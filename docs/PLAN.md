# Plansync — Rocketlane Project Plan Agent

> **⚠ READ THIS FIRST — Session 4 deltas**
>
> This document is the **Session 1 build plan**. It captured the initial architecture decisions and the 20-tool agentic design. Most of it is still accurate, but the following key deltas have landed since this was written and are NOT reflected in the text below:
>
> 1. **Tool count: 21 custom + 1 server = 22 total** (not 20 + 1 = 21). Session 4 added `execute_plan_creation` — a batch execution tool that reversed this plan's "break `execute_creation_pass` into fine-grained primitives" decision for the happy path. The fine-grained tools still exist as fallback for failure recovery and surgical edits. See MEMORY.md "Decision: `execute_plan_creation` batch tool — the architectural reversal" for the full story, measured cost/speed impact (3× cheaper, 35× faster execution phase), and rationale.
>
> 2. **Model is configurable via `ANTHROPIC_MODEL` env var on Railway**, no hardcoded default. The original plan said "Model: `claude-sonnet-4-5`" as a constant. Session 4 made this a required env var with no fallback — the loop fails fast with a clear error if missing. Valid values: `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-5`. Recommended: Haiku for cost (~$0.20-0.25/run), Sonnet for capability (~$0.86/run).
>
> 3. **Frontend is a responsive split layout**, not a single-column chat. Session 3-4 built: user workspace LEFT 40%, agent workspace RIGHT 60%, thin vertical rule between, pinned ExecutionPlanCard + ProgressFeed inside agent column sticky-top. Collapses to single column below 1024px. 14px base font size. ~14 components in `frontend/components/agent-emitted/`.
>
> 4. **Token optimization stack** is applied: tool caching via `cache_control: ephemeral` on the last tool schema (caches ~2000 tokens of tools after turn 1), reasoning-diet rule (prose only in streaming text, no JSON dumps), compact JSON rule in tool inputs, reference-by-artifactId in `execute_plan_creation`. Combined effect: per-turn input tokens down ~10× during execution, rate limit wall no longer hit, end-to-end run cost on Sonnet 4.5 is ~$0.86/run for a 21-task plan.
>
> 5. **Interactive metadata gathering rule** was added to the system prompt (model-agnostic). Tells both Sonnet and Haiku to infer defaults first (filename → project name, workspace context → customer/owner, task dates → start/end), then ask sequentially via `request_user_approval` with options pre-populated from workspace context. Never prose-dump multiple questions. See MEMORY.md "Decision: interactive metadata gathering rule (model-agnostic)".
>
> 6. **429 retry with `Retry-After` backoff** is implemented in the agent loop. Up to 3 retries, max 60s wait per retry, emits `rate_limited` SSE event to frontend so users see a countdown. AgentEvent union gained `rate_limited` variant and `error.kind` field.
>
> 7. **Refresh-safe sessions via Redis event log replay (Commit 2g).** Every SSE event the agent emits is persisted to a new `session:{id}:events` list in Redis with a 7-day TTL. The frontend reads `sessionId` from `localStorage['plansync-session-id']` (instead of regenerating it on every page load) and on mount calls `GET /session/:id/events` to replay the full event list through the same `handleAgentEvent` function that processes live streaming — reconstructing reasoning bubbles, tool calls, plan review tree, execution plan, journey state, and pending approvals exactly as they were before the refresh. Same-browser only; cross-device recovery (Tier 2: gate page + API-key-based auth + user→sessions index) is deferred post-submission. See MEMORY.md "Decision: refresh-safe sessions via Redis event log replay".
>
> 8. **Application-crash error boundary (Commit 2f).** Any unhandled render error in any agent-emitted card used to blanket-crash the app ("Application error: a client-side exception"). Fixed two ways: surgical `normalizePlanItem()` hardening in `PlanReviewTree` for the specific bug (missing `dependsOn` on Haiku-generated plans), plus a class-based `ErrorBoundary` wrapping `Chat` in `app/page.tsx` that catches any future render crash and shows a recoverable card instead of white-paging. See MEMORY.md "Decision: application crash from missing dependsOn — frontend harden + error boundary".
>
> 9. **Rocketlane Custom App `.zip` is BUILT and VERIFIED INSTALLED.** First attempt (commit `3014b4d`) used a hand-crafted `manifest.json` + iframe shell — rejected by Rocketlane with `Invalid zip: rli-dist/deploy.json not found`. Rebuilt from scratch (commit `becaf10`) using the official `@rocketlane/rli` CLI: `rli init` scaffold → stripped down to one Plansync widget at both `left_nav` and `project_tab` surfaces → widget HTML is a full-viewport iframe loading `https://plansync-tau.vercel.app?embed=1` → `rli build` produces a 199 KB `app.zip` with the proper `rli-dist/deploy.json`. Installed and verified working inside `inbarajb.rocketlane.com`. The iframe-inside-widget pattern preserves the live-updates story: Vercel deploys are picked up automatically without rebuilding the `.zip`. See MEMORY.md "Decision: Custom App pivot from hand-crafted manifest.json to @rocketlane/rli CLI" for the full story + lessons.
>
> 10. **System prompt hardened against prose-asking (Commit 2h).** A production session revealed Anthropic non-determinism: agent occasionally skipped `request_user_approval` after `display_plan_for_review` and prose-asked "Does the plan look good?" instead, deadlocking the session. Diagnosed via raw Redis inspection (`/tmp/inspect-sessions.mjs` + `/tmp/diff-sessions.mjs` scratch scripts). Fix: two new HARD RULE sections at the top of § 5 Behavioral Rules (one against prose-asking with 9 forbidden patterns + required replacements, one requiring `update_journey_state` at every phase transition), plus a new § 6 "Re-read the hard rules before every tool call" reminder at the end of the prompt to combat prompt-cache drift. Also in the same commit: UI base font from 14px → 13px for denser dashboard feel. See MEMORY.md "Decision: harden the system prompt against prose-asking".
>
> 11. **Lightweight admin portal v1 built (Commit `e140986`, originally on `admin-portal` branch).** Operator dashboard at `/admin` with HMAC-signed HttpOnly cookie auth (login form, not Basic Auth). 6 stat cards, runtime config editor (model / max_tokens / max_retries without Railway redeploy), 22-tool grid with toggle functionality, recent sessions table with filters, daily usage breakdown by model. Backend: `agent/src/admin/{auth,middleware,config,usage,stats,tools-catalog}.ts`. Frontend: `app/admin/login/page.tsx` + `app/admin/page.tsx` + `lib/admin-client.ts`. Verified on a separate Railway preview deployment before merging. See MEMORY.md "Decision: lightweight admin portal on a separate branch".
>
> 12. **Admin portal v2 rewrite (Commit `207c45e`, merged as `9f887c4`)**. v1 was functionally correct but operationally unusable — dashboard took 15-40 seconds to load because `stats.ts` did a full SCAN + event-log walk per session on every dashboard hit. v2 replaces that with pre-computed set-based counters: new `admin/counters.ts` module maintains daily SCARD-friendly sets (`started`, `successful`, `errored`) + a sorted set (`by_created`) + an active-locks set, incremented at source-of-truth events via hooks in `memory/session.ts loadSession()`, `memory/lock.ts acquireLock/release`, and the `/agent` route's emit wrapper. Dashboard reads 5 cheap keys in parallel instead of ~360 calls → **~200ms load time (150× faster)**. `/admin/dashboard` and `/admin/sessions` are now separate endpoints so the sessions table lazy-loads on tab click. Frontend rewritten as a four-tab layout (Observability default / Runtime Config / Agent Tools / Recent Sessions) with per-tab data fetching. Success rate scoped to today (was all-time). See MEMORY.md "Decision: admin portal v2 — pre-computed counters + tabbed lazy loading" and docs/DESIGN.md § AD-14 for full detail.
>
> 13. **BRD document committed (`1b6f600`).** `BRD.md` at the repo root now covers: problem, approach, 6 hard architectural decisions (batch execution tool, refresh-safe sessions, token optimization, error boundary, reliability extras, system prompt hardening), Rocketlane Custom App integration (including the rli pivot), lightweight admin portal as a bonus deliverable, submission deliverables table, documentation map, and post-submission roadmap. Ready for the Rocketlane submission workflow.
>
> 14. **Session state recovery gap (documented, NOT yet fixed).** If a `POST /agent` streaming request gets killed mid-stream (e.g. Railway rolling redeploy), the session's Redis lock stays held until the 5-minute TTL expires. User has no actionable recovery button other than the blunt "New session". Scoped fix: `POST /session/:id/unlock` endpoint + "Refresh Agent" button in the mid-stream banner. ~45-60 min, deferred post-submission. See docs/DESIGN.md § AD-15.
>
> 15. For the **current state of the build**, read `CONTEXT.md`. For the **why** of every decision, read `MEMORY.md`. This plan is historical — it's Session 1's blueprint, not the running architecture.

