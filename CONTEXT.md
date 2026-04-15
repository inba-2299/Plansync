# CONTEXT.md — Current session state

> **Update this before the session ends.** This is where the next Claude session (or you) picks up from.

---

## Last updated

**2026-04-15, ~early afternoon — end of Session 3 (frontend UI rebuild + build fix).**

## Status

**FULL STACK IS LIVE END-TO-END.** Frontend UI matches the Google Stitch aesthetic. Backend is unchanged from Session 2 (already feature-complete). The one remaining gap tonight was the UI — that's now done.

- **Railway backend** v0.1.3: https://plansync-production.up.railway.app — 20 tools + real ReAct loop, 7-day session TTL
- **Vercel frontend** (just redeployed from commit `d524250`): https://plansync-tau.vercel.app — new chat-first UI, 13 components matching Stitch designs, SSE streaming, agent-emitted cards
- **Visual end-to-end test passed locally** (Playwright on localhost:3000 → Railway prod) earlier in the session. Screenshot at `docs/screenshots/ui-rebuild-verified.png` shows the chat, journey stepper, and `ApiKeyCard` rendering correctly with proper fonts + icons.
- **Vercel build was broken for ~30 min** mid-session (ESLint error on an unused var + custom-font warnings). Fixed in commit `d524250` by switching Inter + Manrope to `next/font/google` and removing the unused const. Local `npm run build` now passes clean.
- Inbaraj is about to click through the live Vercel URL to verify everything works in prod.

**Next session is Session 4.** Focus: 5 product decisions discussed this morning, then Custom App .zip + BRD + submit.

## Just completed (Session 3 — commits in reverse order)

1. **Vercel build fix** (commit `d524250`):
   - Removed unused `friendlyName` const from `components/ToolCallLine.tsx` (ESLint hard error)
   - Ported Inter + Manrope from `<link rel="stylesheet">` in `app/layout.tsx` to `next/font/google` (fixes `@next/next/no-page-custom-font` warnings that Vercel treats as errors)
   - Each font now has a CSS variable: `--font-inter`, `--font-manrope`
   - `tailwind.config.ts` fontFamily updated to reference those variables first with the raw name as fallback
   - Dropped the redundant Inter/Manrope `@import` from `globals.css` (next/font owns them now)
   - Material Symbols Outlined stays as `@import` in `globals.css` because it's an icon font (next/font/google doesn't handle icon fonts)
   - Verified locally: `npm run build` → `✓ Compiled successfully`, no ESLint errors, no font warnings, home route 53.9 kB / 141 kB First Load
2. **Frontend UI rebuild — 13 components + chat shell + theme + lib** (commit `c95aa5f`): 3,255 lines across 25 files. The biggest push of Session 3.
   - **Timeline renderers** (`frontend/components/`):
     - `Chat.tsx` (721 lines) — orchestrator. Holds `messages[]`, `journey`, `streaming`, `memoryToasts`, `inputValue` state. SSE event handler maps each event type to state updates. Auto-starts on mount with a greeting message. Renders header + JourneyStepper + scrollable messages + footer input. `DisplayComponentRenderer` routes `display_component` events to the right agent-emitted component.
     - `MessageBubble.tsx` — user + assistant text bubbles
     - `ReasoningBubble.tsx` — streaming reasoning bubble, auto-collapses when next `tool_use_start` fires
     - `ToolCallLine.tsx` — one-liner for `tool_use` blocks, expandable to show input + result JSON
   - **Agent-emitted components** (`frontend/components/agent-emitted/` — 10 components):
     - `JourneyStepper.tsx` — sticky top stepper, Framer Motion transitions, reads `journey_update` events
     - `ApiKeyCard.tsx` — password-masked input + "Establish Connection" button, POSTs to `/session/:id/apikey`
     - `FileUploadCard.tsx` — drag-drop + Browse Files, POSTs to Next.js `/api/upload` route which forwards to Railway
     - `ExecutionPlanCard.tsx` — renders agent's TODO list from `create_execution_plan` with status icons
     - `PlanReviewTree.tsx` — collapsible tree (phases → tasks → subtasks → milestones), dependency badges
     - `PlanIntegrityPanel.tsx` — confidence score + validation checkmarks (new — added after reviewing Stitch designs)
     - `ApprovalPrompt.tsx` — clickable option chips with special case: if the approval is an "API key" question, renders the `ApiKeyCard` instead
     - `ProgressFeed.tsx` — live progress bar + phase indicator during execution
     - `ReflectionCard.tsx` — purple-bordered metacognition card showing observation / hypothesis / next_action
     - `CompletionCard.tsx` — final stats + "View in Rocketlane" button
   - **Theme + layout** (`frontend/tailwind.config.ts`, `frontend/app/globals.css`, `frontend/app/layout.tsx`):
     - Full Material 3-style tonal palette ported from Stitch: primary `#173ce5`, secondary `#4648d4`, tertiary `#6a1edb`, surface `#faf8ff`, full tonal scale (fixed/fixed-dim/container-lowest/low/high/highest)
     - Status colors: success `#198038`, warning `#d12771`, info `#08bdba`
     - Typography: Manrope for headlines, Inter for body, system mono for code
     - Custom shadows (`card-sm` / `card` / `card-lg` / `card-xl`) using tinted blue
     - Animations: `fade-in`, `slide-up`, `pulse-slow`
     - Border radius scale: 0.25rem → 2rem
   - **Lib** (`frontend/lib/`):
     - `event-types.ts` — mirror of the agent backend's `AgentEvent` union type
     - `cn.ts` — clsx wrapper
     - `agent-client.ts` (162 lines) — `sendToAgent` SSE reader, `storeRocketlaneApiKey`, `uploadPlanFile`, `fetchJourney`
   - **Upload proxy** (`frontend/app/api/upload/route.ts`): Next.js API route forwarding multipart uploads to the Railway `/upload` endpoint. Keeps the Railway URL out of the browser.
   - **Visual end-to-end test**: ran on localhost:3000 via Playwright MCP. Confirmed fonts loaded (Manrope + Inter via `next/font`), Material Symbols rendered (not literal text), chat auto-greeted, agent streamed through `update_journey_state` → rendered stepper → emitted `request_user_approval` → `ApiKeyCard` appeared with agent's question + "Enter API Key" CTA. Screenshot saved to `docs/screenshots/ui-rebuild-verified.png`.
