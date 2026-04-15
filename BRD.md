# Plansync — Business Requirements Document

> **AI agent that reads any project plan CSV/Excel file and creates it as a fully structured project in Rocketlane.**
> Built as the take-home assignment for the **Rocketlane Implementation Manager** role.
> Submitted: 2026-04-16. Author: Inbaraj B.

---

## 1. The problem

Rocketlane has a polished native UI for managing project plans, but **no native CSV import** for them. Every implementation team that arrives with an existing plan in Smartsheet, MS Project, Asana, Monday, Wrike, or Jira has to **rebuild it row-by-row inside Rocketlane**. For a 60-task plan with a few levels of subtasks, milestones, and dependencies, that's typically a 30-60 minute manual effort — repeated for every new customer onboarding.

That manual rebuild is:

- **Error-prone.** Phase boundaries, dependency directions, and milestone classifications get lost in translation.
- **A blocker on time-to-value.** A new Rocketlane customer can't kick off their implementation until their existing plan is faithfully recreated in the platform.
- **A waste of expensive IM time.** Implementation Managers should be running discovery and aligning stakeholders, not retyping cell values.

## 2. The solution: Plansync

Plansync is a properly designed **AI agent** (not a wizard with Claude in one step) that:

1. Accepts any project plan as a `.csv` or `.xlsx` file
2. Reasons about the plan's structure using PM domain knowledge — detecting hierarchy from indentation, WBS numbers, parent columns, or contextual clues
3. Gathers metadata interactively (project name, customer, owner, dates) — inferring defaults from workspace context, asking only for what it can't infer
4. Validates the plan against 11 structural checks and self-corrects on failure
5. Previews the parsed plan to the user for approval
6. Executes the full creation in Rocketlane in **3-5 seconds** for a 21-task plan
7. Streams every step of its reasoning live to the user, so the experience is transparent rather than a black box

Live demo: https://plansync-tau.vercel.app
Source: https://github.com/inba-2299/Plansync

---

## 3. Why "agent" (and not a wizard)

The original PRD I wrote described what Anthropic calls an **AI-augmented workflow** — a Next.js wizard with a hardcoded 6-step state machine, 5 mandatory HITL checkpoints, and a single batch `execute_creation_pass` tool that hid the agent's work behind one Claude call. Mid-build I realized that wasn't an agent under Anthropic's framing:

> **Workflow.** "LLMs and tools orchestrated through predefined code paths."
> **Agent.** "LLMs that dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks."

I rebuilt Plansync from scratch as a **real agent**:

| Wizard pattern (rejected) | Agent pattern (shipped) |
|---|---|
| 6-step state machine in the backend | One static system prompt; LLM controls flow |
| Hardcoded HITL gates | `request_user_approval` is a tool the agent calls when it judges necessary |
| Batch `execute_creation_pass` hides creation work | Agent directs creation via `execute_plan_creation` (batch) + 7 fine-grained creation tools (failure recovery) |
| Frontend has business logic | Frontend has zero business logic — just renders what the agent emits |
| Status field, switch/case dispatch | Agent reports state via `update_journey_state`; frontend renders it |

**The verbal defense, in 60 seconds:**