## Context

**The assignment.** Inbaraj received a Rocketlane Implementation Manager take-home: build an AI agent that reads a project plan CSV and creates it as a structured project (phases, tasks, subtasks, milestones, dependencies) in Rocketlane via their REST API. Deadline 2026-04-16. Rocketlane has no native CSV import for project plans, so implementation teams currently recreate plans manually — this agent eliminates that work.

**Why we're replanning.** Inbaraj already wrote a 970-line PRD (`/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md`) describing what he called "a product instead of an agent" — a Next.js wizard with a hardcoded 6-step state machine, 5 mandatory HITL checkpoints, and a batch `execute_creation_pass` tool that hides the agent's work behind a single call. By Anthropic's definition this is an **AI-augmented workflow**, not an agent.

**What we agreed to build.** A properly designed agent per Anthropic's framing: "LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks." Concretely:
- One unified `/agent` endpoint with a ReAct loop
- **20 fine-grained custom tools + 1 Anthropic server tool (`web_search`) = 21 tools in the array** Claude calls in a real loop (15–25 turns per run)
- **Runtime API recovery** — if a Rocketlane endpoint behaves differently from what's in the system prompt (e.g. field renamed, endpoint moved), the agent calls `web_search` to look up current docs, updates its understanding, caches the fix via `remember`, and retries
- **Explicit planning phase** — agent calls `create_execution_plan` at the start of non-trivial goals, writing its own TODO list as a visible card
- **Explicit memory** — agent has `remember`/`recall` tools for facts it wants to track across turns without cluttering history
- **Explicit reflection** — agent has `reflect_on_failure` tool that renders a visible reflection card when things go wrong; also an implicit rule in the system prompt
- HITL as a tool the agent invokes when it judges necessary — not a hardcoded gate
- Display tools the agent emits to drive UI rendering (frontend has zero business logic)
- **Agent-driven journey state** — `update_journey_state` tool that drives a sticky `JourneyStepper` at the top of the chat. State is reported *by the agent*, not enforced *against the agent*.
- Self-correction loop on validation errors
- Verification tools (`get_task`) and targeted retry (`retry_task`) for reliability
- Streaming reasoning visible in the UI — the biggest signal that "this is an agent"
- Static system prompt (no state-dependent switch/case) with a full **autonomy matrix** from PRD §6.2

**Constraints.**
- 1.5 days to ship (tonight all-nighter + tomorrow)
- **Decoupled hosting:** Next.js frontend on Vercel (Hobby is fine); Node agent backend on **Railway** (no timeout, streaming works natively)
- Upstash Redis is already set up (agent memory)
- TypeScript for both frontend and backend (monorepo with two `package.json`s)
- Production grade, not MVP — deployable, works end-to-end with real API keys
- Keep the chat UI demo format Inbaraj already committed to
- **No scope cuts** — everything promised in discussion is in the plan

**Core deliverables (all required):**
1. Live deployed agent — Vercel (frontend) + Railway (backend)
2. Source code in a public GitHub repo
3. **Rocketlane Custom App .zip** — embedded iframe pointing at the Vercel URL. Critical because it demonstrates understanding of Rocketlane's extensibility model, not just its REST API.
4. BRD document in Rocketlane Spaces
5. Demo CSV (Shard FM Engine, 62 rows, 5 levels)
6. Downloadable CSV template

**Tracking.** 21 tasks already exist in Rocketlane under phase "Agent Development" (project 5000000073039). Parent IDs: 5000001553728 (Core), 5000001553729 (Tools), 5000001553730 (UI), 5000001553747 (Demo). The build sequence below maps each step to these tasks.

---

## Architecture overview

```
┌──────────────────────────────────────────┐         ┌──────────────────────────────────────┐
│ Vercel — Next.js 14 frontend             │         │ Railway — Node agent backend         │
│                                          │         │                                      │
│  ┌────────────────────────────────────┐  │         │  POST /agent                         │
│  │ JourneyStepper (sticky top)        │  │  fetch  │  - ReAct loop (unbounded duration)   │
│  │ Connect→Upload→Analyze→Approve→    │  │  + SSE  │  - Streams text + tool events        │
│  │ Execute→Complete (agent-driven)    │  ├────────►│  - 21 tools, LLM chooses             │
│  └────────────────────────────────────┘  │         │  - Self-corrects on errors           │
│  ┌────────────────────────────────────┐  │         │  - Explicit planning, memory,        │
│  │ Chat timeline                      │  │         │    reflection, verification          │
│  │  - Streaming reasoning bubbles     │  │         │                                      │
│  │  - Tool call one-liners            │  │◄────────┤  POST /upload                        │
│  │  - Rich display components:        │  │         │  - Parses CSV/XLSX                   │
│  │    • ExecutionPlanCard             │  │         │  - Writes to artifact store          │
│  │    • PlanReviewTree                │  │         │                                      │
│  │    • ReflectionCard                │  │         │  GET /session/:id/journey            │
│  │    • ApprovalPrompt                │  │         │  - Re-fetches journey on reconnect   │
│  │    • ProgressFeed                  │  │         │                                      │
│  │    • CompletionCard                │  │         │  plansync-agent.up.railway.app       │
│  └────────────────────────────────────┘  │         └──────┬──────────────┬────────────────┘
│                                          │                │              │
│  plansync.vercel.app                     │                ▼              ▼
│  + /api/upload (forwards to backend)     │         Anthropic API    Rocketlane API
└──────────────────────────────────────────┘         (Claude Sonnet   (server-to-server,
                                                      4.5, streaming, API key encrypted
                                                      tool use,       in Redis)
                                                      prompt cache)
                                                            │
                                                            ▼
                                                     Upstash Redis
                                                     (agent memory:
                                                      history, artifacts,
                                                      remember-keys,
                                                      journey, idmap,
                                                      execlog, lock)
```

**Why decoupled.** Vercel Hobby's 60s `maxDuration` means doing the agent loop on Vercel requires deadline tracking, auto-resume events, state stitching across invocations, and checkpointed bulk operations — a whole class of complexity. Moving the agent loop to Railway (no timeout) eliminates all of this.

**Key invariants.**
1. The LLM controls flow. No backend state machine.
2. Frontend has zero business logic — renders whatever the agent emits via tool calls.
3. Backend is a stateless long-running server — Redis is the session store, each POST runs to completion.
4. Display tools are non-blocking side-effects. Only `request_user_approval` pauses the loop.
5. Tool results are stored as artifacts; history carries summaries + artifactIds, never full blobs.
6. **State is reported by the agent, not enforced against it.** JourneyStepper shows "where we are" because the agent *tells* the frontend via `update_journey_state`.
7. **Everything the agent does is transparent.** Planning, memory writes, reflection, verification — each has a visible UI surface so the user can see the agent think.

---

## PRD reuse map

