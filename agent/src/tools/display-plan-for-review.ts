import type { ToolDispatchContext, ToolDispatchResult, Plan } from '../types';
import type { Session } from '../memory/session';
import { putArtifact } from '../memory/artifacts';

/**
 * display_plan_for_review(plan) — Group G display tool.
 *
 * Renders the structured plan as a PlanReviewTree card in the chat. The
 * agent typically calls this immediately before request_user_approval so
 * the user can see the plan AND approve it in sequence.
 *
 * Stores the plan as an artifact so the agent can reference it later
 * (e.g. during execution) without re-sending the whole blob through
 * conversation history.
 *
 * NOTE: this is a side-effect tool (emits a display_component event).
 * It does NOT block the loop.
 */

export interface DisplayPlanForReviewInput {
  plan: Plan;
}

export async function displayPlanForReviewTool(
  input: DisplayPlanForReviewInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.plan || typeof input.plan !== 'object') {
    return { summary: 'ERROR: display_plan_for_review requires `plan` (structured plan object)' };
  }

  if (!Array.isArray(input.plan.items)) {
    return { summary: 'ERROR: plan.items must be an array' };
  }

  const phases = input.plan.items.filter((i) => i.type === 'phase').length;
  const tasks = input.plan.items.filter((i) => i.type === 'task').length;
  const subtasks = input.plan.items.filter((i) => i.type === 'subtask').length;
  const milestones = input.plan.items.filter((i) => i.type === 'milestone').length;
  const maxDepth = Math.max(0, ...input.plan.items.map((i) => i.depth));
  const dependencies = input.plan.items.reduce(
    (sum, i) => sum + (Array.isArray(i.dependsOn) ? i.dependsOn.length : 0),
    0
  );

  // Persist the plan as an artifact for later reference
  const artifact = await putArtifact({
    sessionId: ctx.sessionId,
    kind: 'plan-tree',
    preview: `${input.plan.projectName}: ${phases} phases, ${tasks} tasks, ${subtasks} subtasks, ${milestones} milestones, ${dependencies} deps, max depth ${maxDepth}`,
    content: input.plan,
  });

  return {
    summary: `Plan rendered for user review: "${input.plan.projectName}" (${phases} phases, ${tasks} tasks, ${subtasks} subtasks, ${milestones} milestones, max depth ${maxDepth}, ${dependencies} dependencies). Stored as artifact "${artifact.id}".`,
    artifactId: artifact.id,
    events: [
      {
        type: 'display_component',
        component: 'PlanReviewTree',
        props: {
          plan: input.plan,
          stats: {
            phases,
            tasks,
            subtasks,
            milestones,
            maxDepth,
            dependencies,
          },
          artifactId: artifact.id,
        },
      },
    ],
  };
}
