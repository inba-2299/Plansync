import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * display_completion_summary(stats, projectUrl?) — Group G display tool.
 *
 * Called once at the very end of a successful run. Emits the final
 * CompletionCard with stats and a link to view the created project in
 * Rocketlane. This is the agent's "done" signal to the user.
 */

export interface CompletionStats {
  phasesCreated: number;
  tasksCreated: number;
  subtasksCreated: number;
  milestonesCreated: number;
  dependenciesCreated: number;
  totalCreated: number;
  failed?: number;
  durationSeconds?: number;
}

export interface DisplayCompletionSummaryInput {
  stats: CompletionStats;
  projectUrl?: string;
  projectName?: string;
}

export async function displayCompletionSummaryTool(
  input: DisplayCompletionSummaryInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.stats || typeof input.stats !== 'object') {
    return {
      summary: 'ERROR: display_completion_summary requires `stats` object',
    };
  }

  const stats = input.stats;
  const totalCreated =
    typeof stats.totalCreated === 'number'
      ? stats.totalCreated
      : (stats.phasesCreated ?? 0) +
        (stats.tasksCreated ?? 0) +
        (stats.subtasksCreated ?? 0) +
        (stats.milestonesCreated ?? 0);

  // Update session status
  ctx.session.meta.status = 'done';

  const lines: string[] = [];
  lines.push('✓ Execution complete.');
  lines.push('');
  lines.push(`  Created: ${totalCreated} total`);
  lines.push(`  ├─ ${stats.phasesCreated ?? 0} phases`);
  lines.push(`  ├─ ${stats.tasksCreated ?? 0} tasks`);
  lines.push(`  ├─ ${stats.subtasksCreated ?? 0} subtasks`);
  lines.push(`  ├─ ${stats.milestonesCreated ?? 0} milestones`);
  lines.push(`  └─ ${stats.dependenciesCreated ?? 0} dependencies`);
  if (typeof stats.failed === 'number' && stats.failed > 0) {
    lines.push(`  Failed: ${stats.failed}`);
  }
  if (typeof stats.durationSeconds === 'number') {
    lines.push(`  Duration: ${stats.durationSeconds.toFixed(1)}s`);
  }
  if (input.projectUrl) {
    lines.push('');
    lines.push(`  View in Rocketlane: ${input.projectUrl}`);
  }

  return {
    summary: lines.join('\n'),
    events: [
      {
        type: 'display_component',
        component: 'CompletionCard',
        props: {
          stats: {
            phasesCreated: stats.phasesCreated ?? 0,
            tasksCreated: stats.tasksCreated ?? 0,
            subtasksCreated: stats.subtasksCreated ?? 0,
            milestonesCreated: stats.milestonesCreated ?? 0,
            dependenciesCreated: stats.dependenciesCreated ?? 0,
            totalCreated,
            failed: stats.failed ?? 0,
            durationSeconds: stats.durationSeconds,
          },
          projectUrl: input.projectUrl,
          projectName: input.projectName,
          projectId: ctx.session.meta.rlProjectId,
          completedAt: Date.now(),
        },
      },
    ],
  };
}
