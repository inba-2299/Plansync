import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * create_execution_plan(goal, steps[]) — Group B planning tool.
 *
 * Called at the start of a non-trivial goal. The agent writes its own
 * TODO list as a visible card so the user can see what's coming. The
 * plan is stored in session.remember for future reference and emitted
 * as a display_component for the frontend's ExecutionPlanCard.
 *
 * The agent may re-call this later with an updated plan if it changes
 * approach mid-run.
 */

export interface ExecutionPlanStep {
  id: string;
  label: string;
  status?: 'pending' | 'in_progress' | 'done' | 'error';
  notes?: string;
}

export interface CreateExecutionPlanInput {
  goal: string;
  steps: ExecutionPlanStep[];
}

export async function createExecutionPlanTool(
  input: CreateExecutionPlanInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.goal || typeof input.goal !== 'string') {
    return {
      summary: 'ERROR: create_execution_plan requires `goal` (string)',
    };
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return {
      summary: 'ERROR: create_execution_plan requires `steps` (non-empty array)',
    };
  }

  const steps: ExecutionPlanStep[] = input.steps.map((s, i) => ({
    id: typeof s?.id === 'string' && s.id ? s.id : `step_${i + 1}`,
    label: typeof s?.label === 'string' && s.label ? s.label : `(step ${i + 1})`,
    status: s?.status ?? (i === 0 ? 'in_progress' : 'pending'),
    notes: typeof s?.notes === 'string' ? s.notes : undefined,
  }));

  // Persist in working memory so later calls can inspect / update it
  ctx.session.remember.executionPlan = {
    goal: input.goal,
    steps,
    createdAt: Date.now(),
  };

  return {
    summary: `Execution plan stored. Goal: "${input.goal}". ${steps.length} steps: ${steps
      .map((s) => s.label)
      .join(' → ')}`,
    events: [
      {
        type: 'display_component',
        component: 'ExecutionPlanCard',
        props: {
          goal: input.goal,
          steps,
          updatedAt: Date.now(),
        },
      },
    ],
  };
}
