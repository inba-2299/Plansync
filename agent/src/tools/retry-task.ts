import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';
import type { CreateTaskInput } from './create-task';

/**
 * retry_task(tempId, fixArgs) — Group F.
 *
 * Targeted retry of a single failed task creation with corrected arguments.
 * If the tempId is already in idmap (previous attempt succeeded), returns
 * early without creating a duplicate.
 *
 * Typical flow: create_tasks_bulk returns { created: 40, failed: 2 } →
 * agent reflects on the failures → calls retry_task for each with fixes.
 */

export async function retryTaskTool(
  input: CreateTaskInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.tempId) {
    return { summary: 'ERROR: retry_task requires `tempId`' };
  }

  // If already succeeded in a previous attempt, skip
  const existing = ctx.session.idmap[input.tempId];
  if (existing && existing.type === 'task') {
    return {
      summary: `Task "${input.tempId}" already successfully created (taskId=${existing.rlId}). Skipping retry.`,
    };
  }

  if (!input.phaseTempId || typeof input.phaseTempId !== 'string') {
    return { summary: 'ERROR: retry_task requires `phaseTempId`' };
  }
  if (!input.taskName || typeof input.taskName !== 'string') {
    return { summary: 'ERROR: retry_task requires `taskName`' };
  }

  const projectId = ctx.session.meta.rlProjectId;
  if (!projectId) {
    return { summary: 'ERROR: no project created yet' };
  }

  const phase = ctx.session.idmap[input.phaseTempId];
  if (!phase || phase.type !== 'phase') {
    return {
      summary: `ERROR: phaseTempId "${input.phaseTempId}" not in idmap`,
    };
  }

  let parentTaskId: number | undefined;
  if (input.parentTempId) {
    const parent = ctx.session.idmap[input.parentTempId];
    if (!parent || parent.type !== 'task') {
      return {
        summary: `ERROR: parentTempId "${input.parentTempId}" not in idmap`,
      };
    }
    parentTaskId = parent.rlId;
  }

  const client = ctx.getRlClient() as RocketlaneClient;

  try {
    const task = await client.createTask({
      taskName: input.taskName,
      project: { projectId },
      phase: { phaseId: phase.rlId },
      parent: parentTaskId ? { taskId: parentTaskId } : undefined,
      type: input.type ?? 'TASK',
      startDate: input.startDate,
      dueDate: input.dueDate,
      effortInMinutes: input.effortInMinutes,
      progress: input.progress,
      status: input.status ? { value: input.status } : undefined,
      taskDescription: input.description,
    });

    const raw = task as Record<string, unknown>;
    const taskId = typeof raw.taskId === 'number' ? raw.taskId : undefined;

    if (!taskId) {
      return {
        summary: `ERROR: retry did not return a taskId. Response: ${JSON.stringify(task).slice(0, 500)}`,
      };
    }

    ctx.session.idmap[input.tempId] = {
      type: 'task',
      rlId: taskId,
      tempId: input.tempId,
      parentTempId: input.parentTempId ?? null,
      createdAt: Date.now(),
    };

    return {
      summary: `✓ Retry succeeded for "${input.tempId}" → taskId=${taskId}`,
    };
  } catch (err) {
    if (err instanceof RocketlaneError) {
      return {
        summary: `Retry failed again: ${err.status} ${err.message}. Body: ${JSON.stringify(err.responseBody).slice(0, 400)}`,
      };
    }
    return {
      summary: `Retry failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
