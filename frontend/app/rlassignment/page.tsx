'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/* ------------------------------------------------------------------ */
/*  Section nav items                                                  */
/* ------------------------------------------------------------------ */
const NAV_ITEMS = [
  { id: 'objective', label: 'Objective' },
  { id: 'scope', label: 'Scope' },
  { id: 'design', label: 'Agent Design' },
  { id: 'deploy', label: 'Deploy & Use' },
  { id: 'security', label: 'Security' },
  { id: 'stack', label: 'Tech Stack' },
  { id: 'team', label: 'Team' },
];

/* ------------------------------------------------------------------ */
/*  Icon helper (Material Symbols already loaded in layout.tsx)        */
/* ------------------------------------------------------------------ */
function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable components                                                */
/* ------------------------------------------------------------------ */
function SectionHeading({ id, label, sub }: { id: string; label: string; sub: string }) {
  return (
    <div id={id} className="scroll-mt-20 mb-8 md:mb-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-tertiary mb-1.5">{sub}</p>
      <h2 className="font-headline text-2xl md:text-3xl font-extrabold text-on-surface">{label}</h2>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-container-lowest rounded-2xl shadow-card border border-outline-variant/30 p-6 md:p-8 ${className}`}>
      {children}
    </div>
  );
}

function Badge({ children, color = 'primary' }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    primary: 'bg-primary-fixed text-primary-on-fixed',
    secondary: 'bg-secondary-fixed text-secondary-on-fixed',
    tertiary: 'bg-tertiary-fixed text-tertiary-on-fixed',
    success: 'bg-emerald-50 text-emerald-700',
    outline: 'bg-surface-container text-on-surface-variant',
  };
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${colors[color] ?? colors.primary}`}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  SCOPE CARDS DATA                                                   */
/* ------------------------------------------------------------------ */
const SCOPE_CARDS = [
  {
    icon: 'psychology',
    title: 'Agent Core',
    badge: 'Shipped',
    items: [
      'Streaming ReAct loop with live reasoning',
      'Static system prompt with full autonomy matrix',
      'Working memory (remember / recall)',
      'Self-correction on validation errors',
    ],
  },
  {
    icon: 'build',
    title: '22 Agent Tools',
    badge: 'Shipped',
    items: [
      '1 batch execution + 6 fine-grained fallbacks',
      '11 programmatic validation checks',
      'Runtime docs recovery via web search',
      'Interactive approvals with pre-populated options',
    ],
  },
  {
    icon: 'dashboard',
    title: 'Chat Interface',
    badge: 'Shipped',
    items: [
      'Split workspace (user 40% / agent 60%)',
      '14 agent-emitted display components',
      'Refresh-safe via Redis event replay',
      'Journey stepper driven by the agent',
    ],
  },
  {
    icon: 'extension',
    title: 'Custom App within Rocketlane',
    badge: 'Shipped',
    items: [
      '199 KB zip built via @rocketlane/rli CLI',
      'Widget at left nav + project tab surfaces',
      'Live iframe to Vercel (auto-updates)',
      'Verified inside inbarajb.rocketlane.com',
    ],
  },
  {
    icon: 'admin_panel_settings',
    title: 'Admin Portal',
    badge: 'Bonus',
    items: [
      'Runtime config: model, tokens, retries',
      '22-tool grid with toggle on/off',
      'Observability: 6 stat cards, ~200ms load',
      'HMAC-signed cookie auth, fail-closed',
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  TOOL GROUPS DATA                                                   */
/* ------------------------------------------------------------------ */
const TOOL_GROUPS = [
  { label: 'Input & Context', count: 3, color: 'bg-blue-50 text-blue-700 border-blue-200', tools: 'parse_csv, get_rocketlane_context, query_artifact' },
  { label: 'Planning', count: 4, color: 'bg-violet-50 text-violet-700 border-violet-200', tools: 'validate_plan, create_execution_plan, update_journey_state, reflect_on_failure' },
  { label: 'Memory', count: 2, color: 'bg-amber-50 text-amber-700 border-amber-200', tools: 'remember, recall' },
  { label: 'HITL', count: 1, color: 'bg-rose-50 text-rose-700 border-rose-200', tools: 'request_user_approval (the only blocking tool)' },
  { label: 'Creation', count: 6, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', tools: 'execute_plan_creation, create_phase, create_task, create_tasks_bulk, add_dependency, retry_task' },
  { label: 'Verification', count: 2, color: 'bg-cyan-50 text-cyan-700 border-cyan-200', tools: 'get_task, retry_task' },
  { label: 'Display', count: 3, color: 'bg-pink-50 text-pink-700 border-pink-200', tools: 'display_plan_for_review, display_progress_update, display_completion_summary' },
  { label: 'Recovery', count: 1, color: 'bg-orange-50 text-orange-700 border-orange-200', tools: 'web_search (Anthropic server tool)' },
];

/* ------------------------------------------------------------------ */
/*  TECH STACK DATA                                                    */
/* ------------------------------------------------------------------ */
const TECH_STACK = [
  { layer: 'Frontend', choice: 'Next.js 14, Tailwind, Framer Motion', why: 'Split-layout chat UI with SSE streaming and smooth animations' },
  { layer: 'Backend', choice: 'Node 20 + Express on Railway', why: 'No timeout limit for long-running agent loops (Vercel caps at 60s)' },
  { layer: 'AI Model', choice: 'Claude Haiku / Sonnet / Opus 4.5', why: 'Best-in-class tool use; live-swappable via admin portal without redeploy' },
  { layer: 'State', choice: 'Upstash Redis (REST)', why: 'Serverless Redis for session persistence, event logs, working memory' },
  { layer: 'Integration', choice: 'Rocketlane REST API', why: 'Direct API calls with idempotency keys and rate-limit retry' },
  { layer: 'Deployment', choice: 'Vercel + Railway (one git push)', why: 'Decoupled: each service runs what it is optimized for' },
  { layer: 'Custom App', choice: '@rocketlane/rli CLI', why: 'Official build tool produces the zip Rocketlane accepts' },
];

/* ------------------------------------------------------------------ */
/*  TEAM COMPARISON DATA                                               */
/* ------------------------------------------------------------------ */
const TEAM_ROWS = [
  {
    area: 'Architecture & System Design',
    inba: 'Designed the agent-vs-workflow distinction. Chose decoupled Vercel + Railway. Defined the 22-tool taxonomy and the autonomy matrix.',
    claude: 'Drafted code scaffolds and proposed trade-offs based on the architectural direction set by Inba.',
  },
  {
    area: 'Rocketlane Domain Expertise',
    inba: 'Mapped the RL data model from firsthand workspace experience. Identified API quirks via live testing. Built and installed the Custom App.',
    claude: 'Implemented the API client and tools based on verified endpoint shapes and real response contracts.',
  },
  {
    area: 'System Prompt Engineering',
    inba: 'Wrote the PM domain knowledge and autonomy matrix. Hardened the prompt after catching a production prose-asking bug.',
    claude: 'Helped compose prompt text and iterate wording. Implemented the HARD RULE sections after Inba diagnosed the bug.',
  },
  {
    area: 'Quality & Cost Optimization',
    inba: 'Flagged the $3/run cost problem. Drove the batch-tool architectural reversal ($3 to $0.86). Caught the 15s dashboard load. Demanded refresh-safe sessions.',
    claude: 'Implemented fixes after direction was set. Measured token savings and reported results.',
  },
  {
    area: 'Testing & Verification',
    inba: 'End-to-end testing against live Rocketlane workspace. Edge-case scenario design. Admin portal v2 production verification.',
    claude: 'Executed test scripts. Documented results and flagged deferred items.',
  },
  {
    area: 'Decision Making',
    inba: 'Every architectural reversal (batch tool, rli pivot, pre-computed counters, prompt hardening) was initiated by Inba after real-world testing.',
    claude: 'Proposed options with trade-offs. Inba evaluated and chose.',
  },
];

/* ------------------------------------------------------------------ */
/*  AUTONOMY MATRIX DATA                                               */
/* ------------------------------------------------------------------ */
const AUTONOMY = {
  act: ['Infer hierarchy from structural signals', 'Calculate phase dates from children', 'Normalize dates to YYYY-MM-DD', 'Detect milestones from keywords', 'Self-correct validation errors'],
  inform: ['Column mapping interpretation', 'Dependency detection & notation', 'Orphan item grouping', 'Date format detection', 'Status value interpretation'],
  ask: ['Ambiguous DD/MM dates', 'Multiple Excel sheets', 'Deep nesting beyond depth 3', 'Project name & customer & owner', 'Final plan approval (non-negotiable)'],
};

/* ================================================================== */
/*  PAGE COMPONENT                                                     */
/* ================================================================== */
const ZOOM_LEVELS = [
  { label: 'A', zoom: 1, title: 'Default' },
  { label: 'A', zoom: 1.1, title: 'Medium' },
  { label: 'A', zoom: 1.2, title: 'Large' },
];

export default function RLAssignmentPage() {
  const [activeSection, setActiveSection] = useState('objective');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' }
    );

    for (const item of NAV_ITEMS) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-surface font-body text-on-surface" style={{ zoom }}>
      {/* ── Sticky nav ── */}
      <nav className="sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-lg border-b border-outline-variant/30">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex items-center h-14 gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}>
          <Link href="/" className="flex items-center gap-1.5 mr-4 shrink-0">
            <Icon name="bolt" className="text-tertiary text-xl" />
            <span className="font-headline font-extrabold text-sm text-on-surface">Plansync</span>
          </Link>
          <div className="h-5 w-px bg-outline-variant/40 mr-2 shrink-0" />
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors shrink-0 ${
                activeSection === item.id
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {item.label}
            </a>
          ))}

          {/* Zoom control */}
          <div className="ml-auto shrink-0 flex items-center gap-0.5 bg-surface-container rounded-full p-0.5">
            {ZOOM_LEVELS.map((s) => (
              <button
                key={s.zoom}
                onClick={() => setZoom(s.zoom)}
                title={s.title}
                className={`rounded-full w-7 h-7 flex items-center justify-center transition-colors ${
                  zoom === s.zoom
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
                style={{ fontSize: s.zoom === 1 ? 11 : s.zoom === 1.1 ? 13 : 15 }}
              >
                <span className="font-semibold">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ── Hero / Objective ── */}
      <section id="objective" className="scroll-mt-20 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-tertiary/[0.04]" />
        <div className="relative max-w-[1440px] mx-auto px-6 lg:px-10 pt-14 pb-10 md:pt-20 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Left — text */}
            <div>
              <Badge color="tertiary">Rocketlane Implementation Manager Assignment</Badge>
              <h1 className="font-headline text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold mt-4 leading-[1.1]">
                Plansync
              </h1>
              <p className="text-base md:text-lg text-on-surface-variant mt-3 leading-relaxed">
                An AI agent that reads a project plan file and creates it as a fully structured
                project in Rocketlane &mdash; phases, tasks, subtasks, milestones, and dependencies.
                <span className="text-on-surface font-medium"> No manual recreation. No row-by-row rebuilding. Just upload and let the agent do the work.</span>
              </p>

              {/* Key metrics */}
              <div className="flex flex-wrap gap-3 mt-6">
                {[
                  { value: '22', label: 'Agent Tools' },
                  { value: '3.5s', label: 'Execution Time' },
                  { value: '$0.86', label: 'Per Run (Sonnet)' },
                  { value: '0', label: 'Manual Steps' },
                ].map((m) => (
                  <div key={m.label} className="bg-surface-container-lowest rounded-xl shadow-card-sm border border-outline-variant/20 px-4 py-2.5">
                    <div className="font-headline text-xl font-extrabold text-primary">{m.value}</div>
                    <div className="text-[10px] text-on-surface-variant font-medium">{m.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 mt-6">
                <a href="https://plansync-tau.vercel.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-primary text-on-primary font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-primary-container transition-colors">
                  <Icon name="open_in_new" className="text-lg" /> Try the Agent
                </a>
                <a href="https://github.com/inba-2299/Plansync" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-surface-container text-on-surface font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-surface-container-high transition-colors border border-outline-variant/30">
                  <Icon name="code" className="text-lg" /> Source Code
                </a>
              </div>
            </div>

            {/* Right — animated agent flow */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="relative w-full max-w-md">
                {/* Background glow */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-tertiary/10 to-secondary/10 rounded-3xl blur-3xl" />

                <div className="relative flex flex-col items-center gap-3">
                  {/* Step 1: Upload */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/30 px-5 py-3 flex items-center gap-3 w-64"
                  >
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Icon name="upload_file" className="text-primary text-lg" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-on-surface">Upload Plan</div>
                      <div className="text-[10px] text-on-surface-variant">CSV or Excel file</div>
                    </div>
                  </motion.div>

                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} transition={{ delay: 0.5 }}>
                    <Icon name="arrow_downward" className="text-outline text-sm" />
                  </motion.div>

                  {/* Step 2: Agent Brain */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.6 }}
                    className="relative"
                  >
                    <div className="bg-gradient-to-br from-primary to-tertiary rounded-2xl shadow-card-lg p-5 w-72">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                          <Icon name="psychology" className="text-white text-lg" />
                        </div>
                        <div className="text-sm font-bold text-white">Agent Brain</div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {['Analyze', 'Validate', 'Plan', 'Execute'].map((label, i) => (
                          <motion.div
                            key={label}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.9 + i * 0.15 }}
                            className="bg-white/15 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-white/90 text-center"
                          >
                            {label}
                          </motion.div>
                        ))}
                      </div>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.6 }}
                        className="flex items-center gap-1.5 mt-3 text-[10px] text-white/70"
                      >
                        <Icon name="build" className="text-xs" />
                        22 tools &middot; ReAct loop &middot; Self-correcting
                      </motion.div>
                    </div>
                    {/* Pulse ring */}
                    <motion.div
                      className="absolute -inset-1 rounded-2xl border border-tertiary/30"
                      animate={{ scale: [1, 1.03, 1], opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </motion.div>

                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.4 }} transition={{ delay: 1.4 }}>
                    <Icon name="arrow_downward" className="text-outline text-sm" />
                  </motion.div>

                  {/* Step 3: Rocketlane Project */}
                  <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 1.6 }}
                    className="bg-surface-container-lowest rounded-xl shadow-card border border-success/30 px-5 py-3 w-64"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                        <Icon name="check_circle" className="text-success text-lg" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-on-surface">Rocketlane Project</div>
                        <div className="text-[10px] text-on-surface-variant">Phases, tasks, milestones, deps</div>
                      </div>
                    </div>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: '100%' }}
                      transition={{ delay: 2.0, duration: 0.8, ease: 'easeOut' }}
                      className="h-0.5 bg-gradient-to-r from-success/50 to-success/0 rounded-full mt-2"
                    />
                  </motion.div>

                  {/* Execution time badge */}
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 2.5, duration: 0.4 }}
                    className="bg-surface-container rounded-full px-3 py-1 text-[10px] font-semibold text-tertiary border border-tertiary/20"
                  >
                    Completed in 3.5 seconds
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Implementation Scope ── */}
      <section className="py-10 md:py-14 bg-surface-container-low/50">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <SectionHeading id="scope" label="Implementation Scope" sub="What shipped" />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SCOPE_CARDS.map((card) => (
              <Card key={card.title}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon name={card.icon} className="text-primary text-xl" />
                    </div>
                    <h3 className="font-headline font-bold text-base text-on-surface">{card.title}</h3>
                  </div>
                  <Badge color={card.badge === 'Bonus' ? 'tertiary' : 'success'}>{card.badge}</Badge>
                </div>
                <ul className="space-y-1.5">
                  {card.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[13px] text-on-surface-variant leading-snug">
                      <Icon name="check_circle" className="text-success text-sm mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

            {/* CTA card */}
            <Card className="flex flex-col items-center justify-center text-center bg-gradient-to-br from-primary/[0.04] to-tertiary/[0.06]">
              <Icon name="description" className="text-tertiary text-3xl mb-2" />
              <h3 className="font-headline font-bold text-base mb-1">Full Scope Document</h3>
              <p className="text-xs text-on-surface-variant mb-4">Detailed breakdown of what was built, what was descoped, and the post-submission roadmap.</p>
              <Link href="/rlassignment/scope" className="inline-flex items-center gap-1.5 bg-tertiary text-on-tertiary font-semibold text-xs px-4 py-2 rounded-lg hover:bg-tertiary-container transition-colors">
                <Icon name="arrow_forward" className="text-sm" /> View Scope Details
              </Link>
            </Card>
          </div>

          {/* Batch tool callout */}
          <div className="mt-6 bg-surface-container-lowest rounded-2xl shadow-card border border-tertiary/20 p-6 flex flex-col md:flex-row items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-tertiary/10 flex items-center justify-center shrink-0">
              <Icon name="trending_down" className="text-tertiary text-2xl" />
            </div>
            <div>
              <h3 className="font-headline font-bold text-sm text-on-surface">Key Decision: Batch Execution Tool</h3>
              <p className="text-[13px] text-on-surface-variant mt-1 leading-relaxed">
                The original design had the agent create each phase and task one-by-one (15-30 tool calls per run). After testing in production, we reversed the architecture:
                a single <code className="font-mono text-xs bg-surface-container px-1 py-0.5 rounded">execute_plan_creation</code> tool now handles the entire creation sequence in one backend call.
                The fine-grained tools remain as fallbacks for error recovery.
              </p>
              <div className="flex gap-6 mt-3">
                <div><span className="font-headline font-extrabold text-tertiary text-lg">3.5&times;</span><span className="text-xs text-on-surface-variant ml-1">cheaper ($3 &rarr; $0.86)</span></div>
                <div><span className="font-headline font-extrabold text-tertiary text-lg">35&times;</span><span className="text-xs text-on-surface-variant ml-1">faster (120s &rarr; 3.5s)</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Agent Design ── */}
      <section className="py-10 md:py-14">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <SectionHeading id="design" label="Agent Design" sub="How it thinks" />

          {/* Pipeline */}
          <Card className="mb-6">
            <h3 className="font-headline font-bold text-sm mb-4 text-on-surface">The ReAct Loop</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              {[
                { icon: 'article', label: 'System Prompt', sub: 'PM knowledge + API reference + rules', link: '/rlassignment/prompt' },
                { icon: 'sync', label: 'ReAct Loop', sub: 'Reason \u2192 Act \u2192 Observe \u2192 Repeat' },
                { icon: 'build', label: '22 Tools', sub: '7 groups by function' },
                { icon: 'cloud', label: 'Rocketlane API', sub: 'Direct REST calls' },
              ].map((step: { icon: string; label: string; sub: string; link?: string }, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  {step.link ? (
                    <Link href={step.link} className="bg-surface-container rounded-xl px-4 py-3 flex items-center gap-2.5 min-w-[140px] hover:bg-primary/10 hover:border-primary/30 border border-transparent transition-colors group">
                      <Icon name={step.icon} className="text-primary text-lg" />
                      <div>
                        <div className="text-on-surface font-semibold group-hover:text-primary flex items-center gap-1">
                          {step.label}
                          <Icon name="open_in_new" className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="text-[10px] text-on-surface-variant font-normal">{step.sub}</div>
                      </div>
                    </Link>
                  ) : (
                    <div className="bg-surface-container rounded-xl px-4 py-3 flex items-center gap-2.5 min-w-[140px]">
                      <Icon name={step.icon} className="text-primary text-lg" />
                      <div>
                        <div className="text-on-surface font-semibold">{step.label}</div>
                        <div className="text-[10px] text-on-surface-variant font-normal">{step.sub}</div>
                      </div>
                    </div>
                  )}
                  {i < 3 && <Icon name="arrow_forward" className="text-outline text-base shrink-0 hidden sm:block" />}
                </div>
              ))}
            </div>
          </Card>

          {/* Tool groups */}
          <Card className="mb-6">
            <h3 className="font-headline font-bold text-sm mb-4 text-on-surface">22 Tools in 8 Groups</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {TOOL_GROUPS.map((g) => (
                <div key={g.label} className={`rounded-lg border px-3 py-2.5 ${g.color}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs">{g.label}</span>
                    <span className="text-[10px] font-bold opacity-70">{g.count}</span>
                  </div>
                  <p className="text-[10px] leading-snug opacity-80 font-mono">{g.tools}</p>
                </div>
              ))}
            </div>
          </Card>

          {/* Autonomy matrix */}
          <Card>
            <h3 className="font-headline font-bold text-sm mb-4 text-on-surface">Autonomy Matrix &mdash; When to Act vs. Ask</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Icon name="bolt" className="text-emerald-600 text-lg" />
                  <span className="font-semibold text-xs text-emerald-700">Acts Autonomously</span>
                </div>
                <ul className="space-y-1">
                  {AUTONOMY.act.map((a) => <li key={a} className="text-[11px] text-emerald-800 leading-snug flex items-start gap-1.5"><span className="mt-1 w-1 h-1 rounded-full bg-emerald-500 shrink-0" />{a}</li>)}
                </ul>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Icon name="info" className="text-amber-600 text-lg" />
                  <span className="font-semibold text-xs text-amber-700">Acts then Informs</span>
                </div>
                <ul className="space-y-1">
                  {AUTONOMY.inform.map((a) => <li key={a} className="text-[11px] text-amber-800 leading-snug flex items-start gap-1.5"><span className="mt-1 w-1 h-1 rounded-full bg-amber-500 shrink-0" />{a}</li>)}
                </ul>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
                <div className="flex items-center gap-2 mb-2.5">
                  <Icon name="front_hand" className="text-rose-600 text-lg" />
                  <span className="font-semibold text-xs text-rose-700">Stops and Asks</span>
                </div>
                <ul className="space-y-1">
                  {AUTONOMY.ask.map((a) => <li key={a} className="text-[11px] text-rose-800 leading-snug flex items-start gap-1.5"><span className="mt-1 w-1 h-1 rounded-full bg-rose-500 shrink-0" />{a}</li>)}
                </ul>
              </div>
            </div>
          </Card>

          {/* Honest autonomy split */}
          <Card className="mt-6">
            <h3 className="font-headline font-bold text-sm mb-1 text-on-surface">Honest Autonomy Split</h3>
            <p className="text-[11px] text-on-surface-variant mb-4">Where the agent genuinely thinks vs. where we guide it through the system prompt.</p>
            <div className="grid grid-cols-[1fr_80px_80px] gap-px bg-outline-variant/20 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="bg-primary/[0.07] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-primary">Capability</div>
              <div className="bg-emerald-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 text-center">Agent</div>
              <div className="bg-blue-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-blue-700 text-center">Guided</div>

              {[
                { area: 'Plan interpretation', agent: 90, desc: 'Reasons about CSV structure, hierarchy, column mapping from first principles' },
                { area: 'Error recovery', agent: 70, desc: 'Reads validation errors, reasons about fixes, decides whether to retry or ask' },
                { area: 'Metadata gathering', agent: 20, desc: 'System prompt provides the sequence and templates; agent fills in context-specific values' },
                { area: 'Overall flow', agent: 10, desc: 'System prompt defines the journey; agent follows the prescribed sequence' },
                { area: 'Execution', agent: 5, desc: 'One deterministic batch call after plan approval — the agent just triggers it' },
              ].map((row, i) => (
                <>
                  <div key={`${row.area}-l`} className={`px-4 py-3 ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}>
                    <div className="text-xs font-semibold text-on-surface">{row.area}</div>
                    <div className="text-[10px] text-on-surface-variant mt-0.5">{row.desc}</div>
                  </div>
                  <div key={`${row.area}-a`} className={`px-3 py-3 flex items-center justify-center ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}>
                    <div className="text-center">
                      <div className="text-sm font-bold text-emerald-600">{row.agent}%</div>
                    </div>
                  </div>
                  <div key={`${row.area}-g`} className={`px-3 py-3 flex items-center justify-center ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}>
                    <div className="text-center">
                      <div className="text-sm font-bold text-blue-600">{100 - row.agent}%</div>
                    </div>
                  </div>
                </>
              ))}
            </div>
            <p className="text-[10px] text-on-surface-variant mt-3 leading-relaxed">
              The agent is autonomous where it matters &mdash; interpreting plans, recovering from errors, adapting to messy data. It&apos;s guided where predictability matters &mdash; the overall flow, the UI, the API calls. A fully autonomous agent would be unpredictable and expensive. The system prompt is guardrails, not a cage.
            </p>
          </Card>
        </div>
      </section>

      {/* ── Deploy & How to Use ── */}
      <section className="py-10 md:py-14 bg-surface-container-low/50">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <SectionHeading id="deploy" label="Deployment & How to Use" sub="Two ways to run it" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Web app */}
            <Card className="flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon name="language" className="text-primary text-2xl" />
                </div>
                <div>
                  <h3 className="font-headline font-bold text-base text-on-surface">Web Application</h3>
                  <p className="text-[11px] text-on-surface-variant">Standalone chat interface on Vercel</p>
                </div>
              </div>

              <ol className="space-y-3 flex-1">
                {[
                  { step: 'Connect', desc: 'Paste your Rocketlane API key' },
                  { step: 'Upload', desc: 'Drop a CSV or Excel project plan file' },
                  { step: 'Review', desc: 'The agent analyzes, validates, and shows the plan for approval' },
                  { step: 'Execute', desc: 'One click creates the full project in Rocketlane' },
                ].map((s, i) => (
                  <li key={s.step} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-on-primary text-xs font-bold shrink-0 mt-0.5">{i + 1}</div>
                    <div>
                      <div className="text-sm font-semibold text-on-surface">{s.step}</div>
                      <div className="text-xs text-on-surface-variant">{s.desc}</div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6">
                <a href="https://plansync-tau.vercel.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-primary text-on-primary font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-primary-container transition-colors w-full justify-center">
                  <Icon name="open_in_new" className="text-lg" /> Open Plansync
                </a>
                <p className="text-[10px] text-on-surface-variant text-center mt-2">plansync-tau.vercel.app</p>
              </div>
            </Card>

            {/* Custom App */}
            <Card className="flex flex-col">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-xl bg-tertiary/10 flex items-center justify-center shrink-0">
                  <Icon name="extension" className="text-tertiary text-2xl" />
                </div>
                <div>
                  <h3 className="font-headline font-bold text-base text-on-surface">Custom App within Rocketlane</h3>
                  <p className="text-[11px] text-on-surface-variant">Runs natively inside your Rocketlane workspace</p>
                </div>
              </div>

              <ol className="space-y-3 flex-1">
                {[
                  { step: 'Download', desc: 'Get plansync-custom-app.zip (199 KB) from the repo' },
                  { step: 'Install', desc: 'Settings \u2192 Custom Apps \u2192 Upload the zip file' },
                  { step: 'Use', desc: 'Open "Plansync" from the left nav or any project tab' },
                ].map((s, i) => (
                  <li key={s.step} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-tertiary flex items-center justify-center text-on-tertiary text-xs font-bold shrink-0 mt-0.5">{i + 1}</div>
                    <div>
                      <div className="text-sm font-semibold text-on-surface">{s.step}</div>
                      <div className="text-xs text-on-surface-variant">{s.desc}</div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-6">
                <a href="https://github.com/inba-2299/Plansync/raw/main/custom-app/plansync-custom-app.zip" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-tertiary text-on-tertiary font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-tertiary-container transition-colors w-full justify-center">
                  <Icon name="download" className="text-lg" /> Download Custom App
                </a>
                <p className="text-[10px] text-on-surface-variant text-center mt-2">plansync-custom-app.zip &middot; 199 KB</p>
              </div>
            </Card>
          </div>

          {/* API key hint */}
          <div className="mt-4 rounded-xl bg-primary/[0.04] border border-primary/15 px-5 py-3 flex items-start gap-3">
            <Icon name="key" className="text-primary text-xl mt-0.5 shrink-0" />
            <p className="text-xs text-on-surface-variant leading-relaxed">
              <span className="font-semibold text-on-surface">You&apos;ll need a Rocketlane API key to get started.</span>{' '}
              Generate one from your workspace: <span className="font-medium text-on-surface">Settings &rarr; API &rarr; Generate API Key</span>. The agent will ask for it on the first step.
            </p>
          </div>

          {/* Janani invite note */}
          <div className="mt-3 rounded-xl bg-surface-container border border-outline-variant/30 px-5 py-3 flex items-start gap-3">
            <Icon name="group_add" className="text-primary text-xl mt-0.5 shrink-0" />
            <p className="text-xs text-on-surface-variant leading-relaxed">
              <span className="font-semibold text-on-surface">Janani has been invited to inbarajb.rocketlane.com.</span>{' '}
              The Custom App is already installed in the workspace &mdash; open &ldquo;Plansync&rdquo; from the left nav to test it live with real projects.
            </p>
          </div>
        </div>
      </section>

      {/* ── Security FYI ── */}
      <section className="py-10 md:py-14">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <SectionHeading id="security" label="API Security & Data Policy" sub="FYI" />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: 'lock', title: 'Encrypted at Rest', desc: 'Your Rocketlane API key is encrypted with AES-256-GCM using a per-deployment key. Never stored in plaintext.' },
              { icon: 'timer', title: '48-Hour TTL', desc: 'Sessions and API keys auto-expire after 48 hours. No long-lived credentials stored on our side.' },
              { icon: 'visibility_off', title: 'Never Shared', desc: 'Your API key is never sent to Anthropic, never logged, and never leaves the Railway backend.' },
              { icon: 'https', title: 'HTTPS Only', desc: 'All communication over TLS. CORS restricted to known origins (Vercel + Rocketlane domains).' },
              { icon: 'shield', title: 'Fail-Closed Auth', desc: 'Admin portal returns 503 if credentials are not configured. No "open by default" surfaces.' },
              { icon: 'delete_forever', title: 'Session Cleanup', desc: 'The "New Session" button clears all stored data. No persistent user tracking or analytics.' },
            ].map((item) => (
              <Card key={item.title} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon name={item.icon} className="text-primary text-lg" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-on-surface">{item.title}</h3>
                  <p className="text-[11px] text-on-surface-variant leading-snug mt-0.5">{item.desc}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="py-10 md:py-14 bg-surface-container-low/50">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <SectionHeading id="stack" label="Tech Stack" sub="What powers it" />

          {/* Header row */}
          <div className="grid grid-cols-[140px_1fr_1fr] md:grid-cols-[160px_1fr_1.5fr] gap-px bg-outline-variant/20 rounded-2xl overflow-hidden shadow-card">
            <div className="bg-primary/[0.07] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-primary">Layer</div>
            <div className="bg-primary/[0.07] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-primary">Choice</div>
            <div className="bg-primary/[0.07] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-primary">Why</div>

            {/* Data rows with alternating backgrounds */}
            {TECH_STACK.map((row, i) => (
              <>
                <div key={`${row.layer}-l`} className={`px-4 py-3.5 flex items-center ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}>
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-on-surface">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    {row.layer}
                  </span>
                </div>
                <div key={`${row.layer}-c`} className={`px-4 py-3.5 flex items-center ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}>
                  <span className="text-xs text-on-surface font-mono">{row.choice}</span>
                </div>
                <div key={`${row.layer}-w`} className={`px-4 py-3.5 flex items-center ${i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-low'}`}>
                  <span className="text-xs text-on-surface-variant leading-snug">{row.why}</span>
                </div>
              </>
            ))}
          </div>
        </div>
      </section>

      {/* ── Team / Inba vs Claude ── */}
      <section className="py-10 md:py-14">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <SectionHeading id="team" label="How We Built This" sub="Inba + Claude" />

          <p className="text-sm text-on-surface-variant mb-6 max-w-3xl leading-relaxed">
            I used Claude the same way an implementation lead uses a senior engineer &mdash;
            I set direction, Claude executed, I verified. Every architectural decision was mine;
            Claude was the tool that helped me build faster.
          </p>

          {/* Column headers */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4 mb-3 pl-0 md:pl-[180px] lg:pl-[200px]">
            <div className="hidden md:flex items-center gap-2 px-4">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Icon name="person" className="text-primary text-sm" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-primary">Inbaraj &mdash; Implementation Lead</span>
            </div>
            <div className="hidden md:flex items-center gap-2 px-4">
              <div className="w-7 h-7 rounded-full bg-tertiary/10 flex items-center justify-center">
                <Icon name="smart_toy" className="text-tertiary text-sm" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-tertiary">Claude &mdash; AI Assistant</span>
            </div>
          </div>

          {/* Rows as cards */}
          <div className="space-y-3">
            {TEAM_ROWS.map((row) => (
              <div key={row.area} className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] lg:grid-cols-[200px_1fr_1fr] gap-px bg-outline-variant/20 rounded-xl overflow-hidden shadow-card-sm">
                {/* Area label */}
                <div className="bg-surface-container px-4 py-4 flex items-center">
                  <span className="text-xs font-bold text-on-surface">{row.area}</span>
                </div>

                {/* Inba column — primary tint */}
                <div className="bg-primary/[0.03] px-4 py-4 border-l-2 border-primary/20">
                  <div className="flex items-center gap-1.5 mb-1.5 md:hidden">
                    <Icon name="person" className="text-primary text-xs" />
                    <span className="text-[10px] font-bold text-primary uppercase">Inbaraj</span>
                  </div>
                  <p className="text-xs text-on-surface leading-relaxed">{row.inba}</p>
                </div>

                {/* Claude column — tertiary tint */}
                <div className="bg-tertiary/[0.03] px-4 py-4 border-l-2 border-tertiary/20">
                  <div className="flex items-center gap-1.5 mb-1.5 md:hidden">
                    <Icon name="smart_toy" className="text-tertiary text-xs" />
                    <span className="text-[10px] font-bold text-tertiary uppercase">Claude</span>
                  </div>
                  <p className="text-xs text-on-surface-variant leading-relaxed">{row.claude}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-outline-variant/30 py-8">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Icon name="bolt" className="text-tertiary text-lg" />
            <span className="font-headline font-bold text-sm">Plansync</span>
            <span className="text-xs text-on-surface-variant">&middot; Built by Inbaraj B for the Rocketlane Implementation Manager assignment</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <a href="https://plansync-tau.vercel.app" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Live App</a>
            <a href="https://github.com/inba-2299/Plansync" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a>
            <a href="https://plansync-production.up.railway.app/health" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Health</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