3. **Session TTL bump** (commit `047cbcd`, v0.1.3): `agent/src/memory/redis.ts` — `SESSION_TTL_SECONDS` bumped from 48h to 7 days (`7 * 24 * 60 * 60`). Agreed to make this admin-configurable later, but 7 days is the right default for the demo window.

## What's next (Session 4)

**Goal**: Ship everything that makes the submission complete, then fit in as many product additions as time allows.

**Deadline**: 2026-04-16 (tomorrow). Session 4 has approximately one working day.

Session 4 is organized into two buckets. Must-ship items come first because they are submission blockers — if Session 4 runs out of time, anything in the stretch bucket gets pushed to post-submission.

---

### Must-ship (submission blockers — do these first)

Subtotal: ~4.5 hours. Do these in order. Do not start stretch items until all 5 are done.

**Priority 1 — Full Shard FM Engine 62-row end-to-end run (1 hour)**
- Author the full Shard FM Engine CSV per PRD §11 lines 888–895: 62 rows, 5 levels of nesting, multiple phases, milestones, cross-phase dependencies.
- Run it end-to-end through the **live Vercel UI → live Railway backend → live Rocketlane workspace**. Not a localhost test, not a direct-POST script test — the real production path Janani will see in the demo.
- Verify in Rocketlane that the created project matches: phase count, task count, subtask nesting depth, milestone flags, dependency links.
- **This is the actual demo.** If this run fails, every other Session 4 priority is moot until it's fixed. Session 2's 4-row smoke test is not enough — it was synthetic and tiny. The 62-row scenario is the one that proves the agent handles real-world complexity.

**Priority 2 — Edge case tests (1 hour)**
These prove the agent is *agentic* (not a deterministic wizard) and they are the scenes that answer "where's the autonomy?" in the demo. Each is a scripted test the agent should handle via its built-in capabilities:
- **Missing phase dates** → agent should derive them from child task min/max without asking
- **Ambiguous DD/MM vs MM/DD dates** → agent should call `request_user_approval` with options, then `remember` the choice for the rest of the session
- **Circular dependency injection** → agent should hit `validate_plan` error, call `reflect_on_failure`, fix the plan, re-validate, succeed (this is the marquee self-correction demo)
- **Forced task creation failure** → agent should hit the error, call `reflect_on_failure`, use `retry_task` to recover
- **Deep nesting (4-5 levels)** → verify agent handles it without flattening
- **Orphan items** → agent should auto-group into "Ungrouped Tasks" phase without asking

**Priority 3 — Duplicate detection (30 min)**
Cheap, defensive, hardens the demo against an embarrassing failure mode.
- Add a rule to the system prompt: when `get_rocketlane_context` returns the existing projects list, the agent checks for a duplicate project name against the plan's proposed name. If found, the agent calls `request_user_approval` with options like "Overwrite existing", "Create new with suffix", "Abort".
- No new tool needed — purely a system prompt addition. 30 minutes of work, protects against "agent creates Plansync E2E Test #47" during the demo.

