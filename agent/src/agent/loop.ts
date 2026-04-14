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

const MODEL = 'claude-sonnet-4-5';
const MAX_TURNS = 40;
const MAX_TOKENS = 4096;

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
    emit({ type: 'error', message: 'ANTHROPIC_API_KEY not set' });
    return { outcome: 'error', error: 'ANTHROPIC_API_KEY not set' };
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

    // ---------- Stream the turn ----------

    let finalMessage:
      | {
          stop_reason: string | null;
          content: AnthropicContentBlock[];
        }
      | null = null;

    try {
      const stream = anthropic.messages.stream({
        model: MODEL,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', message: `Anthropic API error: ${message}` });
      return { outcome: 'error', error: message };
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
  });
  return { outcome: 'max_turns' };
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
