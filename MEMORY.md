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

## 2026-04-15 — Session 2: All-nighter backend build (Hour 1 → 5.5–7)

### Context at start
Session 1 left us with Railway + Vercel scaffolded, fake streaming agent running on Hour 0. Plan for Session 2 was Hour 1–2.5 (RL client) through Hour 4–5.5 (real loop + tools). We ended up also completing Hour 5.5–7 (first real end-to-end run) because the build stayed on-schedule.

### Decision: verify Rocketlane API shapes BEFORE writing tools (Hour 1–2.5)
**What changed:** Wrote `agent/scripts/test-rl.ts` as a 12-scenario live-API test *before* writing any tool implementation. Ran it against the real workspace, captured actual response shapes in `agent/rl-api-contract.json`, and fixed the client + system prompt API reference to match reality.

**Why this was worth it:** Caught 4 real deviations from the PRD §9 docs that would have broken the agent at runtime:
1. `?limit=N` → actually `?pageSize=N` (wrong pagination param triggers 500)
2. `/users/me` → doesn't exist. Use `GET /users` and filter by `type: TEAM_MEMBER`
3. Response envelope is `{data: [...], pagination: {...}}` (PRD didn't document this)
4. User email field is `email` on `/users` but `emailId` on `project.owner` — inconsistent in RL's own API

**Lesson:** Always de-risk the external API before writing 20 tools against its docs. 2 hours of upfront testing saved hours of confused debugging later.

### Decision: artifact store over inlined tool results
**What changed:** Tool results are stored in `session:{id}:artifacts` (Redis HASH) as `{id, kind, preview, content}`. The `tool_result` block sent back to Claude contains only a short summary + the artifactId. Claude calls `query_artifact(id, path)` to read slices on demand.

**Why:** Without this, every turn's tool_result gets replayed in every subsequent `messages.create` call. A 62-row plan's parsed CSV (30KB) + validator report (10KB) + RL context (15KB) would explode the context window by turn 10. With the artifact store, per-turn input stays roughly constant.

**Verified in the first end-to-end run:** agent called `parse_csv` → got summary + artifactId, then used the summary directly without needing to query_artifact. The pattern works naturally for small plans; query_artifact is there when the agent needs specific slices of larger data.

### Decision: Lazy RocketlaneClient per turn, not per-tool
**What changed:** `ToolDispatchContext` exposes a `getRlClient()` function. The first tool in a turn that needs Rocketlane calls it; subsequent tools in the same turn reuse the cached instance. Each new turn gets a fresh client.

**Why:**
- Decryption of the API key from `session.meta.rlApiKeyEnc` happens once per turn, not once per tool call
- Retry/rate-limit state is shared across all tools in a turn (consistent backoff behavior)
- Per-turn freshness avoids stale state accumulating in the client over long-running sessions

**Rejected:** A single global client per session. Would have shared state across parallel requests (race conditions) and across different API keys (if the session meta changes mid-flow).

### Decision: AES-256-GCM encryption for RL API keys at rest
**What changed:** `agent/src/lib/crypto.ts` uses AES-256-GCM with a server-side `ENCRYPTION_KEY` env var (32 random bytes, base64-encoded). Format: `iv:tag:ciphertext` as one base64-joined string. User API keys are encrypted before being stored on `session.meta.rlApiKeyEnc`.

**Why kept this over "don't store" alternative:** Inbaraj explicitly rejected simplifying to "never store the key, pass it in every request" — "this is a production agent, not an MVP." The encryption story is also a stronger narrative for the BRD ("AES-256-GCM encrypted at rest" > "transmitted in every request body").

**Operational detail:** Local dev uses a different `ENCRYPTION_KEY` than production (Railway env). User generated both with `openssl rand -base64 32` in their own terminal — neither key ever touched the chat.

### Decision: `/session/:id/apikey` endpoint is production, not just a test hack
**What changed:** Added `POST /session/:id/apikey` endpoint to `agent/src/index.ts`. Accepts `{apiKey: string}`, encrypts it, stores it on `session.meta.rlApiKeyEnc`.

**Why:** Originally I was going to have the agent call `request_user_approval` to ask for the key, then handle it via `uiAction`. But that requires the key to pass through the conversation history (as a `tool_result` payload), which is messy and log-risky. A dedicated endpoint keeps the key out of the history entirely — the frontend POSTs directly to the backend, gets an {ok: true}, then resumes the agent flow via `uiAction: {toolUseId, data: "approved"}` without the key ever touching the agent's message pipeline.

**This is the production pattern too** — the frontend's ApiKeyCard (to be built Tomorrow AM) will POST the key here when the user submits.

### Lesson: system prompt must explicitly state where credentials live
**What happened:** First end-to-end test run hit a bug. The agent's flow was:
```
parse_csv → validate_plan → display_plan_for_review → [journey advance to Execute]
→ recall("rocketlane_api_key") → "No memory key"
→ request_user_approval → "Please provide your Rocketlane API key"
```
The agent INFERRED (from the memory rule in the system prompt) that the API key would be in working memory. When `recall` returned nothing, it asked the user — but we'd already pre-stored the key via `/session/:id/apikey`. The agent had no way to know the backend auto-loads it from session meta.

**Fix:** Added an explicit "Rocketlane API key handling rule" to the system prompt:
> The user's Rocketlane API key is automatically loaded from encrypted session storage when you call any Rocketlane tool. You never need to: ask via request_user_approval (unless a tool returns an auth error), check via recall (not in working memory), or pass it as an argument. Just call the tool directly.

**Lesson:** When the backend does something "magic" for the agent (auto-load credentials, auto-retry, auto-cache), the system prompt must explicitly tell the agent about the magic. Otherwise the agent reasons from general principles and invents its own flawed flow.

### Lesson: Anthropic stream events don't carry block IDs on deltas
**What happened:** When forwarding SSE events from `anthropic.messages.stream()`, I assumed each `content_block_delta` and `content_block_stop` event would carry the `id` of the block it's for. It doesn't — the `id` is only on `content_block_start`. Deltas are implicitly "for the block that most recently started."

**Fix:** `agent/src/agent/loop.ts` has a `StreamState` closure variable that tracks `currentToolUseId`. Set to the block's id on `content_block_start` (for tool_use blocks), cleared on `content_block_stop`. Deltas use `state.currentToolUseId` instead of looking for an id on the delta event itself.

**Lesson:** When building on a streaming API, always verify which fields are on each event type by reading the actual stream output. Don't infer.

### Lesson: Railway GitHub App permissions are fragile
**What happened:** User reconnected GitHub earlier in Session 1 to grant SSH collaborator access (`inbarajb91-cloud` → `inba-2299/Plansync`). That OAuth flow accidentally revoked Railway's GitHub App access to the repo. Railway kept running the old Hour 0 code; commits `e115507`, `9646527`, `f39119e` (three consecutive big pushes) all went undeployed for hours before we noticed.

**Fix:** User deleted the Railway project entirely and recreated it fresh. The new project creation triggered a fresh GitHub App OAuth, which restored permissions. Railway happened to reassign the SAME public URL (`plansync-production.up.railway.app`), so no env var updates were needed.

**Lesson:** Whenever the user reauthorizes anything GitHub-related, **verify auto-deploy is still working** by bumping a version number, pushing, and curling `/health` uptime. Don't assume Railway/Vercel integrations survive OAuth changes.

**Also:** User offered to transfer everything (GitHub repo + Vercel project) to the same account as Railway for cleaner long-term ownership. Deferred to Session 3 because it's a 20-30 min detour and we were close to 3 AM.

### Lesson: End-to-end with "pre-approved plan" userMessage works
**What happened:** The first real end-to-end test completed with **zero approval resumes**. I wrote the initial userMessage to include `"I pre-approve the plan — proceed straight through when you reach the final approval step by selecting Approve"`. The agent read that, understood it, and still called `display_plan_for_review` (showing the user what was about to happen) but skipped `request_user_approval` entirely.

**Why it worked:** The system prompt says "Final plan approval before any create_* tool — non-negotiable", but the agent applied judgment: pre-authorization from the user in the prompt counts as approval. This is desirable agentic behavior.

**Lesson:** The agent can be instructed mid-conversation to relax a default rule. That's fine for testing. For demo/Janani, let the agent follow the default rule and the user clicks through the real ApprovalPrompt.

### Decision: Stitch designs inform tomorrow's UI but don't change the architecture
**What changed:** User shared a Google Stitch design folder (4 screens: `agent_setup`, `agent_chat_upload`, `plan_validation`, `execution_monitor`) as a visual reference. They're multi-page dashboard designs; our architecture is a single-page chat-first agent UI.

**Resolution:** Steal the aesthetic (blue primary, clean cards, typography, plan tree layout, live action log, stats panel) but keep the single-page chat architecture. Skip the sidebar navigation and multi-page flow (both out of scope for single-session agent).

**New addition from Stitch:** the "Plan Integrity" side panel (confidence score + validation checkmarks) is a good pattern I didn't originally plan. Adding it as a component tomorrow morning alongside `PlanReviewTree`.

### Lesson: Formal design doc pays off mid-build
**What happened:** User invoked `/engineering:system-design` partway through the build. I stopped coding and wrote `docs/DESIGN.md` (~700 lines, 12 architectural decisions with trade-off analysis, 11 risk matrix, full data model, API contracts, control flow, etc.).

**Why this was valuable:** It forced me to articulate the "why" of every decision while still in the middle of executing them. Several pieces of the design doc (artifact store rationale, lazy RL client, blocking tool pattern) became clearer in my head by writing them out, and I caught one mistake (initially I documented the wrong tool count, which I fixed during writing).

**Lesson:** Write the design doc WHILE building, not before (premature) and not after (retrospective, low value). Mid-build is the sweet spot where decisions are fresh but execution has validated them.

---

## Session 3+ — (to be filled in as sessions happen)
