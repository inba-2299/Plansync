# Plansync

> An AI agent that reads a project plan CSV and creates it as a fully structured project in Rocketlane — with phases, tasks, subtasks, milestones, and dependencies.

Built as the take-home assignment for the **Rocketlane Implementation Manager** role.

## Live

- **Frontend (Vercel):** https://plansync-tau.vercel.app
- **Agent backend (Railway):** https://plansync-production.up.railway.app
- **Health check:** https://plansync-production.up.railway.app/health
- **Source:** https://github.com/inba-2299/Plansync

The agent has been verified end-to-end against the live Rocketlane workspace. On 2026-04-15, it parsed a 21-task / 8-phase / 8-milestone / 12-dependency plan uploaded as a real `.xlsx` file and created the full Rocketlane project in **3.5 seconds** of execution time at a cost of **~$0.86/run on Sonnet 4.5** (~$0.20-0.25/run predicted on Haiku 4.5 with the same token optimizations). Zero fuss, zero intervention, zero max_tokens errors, zero rate-limit walls hit.

The frontend is a chat-first single-page UI with a **split layout**: user workspace on the left (40%), agent workspace on the right (60%), thin vertical rule between, pinned execution plan + progress feed sticky at the top of the agent column, collapses to a single chronological timeline below 1024px. 13px base font size (scaled down ~18.75% from the browser default for a denser dashboard feel). 14 components total (JourneyStepper, ExecutionPlanCard, PlanReviewTree, PlanIntegrityPanel, ApprovalPrompt, ApiKeyCard, FileUploadCard, ProgressFeed, ReflectionCard, CompletionCard + chat timeline renderers) that render whatever the agent emits via tool calls. No state machine, no wizard, no multi-page flow. See `frontend/components/agent-emitted/` for the full set.

There is also a **lightweight operator admin portal** at `/admin` — login form auth via HttpOnly HMAC cookie, live runtime config editor (model / max_tokens / 429 retries without a Railway redeploy), 22-tool grid with toggle functionality to disable tools, observability stats (runs today, success rate, active sessions, errors, estimated cost today, avg cost/run), recent sessions table with date range + status filters, daily token usage broken down by model. See [`frontend/app/admin/`](frontend/app/admin/) and [`agent/src/admin/`](agent/src/admin/).

## What it is

A properly designed agent (not a wizard) that:
- Reasons about any project plan file using PM domain knowledge
- Plans its own work with `create_execution_plan` — you see its TODO
- Maintains working memory with `remember`/`recall`
- Reflects on failures before retrying
- Self-corrects on validation errors
- Streams its reasoning live to the UI
- **Gathers metadata interactively** via sequential approvals with options pre-populated from workspace context (customer list, team members, suggested dates)
- **Executes the plan via a single batch tool** (`execute_plan_creation`) that does project + phases + tasks + subtasks + milestones + dependencies in 1-2 turns instead of 15-30, making runs 10× cheaper and 20× faster
- Falls back to fine-grained tools (`create_phase`, `create_task`, `add_dependency`, `retry_task`) for error recovery and surgical edits
- Calls **22 tools total** in a ReAct loop (21 custom + `web_search` server tool)
- Recovers from Rocketlane API changes at runtime via `web_search`
- Handles rate limits gracefully: 429 retry with `Retry-After` backoff, visible countdown card in the UI, up to 3 retry attempts before giving up
- Model-swappable via a Railway env var (`ANTHROPIC_MODEL`): Haiku 4.5, Sonnet 4.5, or Opus 4.5 — no code change
- **Refresh-safe**: every SSE event is persisted to Redis, the frontend replays them on page load, so a browser refresh returns to exactly the same state (reasoning bubbles, plan review, execution plan, pending approvals, journey stepper). Same-browser only; cross-device recovery is a post-submission feature.
- **Runs inside Rocketlane as a Custom App.** `custom-app/plansync-custom-app.zip` is a 199 KB bundle built via the official `@rocketlane/rli` CLI. Declares the Plansync widget at two surfaces (workspace `left_nav` + `project_tab`). The widget shell is a thin iframe wrapper around the live Vercel frontend with `?embed=1` appended — meaning Vercel deploys are picked up automatically without rebuilding the Custom App.
- **Has a lightweight admin portal** at `/admin` for operator observability + runtime config. Login form → HttpOnly cookie → dashboard with 6 stat cards, runtime config editor, 22-tool grid with toggles, recent sessions table, daily usage by model.

