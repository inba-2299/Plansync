'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface ProgressFeedProps {
  completed: number;
  total: number;
  percent?: number;
  currentPhase?: string;
  detail?: string;
}

/**
 * ProgressFeed — live progress bar emitted during execution by
 * `display_progress_update`. Stays at the same position in the timeline;
 * the parent Chat.tsx replaces previous instances rather than appending.
 *
 * Matches the Stitch execution_monitor screen's "Currently Status" hero
 * card with the big phase indicator + percent + progress bar.
 */
export function ProgressFeed({
  completed,
  total,
  percent,
  currentPhase,
  detail,
}: ProgressFeedProps) {
  const pct = percent ?? (total > 0 ? Math.round((completed / total) * 100) : 0);
  const isComplete = completed >= total && total > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl shadow-card overflow-hidden"
    >
      {/* Hero status */}
      <div className="bg-gradient-to-br from-primary/5 to-info/5 px-6 py-5 border-b border-outline-variant/20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">
              Current Status
            </div>
            <div className="font-headline font-extrabold text-on-surface text-xl">
              {isComplete ? 'Phase complete' : `Creating ${completed + 1} of ${total}…`}
            </div>
            {(currentPhase || detail) && (
              <div className="text-xs text-on-surface-variant mt-1">
                {currentPhase && <span className="font-semibold">{currentPhase}</span>}
                {detail && (
                  <>
                    {currentPhase && ' · '}
                    {detail}
                  </>
                )}
              </div>
            )}
          </div>
          <div
            className={cn(
              'text-3xl font-headline font-extrabold tabular-nums',
              isComplete ? 'text-success' : 'text-primary'
            )}
          >
            {pct}%
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 py-4">
        <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className={cn(
              'h-full rounded-full',
              isComplete
                ? 'bg-gradient-to-r from-success to-success'
                : 'bg-gradient-to-r from-primary to-primary-container'
            )}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <div className="text-xs text-on-surface-variant">
            <span className="font-bold text-on-surface tabular-nums">{completed}</span>
            <span className="text-outline"> / </span>
            <span className="tabular-nums">{total}</span>
            <span className="ml-1">items</span>
          </div>
          {!isComplete && (
            <div className="flex items-center gap-1 text-[11px] text-info font-medium">
              <span
                className="material-symbols-outlined text-xs animate-spin"
                style={{ animationDuration: '2s' }}
              >
                progress_activity
              </span>
              <span>Live</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
