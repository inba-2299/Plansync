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

## 2026-04-15 — Session 3: Frontend UI rebuild + Vercel build fix

### Context at start
Session 2 ended at 3 AM with the backend feature-complete and verified end-to-end against production (real Rocketlane project created by the agent with zero approval resumes). The only thing left was the frontend — the Vercel deployment was still the Hour 0 throwaway (purple button, basic chat). Session 3's job: rebuild the UI to match the Google Stitch aesthetic, then move onto the remaining priorities (Custom App, BRD, submit).

Mid-session the user raised 5 product decisions for discussion:
1. Lessons-learned feedback loop + admin approval of lessons before they merge
2. Admin portal `/admin` (Basic Auth protected)
3. Session history across visits (without Supabase)
4. Duplicate project detection
5. Create-or-update project flow (not just create-new)

All 5 deferred to Session 4 by agreement; Session 3 stayed focused on the UI.

### Decision: skip Supabase, stay with Upstash Redis for Session 3
**What changed:** Confirmed we're not moving to Supabase for session persistence or admin features. Stay on Upstash Redis.

**Why:** Supabase adds a whole persistence layer (Postgres + auth + Storage), a new env var surface, and a migration cost that doesn't fit the 1-day remaining window. Upstash already works, sessions already persist for 7 days, and the admin portal can run directly off Redis keys (`session:*:*`). We explicitly rejected moving to Supabase for this submission.

**Rejected:** Switching to Supabase "because it's more production-grade." The 7-day Redis TTL is enough for the demo window, and post-submission migration to Supabase (if we keep this as a real product) is a 1-2 day rework — not a submission blocker.

### Decision: 7-day session TTL, admin-configurable later
**What changed:** `agent/src/memory/redis.ts` — `SESSION_TTL_SECONDS` bumped from 48h to 7 days. Shipped as v0.1.3 (commit `047cbcd`).

**Why:** Janani may run the demo multiple times over a few days. 48h is too tight — a Friday demo wouldn't survive to Monday. 7 days is the right default; anything longer risks Redis bloat and creates data governance questions.

**Admin-configurable later:** The admin portal (Session 4) will expose TTL as a setting so it's not hardcoded forever.

**Rejected:** 30 days (Redis bloat, no reason), permanent (data governance, memory costs), per-session TTL at creation time (overengineered for a 1-day feature).

### Decision: Admin portal is a "show-off" feature, not user-facing
**What changed:** Agreed that `/admin` is just for us (Inbaraj + evaluator) to see what's going on. Not advertised to end users. HTTP Basic Auth is sufficient — no need for full OAuth, per-user accounts, role-based access, etc.

**Why:** The point is to demonstrate operational visibility, not to ship a multi-tenant admin product. Basic Auth is 10 lines of middleware; OAuth + a user table is a day of work. For a take-home, Basic Auth also makes the narrative cleaner: "single admin credential, stored as env vars, used for internal debugging."

**Scope for Session 4 admin:**
- Model selection (swap Sonnet for Haiku/Opus per session)
- Settings: TTL, max turns, rate limits
- Session list with artifact previews
- Lessons-learned review queue (approve before merge into knowledge base)

**Deferred from Session 4 admin:**
- Multi-user auth
- Audit log
- Exportable session archives
- Billing / usage metrics

### Decision: chat-first single-page UI, NOT the multi-page Stitch layout
**What changed:** Google Stitch generated 4 separate dashboard screens (`agent_setup`, `agent_chat_upload`, `plan_validation`, `execution_monitor`). I kept the visual language (blue primary, clean cards, typography, plan tree layout, stats panels) but refused to port the multi-page structure.

**Why:** The agent architecture is fundamentally single-page: one long conversation with streaming reasoning, inline tool calls, and agent-emitted cards appearing in the chat timeline. A multi-page wizard would contradict the agent invariants (frontend has zero business logic, state is reported by the agent not enforced against it). Porting Stitch's page flow would have required a frontend state machine — exactly what we deleted from the PRD in Session 1.

**Resolution:** Use Stitch as a visual reference for colors, components, typography, and individual card designs (`PlanReviewTree`, `PlanIntegrityPanel`, `ProgressFeed`). Don't use it for layout or navigation. Everything lives in `Chat.tsx` and appears inline.

**New addition from Stitch:** `PlanIntegrityPanel` — the side card with confidence score + validation checkmarks. Didn't exist in the original plan; added during this rebuild because it makes validation state visible and matches the agent's `validate_plan` tool output naturally.

### Decision: `ApprovalPrompt` special-cases the API key question
**What changed:** When the agent calls `request_user_approval` with a question that includes "API key" (or the context payload indicates it's an API-key ask), the frontend renders the `ApiKeyCard` instead of the generic approval chips. The `ApiKeyCard` POSTs to `/session/:id/apikey` directly (doesn't go through the agent message pipeline) and then resumes the agent with a clean `uiAction`.

**Why:** We already decided in Session 2 that the API key must never pass through the conversation history. The frontend already has a dedicated endpoint for storing it. The `ApprovalPrompt` would otherwise pass the key as a string into the next agent turn as a `tool_result` content — that's exactly what we're trying to avoid.

**Implementation:** The `ApprovalPrompt` component has an `isApiKeyQuestion` check on the question text. If true, render `ApiKeyCard` instead. Both paths call back to `Chat.tsx` via the same `onApprove(uiAction)` callback.

**Lesson:** The agent-reports-state pattern doesn't mean the frontend is completely dumb. The frontend can pattern-match on tool call shapes to provide better UX for specific cases, as long as it never overrides the agent's *decisions* — just its *rendering*. Classifying the approval type as "generic option chips" vs "API key card" is rendering.

### Lesson: Material Symbols requires BOTH the @import AND a CSS class
**What happened:** On the first frontend rebuild, Material Symbols icons rendered as literal text — `"bolt"`, `"verified_user"`, `"arrow_upward"` — instead of the glyphs. Two separate bugs compounded:

1. `@import url(...)` for the fonts was placed AFTER `@tailwind base; @tailwind components; @tailwind utilities;` in `globals.css`. CSS spec: `@import` must come before any other rules in the file. Tailwind's directives count as "other rules," so the browser silently ignored the imports. Fix: moved `@import` to the top of the file.

