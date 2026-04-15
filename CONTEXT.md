# CONTEXT.md — Current session state

> **Update this before the session ends.** This is where the next Claude session (or you) picks up from.

---

## Last updated

**2026-04-15, ~mid-afternoon — Session 4 in progress, just shipped Commit 2a.6.**

## Status

**FULL STACK IS LIVE AND VERIFIED END-TO-END ON SONNET.** First clean batch run completed successfully with Sample Plan.xlsx (21 tasks, 8 phases, 8 milestones, 12 dependencies, 3.5s execution time, $0.86/run cost). Haiku switch is next (predicted ~$0.20-0.25/run). Core architecture is stable. Remaining submission work is Custom App .zip + BRD document.

- **Railway backend** v0.1.11: https://plansync-production.up.railway.app — batch `execute_plan_creation` tool + interactive metadata rule + env-var model + 429 retry + Rocketlane URL rule + execution plan final-state rule
- **Vercel frontend** `56e353f`: https://plansync-tau.vercel.app — split UI (user left 40%, agent right 60%), pinned cards inside agent column, collapsible execution plan, 14px base font scaling, responsive fallback below 1024px
- **Model**: `ANTHROPIC_MODEL=claude-sonnet-4-5` currently set on Railway (Inbaraj is about to flip to `claude-haiku-4-5` for Session 4's next test)
- **Cost trajectory**: $3/run (pre-optimization, Sonnet) → $0.86/run (post-2e + all optimizations, Sonnet) → predicted $0.20-0.25/run (Haiku)

**Next focus**: Custom App .zip (30-45 min) + BRD document (45-60 min), then submit. Session 4 has already addressed every UX issue surfaced during testing; the remaining work is the two core deliverables and final submission.

## Just completed (Session 4 — commits in chronological order)

Session 4 is a large session — 10+ commits addressing rate limits, UX issues, token optimization, the batch execution tool, and polish.

### Phase 1: Session 3 carryover fixes (backend bugs from UI rebuild)
These three commits fixed bugs reported during Session 3's first UI run. See MEMORY.md for detail.

1. **`757d455`** — Material Symbols icon font + markdown rendering in chat bubbles. Two separate regressions from the UI rebuild: (1) `@import` in `globals.css` was silently invalidated because `next/font/google` injected its `@font-face` at byte 0 of the compiled CSS, pushing the `@import` past the required top position per CSS spec §7.1. Fix: load Material Symbols via `<link>` tag in `layout.tsx` with an `// eslint-disable-next-line @next/next/no-page-custom-font` comment. (2) Agent messages rendered raw markdown because `MessageBubble.tsx` and `ReasoningBubble.tsx` dumped `{content}` into divs with `whitespace-pre-wrap`. Fix: added `components/Markdown.tsx` using react-markdown + remark-gfm, wired into 4 sites (MessageBubble, ReasoningBubble, ReflectionCard, ApprovalPrompt context).
2. **`f2e339e`** — Fixed the Anthropic 400 `tool_use` orphan bug. The agent loop pushed `toolResults` for non-blocking tool_uses to a local array, then broke out of the for loop on `request_user_approval` WITHOUT flushing those results to history. So when the user resumed with `uiAction`, the route handler pushed only the approval's tool_result — leaving the earlier tool_uses orphaned. Fix: added `pendingToolResults: AnthropicContentBlock[] | null` field to the Session type. `loop.ts` stashes accumulated tool_results before returning on block. `index.ts`'s `/agent` route handler prepends the stashed results to the new user message containing the approval's tool_result. Clears after use.

### Phase 2: Interrupted session UX fixes
These commits arrived after Inbaraj flagged "chat input is enabled while agent is working" and "where's the upload widget":

3. **`c315c09`** — Input lockout, reasoning collapse rules, paperclip upload, workspace confirmation rule. Changes:
   - Chat input disabled when `streaming || awaitingUnanswered || uploading`, with state-aware placeholder
   - Send button swaps to spinning `progress_activity` icon while streaming
   - Reasoning bubbles use length heuristic (<200 chars = filler, auto-collapse on `tool_use_start`; else stay expanded). Always expanded on `awaiting_user` and `done`.
   - Paperclip button added to footer, left of textarea, always visible when input enabled. Opens file picker, uploads via existing `/api/upload` → Railway `/upload` path.
   - System prompt: added workspace confirmation rule (non-negotiable approval after `get_rocketlane_context`)

### Phase 3: Token optimization pass 1 + rate limit + metadata gathering

4. **`5bb0084`** — Commit 1: env-var model, 429 retry, system prompt wording + cumulative progress rule + execution plan re-call rule, v0.1.6.
   - Model switched from hardcoded `claude-sonnet-4-5` to env var `ANTHROPIC_MODEL`. No fallback — fails fast if not set.
   - 429 retry loop around `anthropic.messages.stream()`. Reads `Retry-After` header, clamps to [0, 60]s, emits `rate_limited` SSE event to frontend, up to 3 retries.
   - AgentEvent union gained `rate_limited` variant and `error.kind` field. Frontend mirrored.
   - System prompt: cumulative-totals rule for `display_progress_update` (fixes the "3/3 items / 0%" self-contradiction by requiring agent to pass overall counts, not per-phase). Upload wording rule ("project plan (CSV or Excel)"). Execution plan re-call rule.

### Phase 4: Split UI layout (the big refactor)

5. **`8416ffa`** — Commit 2a: Frontend split layout. Full rewrite of `Chat.tsx`. Two-column grid at lg breakpoint (agent left 60%, user right 40%), pinned cards full-width at top (ExecutionPlanCard, ProgressFeed). Classified every UiMessage to side: agent (reasoning, tool, plan review, reflection) or user (user messages, approvals, uploads, completion). Wide max-width (`max-w-screen-2xl` = 1536px) to fix the "A4 page" complaint. Mobile fallback: single chronological column via `lg:hidden`. Independent scroll per column.

6. **`6d5951c`** — Commit 2a.1: Column swap (user LEFT 40%, agent RIGHT 60%) per Inbaraj's feedback that "you act on left, watch agent think on right." Also fixed the file-upload `tool_use` orphan bug — when the user uploaded via the inline FileUploadCard inside an ApprovalPrompt, `handleFileUploaded` was calling `sendUserMessage` (fresh text) instead of `sendUiAction` (tool_result for the pending approval). Added `resolveUploadOrSend` helper and `messagesRef` that both upload paths funnel through.

7. **`471364c`** — Commit 2a.2: Moved pinned cards INTO the agent column (sticky top) instead of full-width at the top. My previous design was eating ~500px of viewport with the 8-step execution plan. Now it's collapsible — shows a one-line compact bar with current step, click to expand. Added `CompactableExecutionPlan` helper component.

8. **`082a53c`** — Commit 2a.3: Fixed API key card regression with Haiku. My `ApprovalPrompt` detection required both `/api.?key/i` on the question AND `enter|submit|paste|provide` on the option labels. Haiku generated different option labels ("I have my API key ready") that didn't match. Broadened detection to question-only: `isApiKeyRequest = /api.?key/i.test(question)`. Same broadening for `isFileUploadRequest`. Plus system prompt hardening with exact request_user_approval shape for the API key flow.

### Phase 5: Token optimization pass 2 + interactive metadata rule

9. **`9f40b39`** — Commit 2a.4: MAX_TOKENS raise (4096 → 16384), tool caching (`cache_control: ephemeral` on last tool schema → caches tools array after turn 1), reasoning-diet rule (prose only, no JSON in streaming text, <200 chars per bubble, compact JSON in tool inputs), journey-state-update-first rule, v0.1.8.

10. **`fed1ace`** — Commit 2a.5: Interactive metadata gathering rule. Model-agnostic. Forbids prose-dumping multiple questions; requires sequential `request_user_approval` calls with options pre-populated from workspace context (customers, team members, dates). Concrete examples in the system prompt for every field type. Also: "infer defaults FIRST, ask only for what you can't infer" rule added to the Act-autonomously section.

### Phase 6: THE BIG ONE — batch execution tool

11. **`8834db5`** — **Commit 2e: `execute_plan_creation` batch tool, v0.1.10**. The architectural reversal that fixed the rate-limit wall permanently. Instead of 15-30 fine-grained tool calls during execution, the agent now calls ONE batch tool that does the full creation sequence deterministically on the backend.

    - New tool `agent/src/tools/execute-plan-creation.ts` (~540 lines)
    - Loads plan from artifact store by `planArtifactId` (from `display_plan_for_review`)
    - Pass 1: depth-sorted item creation (phases → tasks → subtasks → milestones), populates `session.idmap`
    - Pass 2: dependency creation via `add-dependencies` endpoint
    - Emits `display_component:ProgressFeed` events throughout with cumulative percent
    - Returns structured summary: projectId + counts + list of failures for targeted retry
    - Fine-grained tools still exist as edge-case fallbacks (retry_task, create_task, add_dependency)
    - System prompt updated: "execute_plan_creation is the happy path; fine-grained tools are for failure recovery only"

    **Impact** (measured on first real run):
    - Cost: $3/run → $0.86/run on Sonnet (~70% reduction)
    - Token count: execution-phase tokens down ~10× (estimated)
    - Execution time: ~60-120s → **3.5s** for a 21-item plan
    - Rate limit wall: no longer hit
    - Zero fuss, zero intervention, clean end-to-end run

### Phase 7: Polish after the successful run

12. **`56e353f`** — Commit 2a.6: Three small fixes after Inbaraj's end-to-end Sonnet run:
    - **UI scale down to 14px base**. One-line `globals.css` change (`html { font-size: 14px; }`). Tailwind's rem-based sizing cascades — entire UI shrinks ~12.5% proportionally. Addresses "cards feel in-your-face".
    - **Rocketlane URL format rule**. Agent was constructing `https://app.rocketlane.com/project/{id}` which is wrong twice (subdomain is customer-specific like `inbarajb.rocketlane.com`, path is `/projects/` plural). New system prompt section explicitly forbids `app.rocketlane.com`, mandates the correct format, and tells agent to derive subdomain from `get_rocketlane_context` or fall back to a relative path.
    - **Execution plan final-state rule**. The pinned execution plan card was stuck showing "Step 5 of 6 / running" after a successful run because the agent jumped from `execute_plan_creation` straight to `display_completion_summary` without re-calling `create_execution_plan` with all steps done. New rule enforces strict tool call sequence at completion: `create_execution_plan` (all done) → `update_journey_state` (Execute + Complete done) → `display_completion_summary`.
    - Version bump to 0.1.11.

## Current architecture snapshot

**Tools**: 21 custom + 1 Anthropic server (`web_search`) = **22 total**. New tool this session: `execute_plan_creation`. All other tools unchanged in signature.

**Model routing**: `process.env.ANTHROPIC_MODEL` on Railway. No fallback — the loop emits a clear error and fails fast if the env var is missing. Recommended values: `claude-haiku-4-5` (cheap), `claude-sonnet-4-5` (higher capability), `claude-opus-4-5` (expensive).

**Token optimization stack** (applied cumulatively):
1. System prompt with `cache_control: ephemeral` (already present before Session 4)
2. Tools array with `cache_control: ephemeral` on last schema (new in 2a.4) — caches ~2000 tokens of tool schemas after turn 1
3. Reasoning diet rule (new in 2a.4) — prose only, no JSON, <200 chars per bubble
4. Compact JSON rule (new in 2a.4) — no indentation in tool inputs
5. Artifact store reference for plans (new in 2e via `planArtifactId` parameter) — plan JSON not re-inlined in `execute_plan_creation` input
6. Batch execution (new in 2e) — 1-2 turns instead of 15-30 for the execution phase

**Frontend layout**:
- Desktop (≥1024px): Split layout with user workspace LEFT 40%, agent workspace RIGHT 60%. Pinned cards (execution plan + progress feed) inside agent column's scroll container, sticky at top. Execution plan collapsible (default collapsed). Chat input full-width at bottom.
- Mobile (<1024px): Single chronological timeline. Pinned cards at top of scroll, rest of messages flow below.
- Base font size: 14px (scaled down from browser default 16px). Everything cascades proportionally via Tailwind rem units.

**New behavioral rules from Session 4**:
1. Workspace confirmation approval after `get_rocketlane_context` (non-negotiable)
2. Interactive metadata gathering (infer first, ask sequentially with pre-populated options)
3. `execute_plan_creation` as the happy-path execution tool (fine-grained tools are fallback only)
4. Rocketlane URL format rule (never `app.rocketlane.com`, always `{workspace}.rocketlane.com/projects/{id}`)
5. Execution plan final-state rule (update to all-done before showing completion card)
6. Reasoning text discipline (prose only, no JSON, <200 chars)
7. Journey state "update first" rule (first tool call on resume should be `update_journey_state` if state needs to advance)
8. API key flow rule (never ask user to "paste in next message" — always use `request_user_approval` which renders the secure ApiKeyCard)

## What's next (Session 4 — remaining)

**After Inbaraj's Haiku test succeeds**:

### CORE DELIVERABLE 1 — Rocketlane Custom App .zip (30-45 min)
This is one of the 6 core deliverables from the PRD (item 3). Demonstrates understanding of Rocketlane's extensibility model.

Files to create:
- `custom-app/manifest.json` — Rocketlane Custom App manifest per the spec, pointing at `https://plansync-tau.vercel.app?embed=1`
- `custom-app/index.html` — iframe shell if Rocketlane requires a self-contained bundle (otherwise just a manifest + manifest.json is enough)
- `custom-app/icon.svg` — Plansync lightning bolt icon
- `custom-app/build.sh` — zip script producing `plansync-custom-app.zip`

Frontend changes:
- Add `?embed=1` URL param handler to `Chat.tsx` that hides the Plansync header when true (Rocketlane provides its own chrome)
- Test embed: install the .zip in inbarajb.rocketlane.com, open Plansync tab from a project, verify full run works

### CORE DELIVERABLE 2 — BRD document (45-60 min)
One of the 6 core deliverables (item 4). 1-2 pages for Janani.

Pull from:
- `docs/DESIGN.md` — architectural decisions and trade-offs
- `docs/PLAN.md` — tool list and agent invariants
- `MEMORY.md` — session-by-session lessons

Content: problem, approach, why it's agentic (22 tools, interactive metadata, reflection, runtime recovery, batch execution), architecture diagram, demo link, repo link, Custom App .zip link.

### Submission (5-10 min)
- Upload BRD + Custom App .zip + Sample Plan.xlsx demo CSV to Rocketlane Spaces
- Submit to Janani

## Testing state

**Passed end-to-end on Sonnet (2026-04-15)**:
- Sample Plan.xlsx (21 tasks, 8 phases, 8 milestones, 12 dependencies)
- Batch tool `execute_plan_creation` fired cleanly
- Interactive metadata flow: workspace confirmation → project name → customer → owner → dates → plan approval
- Full project created in Rocketlane in ~3.5s execution time
- Total run cost: $0.86 (from $7.15 → $8.01 in Anthropic console)
- No rate limit wall hit
- No max_tokens errors
- No tool_use orphans

**Next test**: Haiku 4.5 on the same Sample Plan.xlsx. Expected cost ~$0.20-0.25/run. Interactive metadata rule is model-agnostic so Haiku should follow the same flow as Sonnet.

**Remaining known UX bugs (known and deliberately deferred)**:
- `ProgressFeed.tsx:29` uses `percent ?? fallback` — treats `0` as valid percent. May be masked now by the batch tool's always-correct percent. Verify during Haiku test. Fix queued as Commit 2b if still needed (one line).
- `FileUploadCard.tsx` title says "Upload your project plan" — should revert to "Drag and drop file" per Stitch design. Queued as part of Commit 2c.
- `ApprovalPrompt.tsx` file-upload branch still has a preamble wrapper with "Agent needs input" header above the FileUploadCard. Should be stripped so just the bare card renders. Queued as part of Commit 2c.
- Rate limit errors still render as plain error bubbles, not a dedicated countdown card. Queued as part of Commit 2c.
- No "Start new session" button in the generic error card. Queued as part of Commit 2c.

## Open questions for Inbaraj

- **Custom App iframe sandbox** — untested. Rocketlane may apply strict CSP that blocks iframes. Test in inbarajb.rocketlane.com before committing to the iframe approach. Fallback is a self-contained HTML bundle (bigger, more complex).
- **BRD format** — Rocketlane Spaces as a page, or PDF upload? Need to check what Spaces accepts.
- **Workspace subdomain for URL construction** — currently the agent derives it from `get_rocketlane_context` team member emails. Not bulletproof. Longer-term fix (post-submission): backend should surface the subdomain explicitly in the context response.

## Deferred items (post-submission)

These are real features we discussed and decided to defer, not bugs:

1. **Session persistence across page refreshes** — currently refresh creates a new sessionId, orphaning the 7-day Redis session. Fix requires: localStorage for sessionId, new `GET /session/:id/hydrate` endpoint on backend, Redis list storing SSE events for replay. ~2-3 hours of work. Documented in detail in Session 4 discussion.
2. **62-row Shard FM Engine test** — originally Priority 1 for Session 4. Skipped by user decision because enough tests have been done with smaller plans and we're creating many test projects.
3. **Gemini free-tier exploration** — user has free Gemini quota, wants to try it as an alternative model. Would require adding a second SDK client and a model abstraction layer.
4. **Admin portal `/admin`** — was on the Session 4 discussion list, deferred to post-submission. HTTP Basic Auth, model selection UI, session list, TTL config.
5. **Lessons feedback loop + knowledge base** — agent learns across sessions via persisted lessons. Also on the discussion list, deferred.
6. **Create-or-update flow** — 5 new Rocketlane update tools + diff view UI. Also deferred.
7. **Tailwind-merge for cn()** — would solve class conflicts in Markdown component but not needed with the current inheritance pattern.
8. **Commit 2b + 2c** — UX polish. 2b may already be masked by 2e. 2c is ~30 min of polish. Low priority unless Inbaraj flags during Haiku test.

## Environment state (production)

| Service | Status | URL |
|---|---|---|
| Railway backend | **LIVE v0.1.11**, ANTHROPIC_MODEL set to sonnet (user will flip to haiku) | https://plansync-production.up.railway.app |
| Vercel frontend | **LIVE** at `56e353f` with scaled UI + split layout | https://plansync-tau.vercel.app |
| GitHub repo | Up to date at `56e353f` | https://github.com/inba-2299/Plansync |
| Rocketlane workspace | Inbarajb's Enterprise trial, multiple test projects exist | https://inbarajb.rocketlane.com |
| Upstash Redis | Connected and healthy (session TTL 7d) | — |
| Anthropic API | Connected, Sonnet 4.5 (will flip to Haiku) | — |

**Railway env vars** (all set):
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` — Sonnet 4.5 currently, Inbaraj will flip to Haiku 4.5
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `ENCRYPTION_KEY`
- `ALLOWED_ORIGIN` = `https://plansync-tau.vercel.app,http://localhost:3000,https://*.rocketlane.com`

## Environment state (local)

| Thing | Status |
|---|---|
| `/Users/inbaraj/Downloads/plansync/` | Git repo synced to `origin/main` at `56e353f` |
| `agent/.env` | Must include `ANTHROPIC_MODEL` (user was reminded to set it locally) |
| `frontend/.env.local` | Pointing at Railway URL |
| `agent/node_modules`, `frontend/node_modules` | Installed |
| Frontend `npm run build` | Clean |
| Agent `npm run build` | Clean |

## Session 4 commit history (most recent first)

- `56e353f` — Commit 2a.6: UI scale 14px + Rocketlane URL rule + execution plan final-state rule (v0.1.11)
- `8834db5` — Commit 2e: execute_plan_creation batch tool (v0.1.10) ← **the big one**
- `fed1ace` — Commit 2a.5: Interactive metadata gathering rule (v0.1.9)
- `9f40b39` — Commit 2a.4: MAX_TOKENS=16384 + tool caching + reasoning diet + journey-first rule (v0.1.8)
- `082a53c` — Commit 2a.3: API key card regression fix + system prompt hardening (v0.1.7)
- `471364c` — Commit 2a.2: pinned cards moved into agent column + collapsible execution plan
- `6d5951c` — Commit 2a.1: column swap (user LEFT 40%, agent RIGHT 60%) + file upload tool_result fix
- `8416ffa` — Commit 2a: frontend split UI + responsive + wide layout + message routing
- `5bb0084` — Commit 1: env-var model + 429 retry + cumulative progress rule (v0.1.6)
- `c315c09` — Input lockout + reasoning collapse rules + paperclip upload + workspace confirmation
- `f2e339e` — Tool_use orphan fix (pendingToolResults) (v0.1.4)
- `757d455` — Material Symbols font + markdown rendering in chat bubbles

Plus doc commits and smaller touches in between.

## Known issues / risks for submission

- **Haiku test unverified at time of writing**. Inbaraj is about to flip the env var and test. If Haiku fumbles the interactive metadata flow (which would be a capability regression), fallback is one env var flip back to Sonnet — zero code change.
- **Custom App iframe sandbox untested**. Rocketlane CSP could block the iframe. Plan B is a self-contained HTML bundle with the app inlined (bigger, but avoids the iframe).
- **BRD format decision pending** (Spaces page vs PDF vs GitHub markdown). 
- **No real session hydration**. Refresh = new session. Inbaraj explicitly deferred this, but Janani may notice. Worth mentioning in the BRD as "documented post-submission work".
- **Model env var must be set on Railway**. Already set. If removed, the agent fails at first request with a clear error. Not a silent failure.

## If the next session starts from a cold start

```bash
# 1. Orient yourself
cat CLAUDE.md       # project-specific Claude instructions
cat CONTEXT.md      # (this file — where we are now)
cat MEMORY.md       # why things are the way they are
less docs/PLAN.md   # the canonical build plan
less docs/DESIGN.md # formal system design (12+ architectural decisions)

# 2. Sync with remote
cd /Users/inbaraj/Downloads/plansync && git pull

# 3. Verify production is alive
curl -sS https://plansync-production.up.railway.app/health
open https://plansync-tau.vercel.app    # visual check

# 4. Check what's left in CONTEXT.md → "What's next"
#    Core deliverables: Custom App .zip, BRD document
```
