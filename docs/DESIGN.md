# Plansync — System Design

> **Purpose.** This document captures the architectural decisions behind Plansync, the explicit trade-offs we made, and the rationale for each component. It sits alongside `PLAN.md` (which is the implementation sequence) and `PRD_Projectplanagent.md` (which has the PM domain knowledge we preserved). Read this doc to understand *why*, read `PLAN.md` to understand *what next*, read `PRD_Projectplanagent.md` to understand *the domain*.

**Status:** Living document. Sections marked **(revised)** have been updated since original planning. Updated 2026-04-15.

---

## Session 4 addendum (2026-04-15 afternoon) + Session 5 (2026-04-16 PM)

This document was written in Session 2 and captures decisions 1-12 from the original design. **Session 4 added several important architectural decisions that reverse or extend those original choices.** This addendum lists the deltas at a high level; for the full detail + rationale + measured impact of each, read `MEMORY.md` under "Session 4".

**Session 5 note:** Session 5 (2026-04-16 PM) was a documentation + Rocketlane tracking cleanup pass only — no architectural changes, no code commits. Admin portal v2 (AD-14) was verified working on production by Inbaraj. All Rocketlane project-plan tracking tasks were rewritten in plain English and marked Completed. Cost concern ($0.86/run on Sonnet) was noted but validation was deferred to submission day. See CONTEXT.md § "Session 5 — Post-compact wrap-up" and MEMORY.md § "2026-04-16 PM — Session 5" for detail. The submission itself is scheduled for 2026-04-17.

### Decisions added/revised in Session 4

**D13 (NEW) — Batch execution tool reverses the "fine-grained only" decision from D4/D8.**
The original design deliberately broke the PRD's batch `execute_creation_pass` into fine-grained primitives (`create_phase`, `create_task`, `create_tasks_bulk`, `add_dependency`) to be "more agentic." In practice this cost ~$3/run on Sonnet, hit the 30K TPM wall regularly, and burned 15-30 turns per execution phase. Session 4 added a new tool `execute_plan_creation(planArtifactId, metadata)` that does the full creation sequence on the backend in one call: project shell → phases → tasks → subtasks → milestones → dependencies, with progress events streamed to the frontend. The fine-grained tools still exist as fallbacks for failure recovery and surgical edits. **The agentic decision is now "which tool to use" (batch vs fine-grained), not "walk every mechanical step."** Measured impact on first run: cost dropped to $0.86/run (~70% reduction), execution time dropped from 60-120s to 3.5s (~35× faster), rate limit wall no longer hit.

**D14 (NEW) — Model is configured via env var, no code default.**
Original design hardcoded `MODEL = 'claude-sonnet-4-5'` in `loop.ts`. Session 4 made this a required `ANTHROPIC_MODEL` env var on Railway with no fallback. If missing, the loop emits a clear error and fails fast. Rationale: model choice is a product decision that should be flippable without a deploy, and a silent fallback hides what's actually running. Valid values: `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-opus-4-5`.

**D15 (NEW) — Token optimization stack.** Four complementary changes applied together:
1. **Tool caching** — added `cache_control: { type: 'ephemeral' }` to the last tool in the schema array. Anthropic's prompt caching cascades backwards from the marker, so this caches the entire tools array. After turn 1, ~2000 tokens of tool schemas become ~200 effective tokens.
2. **Reasoning diet rule** in the system prompt — forbids JSON/code-blocks/structured data in streaming reasoning text. Prose only, <200 chars per bubble. Fixed the max_tokens errors we were hitting when the agent dumped full plan JSON in reasoning before calling tools.
3. **Compact JSON rule** in the system prompt — no indentation in tool inputs. ~20-30% savings on tool input tokens.
4. **Plan-by-artifact-reference** — `execute_plan_creation` takes `planArtifactId` not a full `plan` object. Plan JSON is loaded from the artifact store on the backend instead of being passed through the tool input (which would land in history and be replayed on every subsequent turn).

Combined, these cut per-turn input tokens roughly in half and eliminated the max_tokens errors.

**D16 (NEW) — 429 retry with Retry-After backoff.**
The agent loop now catches `rate_limit_error` from Anthropic, reads the `Retry-After` header, clamps to [0, 60] seconds, emits a new `rate_limited` SSE event so the frontend can show a countdown, sleeps, and retries up to 3 times before giving up with `error: { kind: 'rate_limit' }`. Added to the AgentEvent union: `rate_limited` variant with `retryInSeconds`, `attempt`, `maxAttempts`; `error` now has optional `kind: 'rate_limit' | 'auth' | 'generic'`.

**D17 (NEW) — Interactive metadata gathering rule (model-agnostic).**
New system prompt section that mandates sequential `request_user_approval` calls, one field at a time, with options PRE-POPULATED from workspace context. Forbids prose-dumping multiple questions expecting typed answers. Rule: infer defaults first (filename → project name, workspace context → customer/owner, task dates → start/end), ask only for what can't be inferred, and when asking, use pre-populated options. Added because Haiku 4.5 was using `request_user_approval` as a yes/no confirmation only (Sonnet had the interactive behavior by default), and the rule needed to be explicit for any model to follow.

