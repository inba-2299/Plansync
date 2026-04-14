import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * display_progress_update(completed, total, currentPhase, detail?) — Group G.
 *
 * Emits a display_component event telling the frontend to render/update the
 * ProgressFeed card with the current execution progress. Called periodically
 * during long-running creation phases (e.g. during create_tasks_bulk).
 *
 * Non-blocking — the loop continues immediately after.
 */

export interface DisplayProgressUpdateInput {
  completed: number;
  total: number;
  currentPhase?: string;
  detail?: string;
}

export async function displayProgressUpdateTool(
  input: DisplayProgressUpdateInput,
  _ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (typeof input?.completed !== 'number' || !Number.isFinite(input.completed)) {
    return { summary: 'ERROR: display_progress_update requires `completed` (number)' };
  }
  if (typeof input?.total !== 'number' || !Number.isFinite(input.total) || input.total < 0) {
    return { summary: 'ERROR: display_progress_update requires `total` (non-negative number)' };
  }

  const pct = input.total > 0 ? Math.round((input.completed / input.total) * 100) : 0;

  return {
    summary: `Progress: ${input.completed}/${input.total} (${pct}%)${input.currentPhase ? ` — phase "${input.currentPhase}"` : ''}${input.detail ? ` — ${input.detail}` : ''}`,
    events: [
      {
        type: 'display_component',
        component: 'ProgressFeed',
        props: {
          completed: input.completed,
          total: input.total,
          percent: pct,
          currentPhase: input.currentPhase,
          detail: input.detail,
          updatedAt: Date.now(),
        },
      },
    ],
  };
}
