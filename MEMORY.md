# MEMORY.md — Decision log & lessons learned

> Long-term memory of why things are the way they are. Read before making architectural changes. Append (don't rewrite) at the end of each session.

---

## 2026-04-14 — Session 1: Planning

### Context at start

Inbaraj had written a 970-line PRD (`PRD_Projectplanagent.md`) describing a Next.js wizard app with a 6-step state machine, 5 mandatory HITL checkpoints, batch execution tools, Upstash, Sentry, and Vercel. He called it "a product instead of an agent" and asked whether it qualified as an agent.

### Decision: workflow → agent

**What changed:** The PRD was an AI-augmented workflow per Anthropic's definition ("LLMs orchestrated through predefined code paths"), not an agent ("LLMs that dynamically direct their own processes and tool usage"). Inbaraj agreed. We redesigned from scratch:

- Removed the 6-step state machine and `status` field
- Deleted the switch/case system prompt (one static prompt now)
- Broke up the `execute_creation_pass` batch tool into fine-grained primitives
- Made HITL a tool (`request_user_approval`) the agent chooses to call, not a hardcoded wizard gate
- Added display tools so the agent drives UI rendering (frontend has zero business logic)
- Added an explicit ReAct loop targeting 15–25 turns per run

**Why:** The assignment brief literally says "AI agent". Janani (evaluator) will ask "where's the autonomy?" A wizard with Claude in one step is not an agent.

**Rejected:** Keeping the state machine with a comment "it's still agentic because Claude decides things within each step." That framing would have failed the evaluator test.

### Decision: decoupled Vercel + Railway

**What changed:** Moved the agent backend from Vercel serverless functions to **Railway** (Node server with no timeout). Vercel now hosts only the Next.js frontend.

**Why:** Vercel Hobby's 60s `maxDuration` required a whole class of complexity: deadline tracking in every tool, chunked auto-resume via `awaiting_continuation` SSE events, checkpointing in `create_tasks_bulk`, state stitching across invocations. Moving the agent loop to Railway (unbounded duration) eliminates all of this. Saved an estimated 3–5 hours of build work. Monorepo approach: one git repo with `frontend/` (Vercel root dir) and `agent/` (Railway root dir); one push deploys both.

**Rejected:**
- Pure Vercel with chunking → too complex for 1.5 days
- Self-hosting on a VPS → more ops overhead, no benefit
- Python/FastAPI on Railway → we use TypeScript for type-sharing with the frontend
- Fly.io, Render → Railway is simplest for the 1-day deploy story

### Decision: 21 tools, not 8 (or 13, or 14)

**What changed:** The PRD had 8 coarse tools including a batch `execute_creation_pass`. Iterated through 13, 14, 20, and finally 21 tools total.

**Why:** The batch tool is anti-agent — it hides the creation work behind one Claude call. Fine-grained tools force Claude to loop, which IS the agent behavior. Each iteration added capabilities Inbaraj specifically asked for:

- **13** (initial): input, planning, validation, creation, HITL, display tools
- **14** (added journey stepper): `update_journey_state` for user-visible "where are we" state
- **20** (added promised capabilities): `remember`, `recall`, `reflect_on_failure`, `get_task`, `retry_task`, individual `create_task` (vs only bulk), `search_rocketlane_docs`
- **21 final:** dropped `search_rocketlane_docs` (replaced by embedding RL API reference directly in the system prompt — cached, no tool call needed); added `web_search` (Anthropic server tool) for runtime docs recovery when the API changes

**Why the final shift:** Inbaraj correctly pointed out that a static bundled doc cheat sheet doesn't help if Rocketlane changes their API between our build and the demo. The `web_search` tool gives runtime resilience — the agent detects an unknown field error, looks up current docs, caches the fix via `remember`, retries.

### Decision: agent-driven journey state

**What changed:** Added a `update_journey_state(steps[])` tool and a sticky `JourneyStepper` component at the top of the chat UI. The agent calls this whenever its phase of work changes.

**Why:** Inbaraj said "can't we still have states so the user knows where we are?" — valid UX concern. The tension with agent design: hardcoded state machines constrain the agent; but NO state visibility leaves users lost. Resolution: state is **reported by the agent, not enforced against it**. The agent decides when to update the stepper; the frontend just renders what it's told. This satisfies both the user's UX requirement and the agent invariants.

### Decision: explicit reflection as a tool, not just a rule

**What changed:** Added `reflect_on_failure(observation, hypothesis, next_action)` as a dedicated tool that emits a visible `ReflectionCard` in the UI.

**Why:** I originally made reflection just an implicit system prompt rule ("after failure, reflect in plain text"). Inbaraj asked "where did you include the reflection step as you suggested?" Fair point — implicit rules are invisible. Making it a dedicated tool gives users transparent metacognition: they see the agent think, not just flail. Also tests that the agent is using its reasoning rather than blindly retrying.

### Decision: explicit memory as tools (remember/recall)

**What changed:** Added `remember(key, value)` and `recall(key)` as agent tools, not just Redis helpers.

**Why:** Same reasoning as reflection. I originally made these backend-only helpers. Inbaraj pushed: "did you include everything you promised?" Making them first-class agent tools means:
- Agent can explicitly store facts ("user prefers DD/MM format", "row 1 was a summary row") without cluttering history
- User sees memory writes via a subtle toast
- Across turns, the agent can recall facts that would otherwise replay in every turn at token cost

### Decision: Custom App .zip is core, not cut-if-late

**What changed:** Moved Custom App bundle from the cut-if-late list to the core deliverables. Allocated 30 min in Tomorrow PM.

**Why:** Inbaraj said "this is critical — it shows I understand Rocketlane". Correct. The Custom App demonstrates understanding of Rocketlane's extensibility model beyond just the REST API. The .zip is a simple iframe wrapping the Vercel URL with a manifest.

### Decision: comprehensive API verification in Hour 1–2.5

**What changed:** Expanded `agent/scripts/test-rl.ts` from "create a throwaway project" to 12 specific test scenarios covering every endpoint the 21 tools depend on, including negative cases (missing required fields → 400) and rate limit probes.

**Why:** The PRD's Rocketlane API reference (§9) is reliable for creation endpoints but hand-wavy on GET endpoints (`/companies` vs `/accounts`, `/users/me` vs similar). We need to verify exact paths and response shapes before building 21 tools against them. "De-risk Hour 2 with a standalone test" is the correct principle.

### Decision: persistent sessions out of scope

**What changed:** Decided to NOT build session persistence across browser visits for the 1.5-day window. Documented as a deferred feature with a clear 4-hour add path.

**Why:** Janani running the demo once doesn't need it. Adding a "My runs" sidebar would consume Tomorrow PM time that's better spent on Custom App + BRD. The architecture supports adding it later — Redis already has `sessionId` as the primary key.

### Decision: one monorepo, two deployments

**What changed:** Single git repo `plansync/` with `frontend/` and `agent/` subdirectories. Vercel and Railway each configure a Root Directory and auto-deploy from `main`.

**Why:** Simpler than two repos. Shared types via `../shared/` relative imports. One git push, two deployments. No workspace tools (pnpm/turbo) needed for a 1.5-day build.

### Lessons learned (for future sessions)

- **User will push back on scope cuts.** Inbaraj explicitly said "please don't exclude items thinking about the deadline." Default to including promised features even if it stretches the schedule.
- **Display tools make agent capabilities visible.** Turning backend helpers (`remember`, `reflect`) into first-class agent tools with UI surfaces is a meaningful design choice, not just cosmetic.
- **State visibility is not a state machine.** The agent can *report* state via tool calls without the backend *enforcing* state transitions. This is the core insight that reconciled UX visibility with agent design.
- **Runtime recovery > comprehensive upfront docs.** No matter how thoroughly we verify the RL API Hour 1–2, the API could change. `web_search` is the safety net.
- **The PRD's PM domain knowledge + RL data model + validator checks are still gold.** We kept ~30% of the original PRD as verbatim inputs to the system prompt and tool implementations. Only the architecture, tools, and flow changed.

---

## Session 2+ — (to be filled in as sessions happen)
