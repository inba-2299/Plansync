# CLAUDE.md — Instructions for Claude sessions working on Plansync

> **Read this file first at the start of every session.** Then read `CONTEXT.md` to see where we left off. Update `CONTEXT.md` and `MEMORY.md` before the session ends.

## Project in one sentence

Plansync is an AI agent that reads a project plan CSV and creates it as a fully structured project (phases, tasks, subtasks, milestones, dependencies) inside Rocketlane via their REST API. Take-home assignment for the Rocketlane Implementation Manager role. Deadline **2026-04-16**.

## Where things live

| File | What's in it | Read for |
|---|---|---|
| `docs/DESIGN.md` | **Formal system design** — requirements, high-level architecture, 12 architectural decisions with trade-offs, data model, API contracts, control flow, risk matrix, testing strategy, "what I'd revisit as it grows" | Understanding *why* the system is built the way it is. Source of truth for architecture. |
| `docs/PLAN.md` | **Canonical build plan** — architecture, 21 tools, system prompt composition, file structure, build sequence, risks, verification | Everything. Start here for *what to do next*. |
| `PRD_Projectplanagent.md` | Original 970-line PRD — superseded for architecture but still authoritative for: PM domain knowledge (§4.3 lines 208–276), Rocketlane API reference (§9 lines 753–823), Rocketlane Carbon design tokens (§8.2 lines 614–655), Shard FM Engine demo scenario (§11 lines 888–895), 11 validation checks (§5 Tool 3 lines 442–458), autonomy matrix (§6.2 lines 519–586) | Paste-verbatim content for the agent system prompt and tool implementations |
| `agent/rl-api-contract.json` | Captured request/response shapes from `test-rl.ts` — ground truth for what Rocketlane's API actually returns (vs what PRD §9 claims) | When in doubt about RL API fields or response envelopes |
| `MEMORY.md` | Decision log, architecture iterations, what we tried and rejected, lessons learned per session | Understanding *why* the current design exists (historical context) |
| `CONTEXT.md` | What was just completed, what's next, open questions, environment setup status | Picking up where the last session left off |
| `README.md` | High-level project overview, quick start, repo layout | Onboarding humans |
| `plansync_google_stitch design/` | Google Stitch visual design reference — 4 screens (agent_setup, agent_chat_upload, plan_validation, execution_monitor). Multi-page dashboard aesthetic; we adopted the visual language + component designs in Session 3 but kept our single-page chat architecture. | Visual reference when tweaking existing components or designing new ones |
| `docs/screenshots/ui-rebuild-verified.png` | Screenshot from the Session 3 Playwright verification run — shows the fresh chat UI, JourneyStepper, and `ApiKeyCard` rendering correctly on localhost against the Railway backend | Sanity-check "what the UI should look like" |

## Critical invariants — do not break these

1. **The LLM controls flow.** No backend state machine. No switch/case on a `status` field. The agent decides what to do next.
2. **Frontend has zero business logic.** It renders whatever the agent emits via tool calls. If you're tempted to add logic to the frontend to "fix" something, add it to the system prompt or a tool instead.
3. **Backend is stateless.** Redis is the session store. Each `/agent` POST loads state, runs the loop, saves state.
4. **Display tools are non-blocking.** Only `request_user_approval` pauses the loop. If you ever make a display tool blocking, you've introduced a bug.
5. **Tool results go through the artifact store.** History carries summaries + artifactIds, never full blobs. This prevents context bloat by turn 12.
6. **State is reported by the agent, not enforced against it.** The `JourneyStepper` shows users "where we are" because the agent *tells* the frontend via `update_journey_state` — not because the backend runs a state machine.
7. **Every capability the agent has must be transparent to the user.** Planning, memory writes, reflection, verification, tool calls — all visible in the UI.

## Tech stack

- **Frontend:** Next.js 14 App Router, TypeScript 5, Tailwind 3.4, framer-motion 11, clsx
- **Agent backend:** Node 20, Express 4, `@anthropic-ai/sdk ^0.30`, `@upstash/redis ^1.34`, xlsx, zod, nanoid, undici, tsx
- **Shared:** `shared/types.ts` for AgentEvent, PlanItem, JourneyStep, RL types
- **Deployment:** Vercel (frontend) + Railway (agent backend). **One monorepo, one git push → both deploy.**
- **Model:** `claude-sonnet-4-5`

## Tool count

**21 total = 20 custom + 1 Anthropic server tool (`web_search`).**

Groups: Input/context (3), Planning/metacognition (4), Memory (2), HITL (1 — the only blocking tool), Creation (5), Verification (2), Display (3), Runtime docs recovery (1 server tool).

See `docs/PLAN.md` § "Tools" for the full table and rationale.

