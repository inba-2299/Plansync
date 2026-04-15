'use client';

import { motion, AnimatePresence } from 'framer-motion';
import type { JourneyStep } from '@/lib/event-types';
import { cn } from '@/lib/cn';

interface JourneyStepperProps {
  steps: JourneyStep[];
}

/**
 * JourneyStepper — sticky horizontal stepper at the top of the chat.
 *
 * Agent-driven. The agent calls `update_journey_state(steps[])` whenever
 * its phase of work changes; the frontend re-renders this component with
 * the new state. State is REPORTED by the agent, not enforced.
 *
 * Standard 6 steps: Connect → Upload → Analyze → Review & Approve →
 * Execute → Complete. But the agent may customize.
 */
export function JourneyStepper({ steps }: JourneyStepperProps) {
  return (
    <div className="border-t border-outline-variant/20 bg-surface/60">
      <div className="max-w-5xl mx-auto px-6 py-3">
        <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-2 flex-shrink-0">
              <StepPill step={step} index={idx} />
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    'h-[2px] w-6 rounded-full transition-colors',
                    step.status === 'done' ? 'bg-success' : 'bg-outline-variant/40'
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface StepPillProps {
  step: JourneyStep;
  index: number;
}

function StepPill({ step }: StepPillProps) {
  const styles = {
    done: 'bg-success/10 text-success border-success/30',
    in_progress:
      'bg-primary/10 text-primary border-primary/40 shadow-card-sm',
    pending: 'bg-surface-container-low text-outline border-outline-variant/30',
    error: 'bg-error/10 text-error border-error/30',
  } as const;

  const icons = {
    done: 'check_circle',
    in_progress: 'progress_activity',
    pending: 'circle',
    error: 'error',
  } as const;

  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={step.status}
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap transition-all',
          styles[step.status]
        )}
      >
        <span
          className={cn(
            'material-symbols-outlined text-base',
            step.status === 'in_progress' && 'animate-spin'
          )}
          style={
            step.status === 'in_progress'
              ? { animationDuration: '2s' }
              : undefined
          }
        >
          {icons[step.status]}
        </span>
        <span>{step.label}</span>
      </motion.div>
    </AnimatePresence>
  );
}
