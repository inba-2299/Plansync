import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * remember(key, value) — Group C memory tool.
 *
 * Writes a named fact to working memory so it persists across turns
 * WITHOUT cluttering the conversation history. The agent uses this for:
 *   - User preferences ("user_date_format" = "DD/MM/YYYY")
 *   - Resolved ambiguities ("summary_row_skipped" = 1)
 *   - Runtime API corrections ("rl_api_fix:createPhase" = "field X renamed to Y")
 *   - Decisions the agent made and may need to reference later
 *
 * Mutates session.remember in-place; persisted by saveSession() at the
 * end of the turn. Also emits a subtle memory_write event so the UI can
 * show a transient "💾 remembered X" toast.
 */

export interface RememberInput {
  key: string;
  value: unknown;
}

const MAX_KEY_LEN = 128;

export async function rememberTool(
  input: RememberInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.key || typeof input.key !== 'string') {
    return { summary: 'ERROR: remember requires `key` (non-empty string)' };
  }
  if (input.key.length > MAX_KEY_LEN) {
    return {
      summary: `ERROR: remember key too long (${input.key.length} chars, max ${MAX_KEY_LEN})`,
    };
  }
  if (input.value === undefined) {
    return {
      summary: 'ERROR: remember `value` cannot be undefined (use null to explicitly clear)',
    };
  }

  ctx.session.remember[input.key] = input.value;

  // Short preview of the value for the summary
  let preview: string;
  try {
    preview = JSON.stringify(input.value);
    if (preview.length > 100) preview = preview.slice(0, 100) + '…';
  } catch {
    preview = String(input.value);
  }

  return {
    summary: `💾 remembered "${input.key}" = ${preview}`,
    events: [{ type: 'memory_write', key: input.key }],
  };
}
