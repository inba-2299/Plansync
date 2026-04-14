import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';

/**
 * create_task(tempId, phaseTempId, parentTempId?, taskName, type?, ...) — Group E.
 *
 * Creates ONE task, subtask, or milestone in Rocketlane.
 *
 *   - For a regular task under a phase: omit parentTempId
 *   - For a subtask: set parentTempId = the parent task's tempId
 *   - For a milestone: set type = "MILESTONE"
 *   - For depth 3+: set parentTempId = the parent subtask's tempId (recursive)
 *
 * phaseTempId must resolve to an existing phase in session.idmap.
 * parentTempId, if provided, must resolve to an existing task in session.idmap.
 */

export type RlTaskType = 'TASK' | 'MILESTONE';

export interface CreateTaskInput {
  tempId: string;
  phaseTempId: string;
  parentTempId?: string;
  taskName: string;
  type?: RlTaskType;
  startDate?: string;
  dueDate?: string;
  effortInMinutes?: number;
  progress?: number; // 0-100
  status?: 1 | 2 | 3; // 1=To do, 2=In progress, 3=Completed
  description?: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function createTaskTool(
  input: CreateTaskInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.tempId || typeof input.tempId !== 'string') {
    return { summary: 'ERROR: create_task requires `tempId`' };
  }
  if (!input?.phaseTempId || typeof input.phaseTempId !== 'string') {
    return { summary: 'ERROR: create_task requires `phaseTempId`' };
  }
  if (!input?.taskName || typeof input.taskName !== 'string') {
    return { summary: 'ERROR: create_task requires `taskName`' };
  }
  if (input.startDate && !DATE_REGEX.test(input.startDate)) {
    return { summary: `ERROR: create_task startDate must be YYYY-MM-DD, got: ${input.startDate}` };
  }
  if (input.dueDate && !DATE_REGEX.test(input.dueDate)) {
    return { summary: `ERROR: create_task dueDate must be YYYY-MM-DD, got: ${input.dueDate}` };
  }

  const projectId = ctx.session.meta.rlProjectId;
  if (!projectId) {
    return { summary: 'ERROR: no project created yet. Call create_rocketlane_project first.' };
  }

  // Resolve phase
  const phase = ctx.session.idmap[input.phaseTempId];
  if (!phase || phase.type !== 'phase') {
    return {
      summary: `ERROR: phaseTempId "${input.phaseTempId}" not found in idmap. Create the phase first with create_phase.`,
    };
  }

  // Resolve parent (if provided)
  let parentTaskId: number | undefined;
  if (input.parentTempId) {
    const parent = ctx.session.idmap[input.parentTempId];
    if (!parent || parent.type !== 'task') {
      return {
        summary: `ERROR: parentTempId "${input.parentTempId}" not found in idmap. Create the parent task first.`,
      };
    }
    parentTaskId = parent.rlId;
  }

  // Idempotency
  const existing = ctx.session.idmap[input.tempId];
  if (existing && existing.type === 'task') {
    return {
      summary: `Task "${input.tempId}" already created (taskId=${existing.rlId}). Skipping.`,
    };
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
        summary: `ERROR: Rocketlane did not return a taskId. Response: ${JSON.stringify(task).slice(0, 500)}`,
      };
    }

    ctx.session.idmap[input.tempId] = {
      type: 'task',
      rlId: taskId,
      tempId: input.tempId,
      parentTempId: input.parentTempId ?? null,
      createdAt: Date.now(),
    };

    const typeLabel = input.type === 'MILESTONE' ? 'milestone' : input.parentTempId ? 'subtask' : 'task';
    return {
      summary: `✓ Created ${typeLabel} "${input.taskName}" tempId=${input.tempId} taskId=${taskId} under phase ${input.phaseTempId}${input.parentTempId ? ` parent=${input.parentTempId}` : ''}`,
    };
  } catch (err) {
    if (err instanceof RocketlaneError) {
      return {
        summary: `Rocketlane error creating task "${input.taskName}": ${err.status} ${err.message}. Body: ${JSON.stringify(err.responseBody).slice(0, 400)}`,
      };
    }
    return {
      summary: `Unexpected error creating task: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
