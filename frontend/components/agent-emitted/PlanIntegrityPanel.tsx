'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface PlanIntegrityPanelProps {
  stats?: Record<string, number>;
  warnings: string[];
  errors: Array<{ code: string; detail: string }>;
}

/**
 * PlanIntegrityPanel — side panel rendered alongside PlanReviewTree.
 *
 * Shows the validation results: confidence score (computed from errors
 * + warnings), key counts, and a checklist of validation results.
 *
 * Matches the Stitch plan_validation screen "Plan Integrity" right panel.
 */
export function PlanIntegrityPanel({
  stats,
  warnings,
  errors,
}: PlanIntegrityPanelProps) {
  const totalPhases = stats?.phases ?? 0;
  const totalTasks = stats?.tasks ?? 0;
  const totalSubtasks = stats?.subtasks ?? 0;
  const totalMilestones = stats?.milestones ?? 0;
  const total = totalPhases + totalTasks + totalSubtasks + totalMilestones;

  // Confidence score: 100 - (errors * 15) - (warnings * 3), floor at 0
  const confidence = Math.max(0, 100 - errors.length * 15 - warnings.length * 3);
  const confidenceColor =
    confidence >= 90
      ? 'text-success'
      : confidence >= 70
        ? 'text-info'
        : confidence >= 50
          ? 'text-warning'
          : 'text-error';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl shadow-card overflow-hidden h-fit"
    >
      <div className="px-5 py-3 border-b border-outline-variant/20 bg-surface-container-low/30">
        <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
          Plan Integrity
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Confidence score */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Confidence Score
            </span>
            <span className={cn('text-2xl font-headline font-extrabold', confidenceColor)}>
              {confidence}%
            </span>
          </div>
          <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${confidence}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className={cn(
                'h-full rounded-full',
                confidence >= 90
                  ? 'bg-gradient-to-r from-success to-success'
                  : confidence >= 70
                    ? 'bg-gradient-to-r from-primary to-info'
                    : confidence >= 50
                      ? 'bg-gradient-to-r from-warning to-warning'
                      : 'bg-gradient-to-r from-error to-error'
              )}
            />
          </div>
        </div>

        {/* Counts grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatBox value={totalTasks + totalSubtasks} label="Tasks" />
          <StatBox value={totalPhases} label="Phases" />
          <StatBox value={totalMilestones} label="Milestones" />
          <StatBox value={total} label="Total Items" />
        </div>

        {/* Validation results */}
        <div className="space-y-1.5">
          <CheckRow
            ok={errors.length === 0}
            label="No structural errors"
            failLabel={`${errors.length} structural error${errors.length === 1 ? '' : 's'}`}
          />
          <CheckRow
            ok={!warnings.some((w) => /orphan/i.test(w))}
            label="No orphan tasks"
            failLabel="Orphan tasks detected"
          />
          <CheckRow
            ok={!errors.some((e) => e.code === 'CIRCULAR_DEPENDENCY')}
            label="No circular dependencies"
            failLabel="Circular dependency detected"
          />
          <CheckRow
            ok={!errors.some((e) => e.code === 'PHASE_NO_DATES')}
            label="All phase dates set"
            failLabel="Phase missing dates"
          />
          <CheckRow
            ok={!errors.some((e) => e.code === 'BAD_DATE')}
            label="All dates valid"
            failLabel="Invalid dates"
          />
        </div>

        {/* Warning list (truncated) */}
        {warnings.length > 0 && (
          <div className="pt-2 border-t border-outline-variant/20">
            <div className="text-[10px] uppercase tracking-widest font-bold text-warning mb-1.5">
              {warnings.length} warning{warnings.length === 1 ? '' : 's'}
            </div>
            <ul className="space-y-1">
              {warnings.slice(0, 3).map((w, i) => (
                <li key={i} className="text-[11px] text-on-surface-variant flex items-start gap-1.5">
                  <span className="material-symbols-outlined text-warning text-xs flex-shrink-0 mt-0.5">
                    warning
                  </span>
                  <span className="truncate">{w}</span>
                </li>
              ))}
              {warnings.length > 3 && (
                <li className="text-[10px] text-on-surface-variant italic ml-4">
                  ...and {warnings.length - 3} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-surface-container-low rounded-xl px-3 py-2.5">
      <div className="text-2xl font-headline font-extrabold text-on-surface tabular-nums">
        {value.toString().padStart(2, '0')}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mt-0.5">
        {label}
      </div>
    </div>
  );
}

function CheckRow({
  ok,
  label,
  failLabel,
}: {
  ok: boolean;
  label: string;
  failLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className={cn(
          'material-symbols-outlined text-base flex-shrink-0',
          ok ? 'text-success filled' : 'text-warning filled'
        )}
      >
        {ok ? 'check_circle' : 'warning'}
      </span>
      <span className={cn(ok ? 'text-on-surface-variant' : 'text-warning font-medium')}>
        {ok ? label : failLabel}
      </span>
    </div>
  );
}