2. Even with the font loaded, Material Symbols needs a specific CSS class on every element that uses it. The class declares `font-family: 'Material Symbols Outlined'` + `font-feature-settings: 'liga'` + ligature rendering. Without this, the browser treats `<span>bolt</span>` as the literal text "bolt" (font is loaded but not applied). Fix: added the full `.material-symbols-outlined` class definition to `globals.css`.

**Lesson:** Icon fonts have TWO requirements: (1) the font is loaded, (2) an explicit CSS class tells the browser to USE it as an icon font with ligature rendering. Miss either one and you get literal text. Test the first icon render early before building 10 components that all depend on it.

### Lesson: Vercel's ESLint config is stricter than `next dev`
**What happened:** The UI built fine locally with `npm run dev`. Pushed to Vercel — build failed with:
```
./components/ToolCallLine.tsx
31:9  Error: 'friendlyName' is assigned a value but never used.
./app/layout.tsx
24:9  Warning: Custom fonts not added in `pages/_document.js` will only load for a single page.
28:9  Warning: Custom fonts not added in `pages/_document.js` will only load for a single page.
```

The unused var was a leftover from an earlier refactor. Local dev silently ignored it because `next dev` runs TypeScript in loose mode; Vercel's build runs `next lint` with the full ESLint config, which treats unused vars as errors.

The font warnings were about `<link rel="stylesheet">` tags I'd added in `layout.tsx` as a backup path for the Material Symbols fix. Next.js wants you to use `next/font/google` instead so it can self-host and preload fonts. Vercel's build promotes these warnings to errors.

**Fix:**
1. Removed the unused `friendlyName` const.
2. Ported Inter + Manrope to `next/font/google` with CSS variables (`--font-inter`, `--font-manrope`).
3. Updated `tailwind.config.ts` fontFamily to reference the variables first.
4. Dropped the redundant Inter/Manrope `@import` from `globals.css` (next/font owns them now).
5. Material Symbols stays as `@import` — next/font doesn't handle icon fonts.

**Lesson 1:** Always run `npm run build` locally before pushing. `next dev` and `next build` have different strictness levels. 30 seconds of local build would have saved a broken Vercel deploy.

**Lesson 2:** `next/font/google` is the Next.js-approved way to load Google Fonts. `<link>` tags trigger a lint warning that Vercel treats as an error. The correct pattern:
```tsx
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
<html className={inter.variable}>
```

**Lesson 3:** `next/font/google` does NOT work for icon fonts (Material Symbols, Font Awesome, etc.). Icon fonts must go through `@import` in CSS — and must be placed before `@tailwind` directives.

### Lesson: Playwright MCP is the right tool for visual end-to-end verification
**What happened:** After the UI rebuild, I ran a visual end-to-end test using the Playwright MCP. Opened the page in a real Chromium browser on localhost:3000 pointing at the Railway backend, watched the agent stream through its flow, took a screenshot.

**Why this was valuable:** This caught the Material Symbols literal-text bug AND the fonts-not-loading bug in a single test pass — both invisible to a text-based "does the page load" check. A screenshot is worth 1000 tool calls when the failure mode is "visually broken."

**Lesson:** When rebuilding UI components, always take a screenshot after the first full render. Don't trust that "it compiles and loads" means it looks right.

### Lesson: The CSS @import ordering rule bit us twice
**What happened:** First bug was @import after @tailwind. I fixed that. Then when porting to `next/font/google`, I left the old Inter/Manrope `@import` in `globals.css` as "belt and braces." Vercel's build then flagged the next/font warnings, I fixed those, but the redundant `@import` was still there loading fonts a second time from Google's CDN. The build worked fine but it was wasteful.