## Environment variables

**Railway backend (`agent/`):**
- `ANTHROPIC_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ENCRYPTION_KEY` (32 bytes base64, for AES-GCM of the Rocketlane API key at rest)
- `ALLOWED_ORIGIN` (comma-separated, must include both prod and localhost for dev-plus-prod flow: `https://plansync-tau.vercel.app,http://localhost:3000,https://*.rocketlane.com`)

**Vercel frontend (`frontend/`):**
- `NEXT_PUBLIC_AGENT_URL` (the Railway deployment URL)

Local dev: create `.env` in `agent/` and `.env.local` in `frontend/`. Never commit these — `.gitignore` already excludes them.

## Common commands

```bash
# Frontend local dev
cd frontend && npm run dev                 # → http://localhost:3000

# Frontend local BUILD (use this before pushing — Vercel's lint is stricter than `next dev`)
cd frontend && npm run build               # catches unused vars + no-page-custom-font warnings

# Agent backend local dev
cd agent && npm run dev                    # → http://localhost:3001 (hot-reload via tsx)

# Standalone Rocketlane API verification
cd agent && npx tsx scripts/test-rl.ts     # Exercises every endpoint the agent uses

# Deploy frontend
cd frontend && vercel --prod

# Deploy backend
cd agent && railway up

# Build Custom App .zip
cd custom-app && bash build.sh             # Produces plansync-custom-app.zip

# Run a local end-to-end
# (terminal 1) cd agent && npm run dev
# (terminal 2) cd frontend && npm run dev
# Open localhost:3000
```

## Session workflow — READ THIS EVERY SESSION

**At the start:**
1. Read `CLAUDE.md` (this file)
2. Read `CONTEXT.md` — see what's in flight, what's next, open questions
3. Read `MEMORY.md` — understand past decisions so you don't re-litigate them
4. Read `docs/PLAN.md` — refresh on the full architecture (only read the relevant sections)
5. Skim `docs/DESIGN.md` — read the sections relevant to what you're about to touch (don't re-read the whole thing every session)
6. Check the Rocketlane tracking tasks (project 5000000073039, phase "Agent Development") for current status

**During the session:**
- If you're about to change architecture direction, document the reason in `MEMORY.md` before proceeding
- Update Rocketlane tracking task statuses as you complete them (via the Rocketlane MCP — search for tasks, mark in-progress/complete)

**At the end of the session (non-negotiable):**
1. Update `CONTEXT.md` with:
   - What was just completed (commit SHAs if code was pushed)
   - What's in-flight (partial implementations)
   - What's next for the next session
   - Any open questions for the user
   - Current environment state (what's deployed, what env vars are set, what's broken)
2. Append to `MEMORY.md` any new decisions or lessons learned from this session
3. If the plan (`docs/PLAN.md`) was changed, commit those changes
4. Commit everything and push to `main`

## How to resume from a cold start

```bash
# 1. Orient yourself
cat CLAUDE.md       # this file
cat CONTEXT.md      # what's in flight
cat MEMORY.md       # why things are the way they are
less docs/PLAN.md   # the build plan
less docs/DESIGN.md # formal system design (read only the relevant section)

# 2. Sync with remote
git pull

# 3. Check Rocketlane tracking tasks
# Use Rocketlane MCP: search project 5000000073039, phase "Agent Development"

# 4. Pick up the next item from CONTEXT.md → "What's next"
```

## Rocketlane tracking

The build is tracked as 4 parent tasks + 17 subtasks in Rocketlane project 5000000073039, phase "Agent Development" (phase ID 5000000188900):

| Parent | ID | Subtasks |
|---|---|---|
| Agent Core: Brain, Loop & Memory | 5000001553728 | 4 |
| Agent Tools: Fine-grained Primitives | 5000001553729 | 4 |
| Agent UI: Output Surface + Immersive Q&A | 5000001553730 | 5 |
| Demo CSV + End-to-End Verification | 5000001553747 | 4 |

Full mapping in `docs/PLAN.md` § "Rocketlane tracking task IDs".

## Things NOT to do

- **Don't rewrite `docs/PLAN.md` casually.** It reflects careful iteration. If you think something's wrong, document the disagreement in `MEMORY.md` first.
- **Don't add a `status` field to sessions.** We explicitly rejected the state machine approach.
- **Don't make display tools blocking.** Only `request_user_approval` blocks.
- **Don't inline full tool results into history.** Use the artifact store.
- **Don't commit `.env` files.** `.gitignore` already blocks them — don't override.
- **Don't cut features because of the deadline.** The user has explicitly said everything in the plan is in scope.
- **Don't create PRDs or design docs as Markdown files unless explicitly asked.** The existing `docs/PLAN.md` is the source of truth.
