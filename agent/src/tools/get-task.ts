import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';

/**
 * get_task(rlId | tempId) — Group F verification tool.
 *
 * Read back a task directly from Rocketlane. The agent uses this after
 * create_tasks_bulk to spot-check that tasks were created correctly,
 * especially when validating a large batch.
 *
 * Accepts EITHER a real rlId (number) OR a tempId (string resolved via
 * session.idmap). This lets the agent verify without having to remember
 * which IDs are real and which are temp.
 */

export interface GetTaskInput {
  rlId?: number;
  tempId?: string;
}

export async function getTaskTool(
  input: GetTaskInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  let taskId: number | undefined;

  if (typeof input?.rlId === 'number' && Number.isFinite(input.rlId)) {
    taskId = input.rlId;
  } else if (typeof input?.tempId === 'string' && input.tempId.length > 0) {
    const entry = ctx.session.idmap[input.tempId];
    if (!entry || entry.type !== 'task') {
      return {
        summary: `ERROR: tempId "${input.tempId}" not found in idmap (or is not a task). Current idmap keys: ${Object.keys(ctx.session.idmap).join(', ') || '(empty)'}`,
      };
    }
    taskId = entry.rlId;
  } else {
    return {
      summary: 'ERROR: get_task requires either `rlId` (number) or `tempId` (string in idmap)',
    };
  }

  const client = ctx.getRlClient() as RocketlaneClient;

  try {
    const task = await client.getTask(taskId);
    const raw = task as Record<string, unknown>;

    const summary: Record<string, unknown> = {
      taskId: raw.taskId,
      taskName: raw.taskName,
      type: raw.type,
      startDate: raw.startDate,
      dueDate: raw.dueDate,
      status: raw.status,
      progress: raw.progress,
    };

    // Only include parent/phase if present (avoid printing noise)
    if (raw.parent && typeof raw.parent === 'object') {
      summary.parent = raw.parent;
    }
    if (raw.phase && typeof raw.phase === 'object') {
      summary.phase = raw.phase;
    }

    return {
      summary: `✓ Fetched task ${taskId}:\n${JSON.stringify(summary, null, 2)}`,
    };
  } catch (err) {
    if (err instanceof RocketlaneError) {
      return {
        summary: `Rocketlane error fetching task ${taskId}: ${err.status} ${err.message}. Body: ${JSON.stringify(err.responseBody).slice(0, 400)}`,
      };
    }
    return {
      summary: `Unexpected error fetching task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
