import type { AgentEvent, ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';
import type { CreateTaskInput, RlTaskType } from './create-task';

/**
 * create_tasks_bulk(phaseTempId, tasks[]) — Group E.
 *
 * Creates all tasks in a single phase in one tool call. This is the "hot
 * path" for the execution phase — on a 62-row plan, a single phase may
 * contain 10-20 tasks. Calling create_task 20 times means 20 Claude turns,
 * which is expensive. create_tasks_bulk does them all in one turn.
 *
 * Sequential Rocketlane API calls (no batch API exists). Emits progress
 * updates every PROGRESS_INTERVAL items so the frontend ProgressFeed updates.
 *
 * Tasks MUST be ordered such that parents come before their children
 * (since subtasks resolve parentTempId from idmap, which only has entries
 * for already-created items).
 *
 * Continues past individual failures — logs the error, marks that tempId
 * as failed, and moves on. Returns a summary of {created, failed} so the
 * agent can retry failures via retry_task.
 */

const PROGRESS_INTERVAL = 3;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface BulkTaskItem {
  tempId: string;
  parentTempId?: string;
  taskName: string;
  type?: RlTaskType;
  startDate?: string;
  dueDate?: string;
  effortInMinutes?: number;
  progress?: number;
  status?: 1 | 2 | 3;
  description?: string;
}

export interface CreateTasksBulkInput {
  phaseTempId: string;
  tasks: BulkTaskItem[];
}

interface CreateResult {
  tempId: string;
  taskId?: number;
  error?: string;
}

export async function createTasksBulkTool(
  input: CreateTasksBulkInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.phaseTempId || typeof input.phaseTempId !== 'string') {
    return { summary: 'ERROR: create_tasks_bulk requires `phaseTempId`' };
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    return { summary: 'ERROR: create_tasks_bulk requires `tasks` (non-empty array)' };
  }

  const projectId = ctx.session.meta.rlProjectId;
  if (!projectId) {
    return { summary: 'ERROR: no project created yet. Call create_rocketlane_project first.' };
  }

  const phase = ctx.session.idmap[input.phaseTempId];
  if (!phase || phase.type !== 'phase') {
    return {
      summary: `ERROR: phaseTempId "${input.phaseTempId}" not found in idmap. Create the phase first.`,
    };
  }

  const client = ctx.getRlClient() as RocketlaneClient;
  const total = input.tasks.length;
  const results: CreateResult[] = [];
  const events: AgentEvent[] = [];

  for (let i = 0; i < total; i++) {
    const task = input.tasks[i];

    // Skip if already created (idempotency)
    const existing = ctx.session.idmap[task.tempId];
    if (existing && existing.type === 'task') {
      results.push({ tempId: task.tempId, taskId: existing.rlId });
      continue;
    }

    // Validate per-item
    if (!task?.tempId || typeof task.tempId !== 'string') {
      results.push({ tempId: `index_${i}`, error: 'missing tempId' });
      continue;
    }
    if (!task.taskName || typeof task.taskName !== 'string') {
      results.push({ tempId: task.tempId, error: 'missing taskName' });
      continue;
    }
    if (task.startDate && !DATE_REGEX.test(task.startDate)) {
      results.push({ tempId: task.tempId, error: `bad startDate: ${task.startDate}` });
      continue;
    }
    if (task.dueDate && !DATE_REGEX.test(task.dueDate)) {
      results.push({ tempId: task.tempId, error: `bad dueDate: ${task.dueDate}` });
      continue;
    }

    // Resolve parent
    let parentTaskId: number | undefined;
    if (task.parentTempId) {
      const parent = ctx.session.idmap[task.parentTempId];
      if (!parent || parent.type !== 'task') {
        results.push({
          tempId: task.tempId,
          error: `parentTempId "${task.parentTempId}" not found — parent must be created first`,
        });
        continue;
      }
      parentTaskId = parent.rlId;
    }

    try {
      const result = await client.createTask({
        taskName: task.taskName,
        project: { projectId },
        phase: { phaseId: phase.rlId },
        parent: parentTaskId ? { taskId: parentTaskId } : undefined,
        type: task.type ?? 'TASK',
        startDate: task.startDate,
        dueDate: task.dueDate,
        effortInMinutes: task.effortInMinutes,
        progress: task.progress,
        status: task.status ? { value: task.status } : undefined,
        taskDescription: task.description,
      });

      const raw = result as Record<string, unknown>;
      const taskId = typeof raw.taskId === 'number' ? raw.taskId : undefined;

      if (!taskId) {
        results.push({ tempId: task.tempId, error: `no taskId in response` });
        continue;
      }

      ctx.session.idmap[task.tempId] = {
        type: 'task',
        rlId: taskId,
        tempId: task.tempId,
        parentTempId: task.parentTempId ?? null,
        createdAt: Date.now(),
      };

      results.push({ tempId: task.tempId, taskId });
    } catch (err) {
      const message =
        err instanceof RocketlaneError
          ? `${err.status}: ${err.rlFieldMessage ?? err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      results.push({ tempId: task.tempId, error: message });
    }

    // Progress ping every PROGRESS_INTERVAL items (and at the end)
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i === total - 1) {
      ctx.emit({
        type: 'display_component',
        component: 'ProgressFeed',
        props: {
          completed: i + 1,
          total,
          currentPhase: input.phaseTempId,
          detail: `Creating tasks in ${input.phaseTempId}…`,
          updatedAt: Date.now(),
        },
      });
    }
  }

  const created = results.filter((r) => r.taskId !== undefined).length;
  const failed = results.filter((r) => r.error !== undefined).length;

  const summaryLines: string[] = [];
  summaryLines.push(
    `create_tasks_bulk phase="${input.phaseTempId}": ${created} created, ${failed} failed (total ${total})`
  );

  if (failed > 0) {
    summaryLines.push('');
    summaryLines.push('Failures:');
    for (const r of results.filter((r) => r.error !== undefined).slice(0, 10)) {
      summaryLines.push(`  - ${r.tempId}: ${r.error}`);
    }
    if (failed > 10) summaryLines.push(`  ... and ${failed - 10} more`);
    summaryLines.push('');
    summaryLines.push(
      'For each failure, reflect_on_failure then retry_task with corrected args.'
    );
  }

  return {
    summary: summaryLines.join('\n'),
    events,
  };
}