## Architecture

```
Frontend (Vercel)  ──fetch + SSE──►  Agent Backend (Railway)
Next.js 14 (split UI)                 Node 20 + Express
React chat UI                         Claude Haiku 4.5 / Sonnet 4.5 / Opus
JourneyStepper                        (Redis override → env var → error)
13px base font                        22 tools (21 custom + web_search)
Pinned execution plan                  ├─ 1 batch: execute_plan_creation
Sticky split workspaces                ├─ 6 fine-grained creation (fallback)
ErrorBoundary + refresh-safe           ├─ 4 planning/metacognition
/admin portal                          ├─ 3 input/context + 2 memory
                                       ├─ 2 verification + 3 display
                                       └─ 1 HITL (request_user_approval)
                                      ↓
                              Anthropic + Rocketlane + Upstash Redis
                                      ↑
                  custom-app/plansync-custom-app.zip (199 KB)
                  iframes plansync-tau.vercel.app?embed=1
                  installed inside Rocketlane workspaces
```

See [docs/PLAN.md](docs/PLAN.md) for the full architecture, tool list, system prompt composition, and build sequence. See [docs/DESIGN.md](docs/DESIGN.md) for 20+ architectural decisions with trade-offs.

## Repo layout

```
plansync/
├── frontend/         ← Next.js 14 frontend (deploys to Vercel, rootDir: frontend)
├── agent/            ← Node agent backend (deploys to Railway, rootDir: agent)
├── shared/           ← Shared TypeScript types between frontend and agent
├── custom-app/       ← Rocketlane Custom App bundle source (produces plansync-custom-app.zip)
├── docs/
│   └── PLAN.md       ← The canonical build plan
├── PRD_Projectplanagent.md                 ← Original PRD (reference)
├── PRD_Rocketlane_Project_Plan_Agent.pdf   ← Original PRD, PDF version
├── Plansync Architecture.pdf                ← Earlier architecture doc
├── Plansync_Agent_Design_Document.pdf       ← Earlier agent design doc
├── CLAUDE.md         ← Instructions for Claude sessions (persistent context)
├── MEMORY.md         ← Decision log + lessons learned (persistent)
├── CONTEXT.md        ← Current session state (updated at session end)
└── README.md         ← This file
```

## Quick start (local dev)

> Agent backend:
```bash
cd agent
npm install
cp .env.example .env
# Fill in:
#   ANTHROPIC_API_KEY
#   ANTHROPIC_MODEL           (e.g. claude-haiku-4-5, claude-sonnet-4-5, or claude-opus-4-5 —
#                              optional after Commit 2h; loop reads from Redis first,
#                              falls back to env var)
#   UPSTASH_REDIS_REST_URL
#   UPSTASH_REDIS_REST_TOKEN
#   ENCRYPTION_KEY            (32 bytes base64 — for Rocketlane API key at-rest encryption,
#                              also used to sign admin portal HMAC tokens)
#   ALLOWED_ORIGIN            (comma-separated, must include the frontend origin + any
#                              Vercel preview domains; supports https://*.vercel.app wildcards)
#
# Optional — only needed to enable /admin portal:
#   ADMIN_USERNAME            (pick anything)
#   ADMIN_PASSWORD            (generate: `openssl rand -base64 24`)
#
npm run dev
```

