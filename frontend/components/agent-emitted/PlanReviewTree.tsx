'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';

interface PlanItem {
  id: string;
  name: string;
  type: 'phase' | 'task' | 'subtask' | 'milestone';
  parentId: string | null;
  depth: number;
  startDate: string | null;
  dueDate: string | null;
  effortInMinutes: number | null;
  description: string | null;
  status: 1 | 2 | 3 | null;
  progress: number | null;
  milestoneCandidate: boolean;
  milestoneReason: string | null;
  dependsOn: string[];
}

interface Plan {
  projectName: string;
  items: PlanItem[];
}

interface PlanReviewTreeProps {
  plan: Plan | unknown;
  stats?: Record<string, number>;
}

/**
 * PlanReviewTree — renders the structured plan as a collapsible tree.
 *
 * Phases at the top level. Each phase expands to show its children
 * (tasks, subtasks, milestones). Milestones get a diamond badge.
 * Dependencies show as small pills on each item.
 *
 * Matches the Stitch plan_validation screen aesthetic: cards with
 * subtle borders, type badges, date ranges, dependency tags.
 */
export function PlanReviewTree({ plan, stats }: PlanReviewTreeProps) {
  const safePlan = plan as Plan;
  if (!safePlan || !Array.isArray(safePlan.items)) {
    return (
      <div className="bg-error-container/30 rounded-2xl p-4 text-error">
        Invalid plan data
      </div>
    );
  }

  // Build child map: parentId → children
  const childrenByParent = new Map<string | null, PlanItem[]>();
  for (const item of safePlan.items) {
    const key = item.parentId ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(item);
  }

  // Top-level items are phases (parentId === null)
  const topLevel = childrenByParent.get(null) ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl shadow-card overflow-hidden"
    >
      <div className="bg-gradient-to-br from-primary/5 via-secondary/5 to-tertiary/5 px-5 py-4 border-b border-outline-variant/20">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg">
                account_tree
              </span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-primary">
                Plan Validation &amp; Review
              </div>
              <div className="text-base font-headline font-bold text-on-surface">
                {safePlan.projectName}
              </div>
            </div>
          </div>
          {stats && (
            <div className="flex flex-wrap gap-1.5">
              {stats.maxDepth !== undefined && (
                <Badge
                  icon="format_indent_increase"
                  label={`Nesting Depth ${stats.maxDepth}`}
                  tone="info"
                />
              )}
              {stats.dependencies !== undefined && stats.dependencies > 0 && (
                <Badge
                  icon="link"
                  label={`${stats.dependencies} Dependencies`}
                  tone="secondary"
                />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar">
        {topLevel.length === 0 ? (
          <div className="text-center text-on-surface-variant text-sm py-8">
            No items in this plan
          </div>
        ) : (
          topLevel.map((item) => (
            <PlanNode
              key={item.id}
              item={item}
              childrenByParent={childrenByParent}
              defaultExpanded
            />
          ))
        )}
      </div>
    </motion.div>
  );
}

interface PlanNodeProps {
  item: PlanItem;
  childrenByParent: Map<string | null, PlanItem[]>;
  defaultExpanded?: boolean;
}

function PlanNode({ item, childrenByParent, defaultExpanded = false }: PlanNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const children = childrenByParent.get(item.id) ?? [];
  const hasChildren = children.length > 0;

  if (item.type === 'phase') {
    return (
      <div className="bg-surface-container-low rounded-2xl border border-outline-variant/20 overflow-hidden">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-surface-container transition-colors"
        >
          <span
            className={cn(
              'material-symbols-outlined text-on-surface-variant transition-transform',
              expanded && 'rotate-90'
            )}
          >
            chevron_right
          </span>
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-base">
              workspaces
            </span>
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="font-headline font-bold text-on-surface text-sm truncate">
              {item.name}
            </div>
            {(item.startDate || item.dueDate) && (
              <div className="text-[11px] text-on-surface-variant">
                {item.startDate ?? '?'} → {item.dueDate ?? '?'}
              </div>
            )}
          </div>
          <Badge icon="workspaces" label="PHASE" tone="primary" />
        </button>

        <AnimatePresence>
          {expanded && hasChildren && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-3 pt-1 space-y-1.5 border-t border-outline-variant/20">
                {children.map((child) => (
                  <PlanNode
                    key={child.id}
                    item={child}
                    childrenByParent={childrenByParent}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // task / subtask / milestone
  const isMilestone = item.type === 'milestone';

  return (
    <div className={cn('ml-4', hasChildren && 'space-y-1.5')}>
      <div
        className={cn(
          'flex items-start gap-3 px-3 py-2 rounded-xl transition-colors',
          isMilestone
            ? 'bg-warning/5 border border-warning/20'
            : 'bg-surface-container-lowest border border-outline-variant/20',
          'hover:border-primary/30'
        )}
      >
        {hasChildren ? (
          <button onClick={() => setExpanded((v) => !v)} className="mt-0.5">
            <span
              className={cn(
                'material-symbols-outlined text-on-surface-variant text-base transition-transform',
                expanded && 'rotate-90'
              )}
            >
              chevron_right
            </span>
          </button>
        ) : (
          <span className="material-symbols-outlined text-outline text-base mt-0.5">
            {isMilestone ? 'flag' : 'radio_button_unchecked'}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              'text-sm font-medium truncate',
              isMilestone ? 'text-warning font-bold' : 'text-on-surface'
            )}
          >
            {item.name}
          </div>
          {(item.startDate || item.dueDate || item.dependsOn.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              {item.startDate && item.dueDate && (
                <span className="text-[10px] text-on-surface-variant">
                  {item.startDate} → {item.dueDate}
                </span>
              )}
              {item.dependsOn.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-info/10 text-info">
                  {item.dependsOn.length} dep
                </span>
              )}
              {item.milestoneCandidate && !isMilestone && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-warning/10 text-warning">
                  milestone candidate
                </span>
              )}
            </div>
          )}
        </div>
        {isMilestone && (
          <Badge icon="flag" label="MILESTONE" tone="warning" />
        )}
      </div>

      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden ml-2 border-l-2 border-outline-variant/20 pl-2"
          >
            {children.map((child) => (
              <PlanNode
                key={child.id}
                item={child}
                childrenByParent={childrenByParent}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface BadgeProps {
  icon: string;
  label: string;
  tone: 'primary' | 'secondary' | 'tertiary' | 'info' | 'success' | 'warning' | 'error';
}

function Badge({ icon, label, tone }: BadgeProps) {
  const tones: Record<BadgeProps['tone'], string> = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    secondary: 'bg-secondary/10 text-secondary border-secondary/20',
    tertiary: 'bg-tertiary/10 text-tertiary border-tertiary/20',
    info: 'bg-info/10 text-info border-info/20',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    error: 'bg-error/10 text-error border-error/20',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border whitespace-nowrap',
        tones[tone]
      )}
    >
      <span className="material-symbols-outlined text-xs">{icon}</span>
      {label}
    </span>
  );
}
