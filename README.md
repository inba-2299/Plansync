# Plansync

> An AI agent that reads a project plan CSV and creates it as a fully structured project in Rocketlane — with phases, tasks, subtasks, milestones, and dependencies.

Built as the take-home assignment for the **Rocketlane Implementation Manager** role.

## What it is

A properly designed agent (not a wizard) that:
- Reasons about any project plan file using PM domain knowledge
- Plans its own work with `create_execution_plan` — you see its TODO
- Maintains working memory with `remember`/`recall`
- Reflects on failures before retrying
- Self-corrects on validation errors
- Streams its reasoning live to the UI
- Calls 21 fine-grained tools in a ReAct loop (15–25 turns per run)
- Recovers from Rocketlane API changes at runtime via `web_search`
- Runs inside Rocketlane as a Custom App

## Architecture

```
Frontend (Vercel)  ──fetch + SSE──►  Agent Backend (Railway)
Next.js 14                            Node 20 + Express
React chat UI                         Claude Sonnet 4.5 + tool use
JourneyStepper                        20 custom tools + web_search
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
# Fill in ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ENCRYPTION_KEY
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

- **[docs/PLAN.md](docs/PLAN.md)** — Full architecture, tools, build sequence (canonical)
- **[CLAUDE.md](CLAUDE.md)** — How to work on this repo (for Claude sessions)
- **[MEMORY.md](MEMORY.md)** — Decision log, iterations, lessons
- **[CONTEXT.md](CONTEXT.md)** — Current session state
- **[PRD_Projectplanagent.md](PRD_Projectplanagent.md)** — Original PRD (superseded by PLAN.md for architecture; still authoritative for PM knowledge + RL data model + validator checks)