**Priority 4 — Rocketlane Custom App .zip (30 min)**
Core deliverable from the plan (§13). This is what demonstrates understanding of Rocketlane's extensibility model, not just its REST API.
- `custom-app/manifest.json` — Rocketlane Custom App manifest pointing at `https://plansync-tau.vercel.app?embed=1`
- `custom-app/index.html` — minimal iframe shell (if Rocketlane requires self-contained bundle)
- `custom-app/icon.svg`
- `custom-app/build.sh` — produces `plansync-custom-app.zip`
- Frontend: `?embed=1` handler to hide the app header when running inside Rocketlane
- Test: install the .zip in inbarajb.rocketlane.com, open Plansync tab from a project, verify full run works inside the iframe

**Priority 5 — BRD + submit (1.5 hours)**
- Write BRD (1-2 pages) pulling from `docs/DESIGN.md` + `docs/PLAN.md`
- Focus on: problem, approach, why it's agentic (21 tools + planning + memory + reflection + journey + self-correction), demo link, repo link, Custom App .zip link
- Upload BRD + demo CSV + Custom App .zip to Rocketlane Spaces
- Submit to Janani

---

### Product additions (stretch — fit in if time allows)

Subtotal: ~5.5-6.5 hours. These are the 5 items discussed this morning (minus duplicate detection which moved to must-ship because it's cheap). Pick them up only after all must-ship items are done. Any that don't fit are post-submission work — Inbaraj explicitly said "don't cut scope" earlier, but these are genuinely *additions* to the plan, not core deliverables from the original PRD.

**Priority 6 — Admin portal `/admin` (2-3 hours)**
HTTP Basic Auth protected route. This is a "show-off" feature — just for us to see sessions and tweak settings, not for end users. Scope:
- HTTP Basic Auth middleware (credentials from `ADMIN_USER` + `ADMIN_PASS` env vars)
- Model selection (swap `claude-sonnet-4-5` for another model per-session)
- Settings: session TTL, max turns, rate limit overrides
- Session list with artifact previews
- Admin URL: `https://plansync-production.up.railway.app/admin` (or separate subdomain)

**Priority 7 — Lessons feedback loop + knowledge base (2 hours)**
The agent doesn't get smarter between sessions right now. Add a background "lessons" file that the agent reads at session start and writes to on notable events:
- User corrects the agent's column mapping → agent records "user's CSVs typically have `task_name` in column 3" as a lesson
- Agent encounters an API field rename → records the fix from `web_search` as a permanent lesson (not just session-scoped `remember`)
- Admin can review + approve lessons before they get merged into the knowledge base
- New tool: `record_lesson(observation, lesson, scope: "session"|"global")`
- System prompt section: "Prior lessons learned from previous sessions" populated from the knowledge base at session start

**Priority 8 — Create or update flow (1.5 hours)**
Right now the agent only creates NEW projects. Users may want to update existing ones (add a phase to an in-flight project, sync a revised plan). Scope:
- 5 new Rocketlane update tools: `update_project`, `update_phase`, `update_task`, `delete_task`, `move_task_to_phase`
- Diff view: when duplicate detected + user chooses "Update existing", agent computes a diff between current state and new plan, renders a diff card, asks for approval before applying
- System prompt addition: "If existing project detected AND user chooses update flow, compute diff → show → ask before mutating"

---

### Time math for Session 4

- **Must-ship total: ~4.5 hours** (4h actual work + 30 min buffer for things that break)
- **Stretch total: ~5.5-6.5 hours**
- **Combined: ~10-11 hours**

One realistic working day is ~8-9 hours. That means **1-3 hours of stretch items will fit, not all of them.** The honest tradeoff: finishing must-ship first guarantees the submission is complete and the agentic story is proven. Whatever stretch items land on top are bonus — they make the "product" stronger but they're not what Janani will evaluate for "is this an agent."

**My suggested cut order if time gets tight:** Drop Priority 8 (create-or-update) first — it's the most complex and least essential for the submission narrative. Then drop Priority 7 (lessons) second — it's a fantastic post-submission feature but requires admin portal infrastructure to be valuable. Keep Priority 6 (admin portal) if at all possible because it's the most demo-able of the three.

### Carryover items from Session 3 that aren't Session 4 priorities

- **Rocketlane tracking task status updates** — 21 tasks in phase "Agent Development" still marked "To do". Should be marked "Completed" before submission for the story, but it's a 5-minute cleanup and doesn't need its own priority slot. Do it alongside Priority 5 (BRD + submit).
- **Account consolidation** (GitHub + Vercel + Railway on the same GitHub account) — deferred from Session 2. Not blocking submission. Post-submission cleanup.

## Open questions for Inbaraj (Session 4)

- **Admin portal credentials**: pick a username + password, set as env vars on Railway (`ADMIN_USER` + `ADMIN_PASS`)
- **Knowledge base storage**: file in the repo (`knowledge-base.json`) or Redis key (`session:global:lessons`)? File is simpler, Redis is more robust. Probably file for now.
- **Diff view rendering**: show as a side-by-side tree, inline diff within `PlanReviewTree`, or separate `PlanDiffCard` component?
- **Custom App iframe sandbox**: untested — does Rocketlane apply strict CSP that breaks the iframe? Test tomorrow PM before committing to the approach.
- **BRD format**: Rocketlane Spaces page (markdown-ish) or PDF upload?

## Environment state (production)

| Service | Status | URL |
|---|---|---|
| Railway backend | **LIVE v0.1.3**, all env vars set, 7-day session TTL | https://plansync-production.up.railway.app |
| Vercel frontend | **LIVE** from commit `d524250` (fresh UI, `next/font` working) | https://plansync-tau.vercel.app |
| GitHub repo | Up to date at `d524250` | https://github.com/inba-2299/Plansync |
| Rocketlane workspace | Inbarajb's Enterprise trial | https://inbarajb.rocketlane.com |
| Upstash Redis | Connected and healthy (session TTL 7d) | — |
| Anthropic API | Connected (claude-sonnet-4-5) | — |

**Railway env vars** (all set, confirmed via `/health`):
- `ANTHROPIC_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ENCRYPTION_KEY`
- `ALLOWED_ORIGIN` = `https://plansync-tau.vercel.app,http://localhost:3000,https://*.rocketlane.com`

## Environment state (local)

| Thing | Status |
|---|---|
| `/Users/inbaraj/Downloads/plansync/` | Git repo synced to `origin/main` at `d524250` |
| `agent/.env` | Filled in with real values (never committed) |
| `frontend/.env.local` | Filled in, pointing at Railway URL |
| `agent/node_modules` | Installed |
| `frontend/node_modules` | Installed |
| `frontend` local build | Passes clean (`npm run build` → compiled successfully) |

## Commit history (Session 3)

- `d524250` — Fix Vercel build: switch to next/font + drop unused var
- `c95aa5f` — Frontend UI rebuild: 13 components matching Stitch aesthetic + chat shell
- `047cbcd` — Session TTL: 48h → 7 days (v0.1.3)

Session 2 commits (for context): `f6ae9a4` → `9646527` → `d78e8a7` → `e115507` → `3d9c07d`. See the Session 2 block in the old CONTEXT.md (git log) or MEMORY.md for what each one did.

## Known issues / risks to watch in Session 4

- **The Shard FM Engine 62-row end-to-end run is now Session 4 Priority 1.** It has never been executed against the live stack. Session 2's 4-row test was synthetic and tiny. If the 62-row run surfaces a bug (context bloat, timeout, RL API rate limit, validation failure pattern we haven't seen), every other Session 4 priority is on hold until it's fixed. Budget 1 hour; reserve 30 min buffer for any fix that comes up.
- **Vercel deploy just finished** — as of this write, Inbaraj is about to click through the live UI. If anything broke in prod (CORS, SSE buffering, font loading on a different domain than localhost, `ApiKeyCard` POST flow, file upload forwarding), that needs fixing before Session 4 even starts. Feedback is pending.
- **Edge case tests are Priority 2 and they're the demo story.** The circular-dependency → `reflect_on_failure` → self-correct flow is the marquee "this is an agent" moment. If this doesn't work cleanly, the narrative weakens significantly. Test this at least twice to make sure the reflection card actually renders prominently.
- **Custom App iframe sandbox** — untested. Rocketlane may apply strict CSP that breaks the iframe. First thing to verify in Priority 4 before committing to the iframe approach; fallback is a self-contained HTML bundle.
- **Session 4 time budget is tight.** Must-ship is ~4.5 hours, stretch is ~6 hours, total is ~10-11 hours. One working day = ~8-9 hours. The 5 product additions discussed this morning will NOT all fit if the must-ship bucket runs long. See "My suggested cut order" in the "What's next" section above for the tradeoff logic.
- **Rocketlane tracking tasks still marked "To do"** — the 21 tracking tasks in phase "Agent Development" should be marked "Completed" before submission for the narrative. Folded into Priority 5 (BRD + submit) as a 5-minute cleanup.

## If the next session starts from a cold start

```bash
# 1. Orient yourself
cat CLAUDE.md       # project-specific Claude instructions
cat CONTEXT.md      # (this file — what's in flight)
cat MEMORY.md       # why things are the way they are
less docs/PLAN.md   # the original build plan
less docs/DESIGN.md # the formal system design

# 2. Sync with remote
cd /Users/inbaraj/Downloads/plansync && git pull

# 3. Verify production is alive
curl -sS https://plansync-production.up.railway.app/health
open https://plansync-tau.vercel.app    # visual check

# 4. Pick up from "What's next" above — Session 4 starts with must-ship Priority 1
#    (Full Shard FM Engine 62-row end-to-end run). This is the first thing to do —
#    every other priority depends on the demo actually working on the target dataset.
```