| PRD section | Status | Notes |
|---|---|---|
| §1.1–1.3 Overview, principles | **Keep** | Still accurate. |
| §2 Tech stack | **Replace** | Railway backend + Vercel frontend; drop Sentry. |
| §3 Architecture (state machine, multi-endpoint) | **Replace** | Single backend `/agent`, no status field. |
| §4.3 Layer 1–2 PM knowledge + tool export patterns | **Keep verbatim** | The agent's brain. Copy into `agent/src/agent/system-prompt.ts`. (PRD lines 208–276) |
| §4.3 Layer 3 Rocketlane data model | **Keep verbatim** | PRD lines 278–290. |
| §4.4 Behavioural rules | **Expand** | Replace with full autonomy matrix + planning + memory + reflection + journey rules. |
| §4.5 Plan item schema | **Keep verbatim** | PRD lines 309–327. |
| §4.6 Dynamic context with switch/case | **Delete** | Anti-agent pattern. |
| §4.7 Agent loop | **Replace** | New streaming loop (no deadline, no chunking). |
| §5 Tools (8 batch tools) | **Replace** | 20 fine-grained tools (see below). |
| **§6 Autonomy boundaries + matrix** | **Elevate to system prompt** | PRD §6.2 becomes the core of the behavioural rules. |
| §7 Validation gates | **Keep logic, LLM-driven** | 11 checks in `validate_plan`, agent calls it and self-corrects. |
| §8 UI design (colors, layout) | **Keep + add JourneyStepper + ExecutionPlanCard + ReflectionCard** | Rocketlane Carbon tokens + Nitro purple. PRD lines 614–655. |
| §9 Rocketlane API reference | **Keep verbatim** | PRD lines 756–820. Cheat sheet for `agent/src/rocketlane/client.ts`. |
| §10 Repo structure | **Replace** | Monorepo with `frontend/` and `agent/`. |
| §11 Demo scenario (Shard FM Engine) | **Keep** | PRD lines 888–895. |
| §13 Custom App .zip | **Keep — core deliverable** | Iframe wrapper pointing at Vercel URL. |

---

## Tech stack (concrete)

**Frontend (Vercel):**
```
Next.js 14.2.x         App Router
TypeScript 5.x
tailwindcss 3.4.x      Rocketlane Carbon tokens + Nitro purple
framer-motion ^11      JourneyStepper, ApprovalPrompt, ReflectionCard animations
clsx
```

**Backend (Railway):**
```
Node 20 LTS
express 4.x                   HTTP server with SSE support
@anthropic-ai/sdk ^0.30       Streaming + tool use + prompt caching
@upstash/redis ^1.34          HTTP Redis client
xlsx ^0.18                    SheetJS for CSV + Excel parsing
zod                           Tool input validation
nanoid                        IDs + idempotency keys
undici                        HTTP client for Rocketlane API
tsx                           Dev runtime (hot-reload TypeScript)
```

**Shared:**
```
shared/types.ts               AgentEvent, PlanItem, JourneyStep, RL types
shared/schema.ts              Zod schemas reused both sides
```

**Model:** `claude-sonnet-4-5` (stable, fast, excellent tool use).

