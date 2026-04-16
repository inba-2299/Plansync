import type {
  AgentEvent,
  Plan,
  PlanItem,
  ToolDispatchContext,
  ToolDispatchResult,
} from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';
import { getArtifact } from '../memory/artifacts';

/**
 * execute_plan_creation(planArtifactId, metadata) — Group E batch tool.
 *
 * Creates an ENTIRE Rocketlane project (project shell + phases + tasks +
 * subtasks + milestones + dependencies) from a validated plan artifact,
 * in a single tool call.
 *
 * Why this exists: the original architecture used fine-grained tools
 * (create_rocketlane_project, create_phase, create_task, create_tasks_bulk,
 * add_dependency) to make the execution phase "agentic." In practice the
 * agent had zero actual thinking to do during execution — the validated
 * plan deterministically maps to a sequence of Rocketlane API calls.
 * Making it walk that sequence turn-by-turn meant:
 *   - 15-30 turns per execution phase (each turn = one API call)
 *   - Each turn re-sends the full history to Anthropic (TPM bloat)
 *   - Sonnet tier-1 30K input TPM wall was hit regularly
 *   - ~$3+ per run on Sonnet
 *
 * This tool batches all that work on the backend. The agent calls it
 * ONCE after plan validation + user approval. The tool:
 *   1. Loads the plan from the artifact store (display_plan_for_review
 *      already stored it there as kind='plan-tree')
 *   2. Creates the project shell
 *   3. Creates phases, tasks, subtasks, milestones in depth order
 *      (pass 1 — populates session.idmap as it goes)
 *   4. Creates dependencies via /tasks/{id}/add-dependencies (pass 2 —
 *      walks plan.items[].dependsOn, resolves tempIds through idmap)
 *   5. Emits display_component ProgressFeed events throughout so the
 *      frontend card updates in real time
 *   6. Returns a summary with counts of created/failed items
 *
 * The fine-grained tools still exist as edge-case fallbacks:
 *   - Manual override (user wants to add/edit one task later)
 *   - Targeted retry when this tool reports partial failures — agent
 *     uses retry_task / create_task to re-try individual items with
 *     corrected args
 *
 * Agent is told in the system prompt to use THIS tool for the happy
 * path and fall back to fine-grained tools only for failure recovery.
 */

export interface ExecutePlanCreationInput {
  /** artifactId returned by display_plan_for_review (or any tool that
   *  stored a plan). Must exist in the session's artifact store. */
  planArtifactId: string;
  /** Metadata collected from the user via sequential approvals */
  projectName: string;
  ownerEmail: string;
  customerName: string;
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  description?: string;
}

interface ItemResult {
  tempId: string;
  type: PlanItem['type'];
  rlId?: number;
  error?: string;
}

interface DependencyResult {
  fromTempId: string;
  toTempId: string;
  ok: boolean;
  error?: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function executePlanCreationTool(
  input: ExecutePlanCreationInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  // ---------- validate inputs ----------

  if (!input?.planArtifactId || typeof input.planArtifactId !== 'string') {
    return {
      summary:
        'ERROR: execute_plan_creation requires `planArtifactId` (the artifact id from display_plan_for_review)',
    };
  }
  if (!input?.projectName || typeof input.projectName !== 'string') {
    return { summary: 'ERROR: execute_plan_creation requires `projectName`' };
  }
  if (!input?.ownerEmail || typeof input.ownerEmail !== 'string') {
    return {
      summary:
        'ERROR: execute_plan_creation requires `ownerEmail` (a TEAM_MEMBER email from get_rocketlane_context)',
    };
  }
  if (!input?.customerName || typeof input.customerName !== 'string') {
    return { summary: 'ERROR: execute_plan_creation requires `customerName`' };
  }
  if (!input?.startDate || !DATE_REGEX.test(input.startDate)) {
    return {
      summary: `ERROR: execute_plan_creation requires \`startDate\` in YYYY-MM-DD format, got: ${input?.startDate}`,
    };
  }
  if (!input?.dueDate || !DATE_REGEX.test(input.dueDate)) {
    return {
      summary: `ERROR: execute_plan_creation requires \`dueDate\` in YYYY-MM-DD format, got: ${input?.dueDate}`,
    };
  }
  if (input.startDate > input.dueDate) {
    return {
      summary: `ERROR: startDate (${input.startDate}) is after dueDate (${input.dueDate})`,
    };
  }

  // ---------- load plan from artifact store ----------

  const artifact = await getArtifact<Plan>(ctx.sessionId, input.planArtifactId);
  if (!artifact) {
    return {
      summary: `ERROR: no plan artifact with id "${input.planArtifactId}". Call display_plan_for_review first so the plan is stored, then pass its returned artifactId here.`,
    };
  }
  const plan = artifact.content;
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
    return {
      summary: `ERROR: artifact "${input.planArtifactId}" does not contain a valid plan (no items)`,
    };
  }