**Fix:** Dropped the redundant `@import`. Only Material Symbols remains (because next/font can't handle it).

**Lesson:** When you switch font loading strategies, remove the old path completely. Don't layer them. "Belt and braces" for CSS imports is a code smell — one of them is dead code, and the dead code costs a network round-trip on every page load.

### Lesson: CORS allow-list must include localhost explicitly
**What happened:** Mid-rebuild, the frontend on localhost:3000 got "Failed to fetch" when calling the Railway backend. CORS error. The Railway `ALLOWED_ORIGIN` env var only had `https://plansync-tau.vercel.app,https://*.rocketlane.com` — no localhost.

**Why it broke this session:** In Session 2, user had recreated the Railway project from scratch after a GitHub App permissions drama. The env vars were all re-added, but localhost was missed.

**Fix:** User updated `ALLOWED_ORIGIN` to `https://plansync-tau.vercel.app,http://localhost:3000,https://*.rocketlane.com` and redeployed.

**Lesson:** Always include both `http://localhost:3000` AND the production URL in `ALLOWED_ORIGIN` for any dev-plus-prod workflow. Better: split into `ALLOWED_ORIGIN` (prod) + `DEV_ORIGIN` (localhost), or just comma-list them. Either way, document it in the env setup checklist.

### Decision: 5 product items deferred to Session 4 (not cut)
**What changed:** User raised 5 items for discussion mid-session. We discussed each, agreed to defer all 5 to Session 4 but kept them on the plan (no scope cuts):

1. **Lessons-learned feedback loop** — agent gets smarter across sessions. Admin reviews lessons before they merge into the global knowledge base. Scope: new `record_lesson` tool + `knowledge-base.json` file + admin review UI. ~2 hours.
2. **Admin portal `/admin`** — Basic Auth, model selection, settings, session list, lessons review. ~2-3 hours.
3. **Session history across visits** — keep deferred (was already deferred in Session 1). 7-day TTL is enough for the demo window. Post-submission rework.
4. **Duplicate project detection** — system prompt addition + check in `get_rocketlane_context` output. ~30 min.
5. **Create-or-update flow** — 5 new Rocketlane update tools (`update_project`, `update_phase`, `update_task`, `delete_task`, `move_task_to_phase`) + diff view. ~1.5 hours.

Combined: ~6 hours of Session 4 work. Plus Custom App (30 min) + BRD + submit (~1.5 hours) = ~8 hours total for Session 4. Tight but feasible with the deadline 2026-04-16.

**Why defer instead of cut:** User was explicit in Session 1 — "please don't exclude items thinking about the deadline." These are all real product decisions, not nice-to-haves. The backend is done, so Session 4 can focus entirely on product additions + shipping.

### Lesson: `@import` in globals.css is silently killed by `next/font/google` — use `<link>` for icon fonts

**What happened (Session 3, late in the session):** After Inbaraj ran the UI on the live Vercel deployment, every Material Symbols icon rendered as its ligature name — "bolt", "psychology", "check_circle", "progress_activity", etc. — instead of the glyph. The UI looked like raw markup. Playwright inspection on the deployed page showed:
1. `document.fonts` iterable had NO `Material Symbols Outlined` entry at all
2. `document.styleSheets` had exactly ONE stylesheet, and it was NOT from `fonts.googleapis.com`
3. `hasGoogleFontsImport: false`
4. The `.material-symbols-outlined` class WAS applied, `font-family: "Material Symbols Outlined"` WAS set, `font-feature-settings: 'liga'` WAS set — but there was no `@font-face` declaration to back it

**Root cause:** The `@import url('https://fonts.googleapis.com/...')` in `globals.css` was being invalidated per CSS spec §7.1. Byte-offset analysis of the deployed CSS bundle showed:
- Byte **0**: first `@font-face` declaration (from next/font/google's Inter output)
- Bytes **0 → 9711**: dozens more `@font-face` declarations (Inter + Manrope variants, all from next/font)
- Byte **9712**: our `@import url("https://fonts.googleapis.com/...")`

CSS spec requires `@import` rules to precede ALL other at-rules and style rules. Our import was at byte 9712, well past thousands of bytes of @font-face rules. The browser silently invalidates late imports per spec. Google Fonts stylesheet never loaded. Font-family existed but had no font file behind it. Browser fell back to Inter, which has no glyphs for "bolt" or "psychology", so it rendered the ligature names as literal text.

**The gotcha**: `next/font/google` injects its `@font-face` declarations at the **top** of the final compiled CSS bundle. Our `globals.css` `@import` ends up AFTER them no matter where we write it in the source file — because next/font's output is stitched into the compiled CSS before our file's content. CSS spec then kills the import.

**Why this was invisible locally:** the Playwright screenshot from earlier in Session 3 showed icons working on localhost. Probably a combination of browser cache from an earlier dev session and slightly different build output. The bug only surfaced on a clean browser session against a production build.

**The fix**: Remove `@import` from `globals.css` entirely. Load Material Symbols via `<link rel="stylesheet">` in `app/layout.tsx` with an `// eslint-disable-next-line @next/next/no-page-custom-font` comment. This bypasses the CSS build pipeline — the browser fetches it as an HTML element request, independent of any CSS compilation. The ESLint rule is designed to catch regular text fonts that should be using `next/font/google`; it doesn't apply to icon fonts (which next/font cannot handle), so the disable is legitimate.

**Also: add preconnect hints** for faster font loading:
```tsx
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
```

**Verification (done via Playwright on the live Vercel page after the fix):**
- `document.fonts` now contains `{family: "Material Symbols Outlined", status: "loaded", weight: "100 700"}`
- `document.styleSheets` now includes the Google Fonts URL
- An element with class `material-symbols-outlined` measures `widthPx: 24, heightPx: 24, fontSize: 24px` → width÷fontSize = 1.0, which is the geometric signature of a Material Symbols glyph (glyphs are designed to fit a 1em × 1em square). If the font had failed, the literal 4-char text "bolt" rendered in Inter would measure roughly 0.4× the font-size width.

**Rule for future sessions**: If you ever need to load an external stylesheet that you can't route through `next/font`, use `<link>` in `layout.tsx` with the eslint-disable comment, NOT `@import` in globals.css. The @import path only works reliably in Next.js App Router if you have NO `next/font` calls anywhere in the app — the moment you use `next/font/google`, it takes ownership of the top of the CSS bundle and nothing else can sit there.

### Lesson: Agent messages are markdown, so chat renderers need a markdown component

**What happened:** In the same live Vercel run, the user saw messages like:
```
- **3 team members** available as project owners
- **7 customer companies** available
- **6 active projects** (I'll check for duplicates when you upload)

**Now, please upload your CSV file** with your project plan...
```
rendered with the literal asterisks visible instead of bold text and proper list bullets. `MessageBubble.tsx` and `ReasoningBubble.tsx` were both just rendering `{content}` as a plain string with `whitespace-pre-wrap`. `ReflectionCard` and `ApprovalPrompt`'s `context` field had the same pattern.

**Why this was missed in Session 2 testing:** the 4-row end-to-end test ran against a script endpoint (POST directly to `/agent`), not through the UI. There were no actual rendered chat bubbles to inspect. The first end-to-end run through the UI was Session 3, which is also when it showed up.

**The fix**: Added `components/Markdown.tsx` — a shared react-markdown renderer with remark-gfm for GitHub-flavored markdown (bold, italic, lists, inline code, code blocks, links, tables, blockquotes, headings). Tight element styling designed for chat bubbles. The outer wrapper intentionally has NO font-size or color so parent containers control that without class conflicts. Wired into:
- `MessageBubble.tsx` (agent role only — user messages stay plain text)
- `ReasoningBubble.tsx` (only when `complete === true` — during streaming we keep plain text so partial markdown tokens like an unclosed `**` don't reflow the bubble on every delta)
- `ReflectionCard.tsx` (observation, hypothesis, next_action fields)
- `ApprovalPrompt.tsx` (context field)

**Bundle cost**: react-markdown + remark-gfm is ~40 kB. Home route grew from 53.9 kB → 97 kB, First Load from 141 kB → 184 kB. Acceptable for the legibility improvement.

**Rule for future sessions**: Any place in the UI that renders agent-produced text is probably rendering markdown, and needs to go through `components/Markdown.tsx`. Don't drop raw content into a `<div>` with `whitespace-pre-wrap` — that was the fast-write pattern we used initially and it was wrong.

### Lesson: Mid-build doc pauses cost less than I thought
**What happened:** I started writing this doc update mid-way through Session 3, paused because of the Vercel build error, fixed the build, then resumed. The context I'd built up for the doc writing was still intact because the fix was self-contained (unused var + font loader).

**Lesson:** Doc updates don't need to be "everything at the very end." If the session has natural pauses (waiting on a deploy, waiting on the user to test something), use those pauses to start doc updates. You lose less context than you'd think.

---

## 2026-04-15 — Session 4: UX fixes + token optimization + batch execution tool

### Context at start
Session 3 ended with the UI shipped and end-to-end verified on Sonnet 4.5 via a 4-row script test. Session 4 started with Inbaraj running the real UI on the live Vercel deployment for the first time and immediately hitting a wave of UX and performance issues:

1. Material Symbols icons rendering as literal text (e.g. "bolt" instead of the lightning glyph) because `@import` in `globals.css` was being invalidated by `next/font/google`'s injected `@font-face` rules (CSS spec §7.1 — `@import` must precede all other rules)
2. Agent messages rendered raw markdown (`**bold**` visible as asterisks)
3. Anthropic 400 `tool_use` orphan errors when the agent batched multiple tool_uses in one turn ending with `request_user_approval`
4. Chat input enabled while agent was working (misleading UX)
5. Reasoning bubbles auto-collapsing too aggressively, hiding content users needed to read
6. Upload button not visible / file upload pattern unclear
7. Execution plan cards stacking (agent re-emits on each stage)
8. Progress bar self-contradictory (showing "3/3 items / 0% / Phase complete" simultaneously)
9. Cost of ~$3/run on Sonnet with 30K TPM rate limit being hit on larger plans
10. UI "restricted to A4 page" due to `max-w-3xl` (768px) constraint

The session turned into a long sequence of commits fixing each issue systematically, with multiple user interruptions as new bugs surfaced during testing. The biggest architectural change was Commit 2e — adding a batch `execute_plan_creation` tool that reversed my Session 1 decision to break everything into fine-grained primitives.

### Decision: switch the hardcoded model constant to a Railway env var
**What changed:** `loop.ts` no longer has `const MODEL = 'claude-sonnet-4-5'`. Instead, it reads `process.env.ANTHROPIC_MODEL` at request time. NO fallback — if the env var isn't set, the loop emits a clear error telling the user exactly which values to use and fails fast.

**Why:** Inbaraj pushed back on my original pattern of env-var-with-hardcoded-fallback. His point: "it's a product decision, not a ceiling." Env vars make sense for things you'd want to flip without a code deploy (model, API keys, URLs). A hardcoded fallback defeats the purpose — you lose visibility into what's running. A fail-fast with a clear error is better than a silent fallback to a model you didn't pick.

**Lesson:** Don't pattern-match env var shapes without thinking about why. MAX_TOKENS I hardcoded (there's one right answer). MODEL I made an env var with no fallback (product decision, must be explicit).

### Decision: 429 retry with Retry-After handling in the agent loop
**What changed:** Wrapped the `anthropic.messages.stream()` call in a retry loop. On `rate_limit_error`:
1. Parse `Retry-After` header from the SDK's error response
2. Clamp to [0, 60] seconds
3. Emit a new `rate_limited` SSE event to the frontend (so users see a countdown)
4. Sleep
5. Retry up to 3 times
6. On 4th failure, emit `error` event with `kind: 'rate_limit'` and give up

Added new variant to `AgentEvent` union: `{ type: 'rate_limited', retryInSeconds, attempt, maxAttempts }`. And `error` events now carry an optional `kind: 'rate_limit' | 'auth' | 'generic'`.

**Why:** Anthropic's tier-1 TPM limits are narrow (30K input TPM on Sonnet) and even optimized runs can brush against them on large plans. Without automatic retry, every rate limit kills a run. With retry, most rate limits are recovered transparently.

**Limitation** (that we later hit and had to solve differently): retry buys time for the rolling window to clear, but if per-turn input is ~25K tokens and you send multiple turns within 60 seconds, you saturate the window again immediately. Retry is a band-aid. The real fix is reducing per-turn input tokens — which led to the batch tool decision later.

### Decision: Chat input disabled while agent is working (Option A over B/C)
**What changed:** `Chat.tsx` computes `inputDisabled = streaming || uploading || hasUnansweredApproval`. Textarea, send button, and paperclip all go disabled when this is true. State-aware placeholder swaps between "Agent is working — please wait…", "Please use the options above to continue…", "Uploading file…", and the default "Message Plansync agent…". Send button swaps to a spinning `progress_activity` icon during streaming.

**Why:** Inbaraj raised the deeper question of interrupt semantics — "if I type while the agent is working, does it stop? What if it's mid-Rocketlane call?" I proposed three options:
- **A (what we shipped)**: no interrupt, lock input during work
- **B**: soft interrupt at tool boundaries (user's message queues until the current tool call completes)
- **C**: hard interrupt mid-tool (risks orphaning Rocketlane state)

Option A is the same pattern Claude.ai and ChatGPT use. Simple, safe, zero risk of partial Rocketlane state. Option B is the "right" long-term answer but requires AbortController wiring through the ReAct loop and tool-boundary checkpoints — too much for the submission window. Option C is dangerous.

**Rejected:** C outright. B deferred to post-submission work.

### Decision: reasoning bubble collapse uses a length heuristic, not auto-collapse for everything
**What changed:** When a `tool_use_start` event fires, the current reasoning bubble:
- Collapses ONLY if `content.trim().length < 200` (filler like "I'll call X next")
- Stays expanded otherwise (meaningful content like the workspace details message after `get_rocketlane_context`)
- On `awaiting_user` or `done`, ALWAYS stays expanded (end-of-turn content users need to read)

**Why:** My first implementation auto-collapsed everything, which hid the post-`get_rocketlane_context` workspace summary that Inbaraj wanted to read before confirming "is this the right workspace?". He pushed back: "not for everything — only that are relevant". Length is a crude but reliable proxy for "is this meaningful content?".

**Lesson:** Collapse heuristics should err on the side of visibility, not cleanness. A short filler bubble collapsing is fine; a meaningful bubble with content hiding itself is a bug from the user's perspective.

### Decision: Split UI layout with user workspace LEFT, agent workspace RIGHT
**What changed:** `Chat.tsx` rewritten to use a two-column `grid-cols-[2fr_3fr]` at the `lg` breakpoint (1024px). User workspace on the left (40%), agent workspace on the right (60%), thin vertical rule between them. Below 1024px, collapses to a single chronological column via `lg:hidden`. Chat input full-width at the bottom. Pinned cards (execution plan + progress feed) moved INSIDE the agent column as sticky-top.

Messages classified by side:
- **Agent side**: reasoning, tool_call, PlanReviewTree, ReflectionCard
- **User side**: user messages, approvals, ApiKeyCard, FileUploadCard, CompletionCard
- **Pinned**: ExecutionPlanCard, ProgressFeed (inside agent column, sticky top)

Execution plan is collapsible (default collapsed) via a one-line compact bar showing "Step N of M / <current step>". Click to expand. Prevents 8-step plans from eating 500px of vertical space.

**Why:** Single-column timeline felt "restricted to A4 page" and "overwhelming" — a 20-turn run piled cards on top of each other. Split gives structure: agent output flows down the right, user interactions flow down the left, status panels pin to the top of the agent side. Matches the mental model "you act on the left, watch the agent think on the right." Inbaraj specifically requested this over my hybrid sidebar proposal.

**The column swap**: I initially shipped agent LEFT + user RIGHT. Inbaraj requested the swap. Cost: one grid value change plus swapping the two `<section>` elements. Took 5 minutes.

**The pinned panel mistake**: First version had pinned cards full-width at the top of the whole page, which ate 500px of vertical space with an 8-step plan and squashed both workspaces into unusable slivers. Inbaraj called me out: "what happened to your design you suggested — in the agent space where agent stuff and status space". I had literally drawn the correct design in an earlier message and then deviated from it when I looked at the Figma Execution Monitor screen. Fix: moved pinned cards into the agent column's scroll container as sticky-top, made execution plan collapsible.

**Lesson:** When you've already proposed a design that the user liked, don't deviate from it just because a reference image (Figma, Stitch, Dribbble) shows something different. The reference was for a DIFFERENT screen type in a DIFFERENT context.

### Decision: broaden the API key detection in ApprovalPrompt to question-only
**What changed:** `isApiKeyRequest` and `isFileUploadRequest` in `ApprovalPrompt.tsx` now match on question text alone, not on option labels. Previously both required `question matches /api\s*key/i` AND `at least one option label matches /enter|submit|paste|provide/i`.

**Why:** Haiku 4.5 generates different option labels than Sonnet 4.5 for the same question. Sonnet emits `[{label: "Enter API key"}]` which matched my option regex. Haiku emits `[{label: "I have my API key ready"}, {label: "I need to find my API key first"}]` which didn't match. Result: when we switched to Haiku, the ApiKeyCard stopped rendering — it fell through to default chip options. Worse, Haiku then told the user "paste the API key as your next message" which would have routed it through conversation history and exposed it to Anthropic — a security regression.

Fix: match on question alone. If the question mentions "API key" at all, always render the secure card. Option labels become irrelevant because the card bypasses them entirely. Same broadening applied to file upload detection.

**Lesson:** UI detection should be SEMANTIC (what is the question about?), not LEXICAL (does any option label match a regex?). The options are decorative when the card is going to replace them anyway.

**Plus system prompt hardening**: added an explicit "Rocketlane API key handling rule" section with the exact `request_user_approval` shape for the API key flow (question + single option "Enter API key" + context that mentions security), plus four non-negotiable rules:
1. ONE option, labeled "Enter API key"
2. NEVER ask the user to paste the key as a text message
3. DO NOT mention typing/pasting into the chat input
4. After user submits, validate via `get_rocketlane_context`; do NOT re-ask

Both the frontend broadening and the system prompt hardening are in the same commit — belt-and-braces.

### Decision: tool caching via `cache_control` on the last tool schema
**What changed:** `loop.ts` now rebuilds the tools array every turn with `cache_control: { type: 'ephemeral' }` on the last tool. Anthropic's prompt caching cascades backwards from any cache_control marker — marking the last tool caches the entire tools array as a single cache entry. Combined with the existing `cache_control` on system prompt, this means after turn 1 we pay ~10% of input cost on (system + tools) instead of 100%.

**Why:** Tools array is ~2000 tokens uncached. After 15 turns that's 30K tokens of duplicated tool schema input, which ate into the already-tight TPM budget. Caching saves ~1800 input tokens per turn after turn 1 (2000 × 0.9 reduction).

**Implementation detail:** Rebuilt every turn via `TOOL_SCHEMAS.map((t, i) => i === last ? {...t, cache_control: ephemeral} : t)` so cache_control always lands on the same anchor (last element) regardless of how TOOL_SCHEMAS is mutated. Cast to `any` because the SDK's ToolParam type in `@anthropic-ai/sdk ^0.30` doesn't expose cache_control yet — the API supports it, the types lag.

**Lesson:** When the API supports a feature the SDK types don't know about, cast-to-any is acceptable as long as you wrap it in a comment explaining why. Don't lose the optimization just because the type system is stale.

### Decision: reasoning text discipline — PROSE ONLY, NEVER JSON
**What changed:** New system prompt section forbidding the agent from dumping JSON, code blocks, arrays of objects, trees, or tables in streaming reasoning text. Rules:
1. Prose only, no code fences
2. Short (1-3 sentences, under 200 chars per bubble)
3. Structured data goes in tool call INPUTS, not reasoning
4. Emit compact JSON in tool inputs (no indentation)
5. Tool inputs >2000 tokens: split across calls if possible

**Why:** Inbaraj reported the agent was dumping a 1500+ token JSON plan in its streaming reasoning text before calling the tool that would have accepted the same data as input. This triggered max_tokens errors (we hit the 4096 output ceiling on plan-generation turns) AND burned output tokens on content the user couldn't read anyway (huge JSON blob in a code block). The root cause was Sonnet's / Haiku's tendency to "show work" verbosely.

**Plus** related: raised `MAX_TOKENS` from 4096 to 16384. Hardcoded, not an env var — one right answer ("high enough to never hit it"). We're billed for actual tokens generated, not the ceiling, so raising it has zero cost impact unless output is actually that long.

**Lesson:** LLMs will default to verbose "show your work" reasoning if not explicitly told not to. For tool-calling agents, the tool call inputs ARE the work — duplicating them in reasoning wastes output budget and triggers max_tokens errors.

### Decision: journey state rule — UPDATE FIRST, then act
**What changed:** New system prompt section titled "Journey state rule — UPDATE FIRST, then act". Requires the agent to call `update_journey_state` as the FIRST tool call on every resume (not every turn — specifically on resumes after a tool_result that advances the flow). Names the anti-pattern: "agent runs parse_csv → validate_plan → display_plan_for_review while the stepper still says Upload. User thinks 'why is the agent validating when we're still uploading?'"

**Why:** Inbaraj observed that the stepper lagged behind actual work. My earlier rule said "call `update_journey_state` at these transitions" but didn't specify WHEN within the turn. The agent was calling it AFTER doing other work, so there was a window where the stepper was stale.

**Lesson:** Rules about tool-call ORDER are different from rules about tool-call OCCURRENCE. Specifying "at these transitions" isn't enough if you don't also specify "before any other tool on that turn."

### Decision: interactive metadata gathering rule (model-agnostic)
**What changed:** New system prompt section: "Interactive metadata gathering rule — infer first, ask one-at-a-time with options". Two parts:

**Part 1 — infer first:** Table mapping each metadata field to an inference source (project name from filename, customer from workspace if only one, owner from current user, start/end dates from min/max task dates, etc.). Rule: act autonomously on high-confidence inferences; only ask for what you genuinely can't infer.

**Part 2 — ask one at a time:** When asking is unavoidable, use SEQUENTIAL `request_user_approval` calls, ONE field per call, with options PRE-POPULATED from workspace context. Never prose-dump a list of questions expecting typed answers. Concrete examples in the prompt for every field type: customer (options = workspace list + "Create new"), owner (options = team members), dates (options = "Use suggested: min → max" + "Enter custom"), project name (options = "Use: derived" + "Enter custom"), existing project match (create_new / update_existing / cancel).

**Why:** Inbaraj reported that after switching to Haiku, the metadata gathering flow regressed from "a chain of small approval cards with clickable options" (Sonnet's default behavior) to "one approval with a single 'I'll provide details now' chip, then a prose dump of all questions expecting typed answers" (Haiku's default behavior). Haiku was using `request_user_approval` as a yes/no confirmation only, not as an interactive form.

His key insight: "This rule should apply regardless of model." Sonnet was doing the right thing by default; Haiku wasn't. The rule belongs in the system prompt so both models follow the same pattern. Sonnet gets belt-and-braces explicitness; Haiku gets marching orders.

**Lesson:** When two models differ in default behavior for a pattern that matters to the UX, don't patch one model — encode the pattern in the system prompt explicitly so any model follows it. Model-swap-ability is a feature.

### Decision: `execute_plan_creation` batch tool — the architectural reversal

**This is the most important decision of Session 4**, and it reversed the Session 1 decision to break `execute_creation_pass` into fine-grained primitives.

**What changed:** Added a new tool `execute_plan_creation(planArtifactId, projectName, ownerEmail, customerName, startDate, dueDate, description?)`. It takes the plan via artifactId (from `display_plan_for_review`'s stored artifact), does the full creation sequence on the backend in one call:
1. Load plan from artifact store
2. Pass 1: depth-sorted creation of phases → tasks → subtasks → milestones, populating `session.idmap`
3. Pass 2: dependency creation via `add-dependencies`, walking `plan.items[].dependsOn`
4. Emits `display_component:ProgressFeed` events throughout with cumulative percent
5. Returns structured summary with counts + list of failures

**Why this exists (the full story):**

Session 1 explicitly rejected a batch `execute_creation_pass` tool from the PRD because it "hides the agent work behind one Claude call" and "isn't agentic." We broke it into 5 fine-grained tools: `create_rocketlane_project`, `create_phase`, `create_task`, `create_tasks_bulk`, `add_dependency`. The agent walked the sequence turn-by-turn.

In practice this caused:
- 15-30 turns per execution phase (one per API call equivalent)
- Each turn sent full history to Anthropic
- Per-turn input: ~20-30K tokens
- Total execution-phase input: 300K-600K tokens
- Rate limit wall hit regularly on Sonnet tier 1 (30K TPM)
- Cost ~$3/run on Sonnet

Inbaraj's key insight: **"if creating the project is just a well-structured tool that the AI calls — then will it reduce the usage?"** Yes. During execution, the LLM has zero actual thinking to do — once the plan is validated and approved, the sequence of API calls is deterministic. Making it walk turn-by-turn was conflating "agentic" with "fine-grained."

**The architectural reconciliation:**
- Fine-grained tools still exist for: manual override, failure recovery, surgical updates
- Batch tool is the happy path for the "parse → validate → approve → execute" flow
- Agent DECIDES when to use batch vs fine-grained (batch by default, fine-grained on failures) — THAT's the agentic part, not the mechanical walking
- Parse, validation, interactive approval, reflection, error recovery — these remain agentic (the LLM's actual value-add)

**Measured impact (first run after shipping 2e):**
- Cost: $3/run → $0.86/run on Sonnet (71% reduction)
- Execution time: 60-120s → 3.5s (35× faster)
- Turns during execution: 15-30 → 1-2
- Rate limit wall: no longer hit
- End-to-end success: clean, first try

**Lesson — the big one:** "Agentic" means the LLM makes decisions, not that the LLM walks every mechanical step. In my Session 1 redesign I got this wrong and over-broke the execution into fine-grained turns. Inbaraj correctly intuited that this was overspending. The fix was to restore a batch tool while keeping the fine-grained tools as fallback. Both coexist. The decision of "which to use" is where the agentic intelligence lives.

**Meta-lesson:** When the user says "this shouldn't cost this much" and you can justify the cost architecturally but not practically, the architecture is wrong. User intuition about cost is often a proxy for "you've misplaced the complexity boundary between deterministic and creative work."

### Decision: TOON format — rejected
**What changed:** Nothing (not implemented).

**Why considered:** TOON is a more token-efficient alternative to JSON for tabular data. Could save ~50% on plan-data tokens in tool inputs.

**Why rejected:** 
- Claude isn't natively trained on TOON — would need ~500 tokens of teaching examples in the system prompt (cached, but still)
- No npm library for TOON parsing; we'd need to write one
- Every tool accepting plan data would need to parse both JSON and TOON
- Claude occasionally emitting slightly-wrong TOON (missing column, wrong order) would cause parser errors and waste more tokens in reflection loops than we'd save
- Non-standard format; introduces a new failure surface
- 3-4 hours of work vs 60-90 minutes for the batch tool which solves the same cost problem more directly

**Lesson:** When you're tempted to introduce a novel serialization format to save tokens, consider whether the existing architecture is making you pay for the tokens in the first place. We were paying for plan tokens because we re-sent them in every execution turn. The batch tool eliminated the re-sending. TOON wouldn't have.

### Decision: Rocketlane URL format rule
**What changed:** New system prompt section telling the agent that Rocketlane URLs are always `https://{workspaceSubdomain}.rocketlane.com/projects/{projectId}`, NEVER `https://app.rocketlane.com/...`, and that the path is `/projects/` (plural) not `/project/`. Agent should derive the workspace subdomain from `get_rocketlane_context` or return a relative path if unknown.

**Why:** The agent was constructing `https://app.rocketlane.com/project/5000000074831` in its completion card — wrong twice. `app.rocketlane.com` doesn't exist; each customer has their own subdomain. And the path is `/projects/` plural. Inbaraj caught it during his successful Sonnet run.

**Lesson:** LLMs will improvise plausible-looking URLs from other SaaS products' patterns if you don't tell them the specific format. "app.<brand>.com" is a common pattern (Slack, Notion, Linear) so Claude defaults to it even when Rocketlane uses a different pattern.

### Decision: execution plan must be re-called with all steps done at completion
**What changed:** New system prompt section "Execution plan completion rule — update to final state before completion summary". After `execute_plan_creation` returns successfully, the agent MUST perform this exact tool call sequence before ending the turn:
1. `create_execution_plan` with ALL steps marked `status: 'done'`
2. `update_journey_state` with Execute + Complete both `done`
3. `display_completion_summary` with final stats

Explicit "Do not skip step 1" directive with the anti-pattern named.

**Why:** Inbaraj reported the pinned execution plan card was stuck on "Step 5 of 6 / Execute creation / running" even though the CompletionCard showed the run was done. Root cause: agent jumped from `execute_plan_creation` straight to `display_completion_summary` without re-calling `create_execution_plan`. My earlier rule said "re-call create_execution_plan as progress updates" but I was vague about *when* — I didn't explicitly say "at completion."

**Lesson:** Rules about tool call sequences need to be explicit about every transition point, not just the start. "Call X at each stage" leaves "what about the last stage?" ambiguous. Be explicit about completion.

### Decision: UI base font-size scale to 14px
**What changed:** `html { font-size: 14px; }` in `globals.css`. Browser default is 16px.

**Why:** Inbaraj said "cards feel too in-your-face" and asked if we could scale the entire UI back. Because Tailwind uses `rem` units for everything (font sizes, padding, margin, gap, width, height), changing the base font-size cascades through the entire design system. One line, ~12.5% smaller everything, no per-component tweaks.

**Alternative rejected:** `transform: scale(0.875)` on the root. Transforms work but mess with layout calculations (getBoundingClientRect returns the scaled values, not the intended values). Font-size scaling is cleaner.

**Lesson:** When you want to scale an entire Tailwind app, use the base font-size. One line beats hundreds of per-component tweaks.

### Lesson: Discuss before implementing (I kept forgetting this)
**What happened:** Multiple times in Session 4, Inbaraj explicitly said "let's discuss and then you change anything" and I either jumped ahead immediately or partially implemented before finishing the discussion. He had to pull me up at least three times.

**Why it kept happening:** I was optimizing for "fewer round trips" (get through more work per user interaction) at the cost of alignment. The user correctly prioritizes alignment over throughput — getting the right thing built is faster than building the wrong thing and fixing it.

**Rule for future sessions:** When the user says "discuss first" or "think about this and let me know", STOP coding until they respond. Even if I have a small edit in flight, leave it uncommitted and wait. The in-flight edit won't rot; the user's trust will.

**Also:** When proposing a plan with multiple options, list them explicitly and ask "which one?" or "approve?". Don't present a plan and then silently execute it — make the approval step explicit.

### Lesson: Test the full flow before declaring "done"
**What happened:** I kept shipping code that worked on the initial screen but broke downstream. Examples:
- Commit 2a.3 fixed the API key card but I shipped without testing the full flow — didn't catch that the journey stepper lag was still a bug
- Commit 2a fixed the split layout but I didn't test execution-phase rendering, so the "pinned panels eat 500px" issue only came out in Inbaraj's screenshot
- Multiple times I said "verified with `npm run build`" as if type-checking was the same as behavioral verification

**Rule for future sessions:** "Done" means "I clicked through the full flow on the live deployment with a real scenario." Not "I ran npm run build." Not "I wrote the code." Not "I think it should work."

**Concrete testing checklist for UI changes:**
1. Build locally (`npm run build`)
2. Push
3. Wait for deploy
4. Hard-refresh, fresh session, walk the FULL flow (API key → workspace confirm → upload → validate → approve → execute → complete)
5. Screenshot any unexpected state
6. THEN declare done

### Lesson: Rate limit retries buy time, they don't fix token usage
**What happened:** Commit 1's 429 retry loop was supposed to make rate limits "just work." It didn't. On a run that was already over the 30K TPM budget, retries just hit the same wall 60 seconds later. The only fix was reducing per-turn input tokens — which meant the batch tool.

**Lesson:** Retry is a band-aid for TRANSIENT rate limits (burst traffic, single spike). It doesn't help with SUSTAINED overages (structural overuse of input tokens). Diagnose which class you're in before reaching for retry as the solution.

### Lesson: Haiku is not a drop-in replacement for Sonnet
**What happened:** I recommended switching from Sonnet to Haiku for cost reasons. Haiku's default behavior differed in several subtle ways:
- Used different option labels in `request_user_approval` (broke my frontend detection)
- Prose-dumped metadata questions instead of asking sequentially (broke UX)
- Didn't infer defaults as aggressively (asked for things it should have known)
- Generated different reasoning text patterns

Each difference required a system prompt patch. Net effect: the system prompt grew by ~1000 tokens of model-agnostic rules that Sonnet didn't technically need but Haiku did.

**Lesson:** Smaller models need more explicit prompting. Patterns that "just work" on larger models need to be written out for smaller ones. Make prompts model-agnostic from day 1 if you expect to swap models — the explicit version doesn't hurt the larger model.

### Session 4 tool count change
- Start: 20 custom + 1 server (`web_search`) = 21
- End: 21 custom + 1 server = **22 total**
- New: `execute_plan_creation` (batch execution tool)
- All other tools unchanged in signature

### Decision: application crash from missing `dependsOn` — frontend harden + error boundary

**What happened.** Mid-Haiku run, after a successful clean refresh, the production UI (https://plansync-tau.vercel.app) blanket-crashed with "Application error: a client-side exception has occurred (see the browser console for more information)". No stack trace visible in the user's browser (production Next.js build has minified errors). I couldn't pull Vercel or Railway logs (neither CLI was authenticated locally), so I diagnosed by code reading.

**Root cause.** `frontend/components/agent-emitted/PlanReviewTree.tsx` line 237 did:
```tsx
{(item.startDate || item.dueDate || item.dependsOn.length > 0) && (...)}
```
This assumes `item.dependsOn` is always an array. But the backend's validator, display-plan-for-review tool, and execute-plan-creation tool all defensively wrap `dependsOn` reads with `Array.isArray(i.dependsOn)` — proving that in practice, `dependsOn` can be missing. Haiku is especially lax about emitting empty arrays for optional fields (it often just omits them entirely).

When a plan item lacks `dependsOn` AND has no `startDate` AND no `dueDate`, the short-circuit evaluation falls through to `undefined.length` → uncaught TypeError. Since there was no React error boundary anywhere in the tree, the crash propagated up to the app root and blanket-errored. The user saw a blank page with no recovery path.

**Why I trusted the diagnosis without a stack trace.** The pattern of "worked after one refresh, then suddenly crashed" is the signature of a render-time type error on some subset of data: something got emitted that triggered the latent bug. I grepped the frontend for every `.length` access on fields that could be undefined and PlanReviewTree's `dependsOn.length` was the only unchecked one on a field that the backend itself treats as optional. Confirmation: the backend code in 3 separate files explicitly null-checks `dependsOn` before reading it — that's dispositive evidence the frontend's unchecked access is a bug.

**The fix (4 parts, commit `e8981d9`).**
1. **Normalize at the boundary** — `PlanReviewTree` now runs every raw plan item through a `normalizePlanItem()` function that coerces each field to a safe default (strings get fallbacks, numbers get `null`, arrays get `[]`, enums get the most permissive variant). Downstream renderers (the `PlanNode` component) no longer need to null-check fields individually because the shape is guaranteed at the map-building boundary.
2. **Optional-chain the remaining unconditional reads** — the two `item.dependsOn.length` accesses inside `PlanNode` are now `item.dependsOn?.length ?? 0`. Belt-and-suspenders after normalization.
3. **Harden `Chat.tsx` awaiting_user handler** — `loop.ts` emits `payload: payload ?? null`, meaning `event.payload` can legally be `null`. The old handler did `if (event.payload) { ... event.payload.question ... }`, which is fine for null but not for `{}` or malformed objects. New handler destructures with type guards: `typeof rawPayload.question === 'string'`, `Array.isArray(rawPayload.options)`, and filters options to only well-shaped entries.
4. **Fix CompletionCard URL fallback** — the old `finalUrl` calculation fell back to `https://app.rocketlane.com/projects/${projectId}` when only `projectId` was provided, but `app.rocketlane.com` isn't a real tenant (Rocketlane URLs are always workspace-scoped). System prompt already instructs the agent to emit fully-qualified `projectUrl`; the frontend now hides the "View in Rocketlane" button entirely when no URL is provided instead of rendering a dead link.

**The second line of defense — `ErrorBoundary`.** Even after hardening PlanReviewTree, a render crash in any OTHER agent-emitted card (or any future agent-emitted card) would still white-page the app. So I added `frontend/components/ErrorBoundary.tsx` — a class component (required for React's error boundary API — function components have no equivalent) wrapping Chat in `app/page.tsx`. On any thrown render error, it catches via `getDerivedStateFromError` and renders a recovery card with:
- The error message (not the full stack — avoid leaking internals)
- A "Reset view" button (calls `setState({ error: null })` to retry the subtree)
- A "Full reload" button (nuclear option — `window.location.reload()`)

This doesn't fix bugs, but it converts "white page of death" into "recoverable error card with retry", which is the difference between a broken app and a robust one.

**Lesson: "backend defensively handles X" is a strong signal the frontend needs to too.** The backend had three separate `Array.isArray(i.dependsOn)` defensive checks. That pattern is a tell — it means the author encountered `dependsOn` being missing in practice and decided to handle it. If the backend handles it, the frontend must too. When you find defensive checks in one part of the stack, grep for the same field in the OTHER part of the stack and make sure the defense is mirrored. Type systems help — but if the type declares `dependsOn: string[]` and the runtime reality is `dependsOn?: string[]`, the type is a lie and the type system can't save you.

**Lesson: always add an error boundary before shipping an agent-driven UI.** An agent-driven UI is by definition dynamic — the agent decides what cards to render, what props to pass, what shapes to emit. The UI cannot enforce a schema on what the agent produces without becoming brittle. Given that reality, a top-level error boundary is mandatory, not optional. Without one, ANY render-time bug in ANY agent-emitted component blanket-crashes the app with no recovery path. This should have been in the v0.1.0 codebase. It's now in.

**Lesson: next/font adds CSS compilation order constraints that @import can't satisfy.** Already captured earlier in Session 4 (icons via `<link>` instead of `@import`), but reiterating here as a pattern — next/font is invasive. If you use it, assume every other CSS mechanism that relies on ordering (`@import`, CSS layers, some bundler features) may be affected. `<link rel="stylesheet">` in the HTML `<head>` bypasses the issue because it's not part of the compiled CSS at all.

---

## Session 5+ — (to be filled in as sessions happen)
