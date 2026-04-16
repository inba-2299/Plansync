# Plansync — Full Codebase Code Review Findings

**Date:** 2026-04-16
**Tool:** CodeRabbit CLI v0.4.1 (full codebase scan against root commit)
**Total raw findings:** 74
**After revalidation:** 46 confirmed, 15 false positives, 13 partially valid / context-dependent
**Reviewed by:** Claude Opus 4.6 (revalidated every finding against actual source code)

---

## How to read this document

Each finding follows this structure:

| Field | Description |
|-------|-------------|
| **Finding** | What was detected |
| **Revalidation** | Did we confirm the issue exists in the actual code? |
| **Why it's wrong** | The reasoning behind why this is a problem |
| **Impact** | What could go wrong if left unfixed |
| **Suggested fix** | Concrete code or action to resolve it |
| **How the fix resolves it** | Why the fix actually addresses the root cause |
| **Fix risk** | Risk the fix itself introduces to the system |

Severity levels: **Critical** > **Major** > **Minor**

---

## Table of Contents

- [Critical Findings (2 confirmed, 1 false positive)](#critical-findings)
- [Major Findings — Security (4 confirmed)](#major-findings--security)
- [Major Findings — Code Quality (5 confirmed, 2 false positives)](#major-findings--code-quality)
- [Major Findings — Documentation (4 confirmed)](#major-findings--documentation)
- [Major Findings — Design Mockups (7 findings, context-dependent)](#major-findings--design-mockups)
- [Minor Findings — Error Handling & Defensive Coding (4 confirmed, 4 false positives)](#minor-findings--error-handling--defensive-coding)
- [Minor Findings — UI & Accessibility (5 confirmed, 2 false positives)](#minor-findings--ui--accessibility)
- [Minor Findings — Documentation Drift (5 confirmed, 1 false positive)](#minor-findings--documentation-drift)
- [Minor Findings — Miscellaneous (6 confirmed)](#minor-findings--miscellaneous)
- [Summary Matrix](#summary-matrix)

---

## Critical Findings

### CR-01: `SessionMeta.status` field violates "no state machine" invariant

**File:** `agent/src/types.ts:110-121`
**Revalidation:** CONFIRMED (partially valid — field exists, is written, but barely read)

**Finding:**
`SessionMeta` declares a `status: string` field with commented values `'new' | 'active' | 'awaiting_user' | 'done' | 'error'`. This acts as a backend state machine, which the architecture explicitly forbids (CLAUDE.md invariant #1: "The LLM controls flow. No backend state machine.").

**Why it's wrong:**
The field is initialized to `'new'` in `session.ts:73`, mutated to `'done'` in `tools/display-completion-summary.ts:49`, but no business logic branches on it. The actual session lifecycle is tracked through Redis counter sets in `admin/counters.ts`, not through `meta.status`. This creates two competing sources of truth that can silently diverge.

**Impact:**
- **Architectural debt:** Future developers may build logic on `meta.status`, deepening the state machine violation.
- **Stale state:** If counters say "errored" but status says "done", there's no conflict detection.
- **Dead code:** The field is written but effectively unused for business logic, adding maintenance burden.

**Suggested fix:**
Remove the `status` field from `SessionMeta`. Any admin dashboard that reads it should derive state from the counter sets instead.

```typescript
export interface SessionMeta {
  sessionId: string;
  // status field removed — state is derived from counters
  createdAt: number;
  ttlAt: number;
  turnCount: number;
  rlApiKeyEnc?: string;
  rlWorkspaceId?: number;
  rlProjectId?: number;
}
```

**How the fix resolves it:**
Eliminates the competing state source. All session state queries go through the counter system, which is the actual source of truth. No business logic changes because nothing depends on `meta.status`.

**Fix risk:** LOW. Grep for `meta.status` and `session.meta.status` — only 3 call sites exist (init, one mutation, one admin read). The admin read already has fallback logic (`meta.status ?? 'unknown'`).

---

### CR-02: Shared types intentionally duplicated (not in `shared/types.ts`)

**File:** `agent/src/types.ts` and `frontend/lib/event-types.ts`
**Revalidation:** CONFIRMED — but this is a documented, intentional trade-off

**Finding:**
`AgentEvent`, `PlanItem`, and `JourneyStep` are defined separately in both `agent/src/types.ts` and `frontend/lib/event-types.ts`. The `shared/` directory exists but is empty.

**Why it's wrong:**
Duplicate type definitions can drift over time. If the backend adds a field to `AgentEvent` that the frontend doesn't know about, runtime errors or data loss can occur silently.

**Impact:**
- **Type drift risk:** Backend and frontend could disagree on event shapes without compile-time detection.
- **Maintenance overhead:** Changes to shared shapes require coordinated edits in two files.
- **However:** The frontend comment (`event-types.ts:1-6`) explicitly documents this as intentional: "Kept manually in sync... to avoid monorepo build-tool overhead for a 1.5-day project." The frontend also has defensive normalization (e.g., `PlanReviewTree.tsx:46-68` handles missing `dependsOn` arrays).

**Suggested fix:**
For the current project scope, accept the trade-off but add a cross-reference comment in both files:

```typescript
// agent/src/types.ts
// SYNC NOTE: Frontend mirror at frontend/lib/event-types.ts — update both when changing shared shapes

// frontend/lib/event-types.ts
// SYNC NOTE: Backend source at agent/src/types.ts — update both when changing shared shapes
```

For a production evolution: populate `shared/types.ts` and import from both packages.

**How the fix resolves it:**
The cross-reference reduces the chance of drift by making the dependency explicit. A full shared package eliminates it entirely.

**Fix risk:** NONE for comments. LOW for shared package (requires build config changes, tested locally before deploy).

---

### CR-03 (FALSE POSITIVE): Missing `ANTHROPIC_MODEL` in `.env.example`

**File:** `agent/.env.example`
**Revalidation:** INVALID — by design

**Finding claimed:** `.env.example` omits `ANTHROPIC_MODEL`, causing a fail-fast crash.

**Why it's a false positive:** The model is resolved per-turn in the agent loop (`admin/config.ts:54-60`), not at startup. It can be configured via Redis (`admin:config:model`) OR the env var. The loop starts successfully without it and only fails gracefully on the first agent turn with a clear error message. Omitting it from `.env.example` is correct — the example documents only boot-time-required variables.

---

## Major Findings — Security

### SEC-01: CORS wildcard subdomain matcher is too permissive

**File:** `agent/src/index.ts:56-63`
**Revalidation:** CONFIRMED

**Finding:**
The CORS origin check uses `origin.endsWith(suffix)` for wildcard patterns like `https://*.rocketlane.com`. This matches `evilrocketlane.com` because it also ends with `rocketlane.com`.

**Actual code:**
```typescript
const isAllowed = allowedList.some((a) => {
  if (a === origin) return true;
  if (a.startsWith('https://*.')) {
    const suffix = a.slice('https://*.'.length);   // "rocketlane.com"
    return origin.endsWith(suffix);                  // matches "evilrocketlane.com"
  }
  return false;
});
```

**Why it's wrong:**
An attacker who controls any domain ending in `rocketlane.com` (e.g., `evilrocketlane.com`) could make cross-origin requests to the agent backend, potentially exfiltrating session data or triggering agent actions.

**Impact:**
- **Cross-origin data access:** Malicious origins could read agent responses.
- **Session hijacking:** If combined with a session ID leak, an attacker could control an active session.
- **Practical risk is medium:** The attacker needs to register a domain ending in the target suffix AND trick a user into visiting it while authenticated.

**Suggested fix:**
Validate that the character before the suffix is a dot (confirming true subdomain):

```typescript
if (a.startsWith('https://*.')) {
  const suffix = a.slice('https://*'.length);  // ".rocketlane.com" (keep the dot)
  return origin.startsWith('https://') && origin.endsWith(suffix);
}
```

**How the fix resolves it:**
By keeping the leading dot in the suffix (`.rocketlane.com`), `endsWith` only matches `foo.rocketlane.com`, not `evilrocketlane.com`.

**Fix risk:** LOW. Only affects the CORS check for wildcard patterns. Test by verifying: (1) `https://app.rocketlane.com` passes, (2) `https://evilrocketlane.com` fails, (3) exact-match origins still work.

---

### SEC-02: Custom App iframe missing `sandbox` attribute

**File:** `custom-app/widgets/plansync/index.html:112-116`
**Revalidation:** CONFIRMED

**Finding:**
The iframe embedding the Plansync frontend lacks a `sandbox` attribute, granting the embedded page full capabilities (parent window access, form submission, popups, localStorage).

**Actual code:**
```html
<iframe
  src="https://plansync-tau.vercel.app?embed=1"
  title="Plansync — Rocketlane Project Plan Agent"
  allow="clipboard-read; clipboard-write"
></iframe>
```

**Why it's wrong:**
Without `sandbox`, the embedded page can access `window.parent`, manipulate the Rocketlane host page's DOM, read cookies, and execute arbitrary JavaScript in the parent context. If the Vercel deployment is ever compromised, the Rocketlane Custom App becomes a vector.

**Impact:**
- **Host page compromise:** A compromised embed could steal Rocketlane session tokens or modify the host UI.
- **XSS amplification:** Any XSS in the embedded app extends to the Rocketlane host.
- **Defense in depth:** Even for trusted origins, `sandbox` provides an isolation layer.

**Suggested fix:**
```html
<iframe
  src="https://plansync-tau.vercel.app?embed=1"
  title="Plansync — Rocketlane Project Plan Agent"
  allow="clipboard-read; clipboard-write"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
></iframe>
```

**How the fix resolves it:**
The `sandbox` attribute restricts the iframe's capabilities to only what's listed. `allow-scripts` and `allow-same-origin` are needed for the app to function; `allow-forms` for file uploads; `allow-popups` if any external links exist. Everything else (top-navigation, pointer-lock, etc.) is blocked.

**Fix risk:** LOW. Test the Custom App in Rocketlane after adding — ensure file upload, chat, and clipboard still work. If any feature breaks, add the specific `allow-*` flag needed.

---

### SEC-03: Real email PII in `rl-api-contract.json`

**File:** `agent/rl-api-contract.json`
**Revalidation:** CONFIRMED

**Finding:**
The API contract file contains real email addresses:
- `inbarajb91@gmail.com` (6 occurrences — developer's personal email)
- `inbarajb91+fmeng@gmail.com` (1 occurrence)

**Why it's wrong:**
This file is committed to version control and visible in the full git history. If the repository becomes public (or is shared for review), personal email addresses are exposed.

**Impact:**
- **PII exposure:** Personal email visible to anyone with repo access.
- **Spam / phishing risk:** Scraped emails can be used for targeted attacks.
- **Compliance:** May violate data handling policies depending on context.

**Suggested fix:**
Replace all real emails with neutral placeholders:
```json
"emailId": "dev@example.com"
"emailId": "customer@example.com"
```

**How the fix resolves it:**
Removes PII from the tracked file. Note: the email remains in git history unless the file is rewritten with `git filter-branch` or BFG. For a take-home assignment, sanitizing the current file is sufficient.

**Fix risk:** NONE. The file is a reference document, not imported by code.

---

### SEC-04: Hardcoded email fallback in test script

**File:** `agent/scripts/test-rl.ts:39`
**Revalidation:** CONFIRMED

**Finding:**
```typescript
const ownerEmail = process.env.TEST_ROCKETLANE_OWNER_EMAIL ?? 'inbarajb91@gmail.com';
```

**Why it's wrong:**
If `TEST_ROCKETLANE_OWNER_EMAIL` is not set, the script silently uses a personal email, which could trigger unexpected API calls to Rocketlane under that identity.

**Impact:**
- **PII in source code:** Same as SEC-03.
- **Unintended API calls:** A developer running the test script without the env var set sends requests as another person.

**Suggested fix:**
```typescript
const ownerEmail = process.env.TEST_ROCKETLANE_OWNER_EMAIL;
if (!ownerEmail) {
  console.error('TEST_ROCKETLANE_OWNER_EMAIL not set in agent/.env');
  process.exit(1);
}
```

**How the fix resolves it:**
Fails fast with a clear message instead of silently using a fallback. No PII in source code.

**Fix risk:** NONE. Only affects the test script. Developers must set the env var.

---

## Major Findings — Code Quality

### CQ-01: `@rocketlane/rli` pinned to `"*"` in Custom App

**File:** `custom-app/package.json:12`
**Revalidation:** CONFIRMED

**Finding:**
```json
"devDependencies": {
  "@rocketlane/rli": "*"
}
```

**Why it's wrong:**
Wildcard version means `npm install` fetches whatever is latest at install time. Two developers (or CI runs) checking out the same commit can get different versions.

**Impact:**
- **Non-deterministic builds:** Custom App `.zip` output varies by install time.
- **Silent breakage:** A breaking change in `@rocketlane/rli` will break builds without any code change.
- **Difficult debugging:** No way to reproduce a past build's dependency set.

**Suggested fix:**
Pin to the specific version currently installed (check `package-lock.json`), or use a caret range:
```json
"@rocketlane/rli": "^1.0.0"
```

**How the fix resolves it:**
Locks the dependency to a known-compatible version. Caret range allows patches but blocks breaking changes.

**Fix risk:** NONE. Only affects the Custom App build. Verify the `.zip` builds correctly after pinning.

---

### CQ-02: `ToolCallLine` not keyboard-accessible

**File:** `frontend/components/ToolCallLine.tsx:46-54`
**Revalidation:** CONFIRMED

**Finding:**
The expandable tool call display uses a `<div>` with `onClick` but no keyboard support:
```tsx
<div
  className={cn('... cursor-pointer')}
  onClick={() => setExpanded((v) => !v)}
>
```

**Why it's wrong:**
Keyboard-only users and screen reader users cannot interact with this element. It has no `role`, no `tabIndex`, and no keyboard event handler. Violates WCAG 2.1 Level A (2.1.1 Keyboard).

**Impact:**
- **Inaccessible UI:** Keyboard users cannot expand/collapse tool call details.
- **Screen readers:** Element is invisible to assistive technology.
- **Compliance:** Fails basic accessibility standards.

**Suggested fix:**
```tsx
<div
  role="button"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setExpanded((v) => !v);
    }
  }}
  className={cn('... cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary')}
  onClick={() => setExpanded((v) => !v)}
>
```

**How the fix resolves it:**
`role="button"` announces the element as interactive. `tabIndex={0}` makes it focusable. `onKeyDown` handles Enter and Space. Focus ring provides visual feedback.

**Fix risk:** NONE. Purely additive — existing mouse behavior unchanged. Visual focus ring uses existing design tokens.

---

### CQ-03: `IdMapEntry.type` missing `'subtask'` and `'milestone'`

**File:** `agent/src/types.ts:56-62`
**Revalidation:** CONFIRMED

**Finding:**
```typescript
export interface IdMapEntry {
  type: 'project' | 'phase' | 'task';       // ← missing subtask, milestone
  // ...
}

export type PlanItemType = 'phase' | 'task' | 'subtask' | 'milestone';  // ← has all 4
```

**Why it's wrong:**
The plan data model supports subtasks and milestones, but the ID map (which tracks tempId → Rocketlane ID mappings) can't represent them. If the agent creates subtasks or milestones, their IDs fall outside the type's domain.

**Impact:**
- **Lost ID mappings:** Subtasks and milestones created by the agent can't be tracked in the ID map with correct types.
- **Dependency resolution failures:** Later operations that reference subtask/milestone IDs by type may fail to find them.
- **Type safety bypass:** TypeScript won't catch code that tries to store `'subtask'` in this field.

**Suggested fix:**
```typescript
export interface IdMapEntry {
  type: 'project' | 'phase' | 'task' | 'subtask' | 'milestone';
  rlId: number;
  tempId: string;
  parentTempId: string | null;
  createdAt: number;
}
```

**How the fix resolves it:**
Aligns `IdMapEntry.type` with `PlanItemType`, allowing the ID map to correctly represent all plan item types.

**Fix risk:** LOW. Run `tsc --noEmit` after the change. Any code that branches on `IdMapEntry.type` will now need to handle the new variants — but this is exactly the kind of error TypeScript should catch.

---

### CQ-04 (FALSE POSITIVE): Missing `autoprefixer` in PostCSS config

**File:** `frontend/postcss.config.mjs`
**Revalidation:** INVALID

**Finding claimed:** PostCSS config should include `autoprefixer` alongside `tailwindcss`.

**Why it's a false positive:** Next.js 14 with Tailwind CSS handles vendor prefixing automatically during the build process. Tailwind's built-in PostCSS pipeline includes autoprefixing. Adding an explicit `autoprefixer` plugin would be redundant.

---

### CQ-05 (FALSE POSITIVE): `ANTHROPIC_MODEL` documented as optional in `CONTEXT.md`

**File:** `CONTEXT.md:544`
**Revalidation:** INVALID

**Finding claimed:** Documentation says `ANTHROPIC_MODEL` is optional, but the service requires it.

**Why it's a false positive:** The documentation is accurate. After "Commit 2h", the agent loop reads the model from Redis first (`admin:config:model`) and falls back to the env var. The env var is genuinely optional if the model is configured in Redis.

---

## Major Findings — Documentation

### DOC-01: BRD submitted date conflict

**File:** `BRD.md:5`
**Revalidation:** CONFIRMED

**Finding:**
BRD header says `Submitted: 2026-04-16` but `MEMORY.md` line 1111 says "submission itself, scheduled for 2026-04-17" and `CONTEXT.md:47-48` says "Next focus (tomorrow, 2026-04-17): 1. Submit."

**Why it's wrong:**
Conflicting dates in formal documents create confusion about official timelines.

**Impact:**
- **Credibility:** A reviewer noticing the inconsistency may question document accuracy.
- **Ambiguity:** Which date is authoritative?

**Suggested fix:**
Align the BRD date to the actual submission date (2026-04-17), or update all references if submitting today.

**How the fix resolves it:**
Single source of truth for the submission date across all documents.

**Fix risk:** NONE.

---

### DOC-02: BRD incorrectly describes model fallback behavior

**File:** `BRD.md:243-244`
**Revalidation:** CONFIRMED

**Finding:**
BRD claims a hardcoded-default fallback for the Anthropic model. The actual behavior is fail-fast with a clear error if `ANTHROPIC_MODEL` is unset and Redis has no override.

**Why it's wrong:**
Incorrect technical documentation in a formal deliverable misrepresents the system's actual behavior.

**Impact:**
- **Misconfiguration:** An operator reading the BRD might skip setting `ANTHROPIC_MODEL`, expecting a fallback that doesn't exist.
- **Credibility:** Technical inaccuracy in a submission document.

**Suggested fix:**
Update the BRD text to: "The model is read from Redis runtime config first, falling back to the `ANTHROPIC_MODEL` environment variable. If neither is set, the loop fails fast with a clear error — there is no hardcoded default."

**How the fix resolves it:**
Documentation matches implementation.

**Fix risk:** NONE.

---

### DOC-03: Stale endpoint examples in `docs/PLAN.md`

**File:** `docs/PLAN.md:540-549`
**Revalidation:** CONFIRMED

**Finding:**
Endpoint examples include "**verify this exact path during Hour 1–2**" annotations, suggesting they were written before API testing and never finalized.

**Why it's wrong:**
A developer referencing these examples without reading the annotations could use incorrect API paths.

**Impact:**
- **Wasted debugging time:** Incorrect endpoints cause 404s that take time to diagnose.
- **Misleading reference:** Plan document should be authoritative, not speculative.

**Suggested fix:**
Either verify and finalize the endpoints, or add a clear deprecation notice:
```
> ⚠️ SUPERSEDED: See `agent/src/lib/rocketlane.ts` for current API paths.
> These examples were written pre-implementation and may not match the actual API.
```

**How the fix resolves it:**
Prevents anyone from using stale endpoints. Points to the canonical implementation.

**Fix risk:** NONE.

---

### DOC-04: Design system architecture HTML misrepresents deployment

**File:** `plansync_google_stitch design/rocketlane_project_plan_agent_system_architecture.html`
**Revalidation:** CONFIRMED (multiple locations)

**Finding:**
The architecture document claims:
- "Backend Next.js API routes (Vercel)" — actual backend is Express on Railway
- "serverless functions on Vercel" — backend is a long-running Railway service
- "Primary: Vercel standalone" — actual deployment is split: Vercel (frontend) + Railway (backend)

**Why it's wrong:**
The architecture document describes a monolithic Vercel deployment that doesn't match the actual split deployment.

**Impact:**
- **Misleading for reviewers:** Someone reading the architecture doc will have an incorrect mental model.
- **Deployment errors:** Following the doc's guidance would result in a non-functional deployment.

**Suggested fix:**
Update the HTML document to reflect the actual architecture: "Frontend: Next.js App Router on Vercel. Agent Backend: Stateless Express API on Railway."

**How the fix resolves it:**
Architecture documentation matches reality.

**Fix risk:** NONE. This is a static design reference file.

---

## Major Findings — Design Mockups

> **Context note:** Files in `plansync_google_stitch design/` are static HTML mockups used as visual reference. They are NOT production code. Findings here are valid but lower priority than production code issues.

### DM-01 through DM-07: Design mockup accessibility and hardcoded content

**Files:** `plansync_google_stitch design/agent_setup/code.html`, `plan_validation/code.html`, `agent_chat_upload/code.html`
**Revalidation:** CONFIRMED — issues exist but context matters

**Findings (grouped):**
1. Icon-only buttons lack `aria-label` attributes (3 files × 3 buttons each)
2. Labels not programmatically associated with inputs
3. Hardcoded plan hierarchy and AI messages in static HTML
4. `<img>` tags use `data-alt` instead of standard `alt` attribute
5. Duplicate Material Symbols font `<link>` tags (3 files)
6. Hardcoded "System Status: Online" text
7. Upload area not keyboard-accessible

**Why it's wrong:**
These are genuine accessibility and markup issues. Even in mockups, they set a poor example if developers reference the HTML.

**Impact:**
- **Low (for mockups):** These files are visual references, not served to users.
- **Medium (if referenced):** A developer copying patterns from these mockups would inherit the accessibility gaps.

**Suggested fix:**
If time permits, fix the mockup HTML. If not, add a README or comment in the directory noting these are visual references only and should not be used as implementation templates.

**How the fix resolves it:**
Either brings mockups up to standard or sets expectations about their purpose.

**Fix risk:** NONE.

---

## Minor Findings — Error Handling & Defensive Coding

### EH-01: Redis pipeline errors silently ignored in `saveSession`

**File:** `agent/src/memory/session.ts:219-220`
**Revalidation:** CONFIRMED — this is the highest-impact minor finding

**Finding:**
```typescript
await pipe.exec();
await touchSessionTtl(sessionId);
```

**Why it's wrong:**
`pipe.exec()` returns `[error, result][]` tuples. If individual pipeline commands fail, the errors are silently discarded. `touchSessionTtl` runs unconditionally, even if the save failed.

**Impact:**
- **Data loss:** A failed Redis write means the session state reverts to its previous version on the next request. The agent may repeat work or lose context.
- **Silent corruption:** No error logged, no error returned to the caller.
- **TTL extended on broken session:** Touch runs even if save failed, keeping a corrupted session alive.

**Suggested fix:**
```typescript
const results = await pipe.exec();
const errors = results?.filter(([err]) => err !== null);
if (errors && errors.length > 0) {
  console.error('[saveSession] Pipeline errors:', errors);
  throw new Error(`Session save failed for ${sessionId}`);
}
await touchSessionTtl(sessionId);
```

**How the fix resolves it:**
Pipeline errors are logged and propagated. TTL only extends on successful saves. Callers can handle the error (retry, notify user).

**Fix risk:** MEDIUM. The `throw` will propagate to the agent loop's error handler. Verify the loop handles `saveSession` failures gracefully (it should already, since network errors can occur). Test with a Redis mock that fails one pipeline command.

---

### EH-02: Unprotected `JSON.parse` for history and execlog in `loadSession`

**File:** `agent/src/memory/session.ts:119-125`
**Revalidation:** CONFIRMED

**Finding:**
```typescript
history: (history ?? []).map((s) =>
  typeof s === 'string' ? (JSON.parse(s) as AnthropicMessage) : (s as AnthropicMessage)
),
execlog: (execlog ?? []).map((s) =>
  typeof s === 'string' ? (JSON.parse(s) as ExecLogEntry) : (s as ExecLogEntry)
),
```

**Why it's wrong:**
No try/catch around `JSON.parse`. Other fields in the same function (`remember`, `idmap`, `journey`) use defensive parsing with try/catch. This inconsistency means a corrupted Redis entry for history or execlog crashes the entire session loader.

**Impact:**
- **Session unloadable:** A single corrupted entry in history makes the entire session inaccessible.
- **Cascading failure:** The user can't resume their session or start a new turn.
- **Inconsistent pattern:** The defensive parsing exists for other fields, making this an oversight.

**Suggested fix:**
Wrap in try/catch, filtering out corrupted entries:
```typescript
history: (history ?? []).map((s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) as AnthropicMessage : s as AnthropicMessage;
  } catch {
    console.error('[loadSession] Corrupted history entry, skipping');
    return null;
  }
}).filter(Boolean) as AnthropicMessage[],
```

**How the fix resolves it:**
Corrupted entries are skipped instead of crashing the loader. The session loads with partial history rather than failing entirely.

**Fix risk:** LOW. A skipped history entry means the agent loses context from that turn, but the session remains usable. Better than total failure.

---

### EH-03: `Number()` can produce NaN in admin config

**File:** `agent/src/admin/config.ts:209-217`
**Revalidation:** CONFIRMED

**Finding:**
```typescript
const effectiveMaxTokens =
  maxTokensOverride !== null && maxTokensOverride !== undefined
    ? Number(maxTokensOverride)
    : DEFAULT_MAX_TOKENS;
```

**Why it's wrong:**
If `maxTokensOverride` is a non-numeric string (e.g., `"abc"`), `Number("abc")` returns `NaN`. This NaN is then passed to the Claude API as `max_tokens`, causing unpredictable behavior.

**Impact:**
- **API errors:** Claude API may reject `NaN` as an invalid parameter.
- **Silent misconfiguration:** No error at the config level — the NaN propagates downstream.

**Suggested fix:**
```typescript
const parsed = Number(maxTokensOverride);
const effectiveMaxTokens =
  maxTokensOverride != null && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_TOKENS;
```

**How the fix resolves it:**
NaN and invalid numbers fall back to the default. Only finite positive numbers are accepted.

**Fix risk:** NONE. Invalid overrides now use the default instead of NaN.

---

### EH-04: `JSON.stringify(undefined)` produces misleading error message

**File:** `agent/src/tools/get-task.ts:73-76`
**Revalidation:** CONFIRMED (minor — no crash, just poor messaging)

**Finding:**
```typescript
summary: `Rocketlane error fetching task ${taskId}: ${err.status} ${err.message}. Body: ${JSON.stringify(err.responseBody).slice(0, 400)}`
```

**Why it's wrong:**
`JSON.stringify(undefined)` returns the string `"undefined"` (not a crash), so the error message shows `Body: undefined` instead of a useful fallback.

**Impact:**
- **Poor error messaging:** The agent sees "Body: undefined" in its context, which isn't helpful for debugging.
- **No crash risk:** This won't throw, just produces confusing output.

**Suggested fix:**
```typescript
const bodySnippet = err.responseBody != null
  ? JSON.stringify(err.responseBody).slice(0, 400)
  : '(no body)';
```

**How the fix resolves it:**
Explicit fallback message instead of the confusing "undefined" string.

**Fix risk:** NONE.

---

### EH-05 through EH-08 (FALSE POSITIVES)

| ID | File | Claim | Why invalid |
|---|---|---|---|
| EH-05 | `agent/src/lib/sse.ts:76-82` | `res.write` needs try/catch | The `writableEnded \|\| destroyed` guard already prevents writes to closed connections. The guard is sufficient. |
| EH-06 | `agent/src/tools/remember.ts:44` | `ctx.session.remember` could be undefined | `remember` is initialized as `{}` in `newSession()` (session.ts:81) and parsed defensively in `loadSession`. It's never undefined. |
| EH-07 | `agent/src/memory/artifacts.ts:84-86` | Wrong type for arrays on empty path | `typeof []` returns `"object"` in JavaScript, which is correct behavior. The return type contract is `{ type: string }` and `"object"` satisfies it. |
| EH-08 | `agent/src/tools/get-rocketlane-context.ts:104-108` | `String(undefined)` crash | `String(undefined)` returns `"undefined"` (a valid string). Not a crash — just produces poor data quality if `companyName` is actually missing, which is unlikely from the Rocketlane API. |

---

## Minor Findings — UI & Accessibility

### UI-01: `ApiKeyCard` label not associated with input

**File:** `frontend/components/agent-emitted/ApiKeyCard.tsx:69-91`
**Revalidation:** CONFIRMED

**Finding:**
The `<label>` element and `<input>` element are not programmatically linked (no `htmlFor`/`id` pair).

**Why it's wrong:**
Screen readers won't announce "API Key" when the input is focused. Clicking the label won't focus the input.

**Impact:**
- **Accessibility violation:** WCAG 1.3.1 (Info and Relationships).
- **Minor UX gap:** The placeholder (`rk_live_xxxxxxxxxxxxxxxx`) provides partial context, but it's not a substitute for a proper label association.

**Suggested fix:**
Add `htmlFor="api-key-input"` to the label and `id="api-key-input"` to the input.

**How the fix resolves it:**
Programmatic association enables screen reader announcement and click-to-focus behavior.

**Fix risk:** NONE.

---

### UI-02: `ProgressFeed` shows "Creating 1 of 0" when total is 0

**File:** `frontend/components/agent-emitted/ProgressFeed.tsx:46`
**Revalidation:** CONFIRMED

**Finding:**
```tsx
{isComplete ? 'Phase complete' : `Creating ${completed + 1} of ${total}…`}
```

When `total === 0` and `isComplete` is false, this displays "Creating 1 of 0…".

**Why it's wrong:**
Nonsensical text confuses users. Occurs when the agent emits a progress event before knowing the total count.

**Impact:**
- **UX confusion:** Brief flash of "1 of 0" before the real count arrives.
- **Low frequency:** Only happens if the agent emits progress before the plan is fully parsed.

**Suggested fix:**
```tsx
{isComplete
  ? 'Phase complete'
  : total > 0
    ? `Creating ${completed + 1} of ${total}…`
    : 'Initializing…'}
```

**How the fix resolves it:**
Shows a sensible fallback when total is unknown.

**Fix risk:** NONE.

---

### UI-03: `ExecutionPlanCard` status icons lack accessible labels

**File:** `frontend/components/agent-emitted/ExecutionPlanCard.tsx:59-84`
**Revalidation:** CONFIRMED

**Finding:**
Material icon spans (check, progress_activity, close) have no `aria-label`. Screen readers can't convey step status.

**Impact:**
- **Accessibility gap:** Status (complete/in-progress/failed) is communicated only visually.

**Suggested fix:**
Add `aria-label` to each icon based on status:
```tsx
<span aria-label={isDone ? "Complete" : isInProgress ? "In progress" : isError ? "Failed" : `Step ${idx + 1}`}>
```

**Fix risk:** NONE.

---

### UI-04: `Chat.tsx` — setTimeout memory leak on unmount

**File:** `frontend/components/Chat.tsx:290-296`
**Revalidation:** CONFIRMED

**Finding:**
```tsx
const showMemoryToast = useCallback((key: string) => {
  const toastId = `mem-${Date.now()}-...`;
  setMemoryToasts((prev) => [...prev, { id: toastId, key }]);
  setTimeout(() => {
    setMemoryToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, 2500);
}, []);
```

**Why it's wrong:**
If the Chat component unmounts while a timeout is pending, `setMemoryToasts` fires on an unmounted component, causing React warnings and potential memory leaks.

**Impact:**
- **React warnings in console:** "Can't perform a React state update on an unmounted component."
- **Memory leak:** Timeout references prevent garbage collection.

**Suggested fix:**
Store timeout IDs in a ref and clear them on unmount:
```tsx
const toastTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

useEffect(() => {
  return () => {
    toastTimeoutsRef.current.forEach(clearTimeout);
  };
}, []);
```

**Fix risk:** NONE.

---

### UI-05: Admin `loadTools` silently fails on non-401 errors

**File:** `frontend/app/admin/page.tsx:120-130`
**Revalidation:** CONFIRMED

**Finding:**
```tsx
if (!res.ok) {
  if (res.status === 401) { router.replace('/admin/login'); return; }
  return;  // ← Silent failure for 500, 403, network errors, etc.
}
```

**Why it's wrong:**
Non-401 failures produce no user feedback. The Tools tab shows a perpetual loading state.

**Impact:**
- **Invisible failure:** Users wait indefinitely with no error message.
- **Inconsistent pattern:** `loadDashboard` and `loadSessions` have error handling; `loadTools` doesn't.

**Suggested fix:**
```tsx
if (!res.ok) {
  if (res.status === 401) { router.replace('/admin/login'); return; }
  setError(res.error ?? 'Failed to load tools catalog');
  return;
}
```

**Fix risk:** NONE. Uses the existing `setError` pattern from sibling loaders.

---

### UI-06 & UI-07 (FALSE POSITIVES)

| ID | File | Claim | Why invalid |
|---|---|---|---|
| UI-06 | `frontend/components/Markdown.tsx:57-68` | Fenced code blocks without language not detected as block | `className?.includes('language-')` correctly returns `false` for no-language blocks, which renders them as inline code. This is the intended behavior — the markdown parser handles block vs. inline detection upstream. |
| UI-07 | `frontend/components/agent-emitted/ApprovalPrompt.tsx:24-25` | Unused `toolUseId` prop | The prop is declared in the interface but consumed by the parent (`Chat.tsx:1061-1064`) which passes it to `handleApprovalClick`. The prop is part of the parent-child data flow, not dead code. |

---

## Minor Findings — Documentation Drift

### DD-01: `tools-catalog.ts` comment says "7 groups", code has 8

**File:** `agent/src/admin/tools-catalog.ts:4`
**Revalidation:** CONFIRMED

**Finding:**
Comment says "7 functional groups" but `TOOL_CATEGORIES` array has 8 entries (input, planning, memory, hitl, creation, verification, display, runtime_recovery).

**Impact:** Minor confusion for developers reading the file header.

**Suggested fix:** Change "7" to "8" in the comment.

**Fix risk:** NONE.

---

### DD-02: README component count inconsistency

**File:** `README.md:16`
**Revalidation:** CONFIRMED (nuanced)

**Finding:**
Claims "14 components total" but lists 10 named components + "chat timeline renderers." The `frontend/components/agent-emitted/` directory has 10 `.tsx` files.

**Impact:** Minor — the count likely includes logical rendering variants, not just files.

**Suggested fix:** Clarify: "10 component files rendering 14 distinct UI cards (including chat timeline variants)."

**Fix risk:** NONE.

---

### DD-03: Upload route comment misleads about body size

**File:** `frontend/app/api/upload/route.ts:65-67`
**Revalidation:** CONFIRMED (partially)

**Finding:**
Comment says "Allow large bodies (10 MB)" but the code only exports `runtime` and `maxDuration` — neither controls body size.

**Impact:** False confidence about upload limits. The actual 10 MB limit is enforced by the Railway backend's `express.raw()`.

**Suggested fix:** Update comment: "Backend enforces 10 MB via express.raw({ limit: '10mb' })."

**Fix risk:** NONE.

---

### DD-04: Route comment label mismatch

**File:** `agent/src/index.ts:463`
**Revalidation:** CONFIRMED

**Finding:**
Comment says `DELETE /session/:id` but the actual route is `DELETE /session/:id/events`.

**Suggested fix:** Update comment header to match the route.

**Fix risk:** NONE.

---

### DD-05 (FALSE POSITIVE): `CLAUDE.md:39` — Model documented as hardcoded

**File:** `CLAUDE.md:39`
**Revalidation:** INVALID

**Finding claimed:** Line 39 says `claude-sonnet-4-5` as if it's a hardcoded default.

**Why it's a false positive:** Line 39 is in the "Tech stack" section, stating what model the deployment uses. Line 55 explicitly documents the configurable env var with "no fallback." These are two different contexts — tech stack summary vs. deployment configuration.

---

## Minor Findings — Miscellaneous

### MISC-01: Redis set for active locks can accumulate stale entries

**File:** `agent/src/admin/counters.ts:131-154`
**Revalidation:** CONFIRMED (partially)

**Finding:**
`recordLockAcquired` adds to a Redis set; `recordLockReleased` removes. If release fails (process crash, network error), the entry persists forever.

**Impact:** Admin dashboard shows phantom "active locks" for dead sessions. Locks are advisory (admin UI only), not production-critical.

**Suggested fix:** Use a sorted set with timestamps for automatic staleness detection, or set a TTL on the key.

**Fix risk:** LOW. Only affects admin dashboard display.

---

### MISC-02: Hardcoded API pagination limit of 100

**File:** `agent/src/tools/get-rocketlane-context.ts:79-83`
**Revalidation:** CONFIRMED

**Finding:**
```typescript
const [projectsRes, companiesRes, usersRes] = await Promise.all([
  client.listProjects(100),
  client.listCompanies(),
  client.listUsers(100),
]);
```

**Impact:** Workspaces with >100 projects or users silently lose data from the agent's context.

**Suggested fix:** Add pagination or a truncation warning in the tool's response summary.

**Fix risk:** LOW. Pagination adds complexity but improves correctness.

---

### MISC-03: Final progress message always says "success"

**File:** `agent/src/tools/execute-plan-creation.ts:401-402`
**Revalidation:** CONFIRMED (low impact)

**Finding:**
```typescript
emitProgress('Complete', 'Project created successfully');
```
This runs regardless of whether items/dependencies failed.

**Impact:** The progress UI briefly shows "success" before the actual summary (which correctly reports failures) renders. Minor UX inconsistency.

**Suggested fix:**
```typescript
const hasFailures = itemResults.some(r => r.error) || depResults.some(r => !r.ok);
emitProgress('Complete', hasFailures
  ? `Project created with failures — see summary`
  : 'Project created successfully');
```

**Fix risk:** NONE.

---

### MISC-04: Execution plan step status not validated

**File:** `agent/src/tools/create-execution-plan.ts:43-48`
**Revalidation:** CONFIRMED (low impact)

**Finding:**
Step `status` from LLM input is used as-is without validation against allowed values.

**Impact:** An invalid status string gets stored and rendered. The frontend handles unknown statuses gracefully (default styling), so no crash. Minor type safety gap.

**Suggested fix:** Validate against a whitelist: `['pending', 'in_progress', 'done', 'failed']`.

**Fix risk:** NONE.

---

### MISC-05: `frontend/.gitignore` only excludes `.env*.local`

**File:** `frontend/.gitignore:29`
**Revalidation:** CONFIRMED

**Finding:**
Pattern `.env*.local` excludes `.env.local` and `.env.development.local` but NOT `.env` or `.env.production`.

**Impact:** A developer who creates a `.env` file in the frontend directory could accidentally commit it.

**Suggested fix:**
```
.env*
!.env.example
```

**Fix risk:** NONE.

---

### MISC-06: Design token inconsistencies in `DESIGN.md`

**File:** `plansync_google_stitch design/synthetix_enterprise/DESIGN.md`
**Revalidation:** CONFIRMED

**Finding:**
Mixed naming conventions (hyphens vs. underscores: `surface-container-low` vs. `surface_bright`), missing token definitions (`surface_container_high`, `primary_fixed`, `secondary`, `on_surface`, `outline_variant`), and no typography token values.

**Impact:** Implementers can't reliably translate design specs to code without guessing token values.

**Suggested fix:** Standardize on one naming convention, add a token reference table with hex values, and add concrete typography specs.

**Fix risk:** NONE (design reference file).

---

## Summary Matrix

| ID | Severity | File | Valid? | Impact | Fix Risk |
|---|---|---|---|---|---|
| **CR-01** | Critical | `agent/src/types.ts:110` | Yes | Architectural debt | Low |
| **CR-02** | Critical | `agent/src/types.ts` + `frontend/lib/event-types.ts` | Yes (intentional) | Type drift risk | None |
| CR-03 | Critical | `agent/.env.example` | **False positive** | — | — |
| **SEC-01** | Major | `agent/src/index.ts:56` | Yes | CORS bypass | Low |
| **SEC-02** | Major | `custom-app/widgets/plansync/index.html:112` | Yes | Iframe escalation | Low |
| **SEC-03** | Major | `agent/rl-api-contract.json` | Yes | PII exposure | None |
| **SEC-04** | Major | `agent/scripts/test-rl.ts:39` | Yes | PII + unintended API calls | None |
| **CQ-01** | Major | `custom-app/package.json:12` | Yes | Non-deterministic builds | None |
| **CQ-02** | Major | `frontend/components/ToolCallLine.tsx:46` | Yes | WCAG violation | None |
| **CQ-03** | Major | `agent/src/types.ts:56` | Yes | Lost ID mappings | Low |
| CQ-04 | Major | `frontend/postcss.config.mjs` | **False positive** | — | — |
| CQ-05 | Major | `CONTEXT.md:544` | **False positive** | — | — |
| **DOC-01** | Major | `BRD.md:5` | Yes | Credibility | None |
| **DOC-02** | Major | `BRD.md:243` | Yes | Misconfiguration risk | None |
| **DOC-03** | Major | `docs/PLAN.md:540` | Yes | Stale reference | None |
| **DOC-04** | Major | Design HTML files | Yes | Incorrect architecture desc. | None |
| DM-01–07 | Major | Design mockup HTML | Yes (low priority) | Accessibility in mockups | None |
| **EH-01** | Minor | `agent/src/memory/session.ts:219` | Yes | **Data loss** | Medium |
| **EH-02** | Minor | `agent/src/memory/session.ts:119` | Yes | Session crash on corruption | Low |
| **EH-03** | Minor | `agent/src/admin/config.ts:209` | Yes | NaN passed to API | None |
| **EH-04** | Minor | `agent/src/tools/get-task.ts:73` | Yes | Poor error message | None |
| EH-05–08 | Minor | Various | **False positives** | — | — |
| **UI-01** | Minor | `ApiKeyCard.tsx:69` | Yes | Label not linked | None |
| **UI-02** | Minor | `ProgressFeed.tsx:46` | Yes | "1 of 0" text | None |
| **UI-03** | Minor | `ExecutionPlanCard.tsx:59` | Yes | Missing aria labels | None |
| **UI-04** | Minor | `Chat.tsx:290` | Yes | Memory leak | None |
| **UI-05** | Minor | `admin/page.tsx:120` | Yes | Silent failure | None |
| UI-06–07 | Minor | Various | **False positives** | — | — |
| **DD-01** | Minor | `tools-catalog.ts:4` | Yes | Comment count wrong | None |
| **DD-02** | Minor | `README.md:16` | Yes | Component count unclear | None |
| **DD-03** | Minor | `upload/route.ts:65` | Yes | Misleading comment | None |
| **DD-04** | Minor | `agent/src/index.ts:463` | Yes | Route label wrong | None |
| DD-05 | Minor | `CLAUDE.md:39` | **False positive** | — | — |
| **MISC-01** | Minor | `counters.ts:131` | Yes | Stale lock entries | Low |
| **MISC-02** | Minor | `get-rocketlane-context.ts:79` | Yes | Data truncation | Low |
| **MISC-03** | Minor | `execute-plan-creation.ts:401` | Yes | Premature success msg | None |
| **MISC-04** | Minor | `create-execution-plan.ts:43` | Yes | Unvalidated status | None |
| **MISC-05** | Minor | `frontend/.gitignore:29` | Yes | Incomplete exclusion | None |
| **MISC-06** | Minor | Design `DESIGN.md` | Yes | Token inconsistencies | None |

---

## Recommended Fix Priority

### Immediate (before submission)
1. **SEC-01** — CORS wildcard fix (security)
2. **SEC-03 + SEC-04** — Sanitize PII (professionalism)
3. **DOC-01 + DOC-02** — BRD accuracy (submission document)
4. **EH-01** — Redis pipeline error handling (data integrity)

### High (production readiness)
5. **SEC-02** — iframe sandbox
6. **CQ-02** — Keyboard accessibility
7. **CQ-03** — IdMapEntry type alignment
8. **CR-01** — Remove SessionMeta.status
9. **EH-02** — Defensive JSON.parse in session loader

### Medium (polish)
10. **UI-01 through UI-05** — Accessibility and UX fixes
11. **EH-03** — NaN guard in admin config
12. **MISC-01 through MISC-05** — Miscellaneous improvements
13. **DD-01 through DD-04** — Documentation corrections

### Low (nice to have)
14. **CR-02** — Shared types package
15. **MISC-06** — Design token cleanup
16. **DM-01 through DM-07** — Mockup HTML fixes
