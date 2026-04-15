import Anthropic from '@anthropic-ai/sdk';
import type { AgentEvent, AnthropicContentBlock, ToolDispatchContext } from '../types';
import type { Session, PendingApproval } from '../memory/session';
import { RocketlaneClient } from '../rocketlane/client';
import { decrypt } from '../lib/crypto';
import { SYSTEM_PROMPT } from './system-prompt';
import { dispatch, TOOL_SCHEMAS } from '../tools';

/**
 * runAgentLoop — the real ReAct loop.
 *
 * Flow per iteration:
 *   1. Call anthropic.messages.stream with system prompt + history + tools
 *   2. Forward streamed events (text, tool_use start/end, tool input deltas)
 *      to the SSE emitter in real time
 *   3. After stream completes, get the final assembled assistant message
 *   4. Push that to session.history
 *   5. If stop_reason === 'end_turn' → done
 *   6. Otherwise, for each tool_use block in final.content:
 *      a. Dispatch the tool via src/tools/index.ts
 *      b. If it returns blocking=true (only request_user_approval) →
 *         persist pending, emit awaiting_user, return early
 *      c. Otherwise, collect its tool_result for the next turn
 *   7. Append tool_results to history as a single user message
 *   8. Loop
 *
 * Lazy Rocketlane client: the first tool that calls ctx.getRlClient() in a
 * given turn instantiates the client with the decrypted API key; subsequent
 * calls in the same turn reuse it. Fresh instance per turn keeps retry
 * state clean.
 *
 * Web_search is intentionally NOT added to the tools array yet — will add
 * once the core loop is verified end-to-end.
 */

/**
 * Model is configured exclusively via the ANTHROPIC_MODEL env var on
 * Railway. There is NO hardcoded fallback — if the env var isn't set,
 * the loop fails fast with a clear error explaining which values to use.
 * This keeps model choice outside the codebase so switching between
 * Sonnet / Haiku / Opus is a Railway variable edit + restart, not a
 * commit + deploy.
 *
 * Recommended values:
 *   - claude-haiku-4-5  — ~4x cheaper than Sonnet, good for tool-calling
 *   - claude-sonnet-4-5 — higher capability, use if Haiku struggles
 *   - claude-opus-4-5   — highest capability, expensive
 */
const MAX_TURNS = 40;
const MAX_TOKENS = 4096;

/**
 * 429 retry policy. Anthropic returns Retry-After in the response headers
 * when we hit the per-minute TPM/RPM limits. We retry up to 3 times with
 * that delay (clamped to 60s max so the user doesn't sit frozen forever).
 * Between retries we emit a `rate_limited` SSE event so the frontend can
 * render a visible "retrying in Xs" card.
 */
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 20;
const MAX_RETRY_AFTER_SECONDS = 60;

export interface RunAgentLoopResult {
  /** 'done' | 'awaiting_user' | 'error' | 'max_turns' */
  outcome: 'done' | 'awaiting_user' | 'error' | 'max_turns';
  error?: string;
}