  // ---------- guard against duplicate execution ----------

  if (ctx.session.meta.rlProjectId) {
    return {
      summary: `ERROR: a project has already been created for this session (projectId=${ctx.session.meta.rlProjectId}). Cannot execute plan creation twice. If you need to create a different project, start a new session.`,
    };
  }

  const client = ctx.getRlClient() as RocketlaneClient;

  // ---------- progress bookkeeping ----------

  // Cumulative totals across the entire run (project + all items + all deps)
  const totalItems = plan.items.length;
  const totalDependencies = plan.items.reduce(
    (sum, i) => sum + (Array.isArray(i.dependsOn) ? i.dependsOn.length : 0),
    0
  );
  const totalWork = 1 /* project shell */ + totalItems + totalDependencies;
  let completedWork = 0;

  const emitProgress = (currentStep: string, detail?: string) => {
    const percent = Math.round((completedWork / totalWork) * 100);
    ctx.emit({
      type: 'display_component',
      component: 'ProgressFeed',
      props: {
        completed: completedWork,
        total: totalWork,
        percent,
        currentPhase: currentStep,
        detail: detail ?? undefined,
        updatedAt: Date.now(),
      },
    });
  };

  const events: AgentEvent[] = [];

  // ---------- step 1: create the project shell ----------

  emitProgress('Creating project', `"${input.projectName}"`);

