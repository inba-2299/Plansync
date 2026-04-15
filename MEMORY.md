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

## Session 4+ — (to be filled in as sessions happen)