**Env vars:**
- Frontend (Vercel): `NEXT_PUBLIC_AGENT_URL`
- Backend (Railway):
  - `ANTHROPIC_API_KEY`
  - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  - `ENCRYPTION_KEY` (32 bytes base64 — for RL API key AES-GCM at rest)
  - `ALLOWED_ORIGIN` (https://plansync.vercel.app, plus *.rocketlane.com for embed)

---

## Monorepo file structure

```
plansync/                                 ← git repo root
├── frontend/                             ← Next.js on Vercel (rootDirectory: frontend)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                      ← Chat shell + JourneyStepper, session init
│   │   ├── globals.css                   ← Rocketlane Carbon tokens + Nitro purple
│   │   └── api/
│   │       └── upload/route.ts           ← Forwards to backend /upload
│   ├── components/
│   │   ├── Chat.tsx                      ← Main container, SSE reader, message list
│   │   ├── MessageBubble.tsx             ← Streaming text, collapsible reasoning
│   │   ├── ToolCallLine.tsx              ← One-liner "tool → result"
│   │   └── agent-emitted/
│   │       ├── JourneyStepper.tsx        ← Sticky top stepper, agent-driven
│   │       ├── ApiKeyCard.tsx
│   │       ├── FileUploadCard.tsx
│   │       ├── ExecutionPlanCard.tsx     ← Renders agent's own TODO list
│   │       ├── PlanReviewTree.tsx        ← Collapsible, milestone toggles, inline edit
│   │       ├── ReflectionCard.tsx        ← Agent's post-failure reflection
│   │       ├── ApprovalPrompt.tsx        ← Clickable option chips, animated
│   │       ├── ProgressFeed.tsx          ← Phase-segmented, sticky during execution
│   │       └── CompletionCard.tsx
│   ├── lib/
│   │   ├── agent-client.ts               ← fetch wrapper + SSE parser
│   │   └── event-types.ts                ← Re-exports from shared/
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── package.json
│
├── agent/                                ← Node server on Railway (rootDirectory: agent)
│   ├── src/
│   │   ├── server.ts                     ← Express entry, CORS, routes
│   │   ├── routes/
│   │   │   ├── agent.ts                  ← POST /agent (streaming ReAct loop)
│   │   │   ├── upload.ts                 ← POST /upload (file → artifact store)
│   │   │   ├── journey.ts                ← GET /session/:id/journey (reconnect hydration)
│   │   │   └── health.ts                 ← GET /health
│   │   ├── agent/
│   │   │   ├── loop.ts                   ← ReAct loop (no deadline, no chunking)
│   │   │   ├── system-prompt.ts          ← Static prompt with full autonomy matrix
│   │   │   └── stream-forwarder.ts       ← Anthropic events → SSE events
│   │   ├── tools/
│   │   │   ├── index.ts                  ← Tool schemas + dispatcher
│   │   │   ├── parse-csv.ts
│   │   │   ├── get-rocketlane-context.ts
│   │   │   ├── query-artifact.ts
│   │   │   ├── validate-plan.ts          ← 11 programmatic checks
│   │   │   ├── create-execution-plan.ts  ← Planning tool
│   │   │   ├── update-journey-state.ts   ← Agent-driven top stepper
│   │   │   ├── remember.ts               ← Working memory write
│   │   │   ├── recall.ts                 ← Working memory read
│   │   │   ├── reflect-on-failure.ts     ← Explicit reflection tool
│   │   │   ├── create-rocketlane-project.ts
│   │   │   ├── create-phase.ts
│   │   │   ├── create-task.ts            ← Individual task creation
│   │   │   ├── create-tasks-bulk.ts      ← Batch within a phase
│   │   │   ├── add-dependency.ts
│   │   │   ├── get-task.ts               ← Read back a created task
│   │   │   ├── retry-task.ts             ← Targeted retry of a failed task
│   │   │   ├── request-user-approval.ts  ← THE blocking tool
│   │   │   ├── display-plan-for-review.ts
│   │   │   ├── display-progress-update.ts
│   │   │   └── display-completion-summary.ts
│   │   ├── rocketlane/
│   │   │   ├── client.ts                 ← RL REST client with idempotency, rate limiting
│   │   │   └── types.ts
│   │   ├── memory/
│   │   │   ├── redis.ts                  ← Upstash wrapper
│   │   │   ├── session.ts                ← Session state helpers
│   │   │   ├── artifacts.ts              ← Artifact store (put/get/query)
│   │   │   ├── remember.ts               ← Named-key working memory
│   │   │   └── lock.ts                   ← Per-session lock
│   │   ├── lib/
│   │   │   ├── crypto.ts                 ← AES-GCM for RL API key at rest
│   │   │   └── sse.ts                    ← SSE encoder helpers
│   │   └── index.ts
│   ├── scripts/
│   │   └── test-rl.ts                    ← Standalone script proving RL API works
│   ├── Procfile                          ← web: node dist/index.js
│   ├── tsconfig.json
│   ├── package.json
│   └── railway.json
│
├── shared/
│   ├── types.ts                          ← AgentEvent, PlanItem, JourneyStep, etc.
│   └── schema.ts                         ← Zod schemas
│
├── custom-app/                           ← Rocketlane Custom App bundle source
│   ├── manifest.json                     ← Custom App manifest
│   ├── index.html                        ← Iframe wrapping the Vercel URL
│   ├── icon.svg
│   └── build.sh                          ← Produces plansync-custom-app.zip
│
├── public/
│   ├── template.csv
│   └── template.xlsx
│
├── .gitignore
├── README.md                             ← Setup instructions for both apps
└── vercel.json                           ← rootDirectory: frontend
```

---

## The ReAct loop (`agent/src/routes/agent.ts`)

```typescript
// agent/src/routes/agent.ts
app.post("/agent", async (req, res) => {
  const { sessionId, userMessage, uiAction } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unlock = await lock.acquire(sessionId);
  try {
    const session = await loadSession(sessionId);
    if (userMessage) session.history.push({ role: "user", content: userMessage });
    if (uiAction)    session.history.push({ role: "user", content: [toolResultFor(uiAction)] });

    await runAgentLoop(session, emit);
    await saveSession(sessionId, session);
    emit({ type: "done" });
  } catch (err) {
    emit({ type: "error", message: String(err) });
  } finally {
    await unlock();
    res.end();
  }
});
```

`runAgentLoop`:

```typescript
// agent/src/agent/loop.ts
async function runAgentLoop(session: Session, emit: (e: AgentEvent) => void) {
  const MAX_TURNS = 40;

  while (session.turnCount < MAX_TURNS) {
    session.turnCount++;

    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      system: [{
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      }],
      messages: session.history,
      tools: TOOL_SCHEMAS,
    });

    for await (const event of stream) {
      forwardStreamEvent(event, emit);
    }

    const final = await stream.finalMessage();
    session.history.push({ role: "assistant", content: final.content });

    if (final.stop_reason === "end_turn") return;

    const toolResults: ToolResultBlock[] = [];
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;

      if (block.name === "request_user_approval") {
        await persistPendingApproval(session, block);
        emit({ type: "awaiting_user", toolUseId: block.id, payload: block.input });
        return;
      }

      const result = await dispatch(block, session, emit);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result.summary,
      });
      if (result.artifactId) {
        session.artifacts[result.artifactId] = result.fullPayload;
      }
    }

    session.history.push({ role: "user", content: toolResults });
  }
}
```

---

## Tools (20 custom + 1 server = 21 total)

Organized into 7 groups by role. The full Rocketlane API reference lives in the system prompt (cached) — when it's right, the agent doesn't need to search. When it's wrong (API changed since we built this), the agent falls back to `web_search` for live docs recovery.

### Group A — Input & context (3 tools)

| Tool | Blocking? | Purpose |
|---|---|---|
| `parse_csv(fileId)` | no | Reads uploaded file from artifact store, returns header + row count + sample rows + artifactId for the full data |
| `get_rocketlane_context()` | no | GET /projects, accounts, current user from Rocketlane. Returns summary + artifactId with the full context |
| `query_artifact(artifactId, path)` | no | Dereferences a stored blob to a specific slice — lets the agent read big data on-demand without bloating the context window |

### Group B — Planning & metacognition (4 tools)

| Tool | Blocking? | Purpose |
|---|---|---|
| `create_execution_plan(goal, steps[])` | no | **Planning step.** Agent writes its own TODO list at the start of a non-trivial goal. Emits `display_component` → `<ExecutionPlanCard>` renders the steps inline as a visible card. The agent updates it as it goes. |
| `update_journey_state(steps[])` | no | **Agent-driven journey stepper.** Agent calls this whenever the overall phase of its work changes. Frontend renders a sticky stepper at the top of the chat. Shape: `[{id, label, status: "done"\|"in_progress"\|"pending"\|"error"}]`. |
| `validate_plan(plan)` | no | **Self-correction input.** Runs 11 programmatic checks. Returns `{ valid, stats, errors[] }`. Agent reasons about errors and re-calls `validate_plan` until clean. |
| `reflect_on_failure(observation, hypothesis, next_action)` | no | **Explicit reflection.** Agent calls this after any tool failure or validation error. Emits `display_component` → `<ReflectionCard>` renders a prominent "💭 Reflection" card. Agent then retries or asks the user. |

### Group C — Memory (2 tools)

| Tool | Blocking? | Purpose |
|---|---|---|
| `remember(key, value)` | no | Writes a named fact to working memory (e.g., `remember("user_date_format", "DD/MM/YYYY")`). Keeps facts out of the conversation history so they don't bloat turns. |
| `recall(key)` | no | Reads a named fact back. Agent uses this when it needs a previously remembered value. |

### Group D — HITL (1 tool)

| Tool | Blocking? | Purpose |
|---|---|---|
| `request_user_approval(question, options[], context?)` | **YES — the only blocking tool** | Pauses the loop. Used for: API key, file upload, plan approval, ambiguous dates, deep nesting choices, duplicate handling, final execution confirmation, failure recovery. Frontend renders `<ApprovalPrompt>` with clickable chips. |

### Group E — Creation & mutation (5 tools)

| Tool | Blocking? | Purpose |
|---|---|---|
| `create_rocketlane_project(args)` | no | POST /projects. Stores `projectId` in idmap. |
| `create_phase(args)` | no | POST /phases. Requires startDate + dueDate (agent derives from children if missing). Stores phaseId in idmap. |
| `create_task(args)` | no | POST /tasks for a single task — useful for milestones, subtasks, or one-off corrections. Supports `type: MILESTONE` and `parent.taskId` for subtasks. |
| `create_tasks_bulk(phaseId, tasks[])` | no | Batch create all tasks in a phase in one call. Idempotency keys prevent double-creation. The "hot path" for a 60-row plan. |
| `add_dependency(fromTempId, toTempId, type, lag)` | no | POST /tasks/{id}/add-dependencies. Agent calls this in pass 2 after all entities exist. |

### Group F — Verification & retry (2 tools)

| Tool | Blocking? | Purpose |
|---|---|---|
| `get_task(taskId)` | no | GET /tasks/{id}. Read-back verification after creation. Agent can spot-check whether a task was actually created correctly. |
| `retry_task(tempId, fixArgs)` | no | Targeted retry of a single failed task with corrected args. Skips if tempId already in idmap. |

### Group G — Display (3 tools)

| Tool | Blocking? | Purpose |
|---|---|---|
| `display_plan_for_review(plan)` | no | Emits `display_component` → `<PlanReviewTree>`. Typically called immediately before `request_user_approval`. |
| `display_progress_update(completed, total, currentPhase)` | no | Emits `display_component` → `<ProgressFeed>`. Called periodically during execution. |
| `display_completion_summary(stats, projectUrl)` | no | Emits `display_component` → `<CompletionCard>`. Called once at end. |

### Group H — Runtime docs recovery (1 server tool, Anthropic-managed)

| Tool | Blocking? | Purpose |
|---|---|---|
| `web_search(query)` | no | **Anthropic's built-in server tool** (`type: "web_search_20250305"` in the tools array — no custom implementation required). Agent uses this when a Rocketlane endpoint fails unexpectedly (unknown field, 404, schema mismatch). Forms queries like `"rocketlane api create phase dueDate field required"`, reads recent docs/forum/changelog results, then caches the correction via `remember("rl_api_fix:<endpoint>", "<correction>")` so it persists for the rest of the session. Also used if the agent encounters an unfamiliar CSV format or dependency notation and wants to look up PM tool-specific conventions. |

Adding `web_search` to the tools array:
```typescript
tools: [
  ...CUSTOM_TOOL_SCHEMAS,   // 20 tools above
  { type: "web_search_20250305", name: "web_search" },
]
```

---

**The 11 validation checks in `validate_plan`** (from PRD §5 Tool 3):
1. Every item has `name` and `type`
2. Every `parentId` references an existing item
3. Orphan items → "Ungrouped Tasks" phase
4. No circular dependencies
5. Row count matches source
6. Dates are valid YYYY-MM-DD
7. Effort values positive integers
8. Depth consistency (phase=0, task=1, subtask≥2)
9. Non-phase items have parentId
10. No duplicate IDs
11. Phase dates present (derive from children min/max if missing)

---

## Redis schema

```
session:{id}:meta          HASH   status, createdAt, ttlAt, rlWorkspaceId, rlApiKeyEnc, turnCount
session:{id}:history       LIST   JSON Anthropic messages; tool_result blocks carry summaries
                                  + artifactIds, never full blobs
session:{id}:artifacts     HASH   artifactId → JSON blob (csv rows, rl context, validator
                                  report, plan tree, exec results)
session:{id}:remember      HASH   key → value (agent working memory)
session:{id}:journey       HASH   Current journey state (last value from update_journey_state)
session:{id}:idmap         HASH   tempId → { type, rlId, parentTempId, createdAt }
session:{id}:execlog       LIST   { ts, tool, rlCall, rlStatus, latencyMs, idempotencyKey, error? }
session:{id}:pending       HASH   { toolUseId, question, options, createdAt } (only during awaiting_user)
session:{id}:lock          STRING SET NX EX 300

TTL: 48h on every key.
```

**Why artifacts matter.** A 62-row plan JSON + validator report + RL context replayed every turn = 100k+ tokens by turn 10. With artifacts, history carries 10-row previews + artifactIds; agent calls `query_artifact` when it needs specifics. Combined with `cache_control: ephemeral` on the system prompt, input costs drop ~70%.

**Why `remember` in Redis.** Separate from history so facts don't replay in every turn. Cleaner context. Used for user preferences, resolved ambiguities, decisions.

**Why `journey` in Redis.** Journey stepper is "current state", not a timeline event. Persisted separately so it rehydrates on reconnect via `GET /session/:id/journey`.

**Encryption.** RL API key AES-GCM encrypted in `meta.rlApiKeyEnc`. Decrypted only inside the RL client.

**Lock.** Prevents concurrent POSTs to the same session. SET NX EX 300. 409 if held.

---

## System prompt (`agent/src/agent/system-prompt.ts`)

One static string, ephemerally cached. Five sections:

### 1. Identity
"You are a Rocketlane Project Plan Agent. Your job is to take a project plan file (CSV or Excel) and create it as a fully structured project in Rocketlane — phases, tasks, subtasks, milestones, dependencies. You are an expert in project management and you use that knowledge to interpret any project plan intelligently. You are an agent: you decide when to act, when to inform, and when to stop and ask."

### 2. PM domain knowledge (PRD lines 208–246 verbatim)
WBS, phase patterns, task dependencies (FS/SS/FF/SF + lag), milestones, status values, effort vs duration.

### 3. PM tool export patterns (PRD lines 247–276 verbatim)
Smartsheet indentation, MS Project WBS/Outline numbers, Asana sections, Monday/Wrike/Jira, generic CSVs.

### 4. Rocketlane data model + API reference (PRD lines 278–290 and 753–823 verbatim)

**Data model:** Projects → Phases → Tasks → Subtasks (unlimited depth via `parent.taskId`). Phase dates REQUIRED. Tasks type `TASK` or `MILESTONE`. Two-pass dependency creation (all entities first, then dependencies).

**API base:** `https://api.rocketlane.com/api/1.0`
**Auth:** Header `api-key: <key>`

**Endpoints you will use:**
- `POST /projects` — `{ projectName, owner.emailId, customer.companyName, startDate, dueDate, autoCreateCompany: true }` → 201 `{ projectId }`
- `POST /phases` — `{ phaseName, project.projectId, startDate, dueDate }` → 201 `{ phaseId }`. startDate + dueDate REQUIRED.
- `POST /tasks` — `{ taskName, project.projectId, phase.phaseId, parent.taskId?, type: TASK|MILESTONE, startDate?, dueDate?, effortInMinutes?, progress?, status.value?, taskDescription? }` → 201 `{ taskId }`
- `POST /tasks/{taskId}/add-dependencies` — `{ dependencies: [{ taskId }] }`
- `GET /projects` — list projects (for `get_rocketlane_context`)
- `GET /tasks/{taskId}` — read back a task (for `get_task`)
- `GET /companies` — list accounts (for `get_rocketlane_context`) — **verify this exact path during Hour 1–2**
- `GET /users/me` — current user (for `get_rocketlane_context`) — **verify this exact path during Hour 1–2**

**Status values:** `1 = To do, 2 = In progress, 3 = Completed`

**Error codes:** 201 created, 400 bad request (check field message), 401 unauthorized, 429 rate limited (back off), 500 server error.

**Important notes:**
- Phase dates are REQUIRED — derive from child tasks (min startDate, max dueDate) if not provided.
- Every task needs a `phaseId` (walk up the parent chain to find ancestor phase).
- Subtasks use the same `/tasks` endpoint with `parent.taskId`.
- Milestones use the same `/tasks` endpoint with `type: "MILESTONE"`.
- Capture `X-Request-Id` response header for debugging in execlog.
- **Unlimited nesting depth confirmed** via prior testing (PRD line 822).
- Two-pass creation is required: all entities first (collecting IDs), then dependencies.

### 5. Behavioural rules

**Operating principle.** You decide when to call tools, when to ask, when to act. Stream your reasoning in plain text between tool calls — the user sees it. You have a JourneyStepper at the top of the chat that users reference for "where are we?" — update it by calling `update_journey_state` whenever your phase of work changes.

**Planning rule (first).** At the start of any non-trivial goal (especially right after a file is uploaded), call `create_execution_plan` with a clear list of steps you intend to take. This forces you to think through the full flow before acting and gives the user visibility into what's coming. If you change your approach mid-run, call `create_execution_plan` again with an updated plan — the user sees the update.

**Memory rule.** Use `remember(key, value)` to track facts you want available in future turns without cluttering the conversation history: user preferences, resolved ambiguities ("user confirmed DD/MM format"), decisions ("grouped rows 1-14 as Discovery phase"), pointers into artifacts. Use `recall(key)` to read them back.

**The Autonomy Matrix** (when to act vs inform vs ask):

**Act autonomously** — no need to ask, just do the work and proceed:
- Reason about hierarchy from structural signals (indentation, leading spaces, WBS numbers, parent columns, contextual clues)
- Reason about column meanings from headers and sample values
- Calculate phase dates from child tasks' min/max when phase dates are missing
- Auto-group orphan items under an "Ungrouped Tasks" phase
- Normalise dates to YYYY-MM-DD
- Detect milestone candidates using keywords ("sign off", "go-live", "approval", "handover") and zero-duration heuristics
- Handle empty/malformed rows silently (skip empties, keep partial data)
- Detect and skip project-level summary rows
- Run `validate_plan` and self-correct errors before proceeding
- Retry failed RL API calls up to 3 times with exponential backoff
- Continue past individual execution failures (log and move on)
- Fetch workspace context after API key validated
- Generate the execution summary at the end

**Act then inform** — do it, then tell the user in your streaming text:
- Column mapping interpretation + reasoning
- Hierarchy detection method + reasoning
- Orphan item grouping decisions
- Date format detection and normalisation
- Phase date calculation from children
- Dependency detection and notation pattern found
- Malformed row handling
- Phase creation from flat data
- Status/progress value interpretation
- Summary row detection

**Stop and ask** — always use `request_user_approval` with clickable options, never guess:
- Ambiguous dates where DD/MM and MM/DD both seem plausible
- Multiple sheets in Excel — which to use
- Deep nesting beyond depth 3 — keep nested, flatten, or per-item
- No detectable hierarchy after reasoning through all signals
- Duplicate task names — separate items or true duplicates
- Project name, customer/account, owner email (always explicit)
- Milestone confirmations (you suggest, user toggles)
- **Final plan approval before any `create_*` tool — non-negotiable**
- Post-execution failure recovery (retry, skip, abort)

**Reflection rule.** After any tool failure or validation error, call `reflect_on_failure(observation, hypothesis, next_action)` BEFORE retrying. Your reflection renders as a prominent card — the user sees you thinking, not flailing. Two to four sentences per field; don't lecture. Then retry or ask the user.

**Runtime docs recovery rule.** If a Rocketlane API call returns an unexpected error that suggests the API has changed since this system prompt was written (unknown field errors, 404 on a documented endpoint, response shape doesn't match this prompt's reference), don't just retry blindly:
1. Call `reflect_on_failure` to note the discrepancy.
2. Call `web_search` with a query like `"rocketlane api <endpoint> <error keyword>"` or `"rocketlane api changelog <year>"`.
3. Read the results, figure out the corrected endpoint/field/shape.
4. Call `remember("rl_api_fix:<endpoint>", "<what changed and how to fix>")` so you don't re-look-up the same thing later in this session.
5. Retry the original call with the correction.
If `web_search` finds no relevant results, fall back to `request_user_approval` with the error and options to retry, skip, or abort — the user may have additional context.

**Journey state rule.** Call `update_journey_state` at these transitions (at minimum):
1. Session start → steps initialized, "Connect" in progress
2. API key validated → "Connect" done, "Upload" in progress
3. File uploaded and parsed → "Upload" done, "Analyze" in progress
4. Plan validated and rendered → "Analyze" done, "Review & Approve" in progress
5. User approves → "Review & Approve" done, "Execute" in progress
6. Execution complete → "Execute" done, "Complete" done
You may also update sub-steps mid-execution (e.g., "Execute: creating phases" → "Execute: creating tasks").

**Two-pass creation rule.** All entities first (pass 1), then all dependencies (pass 2). If `add_dependency` is called before both tempIds exist in idmap, the tool errors — sequence correctly.

**Verification option.** After `create_tasks_bulk`, optionally call `get_task` on a sample of the created tasks to verify they look right. If one looks wrong, call `retry_task` with corrected args.

**Display component pairing:**
- `create_execution_plan` → `ExecutionPlanCard` (right after planning)
- `display_plan_for_review(plan)` → `request_user_approval` (show then ask)
- Before `create_tasks_bulk` → `display_progress_update(0, N, phaseName)`
- On failure → `reflect_on_failure` → (then retry or `request_user_approval`)
- After everything → `display_completion_summary`

---

## Frontend event model

**SSE event types** (`shared/types.ts`):
```typescript
export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_input_delta"; id: string; partialJson: string }
  | { type: "tool_use_end"; id: string }
  | { type: "tool_result"; id: string; summary: string }
  | { type: "display_component"; component: string; props: unknown }
  | { type: "journey_update"; steps: JourneyStep[] }
  | { type: "memory_write"; key: string }  // subtle indicator
  | { type: "awaiting_user"; toolUseId: string; payload: unknown }
  | { type: "done" }
  | { type: "error"; message: string };

export type JourneyStep = {
  id: string;
  label: string;
  status: "done" | "in_progress" | "pending" | "error";
};
```

**UI mapping:**
- `text_delta` → streaming reasoning bubble (collapsible)
- `tool_use_start` / `tool_input_delta` / `tool_use_end` → `ToolCallLine` one-liner
- `tool_result` → updates the ToolCallLine
- `display_component` → full-width card appended to timeline:
  - `ExecutionPlanCard` (from `create_execution_plan`)
  - `PlanReviewTree` (from `display_plan_for_review`)
  - `ReflectionCard` (from `reflect_on_failure`) — distinctive purple border with 💭 icon
  - `ProgressFeed` (from `display_progress_update`)
  - `CompletionCard` (from `display_completion_summary`)
  - `ApiKeyCard`, `FileUploadCard` (from matching display tools emitted in early turns)
- `journey_update` → **updates sticky JourneyStepper at top** (outside timeline), animated transitions
- `memory_write` → subtle toast "💾 remembered {key}" (fades after 2s) — just for user transparency
- `awaiting_user` → `ApprovalPrompt` with clickable chips; click → `sendToAgent({ sessionId, uiAction })`
- `done` → unlock input
- `error` → red banner + retry button

**Reasoning-collapse pattern.** Each assistant turn's text renders as a `💭 Thinking... (4s)` card. Expanded while streaming, auto-collapses when next `tool_use_start` fires. Keeps 15–25 turn runs clean.

**The JourneyStepper.** Sticky horizontal stepper above chat. Each step is a pill: icon + label. Colors: done = green check, in_progress = purple (Nitro) with pulse, pending = gray, error = red. Framer Motion transitions. On initial load/reconnect, frontend GETs `/session/:id/journey` so the stepper appears immediately.

---

## CORS + Upload flow

**CORS (agent/src/server.ts):**
```typescript
app.use((req, res, next) => {
  const origin = req.headers.origin ?? "";
  const allowed = origin === process.env.ALLOWED_ORIGIN
    || /\.rocketlane\.com$/.test(origin);
  if (allowed) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
```

**Upload flow:**
1. Frontend POSTs file to `https://plansync.vercel.app/api/upload`
2. Vercel route forwards multipart body to `https://plansync-agent.up.railway.app/upload`
3. Railway parses with SheetJS, writes to `session:{id}:artifacts:{artifactId}`, returns `{ artifactId, rowCount, columns, preview }`
4. Frontend POSTs to `/agent` with `"Uploaded artifact://{artifactId}"`
5. Agent calls `parse_csv(fileId)` on that artifact

---

## Rocketlane Custom App — core deliverable

The Custom App .zip wraps the Vercel URL as an iframe so Plansync runs inside Rocketlane. Demonstrates understanding of Rocketlane's extensibility model.

**`custom-app/manifest.json`** (Rocketlane Custom App spec):
```json
{
  "name": "Plansync",
  "slug": "plansync",
  "version": "1.0.0",
  "description": "AI agent that creates Rocketlane projects from a CSV file",
  "icon": "icon.svg",
  "surfaces": [
    {
      "type": "project-tab",
      "label": "Plansync",
      "url": "https://plansync.vercel.app?embed=1"
    }
  ]
}
```

**`custom-app/index.html`** — minimal HTML iframing the Vercel URL with full viewport (if Rocketlane requires self-contained bundle).

**`custom-app/build.sh`** — `zip -r plansync-custom-app.zip manifest.json icon.svg index.html`

**Frontend embed adaptation:** When `?embed=1`, hide the app header bar (Rocketlane provides chrome). Everything else identical.

**CORS:** `ALLOWED_ORIGIN` regex accepts both `plansync.vercel.app` and `*.rocketlane.com`.

---

## Build sequence (tonight all-nighter + tomorrow)

### Tonight — Session 1 (7+ hours)

**Hour 0–1 — Monorepo scaffold + Railway + de-risk streaming** *(Tracks RL task 5000001553843)*
- Create `plansync/` git repo with `frontend/`, `agent/`, `shared/`, `custom-app/`
- `cd frontend && npx create-next-app@14 . --ts --tailwind --app --no-src-dir`
- `cd ../agent && npm init -y && npm i express @anthropic-ai/sdk @upstash/redis xlsx zod nanoid undici && npm i -D typescript @types/node @types/express tsx`
- Minimal `agent/src/index.ts` Express server
- `railway login && railway init && railway up` — backend deployed hour 1
- Verify Railway URL returns "hello"
- **Build fake-agent streaming endpoint** with 1 dummy tool streaming SSE
- Tiny `frontend/app/page.tsx` reading SSE
- **Success criterion: localhost:3000 streams Claude + fake tool rendering via deployed Railway**
- If not working by Hour 1:30, stop and debug

**Hour 1–2.5 — Rocketlane client + full API verification** *(Tracks RL task 5000001553985)*

This is the risk-killer hour. Goal: prove every endpoint we'll use works exactly as the PRD/API reference describes, before we build 20 tools against it.

- `agent/src/rocketlane/client.ts` with: `createProject`, `createPhase`, `createTask`, `getTask`, `listProjects`, `listCompanies`, `getCurrentUser`, `addDependencies`, rate-limit handling, idempotency keys.
- `agent/scripts/test-rl.ts` — comprehensive standalone test:
  1. **Auth check**: `GET /projects?limit=1` — confirms the API key works; capture the response shape
  2. **Context reads**: `GET /companies`, `GET /users/me` (or discover exact paths if these 404) — we need these for `get_rocketlane_context`
  3. **Create project**: `POST /projects` with `autoCreateCompany: true` — capture response shape, verify `projectId` format
  4. **Create 2 phases**: `POST /phases` with required `startDate`+`dueDate` — verify `phaseId` format
  5. **Create 3 regular tasks**: `POST /tasks` with `type: TASK` — one under each phase
  6. **Create 1 subtask**: `POST /tasks` with `parent.taskId` set — verify `parent.taskId` actually works as documented
  7. **Create 1 sub-subtask**: `POST /tasks` with `parent.taskId` of the subtask — confirm depth-3 works (PRD claims unlimited)
  8. **Create 1 milestone**: `POST /tasks` with `type: MILESTONE` — verify it looks different in the RL UI
  9. **Read back**: `GET /tasks/{id}` on each — confirm response shape matches what `get_task` needs
  10. **Set a dependency**: `POST /tasks/{id}/add-dependencies` — verify request shape and that dependency appears on the dependent task
  11. **Negative case**: `POST /phases` without `dueDate` — confirm the exact 400 error code and message so our validator can produce matching errors
  12. **Rate limit probe**: burst 10 rapid POST /tasks — check for 429 and the `Retry-After` header format
- Print every request/response to console. Save a JSON file `rl-api-contract.json` capturing the actual response shapes — the agent can reference this as a "ground truth" during development.
- **Success criterion:** Every endpoint the 20 tools depend on has been proven to work, with real response shapes documented. If any endpoint behaves differently from PRD §9, fix `client.ts` AND update the API reference in `system-prompt.ts` AND update the plan.
- **If an endpoint doesn't exist as documented** (e.g. `/companies` is actually `/customers`): update the plan and the system prompt before proceeding. Do NOT build tools against a wrong API reference.

**Hour 2.5–4 — Memory + system prompt + Group A/B/C tools** *(Tracks RL tasks 5000001553889, 5000001553861, 5000001553944, 5000001553966)*
- `agent/src/memory/{redis,session,artifacts,remember,lock}.ts`
- `agent/src/lib/crypto.ts`
- `agent/src/agent/system-prompt.ts` — paste PRD §4.3 Layers 1–3 verbatim + PRD §9 API reference verbatim (updated from any Hour 1–2 verification fixes) + full autonomy matrix + planning/memory/reflection/journey/verification rules
- Tool impls: `parse_csv`, `get_rocketlane_context` (uses listProjects + listCompanies + getCurrentUser from client.ts), `query_artifact`, `validate_plan` (all 11 checks), `create_execution_plan`, `update_journey_state`, `remember`, `recall`, `reflect_on_failure`
- `agent/src/tools/index.ts` with 20 Anthropic tool schemas + dispatcher

**Hour 4–5.5 — Real agent loop + Group D/E/F/G/H tools** *(Tracks RL tasks 5000001553912, 5000001554009)*
- Replace fake loop with real `runAgentLoop`
- Group E: `create_rocketlane_project`, `create_phase`, `create_task`, `create_tasks_bulk`, `add_dependency`
- Group F: `get_task`, `retry_task`
- Group D: `request_user_approval` (blocking) with `awaiting_user` event
- Group G: `display_plan_for_review`, `display_progress_update`, `display_completion_summary`
- Group H: add `{ type: "web_search_20250305", name: "web_search" }` to the tools array — zero custom code, Anthropic handles it server-side
- Enable `cache_control: ephemeral` on the system prompt

**Hour 5.5–7 — First real end-to-end run** *(Tracks RL task 5000001554046)*
- Hand-author 8-row CSV with 2 phases, 4 tasks, 1 subtask, 1 milestone, 1 dependency
- POST upload → POST /agent → watch Claude: plan → validate → approve → execute
- Verify project in Rocketlane matches
- **Success criterion: Complete end-to-end run, text-only UI, all 21 tools wired, journey emitted**

### Tomorrow AM (4–6 hours) — UI *(Tracks parent 5000001553730)*

**Hour 0–1.5 — Chat shell + streaming text + JourneyStepper** *(Tracks 5000001554041, 5000001554050)*
- Rocketlane Carbon tokens in `frontend/app/globals.css`
- `Chat.tsx`, `MessageBubble.tsx` with streaming text + collapsible reasoning
- `ToolCallLine.tsx`
- `JourneyStepper.tsx` sticky top, reads `journey_update`, Framer Motion
- `frontend/lib/agent-client.ts` SSE reader
- `GET /session/:id/journey` hydration endpoint on backend

**Hour 1.5–2.5 — Upload + API key cards** *(Tracks 5000001554042)*
- `ApiKeyCard`, `FileUploadCard` via `display_component` events
- Dropzone + validation → POST to `/api/upload` → backend `/upload`

**Hour 2.5–3.5 — Plan review + ExecutionPlanCard + ReflectionCard** *(Tracks 5000001554043)*
- `PlanReviewTree.tsx` — collapsible phases, milestone toggles, inline-editable names, orphan section
- `ExecutionPlanCard.tsx` — renders agent's TODO list from `create_execution_plan`, shows step status
- `ReflectionCard.tsx` — distinctive purple-bordered card with observation/hypothesis/next_action

**Hour 3.5–4.5 — Approval prompt** *(Tracks 5000001554044)*
- `ApprovalPrompt.tsx` clickable option chips + Framer Motion entry (~150ms)
- Wire the `awaiting_user` → click → `sendToAgent({ uiAction })` flow

**Hour 4.5–5.5 — Progress + completion + memory toast** *(Tracks 5000001554050)*
- `ProgressFeed.tsx` phase-segmented bar + sticky streaming log
- `CompletionCard.tsx` with stats + "View in Rocketlane →"
- Memory write toast ("💾 remembered {key}")

### Tomorrow PM (4–5 hours) — Ship *(Tracks parent 5000001553747)*

**Hour 0–1.5 — Demo CSV + end-to-end** *(Tracks 5000001554045, 5000001554046)*
- Author Shard FM Engine CSV (62 rows, 5 levels, from UK Lifts plan per PRD §11)
- Run end-to-end on deployed Railway; fix what breaks
- Re-run 2–3 times until clean

**Hour 1.5–2.5 — Edge cases** *(Tracks 5000001554047)*
- Missing dates, ambiguous DD/MM, duplicate names, deep nesting, orphans
- Self-correction: inject circular dependency → agent reflects → fixes → re-validates
- Memory: verify `remember("user_date_format", "DD/MM")` persists across turns
- Verification: verify `get_task` spot-check path works
- Retry: force one task creation failure → verify `retry_task` recovery

**Hour 2.5–3 — Custom App .zip** *(Tracks 5000001554048)*
- `custom-app/manifest.json`, `index.html`, `icon.svg`
- Adapt frontend to hide header when `?embed=1`
- `build.sh` produces `plansync-custom-app.zip`
- Test: upload .zip to inbarajb.rocketlane.com, verify embed works, complete a run inside Rocketlane

**Hour 3–4.5 — Deploy frontend + BRD + submit** *(Tracks 5000001554048)*
- `vercel --prod` from `frontend/`
- Set env vars in Vercel
- Verify streaming works on prod (breaks ~20% of the time — CORS, buffering)
- Write BRD (1–2 pages): problem, approach, architecture, how it's agentic (21 tools, planning, memory, reflection, journey), demo link, repo link, Custom App .zip link
- Upload BRD + demo CSV + Custom App .zip to Rocketlane Spaces
- Submit to Janani

### Cut-if-late list

Everything that's been promised in discussion is **NOT** on this list. Only UI polish can be cut:
1. Milestone diamond icons in PlanReviewTree (use ⭐ emoji)
2. Execlog JSON download button
3. Completion card stats breakdown (just "N tasks created")
4. Inline editing in PlanReviewTree (approve-as-is only)
5. Dependency visualization in PlanReviewTree (list only)
6. Framer Motion animations (instant transitions)
7. Memory write toast (silent memory writes — agent still uses `remember`/`recall` internally)

**Nothing else is cuttable.** Planning, memory, reflection, verification, retry, journey stepper, Custom App, 21 tools, self-correction, autonomy matrix — all core.

---

## Risks & de-risking order

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Streaming + tool_use + SSE breaks on Railway | Medium | Fatal | **De-risk Hour 1** with fake-agent streaming loop deployed to Railway |
| 2 | Rocketlane API surprises | Medium | High | **De-risk Hour 2** with standalone test-rl.ts |
| 3 | Agent context bloat by turn 12 | High if unmitigated | Medium | Artifact store + `remember`/`recall` + prompt caching from Hour 3 |
| 4 | CORS / buffering issues on Vercel ↔ Railway | Medium | Medium | Explicit CORS + SSE headers + `X-Accel-Buffering: no` |
| 5 | Two-pass dependency ordering bug | Medium | Medium | Validator check #4 + tool-level assertion |
| 6 | Anthropic 529 overloaded mid-demo | Low | Embarrassing | One retry + clean error + "Resume" button |
| 7 | UI clutter at turn 20 | High | Medium | Collapsible reasoning + sticky JourneyStepper + ProgressFeed |
| 8 | Railway cold start during demo | Low | Medium | $5 hobby plan keeps warm |
| 9 | Custom App .zip format surprises | Medium | Low | Build Tomorrow PM after everything else works |
| 10 | 21-tool schema confuses Claude | Low | Low | Group tools in the system prompt by role (already done above); Sonnet 4.5 handles 21 tools fine |
| 11 | Rocketlane API reality differs from PRD §9 | Medium | Medium | `test-rl.ts` verifies ALL endpoints Hour 1–2; any mismatches are fixed in `client.ts` + `system-prompt.ts` before building tools |
| 12 | Rocketlane API changes between build and demo | Low | Medium | `web_search` runtime recovery rule: agent detects schema drift, looks up current docs, caches fix via `remember`, retries. Graceful degradation to `request_user_approval` if search finds nothing. |

**De-risking principle:** Risks 1 and 2 are "unknown knowns" — do them tonight in Hours 1 and 2.

---

## Verification

**Tonight's success criterion:** Tiny test CSV against deployed Railway backend produces a real Rocketlane project matching the CSV structure.

**Tomorrow's success criteria:**
1. **Clean run.** Shard FM Engine CSV → journey stepper advances Connect → Upload → Analyze → Review → Execute → Complete → CompletionCard shows "62 tasks created" → link to Rocketlane matches.
2. **Planning visible.** `ExecutionPlanCard` renders early with the agent's own TODO. User can see what's coming.
3. **Messy run.** Missing dates, ambiguous DD/MM → agent asks via `ApprovalPrompt`, derives phase dates from children, remembers user's date format choice.
4. **Self-correction + reflection.** Inject circular dependency → `validate_plan` errors → `reflect_on_failure` renders a ReflectionCard → agent fixes plan → re-validates → succeeds.
5. **Verification.** After 62-task creation, `get_task` spot-checks a few → all correct.
6. **Retry.** Force one task creation failure → `retry_task` recovers → final count matches.
7. **Long run.** 62-row plan in one POST — no chunking, proves Railway+unbounded.
8. **API drift recovery.** Point `rocketlane/client.ts` at a stub that returns `400 Unknown field: dueDate, did you mean endDate?` for one call → agent reflects → calls `web_search` → finds the correction (or gracefully falls back to `request_user_approval`) → recovers the run. Proves runtime resilience.
9. **Custom App run.** Install `plansync-custom-app.zip` in inbarajb.rocketlane.com → open Plansync tab from a project → complete full run from inside Rocketlane.
10. **Deployed run.** https://plansync.vercel.app with live Railway backend.

**How to tell Janani it's an agent (verbal defense):**
1. "The LLM controls flow — no state machine. It decides when to plan, validate, ask, execute."
2. "Real ReAct loop: 15–25 tool calls per run, 21 tools total organized by role (input, planning, memory, HITL, creation, verification, display, runtime recovery)."
3. "Agent plans its own work — calls `create_execution_plan` upfront and you see its TODO list."
4. "Agent has explicit working memory — `remember`/`recall` for facts it wants to track without cluttering context."
5. "Agent reflects on failures — `reflect_on_failure` renders a visible card before retrying."
6. "Self-corrects on validation errors — reasons through errors and fixes the plan."
7. "Agent is resilient to API changes — if Rocketlane renames a field tomorrow, the agent uses `web_search` to find the current docs, caches the fix via `remember`, and recovers. Graceful fallback to human approval if search fails."
8. "UI is agent-driven: every card on screen (including the journey stepper at the top) is emitted by a tool call the agent chose to make."
9. "HITL is a tool the agent judges when to invoke, not a hardcoded wizard gate."
10. "Decoupled production architecture: Vercel frontend + Railway backend. Each runs what it's good at."
11. "Rocketlane Custom App integration — runs inside Rocketlane, not just alongside it."

---

## Persistent sessions — deferred, documented

Inbaraj asked whether to revisit this. My recommendation: **stay out of scope for the 1.5-day submission**. Janani running the demo once or twice doesn't need it; a real product demo post-submission would take ~4 extra hours to add (user identifier, session list endpoint, sidebar, resume flow). Cutting something else from the 1.5-day window is not worth it. If you want it post-submission, the architecture supports it — the Redis schema already includes `sessionId` as the primary key.

---

## Critical files to reference (from the PRD)

- `/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md` lines 208–290 — paste into `agent/src/agent/system-prompt.ts`
- `/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md` lines 519–586 — Autonomy Matrix, paste into behavioural rules
- `/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md` lines 442–458 — 11 validation checks, implement in `agent/src/tools/validate-plan.ts`
- `/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md` lines 753–823 — RL API reference, use for `agent/src/rocketlane/client.ts` AND `agent/src/rocketlane/docs.ts`
- `/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md` lines 614–655 — Rocketlane Carbon design tokens for `frontend/app/globals.css`
- `/Users/inbaraj/Downloads/plansync/PRD_Projectplanagent.md` lines 888–895 — Shard FM Engine demo scenario

## Rocketlane tracking task IDs

| Task | ID |
|---|---|
| Unified /agent endpoint with streaming ReAct loop | 5000001553843 |
| System prompt: identity, PM knowledge, RL data model, autonomy matrix | 5000001553861 |
| Memory primitives (Redis + remember/recall tools) | 5000001553889 |
| Self-correction loop + reflect_on_failure + web_search runtime docs recovery | 5000001553912 |
| Input tools: parse_csv + get_rocketlane_context + query_artifact | 5000001553944 |
| Planning tools: validate_plan + create_execution_plan + update_journey_state | 5000001553966 |
| Creation tools: create_project, create_phase, create_task, create_tasks_bulk, add_dependency + get_task + retry_task | 5000001553985 |
| HITL + display tools | 5000001554009 |
| Chat shell with streaming reasoning panel | 5000001554041 |
| API key card + file upload drop zone | 5000001554042 |
| Plan review tree + ExecutionPlanCard + ReflectionCard | 5000001554043 |
| Immersive approval prompt with clickable options | 5000001554044 |
| Progress feed + completion card + JourneyStepper + RL design tokens | 5000001554050 |
| Shard FM Engine demo CSV (62 rows, 5 levels) | 5000001554045 |
| End-to-end clean run verification | 5000001554046 |
| Edge-case tests: messy data + self-correction + memory + retry | 5000001554047 |
| Deploy frontend + backend + Custom App .zip + BRD | 5000001554048 |

---

## Open items the plan does NOT cover (by design)

- **PRD rewrite** — skipping. BRD will be written from this plan post-build.
- **Sentry** — dropping for time. Console + Railway logs + Vercel logs.
- **Persistent sessions across visits** — deferred with documented trade-off.
- **Walkthrough video** — decided Friday based on time remaining.
- **Unit tests** — 1.5-day ship; verification is end-to-end functional runs.
- **Multi-user / auth** — single anonymous session per browser.
- **Long-term memory across sessions** — all memory scoped to a single 48h session.