  let projectId: number;
  try {
    const project = await client.createProject({
      projectName: input.projectName,
      owner: { emailId: input.ownerEmail },
      customer: { companyName: input.customerName },
      startDate: input.startDate,
      dueDate: input.dueDate,
      autoCreateCompany: true,
      description: input.description,
    });
    const raw = project as Record<string, unknown>;
    const id = typeof raw.projectId === 'number' ? raw.projectId : undefined;
    if (!id) {
      return {
        summary: `ERROR: Rocketlane did not return a projectId. Response: ${JSON.stringify(project).slice(0, 500)}`,
      };
    }
    projectId = id;
    ctx.session.meta.rlProjectId = projectId;
    completedWork += 1;
    emitProgress('Project created', `projectId=${projectId}`);
  } catch (err) {
    const message =
      err instanceof RocketlaneError
        ? `${err.status}: ${err.rlFieldMessage ?? err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      summary: `FATAL: failed to create project shell — ${message}. Execution aborted before any items were created.`,
    };
  }

  // ---------- step 2: pass 1 — create all items in depth order ----------

  // Sort items by depth ascending so parents come before children. Within
  // each depth, preserve the order they appeared in the plan (stable sort).
  const sortedItems = [...plan.items].sort((a, b) => a.depth - b.depth);

  const itemResults: ItemResult[] = [];

  for (const item of sortedItems) {
    if (!item?.id) {
      itemResults.push({
        tempId: 'unknown',
        type: item?.type ?? 'task',
        error: 'missing id',
      });
      continue;
    }

    // Skip if already created (resumability / idempotency)
    const existing = ctx.session.idmap[item.id];
    if (existing) {
      itemResults.push({ tempId: item.id, type: item.type, rlId: existing.rlId });
      completedWork += 1;
      continue;
    }

    try {
      if (item.type === 'phase') {
        const result = await createPhaseInline(
          client,
          projectId,
          item,
          plan.items
        );
        if (result.error) {
          itemResults.push({
            tempId: item.id,
            type: 'phase',
            error: result.error,
          });
        } else {
          ctx.session.idmap[item.id] = {
            type: 'phase',
            rlId: result.rlId!,
            tempId: item.id,
            parentTempId: null,
            createdAt: Date.now(),
          };
          itemResults.push({
            tempId: item.id,
            type: 'phase',
            rlId: result.rlId,
          });
        }
      } else {
        // task, subtask, or milestone
        const result = await createTaskLike(
          client,
          projectId,
          item,
          plan.items,
          ctx
        );
        if (result.error) {
          itemResults.push({
            tempId: item.id,
            type: item.type,
            error: result.error,
          });
        } else {
          ctx.session.idmap[item.id] = {
            type: 'task',
            rlId: result.rlId!,
            tempId: item.id,
            parentTempId: item.parentId,
            createdAt: Date.now(),
          };
          itemResults.push({
            tempId: item.id,
            type: item.type,
            rlId: result.rlId,
          });
        }
      }
    } catch (err) {
      const message =
        err instanceof RocketlaneError
          ? `${err.status}: ${err.rlFieldMessage ?? err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      itemResults.push({ tempId: item.id, type: item.type, error: message });
    }

    completedWork += 1;

    // Progress ping every 3 items
    if (completedWork % 3 === 0) {
      const typeLabel =
        item.type === 'phase'
          ? 'phases'
          : item.type === 'subtask'
            ? 'subtasks'
            : item.type === 'milestone'
              ? 'milestones'
              : 'tasks';
      emitProgress(
        'Creating items',
        `Just added ${item.type}: "${item.name}" (${typeLabel})`
      );
    }
  }

  // ---------- step 3: pass 2 — create dependencies ----------

  const depResults: DependencyResult[] = [];

  const dependencyEdges: Array<{ from: string; to: string }> = [];
  for (const item of plan.items) {
    if (!item?.id || !Array.isArray(item.dependsOn)) continue;
    for (const dep of item.dependsOn) {
      if (typeof dep === 'string' && dep.length > 0) {
        dependencyEdges.push({ from: item.id, to: dep });
      }
    }
  }

  if (dependencyEdges.length > 0) {
    emitProgress('Linking dependencies', `${dependencyEdges.length} to link`);
  }

