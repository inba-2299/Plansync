'use client';

import { motion } from 'framer-motion';
import { Markdown } from '../Markdown';

interface ReflectionCardProps {
  observation: string;
  hypothesis: string;
  nextAction: string;
}

/**
 * ReflectionCard — purple-bordered card emitted by the
 * `reflect_on_failure` tool. Shows the agent's metacognition in three
 * fields: what happened, why I think it happened, what I'll try next.
 *
 * Visual signal: tertiary purple to differentiate from approval and
 * progress cards. Users see the agent THINK rather than flail.
 */
export function ReflectionCard({
  observation,
  hypothesis,
  nextAction,
}: ReflectionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-container-lowest rounded-3xl shadow-card overflow-hidden border-l-4 border-l-tertiary border-y border-r border-y-tertiary/20 border-r-tertiary/20"
    >
      <div className="bg-gradient-to-br from-tertiary/5 to-tertiary-container/5 px-5 py-3 border-b border-tertiary/15">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-tertiary/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-tertiary text-base">
              psychology
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-tertiary">
            Agent Reflection
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <ReflectField
          icon="visibility"
          label="Observation"
          value={observation}
        />
        <ReflectField
          icon="psychology_alt"
          label="Hypothesis"
          value={hypothesis}
        />
        <ReflectField
          icon="trending_flat"
          label="Next action"
          value={nextAction}
          highlight
        />
      </div>
    </motion.div>
  );
}

interface ReflectFieldProps {
  icon: string;
  label: string;
  value: string;
  highlight?: boolean;
}

function ReflectField({ icon, label, value, highlight }: ReflectFieldProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-tertiary/60 text-base flex-shrink-0 mt-0.5">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest font-bold text-tertiary/80 mb-0.5">
          {label}
        </div>
        <div
          className={
            highlight
              ? 'text-sm text-on-surface font-semibold'
              : 'text-sm text-on-surface-variant'
          }
        >
          <Markdown content={value} />
        </div>
      </div>
    </div>
  );
}
