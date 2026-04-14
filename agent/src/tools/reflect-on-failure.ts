import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * reflect_on_failure(observation, hypothesis, next_action) — Group B tool.
 *
 * Called after any tool failure or validation error. The agent states:
 *   - observation: what actually happened (the error / failure mode)
 *   - hypothesis: why it probably happened (reasoning)
 *   - next_action: what the agent will try next
 *
 * Rendered as a prominent purple ReflectionCard in the UI so the user sees
 * the agent thinking, not flailing. Two to four sentences per field.
 *
 * Not blocking — the agent continues immediately after this tool.
 */

export interface ReflectOnFailureInput {
  observation: string;
  hypothesis: string;
  next_action: string;
}

const MAX_FIELD_CHARS = 1000;

export async function reflectOnFailureTool(
  input: ReflectOnFailureInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  const observation = typeof input?.observation === 'string' ? input.observation.trim() : '';
  const hypothesis = typeof input?.hypothesis === 'string' ? input.hypothesis.trim() : '';
  const next_action = typeof input?.next_action === 'string' ? input.next_action.trim() : '';

  if (!observation || !hypothesis || !next_action) {
    return {
      summary:
        'ERROR: reflect_on_failure requires non-empty `observation`, `hypothesis`, and `next_action` (all strings).',
    };
  }

  const capped = (s: string) =>
    s.length > MAX_FIELD_CHARS ? s.slice(0, MAX_FIELD_CHARS) + '…' : s;

  const payload = {
    observation: capped(observation),
    hypothesis: capped(hypothesis),
    nextAction: capped(next_action),
    timestamp: Date.now(),
  };

  // Also append to a reflections list in working memory for later analysis
  const existing = Array.isArray(ctx.session.remember.reflections)
    ? (ctx.session.remember.reflections as unknown[])
    : [];
  ctx.session.remember.reflections = [...existing, payload];

  return {
    summary: `Reflection recorded. Next action: ${payload.nextAction}`,
    events: [
      {
        type: 'display_component',
        component: 'ReflectionCard',
        props: payload,
      },
    ],
  };
}