  for (const edge of dependencyEdges) {
    const from = ctx.session.idmap[edge.from];
    const to = ctx.session.idmap[edge.to];

    if (!from || from.type !== 'task') {
      depResults.push({
        fromTempId: edge.from,
        toTempId: edge.to,
        ok: false,
        error: `fromTempId "${edge.from}" not in idmap (item probably failed to create)`,
      });
      completedWork += 1;
      continue;
    }
    if (!to || to.type !== 'task') {
      depResults.push({
        fromTempId: edge.from,
        toTempId: edge.to,
        ok: false,
        error: `toTempId "${edge.to}" not in idmap (item probably failed to create)`,
      });
      completedWork += 1;
      continue;
    }

    try {
      await client.addDependencies(from.rlId, {
        dependencies: [{ taskId: to.rlId }],
      });
      depResults.push({ fromTempId: edge.from, toTempId: edge.to, ok: true });
    } catch (err) {
      const message =
        err instanceof RocketlaneError
          ? `${err.status}: ${err.rlFieldMessage ?? err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      depResults.push({
        fromTempId: edge.from,
        toTempId: edge.to,
        ok: false,
        error: message,
      });
    }

    completedWork += 1;

    if (completedWork % 5 === 0) {
      emitProgress(
        'Linking dependencies',
        `${depResults.filter((r) => r.ok).length}/${dependencyEdges.length} linked`
      );
    }
  }

  // ---------- compose summary ----------

  const createdItems = itemResults.filter((r) => r.rlId !== undefined);
  const failedItems = itemResults.filter((r) => r.error !== undefined);
  const createdDeps = depResults.filter((r) => r.ok).length;
  const failedDeps = depResults.filter((r) => !r.ok).length;

  // Final progress ping at 100% — after computing failure counts
  const hasFailures = failedItems.length > 0 || failedDeps > 0;
  emitProgress(
    hasFailures ? 'Complete with errors' : 'Complete',
    hasFailures
      ? `Done — ${failedItems.length} item(s) and ${failedDeps} dependency link(s) failed`
      : 'Project created successfully',
  );

  const phaseCount = createdItems.filter((r) => r.type === 'phase').length;
  const taskCount = createdItems.filter((r) => r.type === 'task').length;
  const subtaskCount = createdItems.filter((r) => r.type === 'subtask').length;
  const milestoneCount = createdItems.filter((r) => r.type === 'milestone').length;

  const lines: string[] = [];
  lines.push(
    `✓ Project "${input.projectName}" created (projectId=${projectId})`
  );
  lines.push(
    `  Phases: ${phaseCount}, Tasks: ${taskCount}, Subtasks: ${subtaskCount}, Milestones: ${milestoneCount}`
  );
  lines.push(`  Dependencies linked: ${createdDeps} / ${dependencyEdges.length}`);
  if (failedItems.length > 0 || failedDeps > 0) {
    lines.push('');
    lines.push(
      `⚠ Failures: ${failedItems.length} item(s) + ${failedDeps} dependency link(s)`
    );
    if (failedItems.length > 0) {
      lines.push('');
      lines.push('Failed items (first 10):');
      for (const f of failedItems.slice(0, 10)) {
        lines.push(`  - ${f.tempId} (${f.type}): ${f.error}`);
      }
      if (failedItems.length > 10) {
        lines.push(`  ... and ${failedItems.length - 10} more`);
      }
      lines.push('');
      lines.push(
        'For each failed item, consider calling retry_task or create_task with corrected args. The idmap has entries for successful items.'
      );
    }
    if (failedDeps > 0) {
      lines.push('');
      lines.push('Failed dependency links (first 5):');
      for (const d of depResults.filter((r) => !r.ok).slice(0, 5)) {
        lines.push(`  - ${d.fromTempId} → ${d.toTempId}: ${d.error}`);
      }
    }
  } else {
    lines.push('');
    lines.push('All items and dependencies created successfully.');
  }

  return {
    summary: lines.join('\n'),
    events,
  };
}

// ---------- helpers ----------

/**
 * Derive phase dates from child tasks if the phase doesn't have explicit dates.
 * Returns { startDate, dueDate } or null if no valid children dates.
 */
function derivePhaseDates(
  phase: PlanItem,
  allItems: PlanItem[]
): { startDate: string; dueDate: string } | null {
  // Explicit dates on the phase take priority
  if (
    phase.startDate &&
    phase.dueDate &&
    DATE_REGEX.test(phase.startDate) &&
    DATE_REGEX.test(phase.dueDate)
  ) {
    return { startDate: phase.startDate, dueDate: phase.dueDate };
  }

  // Walk the tree: collect all descendants recursively
  const descendantDates = collectDescendantDates(phase.id, allItems);
  if (descendantDates.starts.length === 0 || descendantDates.dues.length === 0) {
    return null;
  }
  descendantDates.starts.sort();
  descendantDates.dues.sort();

  return {
    startDate: phase.startDate ?? descendantDates.starts[0],
    dueDate: phase.dueDate ?? descendantDates.dues[descendantDates.dues.length - 1],
  };
}

function collectDescendantDates(
  phaseId: string,
  allItems: PlanItem[]
): { starts: string[]; dues: string[] } {
  const starts: string[] = [];
  const dues: string[] = [];
  const queue: string[] = [phaseId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = allItems.filter((i) => i?.parentId === currentId);
    for (const child of children) {
      if (child.startDate && DATE_REGEX.test(child.startDate)) starts.push(child.startDate);
      if (child.dueDate && DATE_REGEX.test(child.dueDate)) dues.push(child.dueDate);
      queue.push(child.id);
    }
  }
  return { starts, dues };
}

async function createPhaseInline(
  client: RocketlaneClient,
  projectId: number,
  phase: PlanItem,
  allItems: PlanItem[]
): Promise<{ rlId?: number; error?: string }> {
  const dates = derivePhaseDates(phase, allItems);
  if (!dates) {
    return {
      error: `phase "${phase.id}" has no dates and no descendant tasks with dates — cannot create. Validate the plan first.`,
    };
  }

  const created = await client.createPhase({
    phaseName: phase.name,
    project: { projectId },
    startDate: dates.startDate,
    dueDate: dates.dueDate,
    description: phase.description ?? undefined,
  });
  const raw = created as Record<string, unknown>;
  const phaseId = typeof raw.phaseId === 'number' ? raw.phaseId : undefined;
  if (!phaseId) {
    return { error: `Rocketlane returned no phaseId: ${JSON.stringify(created).slice(0, 200)}` };
  }
  return { rlId: phaseId };
}

async function createTaskLike(
  client: RocketlaneClient,
  projectId: number,
  item: PlanItem,
  allItems: PlanItem[],
  ctx: ToolDispatchContext<Session>
): Promise<{ rlId?: number; error?: string }> {
  // Find the phase ancestor by walking parentId chain
  const phaseAncestorId = findPhaseAncestor(item, allItems);
  if (!phaseAncestorId) {
    return {
      error: `${item.type} "${item.id}" has no phase ancestor in the plan — cannot determine which phase it belongs to`,
    };
  }

  const phaseMapping = ctx.session.idmap[phaseAncestorId];
  if (!phaseMapping || phaseMapping.type !== 'phase') {
    return {
      error: `phase ancestor "${phaseAncestorId}" for ${item.type} "${item.id}" not yet created (or failed) in pass 1`,
    };
  }

  // Parent task (for subtasks and deeply nested items) — parentId points to
  // the direct parent, which may be a task or subtask. For a task directly
  // under a phase, parentId === phaseAncestorId and we leave parentTaskId
  // undefined (Rocketlane treats it as a top-level task in the phase).
  let parentTaskId: number | undefined;
  if (item.parentId && item.parentId !== phaseAncestorId) {
    const parentMapping = ctx.session.idmap[item.parentId];
    if (!parentMapping || parentMapping.type !== 'task') {
      return {
        error: `parent "${item.parentId}" for ${item.type} "${item.id}" not yet created (or failed) in pass 1`,
      };
    }
    parentTaskId = parentMapping.rlId;
  }

  // Determine Rocketlane task type
  const rlType: 'TASK' | 'MILESTONE' =
    item.type === 'milestone' || item.milestoneCandidate ? 'MILESTONE' : 'TASK';

  const created = await client.createTask({
    taskName: item.name,
    project: { projectId },
    phase: { phaseId: phaseMapping.rlId },
    parent: parentTaskId ? { taskId: parentTaskId } : undefined,
    type: rlType,
    startDate: item.startDate ?? undefined,
    dueDate: item.dueDate ?? undefined,
    effortInMinutes: item.effortInMinutes ?? undefined,
    progress: item.progress ?? undefined,
    status: item.status ? { value: item.status } : undefined,
    taskDescription: item.description ?? undefined,
  });

  const raw = created as Record<string, unknown>;
  const taskId = typeof raw.taskId === 'number' ? raw.taskId : undefined;
  if (!taskId) {
    return { error: `Rocketlane returned no taskId: ${JSON.stringify(created).slice(0, 200)}` };
  }
  return { rlId: taskId };
}

function findPhaseAncestor(
  item: PlanItem,
  allItems: PlanItem[]
): string | null {
  if (item.type === 'phase') return item.id;
  let currentId = item.parentId;
  const maxHops = 20;
  let hops = 0;
  while (currentId && hops < maxHops) {
    const parent = allItems.find((i) => i?.id === currentId);
    if (!parent) return null;
    if (parent.type === 'phase') return parent.id;
    currentId = parent.parentId;
    hops++;
  }
  return null;
}