1. The LLM controls flow — no state machine, no switch/case on a status field.
2. Real ReAct loop: 22 tools total (21 custom + Anthropic's `web_search` server tool), 4-12 turns per run, agent picks which tool to call next based on its own reasoning.
3. Agent plans its own work — `create_execution_plan` writes a visible TODO list before any work starts, so the user sees what's coming.
4. Agent has explicit working memory — `remember` / `recall` for facts it wants to track without cluttering history.
5. Agent reflects on failures — `reflect_on_failure` renders a visible card before retrying, so the user sees thinking, not flailing.
6. Self-corrects on validation errors — runs 11 checks via `validate_plan` and re-validates after fixing.
7. Resilient to runtime API drift — if Rocketlane renames a field, the agent uses `web_search` to find the current docs, caches the fix via `remember`, and recovers.
8. UI is fully agent-driven — every card on screen (including the journey stepper at the top) is emitted by a tool call the agent chose to make.
9. HITL is a tool, not a hardcoded wizard gate — the agent decides when to ask.
10. Decoupled production architecture — Vercel frontend + Railway backend, each running what it's good at.
11. Rocketlane Custom App integration — runs **inside** Rocketlane via an iframe wrapper, not just alongside it.

---

## 4. Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ Vercel — Next.js 14 UI   │         │ Railway — Node agent     │
│                          │         │                          │
│  Header + JourneyStepper │  fetch  │  POST /agent             │
│  + "New session" + ⚡    │  + SSE  │  - ReAct loop            │
│                          ├────────►│  - 22 tools              │
│  Split workspace         │         │  - Streams text + tools  │
│  ┌──────────┬──────────┐ │         │  - Self-corrects         │
│  │ Your     │ Agent    │ │         │  - 429 retry + heartbeat │
│  │ workspace│ workspace│ │◄────────┤                          │
│  │ (40%)    │ (60%)    │ │         │  POST /upload            │
│  │          │          │ │         │  GET /session/:id/events │
│  │ inputs   │ reasoning│ │         │  GET /session/:id/journey│
│  │ uploads  │ tool calls│ │         │  POST /session/:id/apikey│
│  │ approvals│ plan tree │ │         │                          │
│  │ completion│ pinned cards│ │         │  Hosted on Railway       │
│  └──────────┴──────────┘ │         │  Node 20 + Express       │
│                          │         └──────┬───────────┬───────┘
│  plansync-tau.vercel.app │                │           │
│  (also embedded in       │                ▼           ▼
│   Rocketlane via Custom  │      Anthropic API    Rocketlane API
│   App iframe)            │      (Claude Sonnet   (server-to-server,
└──────────────────────────┘       /Haiku 4.5)      AES-256-GCM
                                                    encrypted key
                                                    in Redis)
                                          │
                                          ▼
                                  Upstash Redis
                                  (session store:
                                   meta, history,
                                   artifacts, journey,
                                   events log, idmap,
                                   pending, lock)
```

**Why decoupled.** Vercel Hobby's 60s `maxDuration` would have forced deadline tracking, chunked auto-resume, checkpointed bulk operations, and state stitching across invocations — a whole class of complexity I deleted by moving the agent loop to Railway (no timeout). Vercel runs only the Next.js frontend; Railway runs only the Node agent backend; one git push deploys both.

**Stateless backend.** Each `POST /agent` call loads session from Redis, runs the loop to completion (or to the next pending approval), persists, and returns. Redis is the working memory. The backend itself holds no per-session state between requests.

**One static system prompt, ephemerally cached.** Five sections: identity, PM domain knowledge (verbatim from the PRD), tool export pattern recognition (Smartsheet, MS Project, Asana, Monday/Wrike/Jira), Rocketlane data model + API reference, and behavioral rules including the autonomy matrix (when to act vs inform vs ask). `cache_control: ephemeral` on the prompt + tools array → ~2000 tokens of stable context cached after turn 1.

---

## 5. Tools — 22 in the array, 7 functional groups

| Group | Tools | Purpose |
|---|---|---|
| **Input & context** | `parse_csv`, `get_rocketlane_context`, `query_artifact` | Read the user's file + workspace state |
| **Planning & metacognition** | `create_execution_plan`, `update_journey_state`, `validate_plan`, `reflect_on_failure` | Visible TODO list, journey stepper, 11-check validator, post-failure reflection |
| **Memory** | `remember`, `recall` | Working memory keyed by name, kept out of conversation history |
| **HITL** | `request_user_approval` | The ONLY blocking tool — pauses the loop for user input |
| **Creation** | `execute_plan_creation` (batch happy-path), `create_rocketlane_project`, `create_phase`, `create_task`, `create_tasks_bulk`, `add_dependency` | One batch tool for the typical run; fine-grained tools as fallback for failure recovery |
| **Verification & retry** | `get_task`, `retry_task` | Read-back verification + targeted retry of failed individual creates |
| **Display** | `display_plan_for_review`, `display_progress_update`, `display_completion_summary` | Drive the agent-emitted cards on the frontend |
| **Runtime docs recovery** | `web_search` (Anthropic server tool) | Look up Rocketlane API changes if our cached reference goes stale |

The full tool-by-tool breakdown lives in `docs/PLAN.md` § "Tools" with rationale for each.

---

## 6. Key technical decisions (and why I made them)

### 6.1 Batch execution tool — reversed the "fine-grained only" stance

**Original plan:** break Rocketlane creation into many small tool calls (`create_phase`, `create_task`, `add_dependency`) so the agent loops through them visibly. This is the "more agentic" choice on paper.

**Reality:** 15-30 turns per execution phase, $3/run on Sonnet, 60-120 seconds, regular collisions with the 30K TPM rate-limit wall.

**Fix:** added `execute_plan_creation` as a single batch tool that takes an artifact ID for the parsed plan and does the whole creation deterministically on the backend (project shell → phases → tasks → subtasks → milestones → dependencies, with progress events streamed back). The fine-grained tools still exist as fallbacks for failure recovery. **The agentic decision is now "which tool to use" (batch vs fine-grained), not "walk every mechanical step."**

**Measured impact** on first end-to-end run (21 tasks, 8 phases, 8 milestones, 12 dependencies):
- Cost: $3/run → **$0.86/run** on Sonnet 4.5 (~70% reduction)
- Execution time: 60-120s → **3.5 seconds** (~35× faster)
- Token usage in the execution phase: down ~10×
- Rate limit wall: no longer hit
- Predicted cost on Haiku 4.5: **~$0.20-0.25/run**

### 6.2 Refresh-safe sessions via Redis event log replay

**Problem:** every browser refresh nuked all UI state — reasoning, plan review, journey, approvals — because the frontend regenerated `sessionId` on every page load, orphaning the backend session.

**Solution:** persist every SSE event the agent emits to a `session:{id}:events` Redis list (7-day TTL, fire-and-forget), wrapping the `emit()` function so events are captured even if the client disconnected mid-stream. Frontend reads `sessionId` from `localStorage`, and on mount calls `GET /session/:id/events` to replay the full list through the **same** `handleAgentEvent` function that processes live streaming. Same code path — no duplicated state-derivation logic.

**Result:** refresh at any point in a session returns to **exactly** the same UI state. Reasoning bubbles, tool calls, plan review tree, execution plan, progress feed, journey stepper, and previously-answered approval cards all reconstruct correctly.

**Limitation:** same-browser only. Cross-device recovery (phone ↔ laptop) is deferred post-submission — it's not exercised during a single-reviewer demo.

### 6.3 Token optimization stack

Four complementary changes applied together:

1. **Tool caching** — `cache_control: ephemeral` on the last tool schema. Anthropic's prompt caching cascades backwards from the marker, so this caches the entire tools array. After turn 1, ~2000 tokens of tool schemas become ~200 effective tokens.
2. **Reasoning diet rule** in the system prompt — forbids JSON / code blocks in streaming text. Prose only, <200 chars per bubble. Fixed the `max_tokens` errors I was hitting when the agent dumped full plan JSON in reasoning before calling tools.
3. **Compact JSON rule** — no indentation in tool inputs. ~20-30% savings.
4. **Plan-by-artifact-reference** — `execute_plan_creation` takes `planArtifactId`, not a full plan object. Plan JSON loads from the artifact store on the backend instead of being inlined in the tool input (which would land in history and replay every turn).

### 6.4 Defensive frontend hardening + top-level error boundary

A mid-Haiku run revealed that any unhandled render error in any agent-emitted card would blanket-crash the app with "Application error: a client-side exception" — white page, no recovery. Root cause was `PlanReviewTree.dependsOn.length` on an undefined value (Haiku is lax about emitting empty arrays for optional fields).

**Two-part fix:**
1. **Surgical** — `normalizePlanItem()` coerces every raw field at the Map-building boundary so downstream renderers never see undefined fields. Plus optional-chain `.length` accesses as belt-and-suspenders. Same pattern applied to `journey_update` events.
2. **Structural** — wrapped `Chat` in a class-based `ErrorBoundary` that catches any render crash anywhere in the tree and shows a recoverable "Something went wrong" card with error details and Reset / Full-reload buttons. Second line of defense — converts white-page-of-death into a recoverable error card.

**Lesson baked into the design:** agent-driven UIs are dynamic by definition, so a top-level error boundary is mandatory, not optional.

### 6.5 Reliability extras

- **429 retry** with `Retry-After` header backoff, up to 3 attempts, max 60s wait, emits a `rate_limited` SSE event so the frontend can show a countdown
- **15-second SSE heartbeat** (comment-line per spec §9.2.6) — fixes the silent hang when a long Anthropic call crosses the Railway/Cloudflare proxy idle timeout
- **`pendingToolResults` stashing** — fixes the Anthropic 400 `tool_use ids were found without tool_result blocks` error when an assistant turn ends with `request_user_approval` after other non-blocking tools
- **AES-256-GCM encryption** of the Rocketlane API key at rest in Redis, decrypted only in-process per request
- **CORS + credentials** properly configured for cross-origin cookie flows (`Access-Control-Allow-Credentials: true` alongside exact-origin `Allow-Origin`) — needed for the admin portal to work from Vercel frontend → Railway backend

### 6.6 System prompt hardening against prose-asking (Commit 2h)

A real production session revealed a class of Anthropic non-determinism that nearly killed the submission experience: the agent would occasionally **prose-ask** a question ("Does the plan look good? Let me know and I'll continue...") instead of calling `request_user_approval`, then end its turn with `done`. The user saw a question with no actionable card — the conversation deadlocked.

**Diagnosed via direct Upstash Redis inspection.** Wrote two scratch scripts (`/tmp/inspect-sessions.mjs` + `/tmp/diff-sessions.mjs`) that SCANned session meta + walked event logs via the Upstash REST API, sorted sessions by createdAt, and printed the tool call sequence of each. Compared a bad session against a clean one three minutes later: both ran the same backend code with the same model, but the bad session stopped at 11 tool calls (after `display_plan_for_review`) while the clean one ran 24 (continuing through 6 more `request_user_approval` calls for metadata gathering).

**Fix:** two new **HARD RULE** sections at the top of the Behavioral Rules in the system prompt:

1. **"NEVER prose-ask the user for input"** — 9 forbidden prose patterns (all pulled verbatim from the bad session, like "Does the plan look good?", "What should the project be called?") with required `request_user_approval` replacements using concrete option labels. A three-question self-check agents must run before ending a turn.

2. **"Update the JourneyStepper after EVERY phase transition"** — 7 minimum transitions explicitly listed, plus the rule that the FIRST tool call on every resumed turn should usually be `update_journey_state`.

Plus a new **§ 6 "Re-read the hard rules before every tool call"** at the very END of the prompt, specifically to combat prompt-cache drift (Anthropic caches this whole prompt after turn 1; by turn 5 the rules at the top feel like "background" to the model). This section forces the model to re-ask itself the two HARD RULE questions at every tool call decision point.

**Lesson:** prompt caching is a double-edged sword. It saves tokens but makes the top of the prompt feel distant from the model's attention by later turns. Mitigation: put the most-critical rules at the top AND reiterate them at the bottom AND explicitly instruct the model to re-read them at every decision point. The combined effect pays for itself — the rules consistently fire at the moment they matter.

---

## 7. Rocketlane Custom App integration

Plansync ships as a **Rocketlane Custom App `.zip`** (`custom-app/plansync-custom-app.zip`, 199 KB) built via the official **`@rocketlane/rli`** CLI. **Installed and verified working** inside `inbarajb.rocketlane.com` — the widget appears in both the workspace left nav and as a project tab.

### The Custom App pivot (story worth telling)

I first tried to build the `.zip` by hand: a `manifest.json`, an `index.html` iframe shell, an `icon.svg`, and a `build.sh` that ran `zip -r` over them. Based on general extension-platform conventions (Slack apps, GitHub apps, Chrome extensions). Rocketlane rejected the upload with:

> **`Invalid zip: rli-dist/deploy.json not found in the uploaded file.`**

That one error message told me everything I needed to know: Rocketlane Custom Apps use a CLI-based build system. Research found the official developer portal at **developer.rocketlane.com** and the `@rocketlane/rli` npm package (RLI = "Rocketlane CLI"). Apps are scaffolded with `rli init`, built with `rli build`, and packaged into `app.zip` containing an auto-generated `rli-dist/deploy.json` (the manifest Rocketlane's upload validator actually checks).

I rebuilt Plansync's Custom App from scratch:

1. `npm install -g @rocketlane/rli`
2. `rli init --template basic` → scaffold with `index.js` manifest, widgets/ directory, public/ assets
3. Stripped the scaffold to a single Plansync widget declaring two surfaces (`left_nav` + `project_tab`)
4. Widget `entrypoint.html` points to a local bundled HTML file at `widgets/plansync/index.html`
5. That local HTML is a **full-viewport iframe** loading `https://plansync-tau.vercel.app?embed=1` with a purple-gradient loading placeholder
6. `rli build` produces `app.zip` (199 KB) containing `rli-dist/deploy.json` + the RLI runtime + the widget source
7. Renamed to `plansync-custom-app.zip` via the build.sh wrapper

**Why iframe-inside-widget:** widgets can only reference LOCAL bundled HTML files (not external URLs directly), but those local files are regular HTML — so they can contain an iframe to any external URL. This preserves the live-updates-from-Vercel story: any frontend change I push to `main` deploys automatically via Vercel and the next time a user opens the Plansync widget inside Rocketlane, they see the new version. **The `.zip` only needs to be rebuilt if the manifest, widget shell, or icon itself changes.**

When the frontend detects `?embed=1`, it hides its app header (Rocketlane provides its own chrome) and replaces it with a slim toolbar that has just the "New session" button, journey stepper, and connection pill.

**Lesson:** when an integration has an official CLI/SDK, use it — don't try to reverse-engineer the wire format from secondary sources. Cost me ~2 hours building the wrong version first, then another 15 minutes researching to pivot. Next time: **always check for an official SDK first.**

---

## 7.5. Lightweight admin portal (bonus feature)

Beyond the six core deliverables, Plansync ships with a **lightweight operator admin portal** at `/admin` for observability + runtime agent configuration. **Not part of the original PRD** — added late in the build after repeatedly needing to write scratch scripts to inspect Redis sessions during debugging.

### What it has

Four-tab layout with lazy loading:

- **Observability** — 6 stat cards (Runs Today, Success Rate, Active Now, Errors Today, Est. Cost Today, Avg Cost/Run), plus a per-model usage breakdown showing input / output / cache read / cache write tokens with cost estimates. All stats are pre-computed counters updated in real-time on every agent event, so the dashboard loads in ~200ms.
- **Runtime Config** — editor for the Anthropic model (Haiku / Sonnet / Opus), max output tokens, and 429 retry cap. Changes write to Redis and take effect on the next agent turn **without a Railway redeploy**. Loop.ts now reads from Redis first, falls back to env var, falls back to a hardcoded default.
- **Agent Tools** — grid of all 22 tools organized into 7 functional categories (Input & Context, Planning & Metacognition, Memory, HITL, Creation, Verification, Display, Runtime Docs Recovery) with human-readable descriptions and enable/disable toggles. `request_user_approval` is marked as protected (lock icon, cannot be disabled — it's the only blocking tool in the system, and the entire interactive UX depends on it).
- **Recent Sessions** — filterable table with date range (Today / 24h / 7d / All), status (All / Success / Errors / Active / Abandoned), and sessionId search. Shows per-session stats: created time, status badge, turns, events, tokens, estimated cost, last event type.

### Architecture

**Auth:** HMAC-SHA-256 signed HttpOnly cookie (login form, not Basic Auth). Signing key reuses the existing `ENCRYPTION_KEY` env var. 2-hour session lifetime. Admin credentials are set via `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables on Railway; if either is missing, all `/admin/*` routes return 503 and the rest of the app is unaffected. **Fail-closed by design.**

**Performance:** the first version of the admin portal was built with the obvious pattern — SCAN every session on every dashboard load and derive outcome from the event log. This made dashboard load times 15-40 seconds on a workspace with ~60 sessions (~360 Upstash REST calls per load). The v2 rewrite introduces pre-computed counters:

- `admin:sessions:started:{yyyy-mm-dd}` (SET) — incremented when `loadSession()` returns a fresh session
- `admin:sessions:successful:{yyyy-mm-dd}` (SET) — incremented when a `CompletionCard` display event fires
- `admin:sessions:errored:{yyyy-mm-dd}` (SET) — incremented when an `error` event fires
- `admin:sessions:active_locks` (SET) — maintained by `acquireLock` / `releaseLock` in `memory/lock.ts`
- `admin:sessions:by_created` (SORTED SET, capped at 1000) — for the fast "top N recent" query

Five cheap SCARD / ZCARD reads instead of hundreds. Dashboard load drops from ~30 seconds to ~200ms.

**Runtime config precedence:** loop.ts calls `getEffectiveModel()` / `getEffectiveMaxTokens()` / `getEffectiveMaxRetries()` / `getDisabledTools()` at the start of every turn. Each reads `admin:config:*` from Redis first, falling back to the env var, falling back to a hardcoded default. Admin changes apply on the NEXT turn of any running session — not mid-stream.

**Safety rails:**
- `setDisabledTools` silently filters out `request_user_approval` (can never land in the disabled set)
- All `loop.ts` config reads fall back gracefully if Redis is unreachable
- `recordUsage` and counter updates are fire-and-forget — Redis write failures never crash the agent loop
- Cookie is `HttpOnly; Secure; SameSite=None` — XSS-proof and cross-origin compatible with Railway backend

### Why this matters for the submission narrative

The admin portal exists because I was the operator of this system during the build and I kept hitting the same pain point: **I couldn't easily see what was happening across sessions.** Having to write throwaway inspection scripts every time something went wrong was the friction that made me build a proper dashboard. That's a real product development pattern — **build the internal tools you wish you had when you were debugging the product**. Even if the target user is the reviewer (Janani) running a single demo, the observability story demonstrates operational maturity.

It also happens to be a strong visual component for the storytelling: the 22-tool grid with category groupings and live toggle functionality is the clearest illustration of "this is an agent with 22 tools, here's what they all do, and here's the architecture behind them."

---

## 8. Submission deliverables

| # | Deliverable | Location |
|---|---|---|
| 1 | Live deployed agent (frontend) | https://plansync-tau.vercel.app |
| 2 | Live deployed agent (backend) | https://plansync-production.up.railway.app |
| 2a | Backend health check | https://plansync-production.up.railway.app/health |
| 3 | Source code (public GitHub repo) | https://github.com/inba-2299/Plansync |
| 4 | Rocketlane Custom App `.zip` | [`custom-app/plansync-custom-app.zip`](https://github.com/inba-2299/Plansync/raw/main/custom-app/plansync-custom-app.zip) (199 KB, built via `@rocketlane/rli`) — **verified installed and running inside `inbarajb.rocketlane.com`** |
| 5 | BRD document | `BRD.md` (this file) |
| 6 | Demo project plan CSV/Excel | `Sample Plan.xlsx` in the repo (21 tasks, 8 phases, 8 milestones, 12 dependencies) |
| +1 | Admin portal (bonus) | https://plansync-tau.vercel.app/admin — lightweight operator dashboard with 4 tabs, runtime config, 22-tool grid, cost estimator |

**Verified end-to-end on 2026-04-15** against the live Rocketlane workspace at `inbarajb.rocketlane.com`. Sample Plan.xlsx → fully structured Rocketlane project in 3.5 seconds, $0.86 cost (Sonnet 4.5), zero intervention, zero errors. The Custom App was subsequently verified running **inside** Rocketlane — user opens the Plansync tab on any project, the iframe loads the live Vercel frontend with `?embed=1`, and the same agent flow runs unchanged.

---

## 9. Documentation map

For anyone going deeper than this BRD:

| Doc | Read for |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | Formal system design — 25+ architectural decisions with trade-offs, full data model, API contracts, control flow, risk matrix, testing strategy. Includes the admin portal decision (AD-13), the Custom App pivot (D23), and the system prompt hardening (D24). |
| [`docs/PLAN.md`](docs/PLAN.md) | Original Session 1 build plan with the Session 4 deltas annotated at the top — architecture, tool list, system prompt composition, file structure, build sequence, verification |
| [`MEMORY.md`](MEMORY.md) | Decision log + lessons learned, session by session, including the rationale behind every architectural reversal. Covers the batch execution tool decision, refresh-safe sessions, application crash fix, Custom App pivot, prose-asking system prompt fix, and admin portal architecture. |
| [`README.md`](README.md) | Repo overview + quick start |
| [`custom-app/README.md`](custom-app/README.md) | How the Custom App is built (rli-based), how to install it in a Rocketlane workspace, design rationale for the iframe-inside-widget approach |
| [`agent/rl-api-contract.json`](agent/rl-api-contract.json) | Captured Rocketlane API response shapes from a 12-scenario live verification — ground truth for what the RL API actually returns |
| [`PRD_Projectplanagent.md`](PRD_Projectplanagent.md) | Original PRD — superseded for architecture but still authoritative for PM domain knowledge and the Rocketlane data model |

---

## 10. What I'd revisit next

If I had another week to harden Plansync into a production-grade Rocketlane integration:

1. **Cross-device session recovery** (Tier 2 of the persistence design). The current Tier 1 covers same-browser refresh via `localStorage` + SSE event log replay. Tier 2 would add API-key-based identity (`sha256(rl_api_key)` as user anchor), a session token middleware on all endpoints, an "Active Plans" UI with TTL countdowns, and a gate page that replaces the auto-greet flow. Designed (scoped to ~4.5 hours) but deferred — not exercised during a single-reviewer demo.
2. **Create-or-update flow.** Right now Plansync only creates new projects. Adding 5 update tools (`update_phase`, `update_task`, etc.) would let it sync an existing Rocketlane project against an updated CSV — the natural follow-up workflow for ongoing implementation management.
3. **Workspace subdomain in `get_rocketlane_context`.** The agent currently has to guess the subdomain for the "View in Rocketlane" link by inspecting team member emails. Backend should surface it explicitly in the context response.
4. **Lessons feedback loop.** Persist agent reflections across sessions so a workspace gradually accumulates institutional knowledge about its own quirks ("user always uses DD/MM dates", "this workspace prefers BPMN-style milestones at every phase end", "typical project duration is 60-90 days"). The `remember` tool already exists for within-session memory — the extension is cross-session.
5. **Admin portal improvements:** live SSE subscription so the operator can watch a running session in real-time from the dashboard, session detail drill-down with full event history, time-series cost graphs, per-user breakdown, backfill the sorted set from existing session metas on first load (currently shows only new sessions created after the portal was deployed).
6. **Commit the Redis inspection scripts** (`/tmp/inspect-sessions.mjs` + `/tmp/diff-sessions.mjs`) to `agent/scripts/` as proper TypeScript with a short scripts README. They were invaluable for the system prompt post-mortem and should be first-class operator tools.
7. **Proper auth + multi-user.** Migrate session storage to Postgres with row-level security, add OAuth via Rocketlane (if they support it as an OAuth provider) or magic links via email.
8. **Walkthrough video** explaining the architecture and a live run end-to-end — 5 minutes of "here's what the agent is doing right now" would probably do more for understanding than this entire BRD.

None of these are quick fixes — each is its own multi-day project. The submission ships with what I committed to in the original plan plus a few things I hadn't planned and decided to build in response to operational pain: the admin portal (born from repeatedly needing Redis inspection scripts), the Custom App rebuild (born from the rejected hand-crafted manifest), and the system prompt hardening (born from a real production drift). Each of those was worth doing because it made the final submission visibly better, not just "complete".

---

**Inbaraj B**
**2026-04-16**
**Submitted for:** Rocketlane Implementation Manager take-home assignment
