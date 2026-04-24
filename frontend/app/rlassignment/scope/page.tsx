'use client';

import Link from 'next/link';

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
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-container-lowest rounded-2xl shadow-card border border-outline-variant/30 p-6 md:p-8 ${className}`}>
      {children}
    </div>
  );
}

function StatusTag({ status }: { status: 'shipped' | 'descoped' | 'next' }) {
  const styles = {
    shipped: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    descoped: 'bg-amber-50 text-amber-700 border-amber-200',
    next: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  const labels = { shipped: 'Shipped', descoped: 'Descoped', next: 'Next Phase' };
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  DATA                                                               */
/* ------------------------------------------------------------------ */

const SHIPPED = [
  {
    area: 'Agent Core',
    items: [
      { name: 'Streaming ReAct loop', desc: 'Unbounded-duration agent loop with SSE streaming. Every reasoning step visible to the user in real time.' },
      { name: 'Static system prompt with autonomy matrix', desc: 'PM domain knowledge, Rocketlane data model, API reference, and behavioral rules. Defines when to act, inform, or ask.' },
      { name: 'Working memory (remember/recall)', desc: 'Agent can store and retrieve facts across turns without bloating conversation history. Built on Redis with 48h TTL.' },
      { name: 'Self-correction on validation errors', desc: '11 programmatic checks catch issues (circular deps, missing dates, orphan items). Agent reasons through errors and fixes them without asking.' },
      { name: 'Reflection on failures', desc: 'After any tool failure, the agent logs what it observed, what it hypothesizes, and what it plans to do next. Rendered as a visible card.' },
      { name: 'Runtime docs recovery', desc: 'If the Rocketlane API behaves differently from the system prompt reference, the agent uses web_search to find current docs and caches the fix.' },
    ],
  },
  {
    area: '22 Agent Tools',
    items: [
      { name: 'Batch execution tool', desc: 'execute_plan_creation creates the entire project (phases + tasks + subtasks + milestones + dependencies) in one backend call. 3.5x cheaper and 35x faster than the one-by-one approach.' },
      { name: '6 fine-grained creation fallbacks', desc: 'create_phase, create_task, create_tasks_bulk, add_dependency, get_task, retry_task. Used for error recovery and surgical edits.' },
      { name: '4 planning/metacognition tools', desc: 'validate_plan, create_execution_plan, update_journey_state, reflect_on_failure. The agent plans its own work and tracks its progress.' },
      { name: '3 input/context tools', desc: 'parse_csv, get_rocketlane_context, query_artifact. The agent reads files, fetches workspace context, and dereferences large payloads on demand.' },
      { name: '2 memory tools', desc: 'remember and recall. Named-key working memory for facts the agent wants across turns.' },
      { name: '3 display tools + 1 HITL tool', desc: 'Fire-and-forget display tools drive the UI. request_user_approval is the only tool that pauses the loop.' },
      { name: '1 Anthropic server tool', desc: 'web_search for runtime API documentation recovery. Zero custom implementation required.' },
    ],
  },
  {
    area: 'Chat Interface',
    items: [
      { name: 'Split workspace layout', desc: 'User inputs on the left (40%), agent reasoning on the right (60%). Pinned execution plan + progress feed at the top of the agent column.' },
      { name: '14 agent-emitted components', desc: 'JourneyStepper, ExecutionPlanCard, PlanReviewTree, PlanIntegrityPanel, ApprovalPrompt, ApiKeyCard, FileUploadCard, ProgressFeed, ReflectionCard, CompletionCard, and more.' },
      { name: 'Refresh-safe sessions', desc: 'Every SSE event persisted to Redis. Browser refresh replays the full session — reasoning, cards, approvals, journey state all restored.' },
      { name: 'Agent-driven journey stepper', desc: 'Connect → Upload → Analyze → Approve → Execute → Complete. Driven by the agent calling update_journey_state, not by a backend state machine.' },
      { name: 'Interactive approvals', desc: 'Clickable option chips pre-populated from workspace context. One-click answers, not typed responses.' },
      { name: 'Error boundary', desc: 'Any component render crash shows a recoverable error card instead of a white page. Added after a production crash on Haiku-generated plans.' },
    ],
  },
  {
    area: 'Rocketlane Custom App',
    items: [
      { name: '199 KB zip via @rocketlane/rli CLI', desc: 'Built using the official Rocketlane CLI tool (not a hand-crafted manifest). Produces the rli-dist/deploy.json that Rocketlane requires.' },
      { name: 'Two widget surfaces', desc: 'Left nav + project tab. Users access Plansync from either location.' },
      { name: 'Live iframe to Vercel', desc: 'Widget HTML is an iframe to plansync-tau.vercel.app?embed=1. Vercel deploys are picked up automatically without rebuilding the zip.' },
      { name: 'Verified inside inbarajb.rocketlane.com', desc: 'Installed, tested, and working end-to-end inside a real Rocketlane workspace.' },
    ],
  },
  {
    area: 'Operator Admin Portal (Bonus)',
    items: [
      { name: 'HMAC-signed cookie auth', desc: 'Login form (not Basic Auth). Fail-closed: returns 503 if credentials not configured. HttpOnly cookie, 2-hour lifetime.' },
      { name: 'Observability dashboard', desc: '6 stat cards (runs today, success rate, active now, errors, est. cost, avg cost/run) loading in ~200ms via pre-computed Redis counters.' },
      { name: 'Runtime config editor', desc: 'Change the AI model (Haiku/Sonnet/Opus), max tokens, and retry count live without redeploying Railway.' },
      { name: '22-tool grid with toggles', desc: 'Every tool displayed with its description and category. Toggle on/off. request_user_approval is locked (cannot be disabled).' },
      { name: 'Recent sessions table', desc: 'Filterable by date range, status, and session ID. Lazy-loaded on tab click to keep the dashboard fast.' },
    ],
  },
  {
    area: 'Production Hardening',
    items: [
      { name: 'Token optimization stack', desc: 'Tool schema caching, reasoning diet rule, compact JSON rule, plan-by-artifact-reference. Combined: per-turn input tokens cut ~50%, max_tokens errors eliminated.' },
      { name: '429 retry with Retry-After backoff', desc: 'Up to 3 retries with countdown displayed to the user. Prevents rate limit failures from killing runs.' },
      { name: 'SSE heartbeat every 15s', desc: 'Prevents Railway/Cloudflare proxy idle timeout from dropping the connection during long Anthropic calls.' },
      { name: 'System prompt hardening', desc: 'HARD RULE sections against prose-asking (9 forbidden patterns) and journey stepper lag. Added after diagnosing a real production drift via Redis session inspection.' },
      { name: 'AES-256-GCM API key encryption', desc: 'Rocketlane API key encrypted at rest in Redis with a per-deployment key. Decrypted only inside the RL client at call time.' },
    ],
  },
];

const DESCOPED = [
  { name: 'Cross-device session recovery (Tier 2)', reason: 'Tier 1 (same-browser refresh) shipped and covers the demo scenario. Tier 2 requires user identity (API-key hash), session list UI, and a gate page. ~4.5 hours, not exercised during a single-reviewer demo.', effort: '~4.5 hours' },
  { name: '62-row Shard FM Engine test', reason: 'The 21-row Sample Plan already exercises every agent capability. Running a larger plan creates many test projects in the workspace without adding verification coverage.', effort: '~1 hour' },
  { name: 'Stuck-session lock recovery ("Refresh Agent" button)', reason: 'If an agent request dies mid-stream, the Redis lock stays held for 5 minutes. Users can click "New session" to recover. Proper fix needs an unlock endpoint + mid-stream banner. ~45-60 min.', effort: '~1 hour' },
  { name: 'Sentry error tracking', reason: 'Opted out to keep the backend lightweight. Console logs + Railway log stream + Vercel log drain are sufficient for a take-home.', effort: '~2 hours' },
  { name: 'Runtime Zod schema validation (admin client)', reason: 'TypeScript interfaces match at compile time. Adding runtime validation is ~20 min but not worth a new dependency for a single-developer project.', effort: '~20 min' },
];

const ROADMAP = [
  { name: 'Create-or-update flow', desc: '5 new update tools (update_phase, update_task, etc.) for syncing an existing Rocketlane project against a revised plan. The natural follow-up workflow for ongoing implementation management.' },
  { name: 'Cross-device session persistence', desc: 'API-key-based identity, session token middleware, "Active Plans" UI, gate page. Users can start a session on their laptop and continue on their phone.' },
  { name: 'Workspace subdomain in context', desc: 'Backend surfaces the Rocketlane subdomain explicitly so the agent always has it for the "View in Rocketlane" link.' },
  { name: 'Lessons feedback loop', desc: 'Persist agent reflections across sessions so a workspace accumulates institutional knowledge ("user always uses DD/MM dates", "typical project duration 60-90 days").' },
  { name: 'Admin portal v3', desc: 'Live SSE subscription for watching sessions, detail drill-down, time-series cost graphs, per-user breakdown.' },
  { name: 'Multi-user auth', desc: 'Migrate to Postgres with row-level security. OAuth via Rocketlane (if available) or email magic links.' },
  { name: 'Walkthrough video', desc: '5-minute recorded demo explaining the architecture and showing a live end-to-end run.' },
];

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */
export default function ScopePage() {
  return (
    <div className="min-h-screen bg-surface font-body text-on-surface">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-lg border-b border-outline-variant/30">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex items-center h-14 gap-3">
          <Link href="/rlassignment" className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors">
            <Icon name="arrow_back" className="text-lg" />
            <span className="text-xs font-medium">Back to Overview</span>
          </Link>
          <div className="h-5 w-px bg-outline-variant/40" />
          <span className="font-headline font-bold text-sm">Implementation Scope</span>
        </div>
      </nav>

      {/* Header */}
      <header className="max-w-[1440px] mx-auto px-6 lg:px-10 pt-8 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-tertiary mb-1.5">Detailed Breakdown</p>
        <h1 className="font-headline text-3xl md:text-4xl font-extrabold">What was built, what was descoped, and what comes next</h1>
        <p className="text-sm text-on-surface-variant mt-3 max-w-2xl leading-relaxed">
          This is the expanded scope document for the Plansync submission. Every item below was an explicit decision &mdash;
          nothing was accidentally left out.
        </p>
      </header>

      {/* ── SHIPPED ── */}
      <section className="max-w-[1440px] mx-auto px-6 lg:px-10 pb-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
            <Icon name="check_circle" className="text-emerald-600 text-lg" />
          </div>
          <h2 className="font-headline text-xl font-extrabold">What Shipped</h2>
          <StatusTag status="shipped" />
        </div>

        <div className="space-y-6">
          {SHIPPED.map((group) => (
            <Card key={group.area}>
              <h3 className="font-headline font-bold text-base text-on-surface mb-4">{group.area}</h3>
              <div className="space-y-3">
                {group.items.map((item) => (
                  <div key={item.name} className="flex items-start gap-3">
                    <Icon name="check" className="text-emerald-500 text-sm mt-1 shrink-0" />
                    <div>
                      <span className="text-sm font-semibold text-on-surface">{item.name}</span>
                      <p className="text-xs text-on-surface-variant leading-snug mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ── DESCOPED ── */}
      <section className="bg-surface-container-low/50 py-10">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <Icon name="schedule" className="text-amber-600 text-lg" />
            </div>
            <h2 className="font-headline text-xl font-extrabold">What Was Descoped</h2>
            <StatusTag status="descoped" />
          </div>

          <p className="text-sm text-on-surface-variant mb-6 max-w-2xl">
            Each item below was a deliberate decision to defer, not an oversight. The rationale and estimated effort are listed so you can see the trade-off.
          </p>

          <Card>
            <div className="space-y-4">
              {DESCOPED.map((item) => (
                <div key={item.name} className="flex items-start gap-3 pb-4 border-b border-outline-variant/15 last:border-b-0 last:pb-0">
                  <Icon name="remove_circle_outline" className="text-amber-500 text-sm mt-1 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-sm font-semibold text-on-surface">{item.name}</span>
                      <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container px-2 py-0.5 rounded shrink-0">{item.effort}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-snug mt-1">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      {/* ── ROADMAP ── */}
      <section className="py-10">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Icon name="rocket_launch" className="text-blue-600 text-lg" />
            </div>
            <h2 className="font-headline text-xl font-extrabold">Next Phase Roadmap</h2>
            <StatusTag status="next" />
          </div>

          <p className="text-sm text-on-surface-variant mb-6 max-w-2xl">
            If Plansync were to move into production, these are the features that would come next &mdash; ordered by impact.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ROADMAP.map((item, i) => (
              <Card key={item.name} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary">{i + 1}</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-on-surface">{item.name}</h3>
                  <p className="text-xs text-on-surface-variant leading-snug mt-0.5">{item.desc}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-outline-variant/30 py-8">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/rlassignment" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-container transition-colors">
            <Icon name="arrow_back" className="text-lg" /> Back to Overview
          </Link>
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <a href="https://github.com/inba-2299/Plansync/blob/main/BRD.md" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Full BRD on GitHub</a>
            <a href="https://github.com/inba-2299/Plansync" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Source Code</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
