import type {
  Plan,
  PlanItem,
  PlanStats,
  ToolDispatchContext,
  ToolDispatchResult,
  ValidationError,
  ValidationResult,
} from '../types';
import type { Session } from '../memory/session';
import { putArtifact } from '../memory/artifacts';

/**
 * validate_plan(plan, sourceRowCount?) — Group B tool.
 *
 * Runs 11 programmatic checks on a structured Plan per PRD §5 Tool 3.
 * Returns errors (hard failures that must be fixed) and warnings (soft
 * issues the agent should acknowledge). Agent self-corrects on errors
 * by regenerating the plan and re-calling validate_plan.
 *
 * The 11 checks:
 *   1. Every item has name and type
 *   2. Every parentId references an existing item
 *   3. Orphan items (non-phase with no parent) flagged
 *   4. No circular dependencies
 *   5. Row count matches sourceRowCount (within tolerance)
 *   6. Dates valid YYYY-MM-DD if present
 *   7. Effort values positive integers if present
 *   8. Depth consistency (phase=0, task≥1, subtask≥2)
 *   9. Non-phase items have parentId
 *   10. No duplicate IDs
 *   11. Phase dates present (or derivable from children)
 */

export interface ValidatePlanInput {
  plan: Plan;
  sourceRowCount?: number;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TYPES: ReadonlyArray<PlanItem['type']> = ['phase', 'task', 'subtask', 'milestone'];

export async function validatePlanTool(
  input: ValidatePlanInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // ---------- input sanity ----------

  if (!input?.plan || typeof input.plan !== 'object') {
    return { summary: 'ERROR: validate_plan requires `plan` (object with projectName, items)' };
  }

  const { plan } = input;
  if (typeof plan.projectName !== 'string' || plan.projectName.trim().length === 0) {
    errors.push({ code: 'MISSING_PROJECT_NAME', detail: 'plan.projectName is required' });
  }

  if (!Array.isArray(plan.items)) {
    return { summary: 'ERROR: plan.items must be an array' };
  }

  const items = plan.items;
  const itemsById = new Map<string, PlanItem>();
  const idCounts = new Map<string, number>();

  // ---------- check 1: every item has name and type ----------
  //       check 10: no duplicate IDs
  items.forEach((item, idx) => {
    if (!item || typeof item !== 'object') {
      errors.push({ code: 'INVALID_ITEM', detail: `item at index ${idx} is not an object` });
      return;
    }
    if (!item.id || typeof item.id !== 'string') {
      errors.push({ code: 'MISSING_ID', detail: `item at index ${idx} has no id` });
    } else {
      idCounts.set(item.id, (idCounts.get(item.id) ?? 0) + 1);
      itemsById.set(item.id, item);
    }
    if (!item.name || typeof item.name !== 'string') {
      errors.push({
        code: 'MISSING_NAME',
        detail: `item "${item.id ?? `index ${idx}`}" has no name`,
        itemId: item.id,
      });
    }
    if (!VALID_TYPES.includes(item.type)) {
      errors.push({
        code: 'INVALID_TYPE',
        detail: `item "${item.id ?? `index ${idx}`}" has invalid type: "${item.type}" (expected: ${VALID_TYPES.join(', ')})`,
        itemId: item.id,
      });
    }
  });

  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({
        code: 'DUPLICATE_ID',
        detail: `id "${id}" appears ${count} times`,
      });
    }
  }

  // ---------- check 2: parentId references existing item ----------
  //       check 9: non-phase items have parentId
  //       check 3: orphan detection
  for (const item of items) {
    if (!item || !item.id) continue;

    if (item.type === 'phase') {
      if (item.parentId !== null && item.parentId !== undefined && item.parentId !== '') {
        warnings.push(`phase "${item.id}" has non-null parentId "${item.parentId}" — phases are expected to be top-level`);
      }
    } else {
      // task, subtask, milestone
      if (!item.parentId) {
        errors.push({
          code: 'ORPHAN',
          detail: `${item.type} "${item.id}" ("${item.name}") has no parentId — must be under a phase or another item. Consider grouping under a synthetic "Ungrouped Tasks" phase.`,
          itemId: item.id,
        });
      } else if (!itemsById.has(item.parentId)) {
        errors.push({
          code: 'DANGLING_PARENT',
          detail: `item "${item.id}" has parentId "${item.parentId}" which does not exist in the plan`,
          itemId: item.id,
        });
      }
    }
  }

  // ---------- check 4: no circular dependencies ----------
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function dfs(id: string, path: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      if (cycleStart >= 0) cycles.push([...path.slice(cycleStart), id]);
      return;
    }
    visiting.add(id);
    path.push(id);
    const item = itemsById.get(id);
    if (item && Array.isArray(item.dependsOn)) {
      for (const dep of item.dependsOn) {
        if (typeof dep === 'string') dfs(dep, path);
      }
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of itemsById.keys()) {
    dfs(id, []);
  }

  for (const cycle of cycles) {
    errors.push({
      code: 'CIRCULAR_DEPENDENCY',
      detail: `circular dependency detected: ${cycle.join(' → ')}`,
    });
  }

  // ---------- check 5: row count matches ----------
  if (input.sourceRowCount !== undefined && Number.isFinite(input.sourceRowCount)) {
    const planCount = items.length;
    const diff = input.sourceRowCount - planCount;
    if (Math.abs(diff) > 2) {
      warnings.push(
        `plan has ${planCount} items but source CSV had ${input.sourceRowCount} rows (diff ${diff}). This is OK if empty/summary rows were skipped — confirm the agent intended to drop them.`
      );
    }
  }

  // ---------- check 6: dates valid YYYY-MM-DD ----------
  for (const item of items) {
    if (!item || !item.id) continue;
    if (item.startDate && !DATE_REGEX.test(item.startDate)) {
      errors.push({
        code: 'BAD_DATE',
        detail: `item "${item.id}" startDate "${item.startDate}" is not YYYY-MM-DD format`,
        itemId: item.id,
      });
    }
    if (item.dueDate && !DATE_REGEX.test(item.dueDate)) {
      errors.push({
        code: 'BAD_DATE',
        detail: `item "${item.id}" dueDate "${item.dueDate}" is not YYYY-MM-DD format`,
        itemId: item.id,
      });
    }
    // date ordering: startDate should be <= dueDate
    if (
      item.startDate &&
      item.dueDate &&
      DATE_REGEX.test(item.startDate) &&
      DATE_REGEX.test(item.dueDate) &&
      item.startDate > item.dueDate
    ) {
      errors.push({
        code: 'DATE_ORDER',
        detail: `item "${item.id}" startDate (${item.startDate}) is after dueDate (${item.dueDate})`,
        itemId: item.id,
      });
    }
  }

  // ---------- check 7: effort positive integers ----------
  for (const item of items) {
    if (!item || !item.id) continue;
    if (item.effortInMinutes !== null && item.effortInMinutes !== undefined) {
      if (!Number.isInteger(item.effortInMinutes) || item.effortInMinutes <= 0) {
        errors.push({
          code: 'BAD_EFFORT',
          detail: `item "${item.id}" effortInMinutes must be a positive integer, got: ${item.effortInMinutes}`,
          itemId: item.id,
        });
      }
    }
  }

  // ---------- check 8: depth consistency ----------
  for (const item of items) {
    if (!item || !item.id) continue;
    if (item.type === 'phase' && item.depth !== 0) {
      warnings.push(`phase "${item.id}" has depth ${item.depth} (expected 0)`);
    }
    if (item.type === 'task' && item.depth < 1) {
      warnings.push(`task "${item.id}" has depth ${item.depth} (expected ≥1)`);
    }
    if (item.type === 'subtask' && item.depth < 2) {
      warnings.push(`subtask "${item.id}" has depth ${item.depth} (expected ≥2)`);
    }
  }

  // ---------- check 11: phase dates present (or derivable) ----------
  for (const item of items) {
    if (!item || !item.id || item.type !== 'phase') continue;
    if (!item.startDate || !item.dueDate) {
      const children = items.filter((c) => c && c.parentId === item.id);
      if (children.length === 0) {
        errors.push({
          code: 'PHASE_NO_DATES',
          detail: `phase "${item.id}" has no dates and no children to derive them from. Either provide dates or add child tasks with dates.`,
          itemId: item.id,
        });
      } else {
        const starts = children
          .map((c) => c.startDate)
          .filter((d): d is string => !!d && DATE_REGEX.test(d))
          .sort();
        const dues = children
          .map((c) => c.dueDate)
          .filter((d): d is string => !!d && DATE_REGEX.test(d))
          .sort();
        if (starts.length === 0 || dues.length === 0) {
          errors.push({
            code: 'PHASE_NO_DATES',
            detail: `phase "${item.id}" has no dates and children don't have valid dates either. Must set explicitly.`,
            itemId: item.id,
          });
        } else {
          warnings.push(
            `phase "${item.id}" is missing ${!item.startDate ? 'startDate' : ''}${
              !item.startDate && !item.dueDate ? ' and ' : ''
            }${!item.dueDate ? 'dueDate' : ''} — derivable from children as ${starts[0]} → ${dues[dues.length - 1]}. Fix the plan before execution.`
          );
        }
      }
    }
  }

  // ---------- stats ----------
  const stats: PlanStats = {
    phases: items.filter((i) => i && i.type === 'phase').length,
    tasks: items.filter((i) => i && i.type === 'task').length,
    subtasks: items.filter((i) => i && i.type === 'subtask').length,
    milestones: items.filter((i) => i && i.type === 'milestone').length,
    maxDepth: items.reduce((max, i) => Math.max(max, i?.depth ?? 0), 0),
    dependencies: items.reduce(
      (sum, i) => sum + (Array.isArray(i?.dependsOn) ? i.dependsOn.length : 0),
      0
    ),
  };

  const valid = errors.length === 0;
  const result: ValidationResult = { valid, stats, warnings, errors };

  // Store full report as artifact
  const previewText = valid
    ? `✓ Plan is VALID. ${stats.phases} phases, ${stats.tasks} tasks, ${stats.subtasks} subtasks, ${stats.milestones} milestones, max depth ${stats.maxDepth}, ${stats.dependencies} dependencies. ${warnings.length} warning(s).`
    : `✗ Plan is INVALID. ${errors.length} error(s), ${warnings.length} warning(s).`;

  const artifact = await putArtifact({
    sessionId: ctx.sessionId,
    kind: 'validator-report',
    preview: previewText,
    content: result,
  });

  // Compose response for Claude
  const lines: string[] = [];
  lines.push(valid ? '✓ PLAN VALID' : '✗ PLAN INVALID');
  lines.push('');
  lines.push(
    `Stats: ${stats.phases} phases, ${stats.tasks} tasks, ${stats.subtasks} subtasks, ${stats.milestones} milestones, max depth ${stats.maxDepth}, ${stats.dependencies} dependencies`
  );

  if (errors.length > 0) {
    lines.push('');
    lines.push(`Errors (${errors.length}) — fix these and re-validate:`);
    for (const err of errors.slice(0, 25)) {
      lines.push(`  • [${err.code}] ${err.detail}`);
    }
    if (errors.length > 25) {
      lines.push(
        `  ... and ${errors.length - 25} more (query_artifact "${artifact.id}" "errors[25:50]" for the rest)`
      );
    }
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push(`Warnings (${warnings.length}) — review but not blocking:`);
    for (const w of warnings.slice(0, 15)) {
      lines.push(`  • ${w}`);
    }
    if (warnings.length > 15) {
      lines.push(`  ... and ${warnings.length - 15} more`);
    }
  }

  lines.push('');
  lines.push(`Full report in artifact "${artifact.id}".`);

  return {
    summary: lines.join('\n'),
    artifactId: artifact.id,
  };
}