export async function runAgentLoop(
  session: Session,
  emit: (event: AgentEvent) => void
): Promise<RunAgentLoopResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emit({
      type: 'error',
      message: 'ANTHROPIC_API_KEY env var is not set on the agent backend.',
      kind: 'generic',
    });
    return { outcome: 'error', error: 'ANTHROPIC_API_KEY not set' };
  }

  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    emit({
      type: 'error',
      message:
        'ANTHROPIC_MODEL env var is not set on the agent backend. Set it on Railway to one of: claude-haiku-4-5 (cheap, recommended), claude-sonnet-4-5 (higher capability), or claude-opus-4-5 (highest capability, expensive), then retry.',
      kind: 'generic',
    });
    return { outcome: 'error', error: 'ANTHROPIC_MODEL not set' };
  }

  const anthropic = new Anthropic({ apiKey });

  while (session.meta.turnCount < MAX_TURNS) {
    session.meta.turnCount++;

    // Lazy RL client — one per turn, reused across all tool calls this turn
    let rlClient: RocketlaneClient | null = null;
    const getRlClient = (): RocketlaneClient => {
      if (rlClient) return rlClient;
      if (!session.meta.rlApiKeyEnc) {
        throw new Error(
          'No Rocketlane API key in session. Use request_user_approval to ask the user first.'
        );
      }
      const plainKey = decrypt(session.meta.rlApiKeyEnc);
      rlClient = new RocketlaneClient({ apiKey: plainKey, maxRetries: 3 });
      return rlClient;
    };

    const ctx: ToolDispatchContext<Session> = {
      sessionId: session.meta.sessionId,
      session,
      emit,
      getRlClient,
    };

    // ---------- Stream the turn (with 429 retry) ----------

    let finalMessage:
      | {
          stop_reason: string | null;
          content: AnthropicContentBlock[];
        }
      | null = null;

    let rateLimitAttempt = 0;
    let streamSucceeded = false;

    while (!streamSucceeded) {
      try {
        const stream = anthropic.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          // Cast to any because the SDK's TextBlockParam type in this version
          // doesn't know about cache_control yet — but the API supports it.
          // Ephemeral cache cuts input tokens ~70% on multi-turn runs.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          system: [
            {
              type: 'text',
              text: SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ] as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: session.history as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: TOOL_SCHEMAS as any,
        });

        const streamState: { currentToolUseId: string | null } = { currentToolUseId: null };

        for await (const event of stream) {
          forwardStreamEvent(event, emit, streamState);
        }

        const final = await stream.finalMessage();
        finalMessage = {
          stop_reason: final.stop_reason ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: final.content as any,
        };
        streamSucceeded = true;
      } catch (err) {
        const classified = classifyAnthropicError(err);

        // Rate limit — retry up to MAX_RATE_LIMIT_RETRIES times with
        // Retry-After backoff. Emit a visible rate_limited event between
        // attempts so the frontend can show a countdown.
        if (classified.kind === 'rate_limit' && rateLimitAttempt < MAX_RATE_LIMIT_RETRIES) {
          rateLimitAttempt++;
          const waitSeconds = Math.min(
            classified.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS,
            MAX_RETRY_AFTER_SECONDS
          );
          emit({
            type: 'rate_limited',
            retryInSeconds: waitSeconds,
            attempt: rateLimitAttempt,
            maxAttempts: MAX_RATE_LIMIT_RETRIES,
            message: classified.message,
          });
          await sleep(waitSeconds * 1000);
          continue; // retry the stream
        }

        // Unrecoverable (out of retries or non-429 error)
        emit({
          type: 'error',
          message: `Anthropic API error: ${classified.message}`,
          kind: classified.kind,
        });
        return { outcome: 'error', error: classified.message };
      }
    }

    if (!finalMessage) {
      // Defensive: we should have either set finalMessage or returned above.
      emit({ type: 'error', message: 'Internal error: no final message from stream', kind: 'generic' });
      return { outcome: 'error', error: 'no_final_message' };
    }

    // Append assistant turn to history
    session.history.push({
      role: 'assistant',
      content: finalMessage.content,
    });

    // ---------- Decide next step ----------

    if (finalMessage.stop_reason === 'end_turn') {
      emit({ type: 'done', stopReason: 'end_turn' });
      return { outcome: 'done' };
    }

    if (finalMessage.stop_reason === 'max_tokens') {
      emit({
        type: 'error',
        message: 'Model response hit max_tokens. Consider raising the limit or asking the agent to be more concise.',
      });
      return { outcome: 'error', error: 'max_tokens' };
    }

    // ---------- Dispatch tool calls ----------

    const toolResults: AnthropicContentBlock[] = [];
    let shouldBlock = false;

    for (const block of finalMessage.content) {
      if (block.type !== 'tool_use') continue;

      // Skip Anthropic server tools (not dispatched locally)
      if (block.name === 'web_search') continue;

      const result = await dispatch(block.name, block.input, ctx);

      // Emit any side-effect events (display_component, journey_update, memory_write)
      if (result.events) {
        for (const ev of result.events) emit(ev);
      }

      // Emit the tool_result summary event for the frontend's ToolCallLine
      emit({
        type: 'tool_result',
        id: block.id,
        summary: result.summary,
      });

      if (result.blocking && block.name === 'request_user_approval') {
        const payload = result.blockingPayload as
          | { question: string; options: PendingApproval['options']; context?: unknown }
          | undefined;

        if (payload) {
          session.pending = {
            toolUseId: block.id,
            question: payload.question,
            options: payload.options,
            context: payload.context,
            createdAt: Date.now(),
          };
        }

        emit({
          type: 'awaiting_user',
          toolUseId: block.id,
          payload: payload ?? null,
        });

        shouldBlock = true;
        break;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.summary,
      });
    }

    if (shouldBlock) {
      // CRITICAL: Stash tool_results for any non-blocking tool_uses that
      // ran BEFORE the request_user_approval in this same assistant turn.
      // Anthropic's API requires that every tool_use block in an assistant
      // message have a matching tool_result in the immediately-following
      // user message. If we just pause and resume with only the approval's
      // tool_result, the earlier tool_uses are orphaned and Anthropic
      // returns a 400:
      //
      //   messages.N: `tool_use` ids were found without `tool_result`
      //   blocks immediately after: toolu_...
      //
      // The /agent route handler, on resuming via uiAction, will prepend
      // these stashed results to the new user message containing the
      // approval's tool_result, so the next Anthropic request sees one
      // tool_result per tool_use.
      session.pendingToolResults = toolResults.length > 0 ? toolResults : null;
      return { outcome: 'awaiting_user' };
    }

    // Append tool results as a single user message for the next turn
    if (toolResults.length > 0) {
      session.history.push({
        role: 'user',
        content: toolResults,
      });
    } else {
      // No tool calls, no end_turn — unusual. Treat as done to avoid infinite loop.
      emit({ type: 'done', stopReason: finalMessage.stop_reason ?? 'unknown' });
      return { outcome: 'done' };
    }
  }

  // Hit max turns
  emit({
    type: 'error',
    message: `Agent exceeded max turns (${MAX_TURNS}). This usually means the agent is stuck in a loop.`,
    kind: 'generic',
  });
  return { outcome: 'max_turns' };
}

