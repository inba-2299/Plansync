import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * recall(key) — Group C memory tool.
 *
 * Reads a named fact back from working memory. Complement to remember.
 *
 * If key is omitted or empty string, returns a list of all remembered keys
 * (useful for the agent to check what it has in memory before looking things up).
 */

export interface RecallInput {
  key?: string;
}

const MAX_RESPONSE_CHARS = 4096;

export async function recallTool(
  input: RecallInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  const key = typeof input?.key === 'string' ? input.key : '';

  if (!key) {
    const keys = Object.keys(ctx.session.remember);
    if (keys.length === 0) {
      return { summary: 'Memory is empty. Nothing has been remembered yet.' };
    }
    return {
      summary: `Memory contains ${keys.length} keys: ${keys.join(', ')}. Call recall("<key>") to read a specific value.`,
    };
  }

  if (!(key in ctx.session.remember)) {
    return {
      summary: `No memory key "${key}". Current keys: ${Object.keys(ctx.session.remember).join(', ') || '(none)'}`,
    };
  }

  const value = ctx.session.remember[key];

  let stringified: string;
  try {
    stringified = JSON.stringify(value, null, 2);
  } catch {
    stringified = String(value);
  }

  if (stringified.length > MAX_RESPONSE_CHARS) {
    stringified =
      stringified.slice(0, MAX_RESPONSE_CHARS) +
      `\n\n... (TRUNCATED: full length ${stringified.length} chars)`;
  }

  return {
    summary: `Recalled "${key}":\n${stringified}`,
  };
}