**D18 (REVISED) — Split-layout frontend replaces single-column chat.**
The original design implied a single-column chat UI with inline cards. Session 4 shipped a two-column split layout (user workspace LEFT 40%, agent workspace RIGHT 60%, thin vertical rule between, pinned cards inside the agent column sticky-top with collapsible execution plan). Responsive: collapses to single chronological column below 1024px. 14px base font size (cascades through Tailwind's rem-based sizing for ~12.5% smaller UI overall). Rationale: single-column got overwhelming on 20-turn runs and the Figma reference showed a sidebar + main content pattern that worked better for "you act, agent thinks."

**D19 (REVISED) — Rocketlane URL format rule.**
The agent was constructing `https://app.rocketlane.com/project/{id}` in completion cards. Wrong twice: `app.rocketlane.com` doesn't exist (each customer has their own subdomain like `inbarajb.rocketlane.com`), and the path is `/projects/` plural, not `/project/`. New system prompt rule tells the agent to derive the workspace subdomain from `get_rocketlane_context` and use the correct format, or fall back to a relative path `/projects/{id}` if the subdomain can't be determined. Follow-up work deferred: make `get_rocketlane_context` surface the subdomain explicitly in its response so the agent always has it available.

**D20 (REVISED) — Execution plan completion sequence rule.**
The pinned execution plan card was getting stuck on "Step 5 of 6 / running" after successful runs because the agent jumped from `execute_plan_creation` straight to `display_completion_summary` without re-calling `create_execution_plan` to mark all steps done. New rule enforces a strict final sequence: `create_execution_plan` (all steps done) → `update_journey_state` (Execute + Complete done) → `display_completion_summary`. Explicit "do not skip step 1" directive.

**D21 (NEW) — Refresh-safe sessions via Redis event log replay.**
Originally a browser refresh lost all UI state because the frontend generated a fresh `sessionId` on every page load, orphaning the Redis session. Commit 2g adds persistence in two parts: (1) backend wraps `emit()` in the `/agent` route to RPUSH every `AgentEvent` to a new `session:{id}:events` list in Redis (7d TTL, fire-and-forget, runs BEFORE the `res.writableEnded` check so events emitted after a mid-stream client disconnect are still captured), plus a new `GET /session/:id/events` endpoint returning `{events, count}`; (2) frontend reads `sessionId` from `localStorage['plansync-session-id']` instead of regenerating it, and the mount effect replays the event list through the same `handleAgentEvent` function that processes live streaming — reconstructing reasoning bubbles, tool calls, display cards, journey state, and pending approvals via a single state-derivation code path. New UI states: `hydrationMode: 'loading' | 'fresh' | 'resumed' | 'mid-stream'`. Mid-stream mode (refresh hit while the backend was emitting) shows a "Check for updates" banner that re-fetches `/events` to pick up any events emitted after the client disconnect. New "New session" button in header clears the local sessionId + backend events log and reloads. **Limitation: same-browser only.** Cross-device recovery (Tier 2 — API-key-based identity + auth middleware + gate page) is deferred post-submission because it's not exercised during a single-reviewer demo.

**D21.1 (NEW) — Post-replay approval answered-state inference.**
The initial Commit 2g replay correctly reconstructed the agent workspace but re-rendered every prior approval card in the user workspace as unanswered (with option chips active). Root cause: the user's click that resolved each approval isn't an event in the log — it's a separate POST /agent with a `uiAction` body. So pure replay has no direct "approval X was answered" signal. Fix: derive the answered state from the event log's structure with the rule **"if there's any event in the log after an awaiting_user, that approval was answered"** (evidenced by the fact that the agent kept going past it). Only the very last `awaiting_user` is still pending, and only if it's literally the last event. New `markPriorApprovalsAsAnswered(events)` callback walks backward to find the pending `toolUseId` and flips every other `awaiting` UiMessage to `answered: true` with a generic "Answered" label. Called once after initial replay and again inside `handleCheckForUpdates`. **UX trade-off:** we can't recover the specific option picked (not captured in events), so previously-answered approvals all show "Answered" generically. Post-submission improvement: emit a synthetic `user_action` event on every `uiAction` POST to capture the selection explicitly.

**D22 (NEW) — Application-crash error boundary.**
Commit 2f discovered that any unhandled render error in any agent-emitted card would blanket-crash the app with "Application error: a client-side exception has occurred" (the production Next.js minified error) — white page, no recovery path. Root cause was a `PlanReviewTree.dependsOn.length` on an item where `dependsOn` was undefined (Haiku is lax about optional fields; the backend defensively checked `Array.isArray(i.dependsOn)` in three places, proving the field can be missing). Two-part fix: (1) **harden the specific site** with a `normalizePlanItem()` function that coerces every raw field at the Map-building boundary, plus optional-chain `.length` accesses downstream; (2) **wrap `Chat` in a class-based `ErrorBoundary`** that catches any render crash anywhere in the tree and renders a recoverable "Something went wrong" card with error details and Reset / Full-reload buttons. Second line of defense — doesn't fix bugs but converts white-page-of-death into recoverable error card. **Lesson baked into the design: agent-driven UIs are by definition dynamic, so a top-level error boundary is mandatory, not optional.**

**D23 (NEW) — Custom App built via `@rocketlane/rli` CLI, not hand-crafted manifest.**
First attempt (commit `3014b4d`) shipped a hand-crafted `manifest.json` + `index.html` iframe shell + `icon.svg` + a `build.sh` that ran `zip -r ...`. Rocketlane's upload validator rejected it with: `Invalid zip: rli-dist/deploy.json not found in the uploaded file.` That error message revealed that Rocketlane Custom Apps have a CLI-based build system (`@rocketlane/rli`) that produces a specific directory structure including an auto-generated `rli-dist/deploy.json`. Rebuilt from scratch as commit `becaf10`: `rli init` scaffold → stripped down to one widget at both `left_nav` and `project_tab` surfaces → widget HTML is a full-viewport iframe wrapper loading `https://plansync-tau.vercel.app?embed=1` with a loading placeholder → `rli build` produces `app.zip` containing `rli-dist/deploy.json` + bundled widget source files. Installed and verified working inside `inbarajb.rocketlane.com`. **The iframe-inside-widget pattern preserves the live-updates story**: Vercel deploys are picked up automatically; the `.zip` only needs to be rebuilt if the manifest, widget shell, or icon changes. **Lesson: when an integration has an official CLI/SDK, use it — don't try to reverse-engineer the wire format.** The earlier attempt wasted ~2 hours that could have been avoided by checking developer.rocketlane.com first.

**D24 (NEW) — Hard rules in the system prompt against prose-asking + journey lag.**
Commit 2h. A real production session showed Anthropic drifting: after rendering the plan review tree, the agent STREAMED PROSE ("Great! Does the plan look good to you? Let me know...") and ended its turn with `done` — no `request_user_approval`, no metadata gathering, no actionable card for the user to click. Diagnosed by side-by-side comparison of the bad session and a clean session 3 minutes later using raw Upstash REST calls (scratch scripts `/tmp/inspect-sessions.mjs` and `/tmp/diff-sessions.mjs`). Same backend code, same model. Classic Anthropic non-determinism — the rules at the top of the cached system prompt had started to feel like "background" to the model by turn 11.

Fix: two new **HARD RULE** sections at the top of § 5 Behavioral Rules, plus a new § 6 "Re-read the hard rules before every tool call" reminder at the end of the prompt. The HARD RULE sections:
1. **"NEVER prose-ask the user for input"** — 9 forbidden prose patterns (all pulled verbatim from the bad session) with required `request_user_approval` replacements. Includes a pre-turn-end self-check and references the actual bad session as a cautionary story.
2. **"Update the JourneyStepper after EVERY phase transition"** — 7 minimum transitions explicitly listed, the observed anti-pattern (`parse_csv` → `validate_plan` → `display_plan_for_review` while stepper still says "Upload") called out by name.

**Lesson: prompt caching is a double-edged sword.** It saves tokens but makes the top of the prompt feel distant from the model's attention by later turns. Mitigation: put the most-critical rules at the TOP of the prompt (they get cached), reiterate them at the BOTTOM (they stay in "recent context" window), and explicitly instruct the model to re-read them at every tool call decision point. The combined effect pays for itself — the rules consistently fire at the moment they matter.

**Lesson: direct Redis inspection is the fastest way to diagnose agent drift.** Without the two scratch scripts, I would have been guessing what the bad session did differently. The tool-call-diff format made the missing `request_user_approval` calls jump out immediately. Post-submission work: commit these scripts to `agent/scripts/inspect-sessions.ts` and `agent/scripts/diff-sessions.ts` with a short scripts README.

Also in Commit 2h: UI base font from 14px → 13px. Total ~18.75% smaller than browser default. Dashboard-like density without being unreadable.

### AD-13: Lightweight admin portal (Session 5 addendum)

**Decision.** Build an operator admin portal at `/admin` on the same Vercel frontend with backend routes at `/admin/*` on the existing Railway backend. Auth via a custom login form that issues an HttpOnly HMAC-signed cookie (not Basic Auth). Scope: observability (6 stat cards with filters), runtime config editor (model / max_tokens / max_retries), 22-tool grid with toggle functionality, recent sessions table with date/status/search filters, daily usage breakdown by model. Lives on an `admin-portal` git branch until verified end-to-end against a separate Railway preview deployment.

**Architecture:**
- `agent/src/admin/auth.ts` — HMAC-SHA-256 token minting/verification reusing `ENCRYPTION_KEY`. 2-hour lifetime. Constant-time credential comparison.
- `agent/src/admin/middleware.ts` — `requireAdminAuth` Express middleware. Manual Cookie header parsing (no `cookie-parser` dep). Fail-closed if env vars missing.
- `agent/src/admin/config.ts` — Redis-backed runtime config with env fallback. Four keys: `admin:config:model`, `admin:config:maxTokens`, `admin:config:maxRetries`, `admin:config:disabledTools`. Precedence on read: Redis → env → hardcoded default. `setDisabledTools` silently filters out `request_user_approval` as a safety rail.
- `agent/src/admin/usage.ts` — Token usage + cost estimation from Anthropic's `final.usage`. Two stores: per-session + daily aggregate per model. Pricing table for Haiku/Sonnet/Opus 4.5 with comments explaining it's approximate.
- `agent/src/admin/stats.ts` — SCAN-based aggregation from session:*:meta keys + event log inspection to derive session outcomes. Returns dashboard stats + filtered recent session rows.
- `agent/src/admin/tools-catalog.ts` — Display metadata for all 22 tools in 7 categories. `canDisable: false` on `request_user_approval` (lock icon in UI).
- `agent/src/agent/loop.ts` — Modified to read config FRESH at the start of every turn. Filters `TOOL_SCHEMAS` against the disabled set before applying cache_control. Calls `recordUsage` fire-and-forget after each `stream.finalMessage()`.
- `agent/src/index.ts` — 8 new routes under `/admin/*` (login, logout, me, dashboard, tools, config GET/POST, config/disabled-tools).
- `frontend/app/admin/login/page.tsx` — Standalone login form with Plansync brand.
- `frontend/app/admin/page.tsx` — Single-page dashboard. Inline sub-components (StatCard, StatusBadge, SegmentedControl, SectionHeader) for fast iteration.
- `frontend/lib/admin-client.ts` — Typed fetch helpers with `credentials: 'include'`.

**Alternatives considered:**
- **Basic Auth.** Simpler (5-line middleware) but less secure (password sent on every request, no logout, no expiration). Rejected because Inbaraj specifically asked for a login form.
- **On main, not a branch.** Rejected because the loop.ts changes touch the critical path — if the Redis read logic has a bug, every session breaks. Branch gives real isolation.
- **Separate Upstash database for preview.** Rejected because the admin dashboard's value comes from showing REAL session data. Shared Redis on purpose.
- **Session detail drill-down with full history viewer.** Deferred — too much data to render cleanly for v1.
- **Live SSE subscription to running sessions.** Deferred — would need a separate admin SSE endpoint + subscription management.
- **Interrupt/stop running agent.** Inbaraj considered it, then dropped it ("no need for interruption"). Input-disable covers the common case of not sending another message mid-stream.

**Why this.** The admin portal is a real operator tool, not a gimmick. During Session 4 I repeatedly had to write scratch scripts to inspect Redis sessions — that's exactly the pain the dashboard exists to solve. Making model selection adjustable at runtime (Redis override) removes "redeploy Railway to flip the model" as a pain point. The tool grid is as much about storytelling as utility — showing all 22 tools with descriptions at a glance is strong evidence of the agent's design.

**Trade-offs:**
- Admin config changes persist in Redis — they stick across Railway redeploys until manually cleared
- Shared Redis means preview admin writes affect prod (acceptable because Inbaraj is the only admin)
- Tool toggling affects all running sessions at the start of their next turn (a running session could see the tool disappear mid-run — uncommon and self-correcting on the next turn)
- No in-UI session detail drill-down — the dashboard shows enough metadata to identify problematic sessions, and the Redis inspection scripts cover deep-dive debugging

**Env vars required** (set via Railway dashboard):
- `ADMIN_USERNAME` (operator picks)
- `ADMIN_PASSWORD` (generate via `openssl rand -base64 24`)

Neither is required for the core agent to function — if they're missing, `/admin/*` routes return 503 and the rest of the app is unaffected.

### AD-14: Admin portal v2 — pre-computed counters + tabbed lazy loading

**Problem.** The v1 admin portal built under AD-13 was functionally correct but operationally unusable: dashboard load took 15-40 seconds on a workspace with ~60 sessions. The initial `stats.ts` implementation SCANned `session:*:meta` on every dashboard hit, then walked every session's event log to derive outcome — ~360 Upstash REST calls per load, each with 50-200ms latency. Filters triggered the same query. The user's 6 specific complaints: slow load, broken filter UX, cost labels, misleading success rate scope, no lazy loading, no runtime schema validation.

**Decision.** Replace the SCAN + event-log-walk pattern with pre-computed set-based counters. Split the `/admin/dashboard` monolithic endpoint into a fast dashboard endpoint + separate lazy-loaded sessions endpoint. Restructure the frontend as a four-tab layout with per-tab data fetching.

**Counter architecture** (`agent/src/admin/counters.ts`):
- `admin:sessions:started:{yyyy-mm-dd}` — SET, SADD on `loadSession` fresh-session path
- `admin:sessions:successful:{yyyy-mm-dd}` — SET, SADD in the `/agent` emit wrapper on `display_component: CompletionCard`
- `admin:sessions:errored:{yyyy-mm-dd}` — SET, SADD in the emit wrapper on any `error` event
- `admin:sessions:by_created` — SORTED SET capped at 1000, score = createdAt ms, for fast top-N recent lookup
- `admin:sessions:active_locks` — SET, maintained by `memory/lock.ts`

All writes are fire-and-forget (`void .catch(() => {})`) so a Redis hiccup during event emission never crashes the agent loop. Set semantics dedupe automatically — safe to re-emit completion events.

**Stats computation** (new `stats.ts`): 5 parallel cheap reads — 3 SCARDs for daily counters, 1 ZCARD for total sessions ever, 1 SCARD for active locks. Dashboard load drops from ~30 seconds to **~200 milliseconds** (150× faster). Success rate scoped to today (`successfulToday / terminalToday`), matching the card label.

**Endpoint split**: `GET /admin/dashboard` returns stats + config + dailyUsage (fast, loads on mount). `GET /admin/sessions` is a NEW endpoint for recent sessions with filters (lazy-loaded only when the Sessions tab is opened, or when filters change).

**Frontend tab layout** (`app/admin/page.tsx`):
- **Observability** (default) — stat cards + daily usage by model. Loads on mount.
- **Runtime Config** — uses already-loaded config snapshot. Instant tab switch.
- **Agent Tools** — static catalog. Instant tab switch.
- **Recent Sessions** — lazy-loaded on first click, refetches on filter change with 400ms debounced search.

**Trade-offs:**
- Counters are append-only; no historical recounts. Old sessions created before the counters existed aren't in them. Acceptable because the daily counters only matter for "today's" stats and the sorted set naturally fills with new sessions over time.
- Counter updates are fire-and-forget — if Redis is partitioned, counters drift but the agent loop doesn't fail. Stats can be re-derived from event logs post-hoc if we ever need to.
- The Sessions tab still does N per-session HGETALLs (bounded at 100) to fetch metadata for display. Not O(1), but predictable and lazy-loaded so users don't pay this cost unless they click the tab.

**Verified:** typecheck + build clean, dashboard measurably faster (confirmed via DevTools Network tab in the preview deployment). **Session 5 (2026-04-16):** v2 re-verified on production after the `9f887c4` merge by Inbaraj — dashboard loads fast, stat cards correct, runtime config editor persists to Redis, tool toggles work, recent sessions table filters correctly. The ~200ms dashboard load time holds on prod, not just preview.

### AD-15: Session state recovery gap (documented, not yet fixed)

**Context.** Mid-development, Inbaraj was testing the main agent flow on prod while I merged the admin-portal branch to main. Railway's rolling redeploy killed his in-flight `POST /agent` streaming request. The session's Redis lock stayed held because the `release()` code in `memory/lock.ts` only fires in the `finally` block of the route handler, which never ran (container died mid-stream). Lock has a 5-minute TTL, so subsequent requests hit HTTP 409 "another request is in progress" until the TTL expired. The user had no actionable recovery button other than the blunt "New session" (which loses the current session state entirely).

**Decision.** Document as a known UX gap, NOT fixed pre-submission. Rationale:
- A reviewer is unlikely to trigger this specific sequence unless they themselves deploy mid-demo
- The `New session` button IS a valid (if blunt) recovery path
- Fixing it properly is ~45-60 min of work — tight for the submission timeline

**Post-submission fix spec:**
- Backend: new `POST /session/:id/unlock` endpoint that does `redis.del(key.lock(sessionId))`. Authentication: any caller (for a demo; production would want ownership check).
- Backend: optional `POST /session/:id/resume` that force-releases the lock AND injects a user message like "Please continue from where you left off" to nudge the agent back on track.
- Frontend: when `hydrationMode === 'mid-stream'`, surface a "Refresh Agent" button alongside (or replacing) the existing "Check for updates" button.
- Frontend: when a `POST /agent` call returns 409, render a recovery card instead of just "HTTP 409", with "Refresh Agent" + "Start New Session" actions.

**Lesson baked into the design:** distributed session locks need an explicit user-accessible release path. The "request-handler-in-finally" pattern works for clean exits but fails when the process dies. Either use shorter lock TTLs (30 sec?) + heartbeat, or expose a force-release endpoint to the user.

### Decisions REJECTED in Session 4

**R3 — TOON format.** Discussed as an alternative to JSON for ~50% token savings on plan data. Rejected because:
- Claude isn't natively trained on TOON; needs ~500 tokens of teaching examples
- No npm library for TOON parsing; would need custom parser
- Novel format introduces failure surface when Claude emits slightly-wrong TOON
- The batch tool solves the same cost problem more directly by eliminating the re-sending of plan data, not by compressing it

**R4 — Sonnet-only.** Initially I recommended Haiku as the cheaper default. Inbaraj tested both — Haiku had capability regressions (different option labels, prose-dumping metadata) that needed system prompt patches. The interactive metadata rule (D17) was the belt-and-braces fix so that Sonnet AND Haiku follow the same pattern. Net effect: both models work, Sonnet stays the recommended default for the submission demo (~$0.86/run), Haiku is the cheaper fallback (~$0.20-0.25/run predicted) for cost-sensitive runs.

---

---

## 1. Context & Goals

Plansync is an AI agent that reads a project plan CSV/Excel file and creates it as a fully structured project (phases, tasks, subtasks, milestones, dependencies) in Rocketlane via their REST API. It exists because Rocketlane has no native CSV import for project plans, so implementation teams currently rebuild plans manually from exports of Smartsheet, MS Project, Asana, etc.

**Primary goal.** Ship a *properly designed agent* (not a wizard with Claude in one step) for the Rocketlane Implementation Manager take-home by 2026-04-16.

**Success criteria.**
1. A live, deployable system that takes any reasonable project plan CSV and creates a matching project in Rocketlane end-to-end
2. The agent's autonomy is visible and defensible — streaming reasoning, self-correction, HITL as a tool (not a hardcoded gate), runtime API recovery
3. Rocketlane Custom App integration so the agent runs *inside* Rocketlane, not just alongside it
4. A written BRD explaining the architecture and agent semantics to the evaluator

**Non-goals.** Multi-user auth. Horizontal scale. Real-time collaboration. Long-term memory across sessions (beyond the 48h session TTL). Pretty pixel-perfect animations (cut-if-late).

---

## 2. Requirements

### 2.1 Functional

| # | Requirement |
|---|---|
| F1 | Accept CSV or Excel (.xlsx) upload; parse columns, rows, and Smartsheet-style indentation |
| F2 | Reason about plan hierarchy from structural signals (indentation, leading spaces, WBS numbers, parent columns, contextual clues) — not hardcoded parsers |
| F3 | Auto-detect milestone candidates using PM keywords and zero-duration heuristics |
| F4 | Validate the structured plan against 11 programmatic checks before any Rocketlane write |
| F5 | Ask the user for explicit approval on key decisions via clickable option chips |
| F6 | Execute two-pass creation in Rocketlane: all entities (projects, phases, tasks, subtasks, milestones) first, then dependencies |
| F7 | Stream the agent's reasoning and tool calls to the UI in real time |
| F8 | Render rich display components (plan tree, progress feed, approval prompt, reflection card, completion card) emitted by the agent via tool calls |
| F9 | Surface the agent's journey state (where in the 6-step flow it is) via an agent-driven JourneyStepper |
| F10 | Self-correct on validation errors: reason about the error, fix the plan, re-validate |
| F11 | Recover from Rocketlane API changes at runtime via `web_search` and cached corrections |
| F12 | Run inside Rocketlane as a Custom App (iframe-embedded) in addition to standalone |

### 2.2 Non-functional

| Dimension | Target | Notes |
|---|---|---|
| **Streaming latency** | First token ≤ 3s | Dominated by Claude Sonnet 4.5 time-to-first-token (1–3s) |
| **End-to-end run time** | 62-row plan ≤ 2 min | Dominated by sequential Rocketlane API calls |
| **Agent turn count** | 15–25 turns per run | Fine-grained tools, not batch operations — the loop IS the signal of "this is an agent" |
| **Availability** | Works on demand during demo window | Single-user demo; no HA requirement |
| **Cost per run** | ≤ $0.50 (Anthropic) | Artifact store + prompt caching keep per-turn input ≈ constant |
| **Security** | RL API keys encrypted at rest; never logged | AES-256-GCM using server-side `ENCRYPTION_KEY` |
| **Data durability** | 48h TTL on session state | No long-term memory; fresh start every visit |

### 2.3 Constraints

- **Timeline**: 1.5 days to ship
- **Stack**: TypeScript everywhere, Next.js 14 frontend, Express on Node 20 backend
- **Hosting**: Vercel (frontend) + Railway (backend) — chosen early because Vercel Hobby's 60s `maxDuration` was incompatible with the unbounded-duration ReAct loop
- **External services**: Anthropic API (Claude Sonnet 4.5), Upstash Redis (agent memory), Rocketlane REST API (execution target)
- **Must be a proper agent per Anthropic's definition**: "systems where LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks" — not a wizard with Claude in one step

---

## 3. High-Level Architecture

### 3.1 Component diagram

```
                           ┌─────────────────────┐
                           │  User's browser     │
                           │  (Chrome / Firefox) │
                           └──────────┬──────────┘
                                      │ HTTPS
                                      ▼
┌───────────────────────────────────────────────────────────────────┐
│ VERCEL — Next.js 14 frontend                                      │
│  plansync-tau.vercel.app                                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ app/page.tsx                                                │  │
│  │  - Chat container                                           │  │
│  │  - SSE reader (fetch + reader loop)                         │  │
│  │  - Auto-resume on awaiting_user / done                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ components/                                                 │  │
│  │  - MessageBubble (streaming text + collapsible reasoning)   │  │
│  │  - ToolCallLine (one-liner + expandable details)            │  │
│  │  - agent-emitted/                                           │  │
│  │    - JourneyStepper (sticky top, agent-driven)              │  │
│  │    - ApiKeyCard, FileUploadCard                             │  │
│  │    - ExecutionPlanCard (from create_execution_plan)         │  │
│  │    - PlanReviewTree (from display_plan_for_review)          │  │
│  │    - ReflectionCard (from reflect_on_failure)               │  │
│  │    - ApprovalPrompt (from request_user_approval)            │  │
│  │    - ProgressFeed (from display_progress_update)            │  │
│  │    - CompletionCard (from display_completion_summary)       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  app/api/upload/route.ts  (thin forwarder to backend /upload)     │
└───────────────────────────────────┬───────────────────────────────┘
                                    │ HTTPS
                                    │ POST /agent (SSE)
                                    │ POST /upload (multipart)
                                    ▼
┌───────────────────────────────────────────────────────────────────┐
│ RAILWAY — Node 20 + Express agent backend                        │
│  plansync-production.up.railway.app                               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ routes/                                                     │  │
│  │  - /agent : streaming ReAct loop                            │  │
│  │  - /upload: SheetJS parse → artifact store                  │  │
│  │  - /health                                                  │  │
│  │  - /session/:id/journey (hydration on reconnect)            │  │
│  └────────────────────────┬────────────────────────────────────┘  │
│                           │                                       │
│  ┌────────────────────────▼────────────────────────────────────┐  │
│  │ agent/                                                      │  │
│  │  - loop.ts      : ReAct loop (streaming, dispatch, retry)   │  │
│  │  - system-prompt: static prompt w/ full autonomy matrix     │  │
│  │  - stream-fwd   : Anthropic events → SSE events mapping     │  │
│  └────────────────────────┬────────────────────────────────────┘  │
│                           │                                       │
│  ┌────────────────────────▼────────────────────────────────────┐  │
│  │ tools/    (21 tools across 8 groups + dispatcher)           │  │
│  │  A: parse_csv, get_rocketlane_context, query_artifact       │  │
│  │  B: validate_plan, create_execution_plan,                   │  │
│  │     update_journey_state, reflect_on_failure                │  │
│  │  C: remember, recall                                        │  │
│  │  D: request_user_approval (only blocking tool)              │  │
│  │  E: create_project, create_phase, create_task,              │  │
│  │     create_tasks_bulk, add_dependency                       │  │
│  │  F: get_task, retry_task                                    │  │
│  │  G: display_plan_for_review, display_progress_update,       │  │
│  │     display_completion_summary                              │  │
│  │  H: web_search (Anthropic server tool, not dispatched)      │  │
│  └────────────────────────┬────────────────────────────────────┘  │
│                           │                                       │
│  ┌────────────────────────▼────────────────────────────────────┐  │
│  │ rocketlane/                                                 │  │
│  │  - client.ts    : REST client w/ retries, backoff, logger   │  │
│  │  - types.ts     : RL entity types                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ memory/                                                     │  │
│  │  - redis.ts     : singleton Upstash client + key helpers    │  │
│  │  - session.ts   : load/save the Session struct              │  │
│  │  - artifacts.ts : content-addressed store + path query lang │  │
│  │  - remember.ts  : working-memory helpers                    │  │
│  │  - lock.ts      : SET NX EX per-session lock                │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ lib/                                                        │  │
│  │  - crypto.ts : AES-256-GCM encrypt/decrypt (RL api key)     │  │
│  │  - sse.ts    : SSE headers + emitter                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────┬────────────────────┬─────────────────────┬────────────────┘
        │                    │                     │
        ▼                    ▼                     ▼
 ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐
 │ Anthropic    │    │ Upstash      │    │ Rocketlane REST   │
 │ messages API │    │ Redis (REST) │    │ api.rocketlane.com│
 │ Claude 4.5 + │    │ session KV + │    │ Projects, phases, │
 │ tool use +   │    │ artifacts +  │    │ tasks, deps       │
 │ web_search   │    │ lock + TTL   │    │                   │
 └──────────────┘    └──────────────┘    └───────────────────┘
```

### 3.2 Component responsibilities

**Frontend (Vercel).** Dumb renderer. Zero business logic. Its only job is:
1. Open an SSE connection to `/agent`, read events, apply them to React state
2. Render rich display components when the agent emits them
3. Forward file uploads to `/api/upload` (which forwards to Railway)
4. Auto-resume on `awaiting_user` when the user clicks an approval option

**Agent backend (Railway).** Stateful-per-request but stateless across requests:
1. Load session state from Redis at the start of every POST
2. Run the ReAct loop: stream Claude → execute tools → append to history → repeat
3. Save session state to Redis before closing the response
4. Hold nothing in process memory between requests — Redis is the source of truth

**Anthropic.** Claude Sonnet 4.5 reasons, decides which tool to call, emits streamed events. Anthropic also hosts the `web_search` server tool for runtime docs recovery.

**Upstash Redis.** Session store. Contains: conversation history, artifacts, idmap (tempId→RL ID), execlog, working memory (remember/recall), journey state, pending approval state, per-session lock. 48h TTL on everything.

**Rocketlane.** Execution target. The agent calls the REST API to create projects, phases, tasks, milestones, and dependencies.

### 3.3 Critical invariants

These are not aspirations — breaking any of them is a bug.

1. **The LLM controls flow.** No backend state machine. No switch/case on a `status` field.
2. **Frontend has zero business logic.** It renders whatever the agent emits via tool calls. No client-side validation, no client-side hierarchy detection, no client-side next-state selection.
3. **Backend is stateless across requests.** Every POST is self-contained: load state → run loop → save state → close.
4. **Display tools are non-blocking side effects.** Only `request_user_approval` pauses the loop.
5. **Tool results are artifacts, not inlined blobs.** History carries `{summary, artifactId}` pairs, never the full tool output.
6. **State is reported by the agent, not enforced against it.** `update_journey_state` is a tool the agent calls; the backend never "decides" which step the agent is on.
7. **Every capability is transparent in the UI.** Planning (ExecutionPlanCard), memory (memory_write toast), reflection (ReflectionCard), HITL (ApprovalPrompt), journey (JourneyStepper), tool calls (ToolCallLine), reasoning (streamed text). Nothing happens "invisibly."

---

## 4. Data Model

The contract types live in `agent/src/types.ts`. Summary:

### 4.1 Plan (what the agent builds)

```typescript
interface PlanItem {
  id: string;                              // temp id assigned by the agent
  name: string;
  type: 'phase' | 'task' | 'subtask' | 'milestone';
  parentId: string | null;                 // null for phases only
  depth: number;                            // 0 = phase, 1 = task, 2+ = subtask
  startDate: string | null;                 // YYYY-MM-DD
  dueDate: string | null;
  effortInMinutes: number | null;
  description: string | null;
  status: 1 | 2 | 3 | null;                 // 1=To do, 2=In progress, 3=Completed
  progress: number | null;                  // 0-100
  milestoneCandidate: boolean;
  milestoneReason: string | null;
  dependsOn: string[];                      // references to other PlanItem.id
}

interface Plan {
  projectName: string;
  items: PlanItem[];
  sourceRowCount: number;
}
```

### 4.2 Session (what Redis stores)

```typescript
interface Session {
  meta: SessionMeta;                      // status, ttlAt, turnCount, rlApiKeyEnc
  history: AnthropicMessage[];            // full ReAct history, replayed every turn
  idmap: Record<string, IdMapEntry>;      // tempId → real Rocketlane ID
  execlog: ExecLogEntry[];                // append-only API call audit
  remember: Record<string, unknown>;      // agent working memory
  journey: JourneyStep[];                 // current stepper state
  pending: PendingApproval | null;        // populated only when awaiting user click
}
```

### 4.3 Artifacts (content-addressed blobs)

```typescript
interface Artifact<T = unknown> {
  id: string;                             // "art_<12-char-nanoid>"
  kind: 'csv-rows' | 'rl-context' | 'validator-report' | 'plan-tree' | 'exec-results' | 'generic';
  preview: string;                        // short human-readable summary
  content: T;                             // full blob
  createdAt: number;
}
```

Tool results include `{summary, artifactId}` where `summary` is what goes back to Claude in the `tool_result` block. The full content stays in Redis and is only fetched on demand via `query_artifact`.

### 4.4 Events (SSE protocol)

```typescript
type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'tool_result'; id: string; summary: string }
  | { type: 'display_component'; component: string; props: unknown }
  | { type: 'journey_update'; steps: JourneyStep[] }
  | { type: 'memory_write'; key: string }
  | { type: 'awaiting_user'; toolUseId: string; payload: unknown }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string };
```

---

## 5. API Contracts

### 5.1 HTTP endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/agent` | none (session-scoped) | Streaming ReAct loop, SSE response |
| `POST` | `/upload` | none | Multipart file upload → artifact store |
| `GET` | `/health` | none | Status + env booleans |
| `GET` | `/session/:id/journey` | none | Re-fetch journey state on reconnect |

**Request body for `/agent`:**
```typescript
interface AgentRequest {
  sessionId: string;
  userMessage?: string;                   // user typed text
  uiAction?: {                            // user clicked an approval chip
    toolUseId: string;
    data: unknown;
  };
}
```
At least one of `userMessage` or `uiAction` must be present.

**Response:** `Content-Type: text/event-stream`, events per §4.4.

### 5.2 Tool contracts

Full schemas live in `agent/src/tools/index.ts` (`TOOL_SCHEMAS`). Each tool has:
- `name` — agent-callable identifier
- `description` — tells Claude *when* to call it
- `input_schema` — JSON Schema for validation

The dispatcher in the same file routes `tool_use` blocks to their handler and returns `{summary, artifactId?, events?, blocking?}`. All handlers are in `agent/src/tools/*.ts` as pure async functions of `(input, ctx) → ToolDispatchResult`.

---

## 6. Control Flow: The ReAct Loop

```
POST /agent (sessionId, userMessage?, uiAction?)
├── acquireLock(sessionId)                            ← prevent concurrent writes
├── loadSession(sessionId)                             ← from Redis
├── if userMessage: append {role: 'user', content}
├── if uiAction:    append {role: 'user', content: [tool_result block]}
├── startSseStream()
│
├── LOOP (max 40 turns):
│   ├── turnCount++
│   ├── anthropic.messages.stream({
│   │     model: 'claude-sonnet-4-5',
│   │     system: [{ text: SYSTEM_PROMPT, cache_control: ephemeral }],
│   │     messages: history,
│   │     tools: [...TOOL_SCHEMAS, {type: 'web_search_20250305', name: 'web_search'}]
│   │   })
│   ├── for await (event of stream):
│   │     forwardStreamEvent(event, emit)              ← SSE: text_delta, tool_use_*
│   ├── final = await stream.finalMessage()
│   ├── history.push({role: 'assistant', content: final.content})
│   │
│   ├── if final.stop_reason === 'end_turn':
│   │     break
│   │
│   ├── toolResults = []
│   ├── for each tool_use block in final.content:
│   │   ├── if block.name === 'request_user_approval':
│   │   │     persistPending(session, block)
│   │   │     emit({type: 'awaiting_user', toolUseId, payload})
│   │   │     goto END                                 ← THE blocking case
│   │   │
│   │   ├── result = await dispatch(block.name, block.input, ctx)
│   │   ├── for each event in result.events: emit(event)
│   │   └── toolResults.push({type: 'tool_result', tool_use_id, content: result.summary})
│   │
│   └── history.push({role: 'user', content: toolResults})
│
├── END:
│   ├── saveSession(sessionId, session)
│   ├── emit({type: 'done', stopReason})
│   └── endSseStream()
│
└── finally: releaseLock(sessionId)
```

**Resume after approval.** When the frontend POSTs with `uiAction`, step 1 above injects the approval as a `tool_result` block for the `toolUseId` the agent was waiting on. The loop runs from Claude's next turn onward.

---

## 7. Session & State Management

### 7.1 Redis schema

```
session:{id}:meta        HASH    status, createdAt, ttlAt, turnCount, rlApiKeyEnc, rlWorkspaceId
session:{id}:history     LIST    JSON-encoded Anthropic messages (role + content blocks)
session:{id}:artifacts   HASH    artifactId → JSON blob
session:{id}:idmap       HASH    tempId → IdMapEntry
session:{id}:execlog     LIST    JSON-encoded ExecLogEntry (append-only audit)
session:{id}:remember    HASH    working-memory key → JSON value
session:{id}:journey     HASH    ordered JourneyStep entries
session:{id}:pending     HASH    populated only during awaiting_user
session:{id}:lock        STRING  SET NX EX 300, holds a random token per holder
```

TTL: 48h on every key; refreshed on every save via `touchSessionTtl`.

### 7.2 Artifact store rationale

Without the artifact store, every tool result (parsed CSV 30KB + RL context 15KB + validator report 10KB + ...) would get replayed in every `messages.stream` call. By turn 10 we'd be shoveling 100k+ tokens per turn into the Anthropic API — expensive and slow.

With the artifact store:
- Tool handler writes the full payload to `session:{id}:artifacts[artifactId]`
- The `tool_result` block sent to Claude contains only `{summary (< 1KB), artifactId}`
- When Claude needs details, it calls `query_artifact(artifactId, "rows[10:20]")` to read a slice
- Combined with `cache_control: ephemeral` on the system prompt, per-turn input tokens stay roughly flat as the session grows

### 7.3 Lock strategy

`SET NX EX 300` on `session:{id}:lock` at the start of every POST. If another request holds the lock, return 409 Conflict and the frontend shows "another request in progress." Release is best-effort (read token + delete if match), and the 300s TTL ensures it won't stick forever if the release step fails.

This matters because the user can double-click an approval button; without the lock, both clicks could spawn parallel loop invocations with divergent state.

---

## 8. Error Handling & Reliability

### 8.1 Error categories

| Category | Source | Handling |
|---|---|---|
| **Rocketlane 4xx (validation)** | Client sent bad data | `RocketlaneError` thrown; agent sees in tool result and self-corrects |
| **Rocketlane 429 (rate limit)** | Quota exceeded | Client auto-retries with `Retry-After` wait, up to `maxRetries` (3) |
| **Rocketlane 5xx** | Server-side issue | Client auto-retries with exponential backoff, up to `maxRetries` |
| **Rocketlane network error** | Timeout, DNS, etc. | Client retries with backoff |
| **Anthropic 529 (overloaded)** | Too many concurrent API calls | Caught in loop.ts; one retry with a fixed delay, then surface as `error` event |
| **Validation errors** | `validate_plan` found issues | Returned to Claude as tool_result; agent regenerates plan and re-validates |
| **Tool dispatch errors** | Tool handler threw | Wrapped as `{summary: 'ERROR in tool "X": ...'}` and fed back to Claude |
| **Runtime API drift** | RL API changed since system prompt was written | Agent detects unknown field / 404 → calls `reflect_on_failure` → `web_search` → `remember` the fix → retry |
| **Lock conflict** | Concurrent POST to same session | 409 Conflict; frontend surfaces "already in progress" |
| **Stream disconnect** | Client closed tab | Emit drops writes silently; session saves on `finally` |

### 8.2 Idempotency

Rocketlane write operations should be idempotent on client-driven retry. The RL client supports per-request idempotency by passing a deterministic key derived from `{sessionId, toolName, tempId}`. If RL accepts X-Idempotency-Key (TBD from further testing), we use it; otherwise we rely on agent-level deduplication via `idmap` (if `tempId` already mapped to a real ID, skip the create).

### 8.3 Retry budgets

- Rocketlane client: 3 retries per request, exponential backoff starting at 500ms with jitter
- Anthropic API: 1 retry on 529, no backoff beyond the SDK's internal handling
- Tool-level: no automatic retries; the agent retries explicitly via its own reasoning

---

## 9. Security

### 9.1 Secrets

| Secret | Where stored | Access path |
|---|---|---|
| `ANTHROPIC_API_KEY` | Railway env | Backend process only, passed to SDK constructor |
| `UPSTASH_REDIS_REST_TOKEN` | Railway env | Backend process only |
| `ENCRYPTION_KEY` (32 bytes base64) | Railway env | Used only by `lib/crypto.ts` to encrypt user RL API keys |
| `TEST_ROCKETLANE_API_KEY` | Local `.env` only (never in prod) | Used only by `scripts/test-rl.ts` for API verification |
| User's own Rocketlane API key | Session state (`rlApiKeyEnc`) | **AES-256-GCM encrypted at rest in Redis**; decrypted only in-process when building the RL client for a request |

Env vars are never logged. The RL API key is never written to logs or stdout; the execlog captures call metadata (method, path, status, latency, x-request-id) but not the auth header.

### 9.2 CORS

Railway backend sets `Access-Control-Allow-Origin` dynamically based on `ALLOWED_ORIGIN` env. Current allowlist:
- `https://plansync-tau.vercel.app` (production frontend)
- `http://localhost:3000` (local dev)
- `https://*.rocketlane.com` (Custom App embed — wildcard handled in middleware)

### 9.3 Transport

All traffic is HTTPS. Vercel and Railway both enforce TLS. Upstash Redis uses its REST API over HTTPS (no raw Redis protocol over the public internet).

---

## 10. Architectural Decisions & Trade-offs

Each key decision with the alternatives we considered and why the current choice won.

### AD-1: Decouple Vercel and Railway
**Decision.** Frontend on Vercel (free Hobby), backend on Railway ($5/mo). Not the same platform.
**Alternatives.** (a) Pure Vercel with chunked auto-resume to work around 60s timeout. (b) Self-host on a VPS. (c) Fly.io / Render.
**Why this.** Vercel Hobby's 60s `maxDuration` would force deadline tracking in every tool, chunked state stitching across requests, and checkpointed bulk operations — an entire class of complexity that disappears the moment the loop runs on Railway (no timeout). Estimated ~3-5 hours of avoided build work. Railway was chosen over Fly/Render because it's the simplest monorepo-aware deploy (set Root Directory = `agent/` in dashboard).
**Trade-offs.** Two deployment targets to manage, two CORS configs, but `git push` still auto-deploys both.

### AD-2: Fine-grained tools, not batch operations
**Decision.** 20 custom tools + 1 server tool. The agent calls them one at a time in a 15–25 turn ReAct loop.
**Alternatives.** The original PRD had 8 tools including `execute_creation_pass` that created all entities in one call.
**Why this.** The batch tool hid the entire creation flow behind one Claude call — structurally making it an AI-augmented workflow (PRD §4.7), not an agent. Fine-grained tools force the LLM to drive the sequence, which IS the defining agent behavior per Anthropic's framing.
**Trade-offs.** More turns = higher API cost (~$0.30–0.50/run vs ~$0.10 for a single batch call). We trade ~$0.30/run for a *provably agentic* system.

### AD-3: HITL as a tool, not a hardcoded gate
**Decision.** `request_user_approval(question, options)` is the only blocking tool. The agent calls it when *it* judges approval necessary — not at hardcoded checkpoints.
**Alternatives.** The original PRD had 5 "mandatory, non-bypassable" HITL checkpoints in a wizard flow.
**Why this.** A 5-step wizard with a Claude call at each step is the definition of a workflow. Making approval a tool means the agent applies judgment: a clean plan proceeds to confirm-and-execute; a messy plan asks about ambiguous dates first. The system prompt's Autonomy Matrix gives Claude the rules for *when* to ask.
**Trade-offs.** The agent could theoretically "decide" not to ask and just execute. The system prompt's rule `"Final plan approval before any create_* tool — non-negotiable"` ensures it does. Still a risk; mitigated by validator + runtime RL error handling.

### AD-4: Artifact store for tool results
**Decision.** Tool results are stored as artifacts. History carries `{summary, artifactId}`, not the full blob.
**Alternatives.** (a) Inline full tool results in history. (b) Limit history length by dropping older turns.
**Why this.** Inlining blows up the context window by turn 10 on a 62-row plan. Dropping old turns loses the agent's reasoning chain. Artifacts keep per-turn input tokens roughly constant while preserving full history for Claude.
**Trade-offs.** More Redis operations per turn. Custom path language for `query_artifact` (not JSONPath) is more limited but simpler. Agent may occasionally "forget" the full context of an artifact and re-query — mild cost.

### AD-5: Agent-driven journey state
**Decision.** `update_journey_state(steps[])` is a tool the agent calls. The backend never enforces state transitions.
**Alternatives.** Frontend-managed state machine. Backend status field.
**Why this.** Reconciles the user's "I want to know where we are" need with the agent design principle "the LLM controls flow." The agent reports where it is; the UI displays it. No state machine anywhere.
**Trade-offs.** Agent could "lie" about its state. In practice, the system prompt lists the mandatory transition points and Claude follows them.

### AD-6: Static system prompt, no dynamic composition
**Decision.** One static prompt marked as ephemeral-cacheable. No `switch(status)` composition.
**Alternatives.** Compose the prompt per turn with current state injected.
**Why this.** Dynamic composition breaks prompt caching (70% cost reduction lost), and it encodes the state machine we're trying to avoid. The agent reads its own conversation history to know where it is.
**Trade-offs.** The prompt is long (~5k tokens). Cached, it's free after turn 1.

### AD-7: `web_search` (Anthropic server tool) for runtime API recovery
**Decision.** Include Anthropic's `web_search_20250305` server tool alongside our custom tools. Agent calls it when an RL endpoint returns an unexpected error suggesting the API changed.
**Alternatives.** (a) Embed the full RL API reference in the system prompt (already done). (b) Fail hard on any API surprise.
**Why this.** Static references go stale. A take-home assignment that works today but breaks tomorrow when Rocketlane renames a field is embarrassing. The agent detects drift, looks up current docs, caches the fix, retries. The `remember` tool persists the correction for the rest of the session so we don't pay for repeated searches.
**Trade-offs.** Small additional Anthropic cost per search (~$0.005/search, maybe 1–2 per run if triggered). No impact if no drift occurs.

### AD-8: Redis-backed session, not in-memory
**Decision.** Session lives in Upstash Redis with 48h TTL. Backend process holds nothing between requests.
**Alternatives.** In-memory session (single-instance), SQLite on Railway disk.
**Why this.** Railway containers are ephemeral — restart wipes disk and memory. Redis survives restarts. Also enables multi-instance horizontal scaling later (not needed now, but free).
**Trade-offs.** Every POST pays one round-trip to Upstash to load the session. In practice <50ms, negligible compared to Claude TTFT.

### AD-9: TypeScript everywhere, shared types duplicated
**Decision.** Agent types in `agent/src/types.ts`, frontend types in `frontend/lib/event-types.ts`. Duplicated by hand, not via a shared package.
**Alternatives.** npm workspaces with a `shared/` package. TypeScript path mappings.
**Why this.** Npm workspaces + TypeScript paths add 30 min of config overhead I don't need for a 1.5-day build. The shared surface (AgentEvent shape) is ~20 lines; keeping them in sync manually is cheaper than the build tooling.
**Trade-offs.** Two files to update when changing SSE events. Acceptable for this scope.

### AD-10: Rocketlane Custom App via iframe wrapper
**Decision.** Custom App .zip contains a minimal HTML shell that iframes `https://plansync-tau.vercel.app?embed=1`.
**Alternatives.** Package the full Next.js app as a static export bundle.
**Why this.** The iframe approach is ~5KB zip, always uses the latest deployed frontend, and only requires a `?embed=1` URL handler on the frontend to hide its app header. The full static bundle is 500KB–5MB and requires rebuilding/redeploying the .zip on every frontend change.
**Trade-offs.** Rocketlane's iframe sandbox may restrict some features — we'll test during Tomorrow PM. Fallback: full static bundle.

### AD-11: Two-pass entity creation (entities first, deps second)
**Decision.** All `create_*` calls run in pass 1. All `add_dependency` calls run in pass 2 after `idmap` is fully populated.
**Alternatives.** Create entities and their dependencies inline as we go.
**Why this.** A dependency references two task IDs. If we create inline, the second task might not exist yet. Rocketlane would reject with "task not found." Two-pass guarantees all IDs exist before dependency creation.
**Trade-offs.** Two passes over the item list instead of one. Trivial overhead.

### AD-12: Encrypted user API keys, not client-held
**Decision.** User's RL API key is encrypted with AES-256-GCM and stored in Redis for the 48h session.
**Alternatives.** Client-side only (user retypes on every session), no storage at all.
**Why this.** User ergonomics — typing an API key every time is friction, and for a real product demo we want the agent to remember it. The "production agent" framing means we do it the secure way (encrypted at rest, decrypted only in-process).
**Trade-offs.** More complexity: `ENCRYPTION_KEY` env var, crypto code path, separate local vs prod keys. Worth it for the narrative.

---

## 11. Testing Strategy

For a 1.5-day build, we test **end-to-end functional paths**, not individual units.

### 11.1 Hour 0 (done)
**Goal.** Prove streaming SSE works through the full stack.
**Method.** Fake-agent loop with a dummy `greet` tool. Drive via Playwright MCP in a real browser. Verify text_delta, tool_use_*, done events flow through.
**Outcome.** ✅ Passed. See `docs/screenshots/hour0-verified.png`.

### 11.2 Hour 1–2.5 (done)
**Goal.** Prove every Rocketlane endpoint the 21-tool agent depends on actually works.
**Method.** `agent/scripts/test-rl.ts` — 12 scenarios covering auth, context reads, project creation, 2 phases, 3 tasks, 1 subtask, 1 sub-subtask (depth 3), 1 milestone, read-back, dependency, and a negative case (missing dueDate → expected 400).
**Outcome.** ✅ All 12 passed. API response shapes captured in `agent/rl-api-contract.json`.

### 11.3 Hour 5.5–7 (pending)
**Goal.** Prove the real agent loop (not fake) can drive a small CSV through end-to-end.
**Method.** Hand-author an 8-row CSV with 2 phases, 4 tasks, 1 subtask, 1 milestone, 1 dependency. POST it, watch the agent stream through parse → plan → validate → approve → execute. Verify the real project appears in Rocketlane with correct structure.

### 11.4 Tomorrow PM (pending)
**Goal.** Prove the full 62-row Shard FM Engine CSV runs clean and edge cases self-correct.
**Method.**
1. **Clean run.** 62 rows, clean data. Watch journey stepper advance through all 6 steps.
2. **Messy run.** Remove dates from 10 rows, swap DD/MM on one. Agent asks via ApprovalPrompt.
3. **Self-correction run.** Inject a circular dependency. Agent reflects via ReflectionCard, fixes, re-validates, succeeds.
4. **API drift recovery run.** Inject a stub that returns "unknown field" on one RL call. Agent web_searches, remembers the fix, retries.
5. **Custom App run.** Install plansync-custom-app.zip in inbarajb.rocketlane.com, complete a full run from inside RL.

### 11.5 What we do NOT test
- **Unit tests on tool functions.** Each tool is small and contract-bound; the integration tests cover them.
- **Load tests.** Single-user demo.
- **Multi-user isolation.** No multi-user.
- **Failover.** Single-region Redis, single Railway instance.

---

## 12. Known Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Streaming + tool_use + SSE breaks on Railway | Medium | Fatal | ✅ De-risked Hour 0 |
| 2 | Rocketlane API surprises | Medium | High | ✅ De-risked Hour 1–2.5 via test-rl.ts |
| 3 | Agent context bloat by turn 12 | High if unmitigated | Medium | ✅ Artifact store + prompt caching |
| 4 | CORS / buffering issues Vercel ↔ Railway | Medium | Medium | ✅ Explicit CORS + X-Accel-Buffering: no |
| 5 | Two-pass dependency ordering bug | Medium | Medium | Validator check #4 + tool-level assertion |
| 6 | Anthropic 529 overloaded mid-demo | Low | Embarrassing | One retry + clean error state + "Resume" button |
| 7 | UI clutter at turn 20 | High | Medium | Collapsible reasoning + sticky JourneyStepper + ProgressFeed |
| 8 | Railway cold start during demo | Low | Medium | $5/mo plan keeps warm |
| 9 | Custom App .zip format surprises | Medium | Low | Tomorrow PM test; fall back to live URL |
| 10 | 21-tool schema confuses Claude | Low | Low | Grouped by role in system prompt; Sonnet 4.5 handles 21 tools fine |
| 11 | Rocketlane API changes between build and demo | Low | Medium | web_search runtime recovery rule |

Risks 1, 2, 3, 4 are verified-closed. Risks 5–11 are mitigated by design; real-world verification happens in Hour 5.5–7 and Tomorrow PM.

---

## 13. Current Implementation Status

| Component | Status | Commit |
|---|---|---|
| Monorepo scaffold | ✅ | `12c976e` |
| `.env.example` templates | ✅ | `3b09d2d` |
| Next.js frontend + fake streaming chat | ✅ | `3a6ea99` |
| Express backend + fake agent endpoint | ✅ | `3a6ea99` |
| Railway deployment | ✅ | Running at plansync-production.up.railway.app |
| Vercel deployment | ✅ | Running at plansync-tau.vercel.app |
| Rocketlane REST client + 12-scenario verification | ✅ | `e115507` |
| `rl-api-contract.json` (ground-truth API reference) | ✅ | `e115507` |
| Agent types + memory infrastructure | ✅ | `d78e8a7` |
| Crypto + SSE helpers | ✅ | `d78e8a7` |
| System prompt (corrected API reference) | ✅ | `d78e8a7` |
| Group A tools (parse_csv, get_rocketlane_context, query_artifact) | ✅ | `d78e8a7` |
| Group B tools (validate_plan, create_execution_plan, update_journey_state, reflect_on_failure) | ✅ | `d78e8a7` |
| Group C tools (remember, recall) | ✅ | `d78e8a7` |
| Tool dispatcher | ✅ | `d78e8a7` |
| **Group D tool (request_user_approval)** | ⏳ Hour 4–5.5 | — |
| **Group E tools (creation: project/phase/task/bulk/dependency)** | ⏳ Hour 4–5.5 | — |
| **Group F tools (get_task, retry_task)** | ⏳ Hour 4–5.5 | — |
| **Group G tools (display_*)** | ⏳ Hour 4–5.5 | — |
| **Real ReAct loop (loop.ts)** | ⏳ Hour 4–5.5 | — |
| **Route refactor (`/agent` uses real loop + dispatcher)** | ⏳ Hour 4–5.5 | — |
| **`/upload` endpoint with SheetJS parsing** | ⏳ Hour 4–5.5 | — |
| **First end-to-end run with tiny CSV** | ⏳ Hour 5.5–7 | — |
| **Frontend rich components** | ⏳ Tomorrow AM | — |
| **Shard FM Engine demo CSV** | ⏳ Tomorrow PM | — |
| **Edge case runs + Custom App + BRD + submit** | ⏳ Tomorrow PM | — |

---

## 14. What I'd Revisit as the System Grows

(Per the system-design skill framework.)

### If we needed to support 10+ concurrent users
- Move from session-locked POST/agent to an async job queue (Bull, Temporal). Each turn is a job, tracked by jobId, SSE multiplexed via a pub/sub layer.
- Upstash Redis pipeline → full Redis cluster. Or move to Postgres for durable session state.
- Rate limiting at the CORS layer (per-origin token bucket).

### If we needed horizontal backend scaling
- Session lock moves from SET NX EX to a Redis lock manager (Redlock). Currently a single-instance lock works because Railway gives us one container.
- Artifact store doesn't scale well as a Redis HASH per session if artifacts get large (5MB+). Move to S3 or R2 with presigned URLs.

### If we wanted persistent sessions across visits
- Add user identity (email-based token). Session persistence in Postgres with proper indexes on userId + createdAt.
- Build a "My runs" sidebar and a "Resume" flow for each session.
- ~4 hours of frontend + backend work. Documented but deferred — not needed for the 1.5-day submission.

### If we wanted the agent to work offline (inside Rocketlane only)
- Replace the iframe Custom App with a fully-bundled static export. Agent backend runs on a proxy that lives inside Rocketlane's environment. Significantly more ops complexity.

### If the LLM call costs became a problem
- Aggressive prompt caching on more message parts (not just the system prompt).
- Batch tool calls where possible (the current `create_tasks_bulk` already does this for the hottest path).
- Switch to Claude Haiku for simple tool calls (summary, reflection), keep Sonnet for the plan-generation turn.

### If Rocketlane added a CSV import feature upstream
- Plansync becomes redundant for the primary use case. Pivot to: intelligent plan *editing* (take an existing Rocketlane project and a diff CSV, apply the diff); cross-tool migration (Asana → Rocketlane with mapping); or plan *validation* (tell me if this plan is well-structured before I commit to it).

---

## 15. Open Questions

Questions for the user (Inbaraj) that don't block current development:

1. **Custom App approach — revisit Tomorrow PM when we build it.** Current default is the iframe wrapper (AD-10). Inbaraj raised a third option worth exploring: **hybrid self-contained + live-updating bundle**. The idea: the Custom App .zip contains a local HTML shell + a service worker that pulls the latest JavaScript bundles from Vercel at runtime (same as the iframe gets updates seamlessly), but the entry point is served locally inside Rocketlane so it feels self-contained.

   Implementation options for the hybrid:

   **(a) Script-loader shell.** The .zip contains `index.html` with `<script src="https://plansync-tau.vercel.app/_next/static/chunks/[hash].js">` pointing at the Vercel-hosted bundles. Updates land automatically when you `vercel --prod`. Feels "installed" inside Rocketlane but still needs internet.

   **(b) Service worker + cache.** The .zip contains an initial HTML shell that registers a service worker. The SW fetches the latest Vercel bundle on first load, caches it, and updates in the background on subsequent loads. Works offline after first load.

   **(c) Next.js static export with a "check for updates" bootstrap.** The .zip contains a fully bundled Next.js app (via `next export`). On load, the bundled app pings a Vercel endpoint for a version hash; if newer, it fetches the new bundle and swaps in on next load. Works offline, longest initial zip.

   Decision deferred until Tomorrow PM when we can test Rocketlane's Custom App iframe sandbox limits (CSP, allowed external origins, service-worker permissions). If Rocketlane blocks external scripts entirely, option (c) is the only viable one. If it allows scripts but blocks SW, option (a). If it allows everything, option (b) is best.

   **Action item:** before building the Custom App in Tomorrow PM, test what Rocketlane's iframe sandbox allows. If unclear, fall back to the plain iframe wrapper (AD-10) as a known-working baseline.
2. **Persistent sessions.** Currently out of scope (48h TTL, no user identity). Confirm this is OK for the submission.
3. **Demo CSV.** The plan uses the Shard FM Engine adaptation from PRD §11. Confirm this is still the target or if there's a different CSV you want to use.
4. **BRD format.** Rocketlane Spaces (PDF?) or a GitHub markdown doc? Confirm your preference before Tomorrow PM.
5. **Walkthrough video.** In the plan as "decide Friday based on time". Hard yes or soft maybe?

---

*Last updated 2026-04-15 after committing d78e8a7 (Hour 2.5–4 checkpoint).*
