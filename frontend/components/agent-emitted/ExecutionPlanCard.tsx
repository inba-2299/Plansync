'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface ExecutionPlanStep {
  id: string;
  label: string;
  status?: string;
  notes?: string;
}

interface ExecutionPlanCardProps {
  goal: string;
  steps: ExecutionPlanStep[];
}

/**
 * ExecutionPlanCard — renders the agent's own TODO list, emitted by the
 * `create_execution_plan` tool. This is a transparency surface: the user
 * sees what the agent has decided to do BEFORE it does it.
 *
 * The agent may re-emit this card multiple times as it advances or
 * changes plan; the parent Chat.tsx allows multiple ExecutionPlanCard
 * messages in the timeline (no de-duplication).
 */
export function ExecutionPlanCard({ goal, steps }: ExecutionPlanCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl shadow-card overflow-hidden"
    >
      <div className="bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5 px-5 py-3 flex items-center gap-3 border-b border-outline-variant/20">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-base">
            checklist
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-primary">
            Agent execution plan
          </div>
          <div className="text-sm font-headline font-bold text-on-surface truncate">
            {goal}
          </div>
        </div>
      </div>

      <ol className="p-5 space-y-2">
        {steps.map((step, idx) => {
          const status = step.status ?? 'pending';
          const isDone = status === 'done';
          const isInProgress = status === 'in_progress';
          const isError = status === 'error';

          return (
            <li key={step.id} className="flex items-start gap-3">
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                  isDone && 'bg-success/15 text-success',
                  isInProgress && 'bg-primary/15 text-primary',
                  isError && 'bg-error/15 text-error',
                  status === 'pending' && 'bg-surface-container-high text-outline'
                )}
              >
                {isDone ? (
                  <span className="material-symbols-outlined text-base filled" aria-label="Completed">
                    check
                  </span>
                ) : isInProgress ? (
                  <span
                    className="material-symbols-outlined text-base animate-spin"
                    style={{ animationDuration: '2s' }}
                    aria-label="In progress"
                  >
                    progress_activity
                  </span>
                ) : isError ? (
                  <span className="material-symbols-outlined text-base" aria-label="Error">close</span>
                ) : (
                  <span className="text-[10px] font-bold">{idx + 1}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={cn(
                    'text-sm font-medium',
                    isDone && 'text-on-surface-variant line-through',
                    isInProgress && 'text-on-surface',
                    isError && 'text-error',
                    status === 'pending' && 'text-on-surface'
                  )}
                >
                  {step.label}
                </div>
                {step.notes && (
                  <div className="text-xs text-on-surface-variant mt-0.5">
                    {step.notes}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}
