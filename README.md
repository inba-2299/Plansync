# Plansync

> An AI agent that reads a project plan CSV and creates it as a fully structured project in Rocketlane — with phases, tasks, subtasks, milestones, and dependencies.

Built as the take-home assignment for the **Rocketlane Implementation Manager** role.

## Live

- **Frontend (Vercel):** https://plansync-tau.vercel.app
- **Agent backend (Railway):** https://plansync-production.up.railway.app
- **Health check:** https://plansync-production.up.railway.app/health
- **Source:** https://github.com/inba-2299/Plansync

The agent has been verified end-to-end against the live Rocketlane workspace. On 2026-04-15, it parsed a 21-task / 8-phase / 8-milestone / 12-dependency plan uploaded as a real `.xlsx` file and created the full Rocketlane project in **3.5 seconds** of execution time at a cost of **~$0.86/run on Sonnet 4.5** (~$0.20-0.25/run predicted on Haiku 4.5 with the same token optimizations). Zero fuss, zero intervention, zero max_tokens errors, zero rate-limit walls hit.

The frontend is a chat-first single-page UI with a **split layout**: user workspace on the left (40%), agent workspace on the right (60%), thin vertical rule between, pinned execution plan + progress feed sticky at the top of the agent column, collapses to a single chronological timeline below 1024px. 14px base font size. 14 components total (JourneyStepper, ExecutionPlanCard, PlanReviewTree, PlanIntegrityPanel, ApprovalPrompt, ApiKeyCard, FileUploadCard, ProgressFeed, ReflectionCard, CompletionCard + chat timeline renderers) that render whatever the agent emits via tool calls. No state machine, no wizard, no multi-page flow. See `frontend/components/agent-emitted/` for the full set.

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
- Runs inside Rocketlane as a Custom App

## Architecture

```
Frontend (Vercel)  ──fetch + SSE──►  Agent Backend (Railway)
Next.js 14 (split UI)                 Node 20 + Express
React chat UI                         Claude Sonnet 4.5 / Haiku 4.5
JourneyStepper                        (configurable via env var)
Pinned execution plan                 21 custom tools + web_search
Sticky user/agent columns              ├─ 1 batch: execute_plan_creation
                                       └─ 20 fine-grained (fallback)
                                      ↓
                              Anthropic + Rocketlane + Upstash Redis
```

See [docs/PLAN.md](docs/PLAN.md) for the full architecture, tool list, system prompt composition, and build sequence.

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
#   ANTHROPIC_MODEL           (e.g. claude-haiku-4-5, claude-sonnet-4-5, or claude-opus-4-5)
#   UPSTASH_REDIS_REST_URL
#   UPSTASH_REDIS_REST_TOKEN
#   ENCRYPTION_KEY            (32 bytes base64 — for Rocketlane API key at-rest encryption)
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

## Documentation

- **[docs/DESIGN.md](docs/DESIGN.md)** — Formal system design document: architectural decisions with trade-offs, full data model, API contracts, control flow, risk matrix, testing strategy. Written mid-build to capture the "why" of every major choice.
- **[docs/PLAN.md](docs/PLAN.md)** — Canonical build plan: architecture, tool list, system prompt composition, file structure, build sequence, verification.
- **[CLAUDE.md](CLAUDE.md)** — How to work on this repo (for Claude sessions working on the project).
- **[MEMORY.md](MEMORY.md)** — Decision log and lessons learned, per session. Read to understand *why* the current design exists and what alternatives were rejected. Includes the Session 4 decision to reverse "fine-grained tools only" in favor of a batch execution tool for the happy path.
- **[CONTEXT.md](CONTEXT.md)** — Current session state, what's next, open questions, environment.
- **[agent/rl-api-contract.json](agent/rl-api-contract.json)** — Captured Rocketlane API response shapes from a 12-scenario live verification. Ground truth for what the RL API actually returns (vs what PRD §9 claims).
- **[PRD_Projectplanagent.md](PRD_Projectplanagent.md)** — Original PRD (superseded by PLAN.md for architecture; still authoritative for PM knowledge + RL data model + validator checks).