// ---------- error classification + retry helpers ----------

interface ClassifiedError {
  kind: 'rate_limit' | 'auth' | 'generic';
  message: string;
  /** Seconds to wait before retrying (from Retry-After header), if known */
  retryAfterSeconds?: number;
}

/**
 * Classify an error thrown by the Anthropic SDK so the retry loop knows
 * whether to back off and retry (rate_limit) or give up (auth / generic).
 *
 * The SDK's APIError type carries `status` (HTTP status) and `headers`
 * (response headers). For 429 we try to parse Retry-After; it can be an
 * integer number of seconds or an HTTP-date. We handle the integer case
 * and fall back to a default for HTTP-dates (rare in practice).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyAnthropicError(err: any): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);
  // Anthropic SDK errors have .status; also check message content as a fallback
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const isRateLimit =
    status === 429 ||
    /rate[_ ]?limit/i.test(message) ||
    /429/.test(message);
  const isAuth = status === 401 || /auth|api[_ ]?key|unauthorized/i.test(message);

  if (isRateLimit) {
    // Try to pull Retry-After from the error's response headers
    let retryAfterSeconds: number | undefined;
    const headers = err?.headers ?? err?.response?.headers;
    if (headers) {
      const raw =
        typeof headers.get === 'function'
          ? headers.get('retry-after')
          : headers['retry-after'] ?? headers['Retry-After'];
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) {
          retryAfterSeconds = parsed;
        }
      }
    }
    return { kind: 'rate_limit', message, retryAfterSeconds };
  }

  if (isAuth) {
    return { kind: 'auth', message };
  }

  return { kind: 'generic', message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- stream event forwarder ----------

interface StreamState {
  currentToolUseId: string | null;
}

/**
 * Map Anthropic streaming events onto our AgentEvent SSE protocol.
 *
 * Anthropic emits (for a single turn):
 *   message_start
 *   content_block_start        (type: text | tool_use | web_search_tool_result | ...)
 *     content_block_delta*     (type: text_delta | input_json_delta | ...)
 *   content_block_stop
 *   ...
 *   message_delta
 *   message_stop
 *
 * We only care about text + tool_use blocks for streaming UI. Tool results
 * from server tools (like web_search_tool_result) are carried in final.content
 * and don't need individual streaming.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function forwardStreamEvent(event: any, emit: (e: AgentEvent) => void, state: StreamState): void {
  if (!event || typeof event !== 'object') return;

  if (event.type === 'content_block_start') {
    const block = event.content_block;
    if (block?.type === 'tool_use') {
      state.currentToolUseId = block.id ?? null;
      emit({
        type: 'tool_use_start',
        id: block.id ?? '',
        name: block.name ?? 'unknown',
      });
    } else {
      state.currentToolUseId = null;
    }
    return;
  }

  if (event.type === 'content_block_delta') {
    const delta = event.delta;
    if (delta?.type === 'text_delta') {
      emit({ type: 'text_delta', text: delta.text ?? '' });
    } else if (delta?.type === 'input_json_delta' && state.currentToolUseId) {
      emit({
        type: 'tool_input_delta',
        id: state.currentToolUseId,
        partialJson: delta.partial_json ?? '',
      });
    }
    return;
  }

  if (event.type === 'content_block_stop') {
    if (state.currentToolUseId) {
      emit({ type: 'tool_use_end', id: state.currentToolUseId });
      state.currentToolUseId = null;
    }
    return;
  }
}