> Frontend:
```bash
cd frontend
npm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_AGENT_URL=http://localhost:3001 (or your Railway URL)
npm run dev
```

Open http://localhost:3000.

## Deployment

- **Frontend** → Vercel (set Root Directory to `frontend/`)
- **Backend** → Railway (set Root Directory to `agent/`)
- **One git push deploys both.**

See [docs/PLAN.md](docs/PLAN.md) § "Build sequence" for full deployment steps.

## Critical invariants

1. The LLM controls flow. No backend state machine.
2. Frontend has zero business logic — renders whatever the agent emits.
3. Backend is stateless — Redis is the session store.
4. Display tools are non-blocking; `request_user_approval` is the only blocking tool.
5. Tool results are artifacts; history carries summaries, not full blobs.
6. State is reported by the agent, not enforced against it.

## Submission deliverables

| # | Deliverable | Location |
|---|---|---|
| 1 | Live deployed agent (frontend) | https://plansync-tau.vercel.app |
| 2 | Live deployed agent (backend) | https://plansync-production.up.railway.app |
| 3 | Source code (this repo) | https://github.com/inba-2299/Plansync |
| 4 | Rocketlane Custom App `.zip` | [`custom-app/plansync-custom-app.zip`](custom-app/plansync-custom-app.zip) (199 KB, built via `@rocketlane/rli`) — **verified installed and running inside `inbarajb.rocketlane.com`** |
| 5 | BRD document | **[BRD.md](BRD.md)** — start here for the formal write-up |
| 6 | Demo project plan | `Sample Plan.xlsx` in repo (21 tasks, 8 phases, 8 milestones, 12 dependencies) — verified end-to-end: full project created in Rocketlane in 3.5 seconds at a cost of $0.86/run on Sonnet 4.5 |
| +1 | Lightweight admin portal (bonus) | `/admin` route — login form → dashboard with runtime config editor, 22-tool grid with toggles, observability stats, recent sessions table, cost estimator |

## Documentation

- **[BRD.md](BRD.md)** — **The formal Business Requirements Document for the submission.** Problem, approach, why-it's-an-agent defense, architecture diagram, key technical decisions with measured impact, deliverables checklist. Read this first.
- **[docs/DESIGN.md](docs/DESIGN.md)** — Formal system design document: 25+ architectural decisions with trade-offs, full data model, API contracts, control flow, risk matrix, testing strategy. Written mid-build to capture the "why" of every major choice.
- **[docs/PLAN.md](docs/PLAN.md)** — Canonical Session 1 build plan with Session 4 deltas annotated at the top: architecture, tool list, system prompt composition, file structure, build sequence, verification.
- **[custom-app/README.md](custom-app/README.md)** — How to install the Rocketlane Custom App `.zip` in a workspace + design rationale (iframe-in-widget approach + why `@rocketlane/rli` instead of a hand-crafted manifest).
- **[CLAUDE.md](CLAUDE.md)** — How to work on this repo (for Claude sessions working on the project).
- **[MEMORY.md](MEMORY.md)** — Decision log and lessons learned, per session. Read to understand *why* the current design exists and what alternatives were rejected. Covers the Session 4 decisions to reverse "fine-grained tools only" in favor of a batch execution tool, the refresh-safe sessions architecture, the application crash + error boundary fix, the Custom App pivot from hand-crafted to rli-based, the system prompt hardening against prose-asking, and the admin portal architecture.
- **[CONTEXT.md](CONTEXT.md)** — Current session state, what's next, open questions, environment.
- **[agent/rl-api-contract.json](agent/rl-api-contract.json)** — Captured Rocketlane API response shapes from a 12-scenario live verification. Ground truth for what the RL API actually returns (vs what PRD §9 claims).
- **[PRD_Projectplanagent.md](PRD_Projectplanagent.md)** — Original PRD (superseded by PLAN.md for architecture; still authoritative for PM knowledge + RL data model + validator checks).
