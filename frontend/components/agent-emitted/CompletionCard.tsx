'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface CompletionCardProps {
  stats?: Record<string, number>;
  projectUrl?: string;
  projectName?: string;
  /**
   * projectId is accepted for forward-compat but intentionally ignored —
   * we only show the "View in Rocketlane" button when the agent passes a
   * fully-qualified `projectUrl`, because Rocketlane URLs are always
   * workspace-scoped (`{workspace}.rocketlane.com/projects/{id}`) and we
   * cannot synthesize the workspace from the ID alone.
   */
  projectId?: number;
}

/**
 * CompletionCard — the final card rendered after `display_completion_summary`.
 *
 * Shows what was created in Rocketlane with a satisfying summary +
 * a button to view the project. Only emitted once per session at the
 * very end of a successful run.
 */
export function CompletionCard({
  stats,
  projectUrl,
  projectName,
}: CompletionCardProps) {
  const phasesCreated = Number(stats?.phasesCreated ?? 0);
  const tasksCreated = Number(stats?.tasksCreated ?? 0);
  const subtasksCreated = Number(stats?.subtasksCreated ?? 0);
  const milestonesCreated = Number(stats?.milestonesCreated ?? 0);
  const dependenciesCreated = Number(stats?.dependenciesCreated ?? 0);
  const totalCreated = Number(
    stats?.totalCreated ??
      phasesCreated + tasksCreated + subtasksCreated + milestonesCreated
  );
  const failed = Number(stats?.failed ?? 0);
  const durationSeconds = stats?.durationSeconds;

  // Only show the "View in Rocketlane" button when the agent has given us
  // a fully-qualified URL. We used to fall back to
  // `https://app.rocketlane.com/projects/${projectId}` when only `projectId`
  // was provided — but `app.rocketlane.com` is not a real tenant, Rocketlane
  // URLs are always workspace-scoped (`{workspace}.rocketlane.com/projects/{id}`).
  // The system prompt now instructs the agent to always emit a fully-qualified
  // URL; this removes the broken fallback so users never see a dead link.
  const finalUrl =
    typeof projectUrl === 'string' && projectUrl.trim().length > 0
      ? projectUrl
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="bg-surface-container-lowest rounded-3xl shadow-card-lg overflow-hidden border border-success/20"
    >
      {/* Top hero strip */}
      <div className="relative bg-gradient-to-br from-success/10 via-info/5 to-primary/10 px-6 py-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-success/10 rounded-full blur-3xl" />
        <div className="relative flex items-start gap-4">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-success to-success flex items-center justify-center shadow-card-lg flex-shrink-0"
          >
            <span className="material-symbols-outlined filled text-white text-3xl">
              celebration
            </span>
          </motion.div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-success mb-0.5">
              Execution complete
            </div>
            <div className="font-headline font-extrabold text-on-surface text-xl truncate">
              {projectName ?? 'Project created'}
            </div>
            {durationSeconds !== undefined && (
              <div className="text-xs text-on-surface-variant mt-0.5">
                Built in {durationSeconds.toFixed(1)}s
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="px-6 py-5 grid grid-cols-3 sm:grid-cols-5 gap-3">
        <StatBox value={phasesCreated} label="Phases" icon="workspaces" />
        <StatBox value={tasksCreated} label="Tasks" icon="task_alt" />
        <StatBox value={subtasksCreated} label="Subtasks" icon="subdirectory_arrow_right" />
        <StatBox value={milestonesCreated} label="Milestones" icon="flag" tone="warning" />
        <StatBox value={dependenciesCreated} label="Dependencies" icon="link" tone="info" />
      </div>

      {failed > 0 && (
        <div className="mx-6 mb-4 p-3 bg-error-container/20 border border-error/20 rounded-xl flex items-center gap-2">
          <span className="material-symbols-outlined text-error">error</span>
          <div className="text-xs text-on-surface">
            <strong className="text-error">{failed}</strong> item{failed === 1 ? '' : 's'} failed.
            Review the agent log above for details.
          </div>
        </div>
      )}

      <div className="px-6 pb-6 pt-1">
        <div className="text-xs text-on-surface-variant text-center mb-3">
          Total: <span className="font-bold text-on-surface">{totalCreated}</span> items
          synced to Rocketlane
        </div>

        {finalUrl && (
          <a
            href={finalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'block w-full py-3.5 bg-gradient-to-r from-primary to-primary-container text-white',
              'font-headline font-bold text-sm rounded-xl shadow-card text-center',
              'hover:scale-[1.01] active:scale-[0.99] transition-all',
              'flex items-center justify-center gap-2'
            )}
          >
            View in Rocketlane
            <span className="material-symbols-outlined text-base">open_in_new</span>
          </a>
        )}
      </div>
    </motion.div>
  );
}

function StatBox({
  value,
  label,
  icon,
  tone = 'primary',
}: {
  value: number;
  label: string;
  icon: string;
  tone?: 'primary' | 'success' | 'info' | 'warning';
}) {
  const tones = {
    primary: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    info: 'text-info bg-info/10',
    warning: 'text-warning bg-warning/10',
  };
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center mb-1.5',
          tones[tone]
        )}
      >
        <span className="material-symbols-outlined text-base">{icon}</span>
      </div>
      <div className="text-2xl font-headline font-extrabold text-on-surface tabular-nums leading-none">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant mt-1">
        {label}
      </div>
    </div>
  );
}
