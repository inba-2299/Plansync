# PRD: Rocketlane Project Plan Agent
## Complete Build Specification for Claude Code

**Version:** 2.0
**Date:** April 14, 2026
**Author:** Inbaraj B
**Purpose:** Single source of truth for Claude Code to build the entire project

---

## 1. Project Overview

### 1.1 What We're Building

An AI agent that reads a project plan from a CSV/Excel file and creates it as a fully structured project in Rocketlane — with phases, tasks, subtasks at any nesting depth, milestones, and dependencies.

This is a conversational agent, not a wizard-style import tool. It reasons about the uploaded plan, detects hierarchy and column meanings using PM domain knowledge, asks the user questions when uncertain, validates its own work, and executes autonomously with human approval at key decision points.

### 1.2 Why It Exists

Rocketlane has no native CSV import feature for project plans. Implementation teams maintain plans in Excel/Smartsheet/Asana/MS Project and manually recreate them in Rocketlane. This agent eliminates that manual work while adding intelligence — detecting hierarchy, suggesting milestones, handling deep nesting, and setting dependencies.

### 1.3 Design Principles

1. **Agent, not app** — the agent drives the flow, the user guides it
2. **Generic, not hardcoded** — works for ANY project plan, not a specific client
3. **Brain-driven, not parser-driven** — the agent reasons about data using PM knowledge, not hardcoded format parsers. Column mapping, dependency detection, status interpretation — all happen through Claude's reasoning, not pre-built code.
4. **No silent decisions** — deep nesting, milestones, and structure changes always require user confirmation
5. **No silent drops** — orphan items are grouped under "Ungrouped Tasks" and flagged, never deleted
6. **Rocketlane is the system of record** — the agent is a translator, not a data store
7. **Fail gracefully** — show what succeeded, retry what failed, never leave the user guessing

### 1.4 Who This Is For

This is a take-home assignment for the Implementation Manager role at Rocketlane. The evaluators will test the live agent, review the architecture, and assess implementation consulting depth.

---

## 2. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React (Next.js 14, App Router) | Conversational UI with embedded rich components. Single codebase for frontend + backend. |
| Backend | Next.js API routes (Vercel serverless) | Stateless, auto-scaling, zero ops. Each route handles one agent action. |
| Agent Brain | Claude Sonnet via Anthropic Messages API + tool use | ReAct pattern. Stable API, well-documented tool use. |
| State | Upstash Redis | Serverless Redis with HTTP client. TTL-based session expiry (48h). Sub-ms reads. |
| File Parsing | SheetJS (xlsx) — server-side | Handles both CSV and Excel. Server-side keeps frontend thin. Extracts cell formatting (indentation). |
| Execution Target | Rocketlane API | System of record. Projects, phases, tasks, subtasks, milestones, dependencies. |
| Styling | Tailwind CSS | Utility-first, fast to build. |
| Error Tracking | Sentry (@sentry/nextjs) | Runtime error catching. 10-min setup. |
| Hosting | Vercel | Native Next.js. Free tier. Automatic HTTPS. |
| Custom App | Rocketlane Custom Apps (.zip) | Agent embedded inside RL via iframe. Bonus deliverable. |

### 2.1 Technologies NOT Used

| Technology | Why Not |
|-----------|---------|
| Supabase | No persistent relational data. Sessions are ephemeral. RL is system of record. |
| Pinecone | No semantic search. Claude handles plan understanding natively. |
| LangGraph | Python-first. Our project is TypeScript/Next.js. |
| LangChain | Heavy abstraction, no value for single-LLM agent. |
| csv-parse | CSV-only. SheetJS handles both CSV + Excel. |

---

## 3. Architecture

### 3.1 System Diagram

```
┌──────────────────────────────────────────────┐
│  Vercel (Next.js)                             │
│                                               │
│  Frontend: React chat UI + rich components    │
│  Backend:  /api/* routes (serverless)         │
│                                               │
│  Each API call:                               │
│    1. Reads session state from Upstash Redis  │
│    2. Runs agent logic (Claude + tools)       │
│    3. Validates results (programmatic checks) │
│    4. Writes updated state to Upstash Redis   │
│    5. Returns response to frontend            │
│                                               │
└──────┬──────────────┬──────────────┬──────────┘
       │              │              │
       ▼              ▼              ▼
  Anthropic API   Rocketlane API   Upstash Redis
  (Agent brain)   (Execution)      (Memory)
```

### 3.2 API Routes

| Route | Purpose | Calls |
|-------|---------|-------|
| POST /api/chat | Main agent loop — receives user message, runs ReAct cycle, returns agent response + tool results | Claude API, Redis |
| POST /api/upload | Receives file upload, parses with SheetJS server-side, returns JSON rows + metadata (including cell indentation data) | SheetJS, Redis |
| POST /api/rocketlane/* | Proxy for all Rocketlane API calls — hides API key from browser | Rocketlane API, Redis |
| GET /api/session | Session management — create, read, resume | Redis |
| GET /api/session/progress | Progress polling — frontend polls during execution | Redis |
| GET /api/session/log | Download execution log as JSON | Redis |

### 3.3 Session State Schema (Redis)

```
session:{id}                    → Hash
├── status                      → "new" | "connected" | "analysing" | "analysed" |
│                                  "approved" | "executing" | "done" | "failed"
├── createdAt                   → ISO timestamp
├── updatedAt                   → ISO timestamp
├── rlApiKey                    → Encrypted, never logged
├── rlContext                   → JSON: existing projects, accounts, owner info
├── uploadedData                → JSON: parsed rows with metadata (column names, indentation, row count)
├── plan                        → JSON: structured plan (Claude's analysis output)
├── config                      → JSON: project name, dates, preferences
├── idMap                       → JSON: tempId → rlId mapping (from execution)
└── rlProjectId                 → Set after project creation

session:{id}:messages           → List
├── [0]                         → { role, content }
└── [n]                         → { ... }

session:{id}:execlog            → List (append-only)
├── [0]                         → { timestamp, action, endpoint, request, response, status, duration_ms, xRequestId }
└── [n]                         → { ... }

session:{id}:progress           → Hash
├── total                       → 62
├── completed                   → 34
├── failed                      → 1
├── currentPhase                → "Data Requirements"
├── current                     → "Creating subtask: Stateflow Setup"
└── failedItems                 → JSON: [{ item, error, retryable }]
```

TTL: 48 hours on all session keys.

### 3.4 File Upload and Parsing (/api/upload)

SheetJS parses the file server-side. For Excel files (.xlsx), it extracts:
- All row data as JSON array
- Column headers
- Sheet names (for multi-sheet detection)
- **Cell indentation values** (alignment.indent property) — critical for hierarchy detection from Smartsheet/MS Project exports
- Row count

For CSV files (.csv), it extracts:
- All row data as JSON array
- Column headers
- Row count
- Leading whitespace in the task name column (preserved, not trimmed — used for hierarchy detection)

The parsed data JSON is stored in Redis and sent to `/api/chat` for Claude's analysis.

**File validation (client-side before upload):**
- Accepted extensions: .csv, .xlsx, .xls
- Max file size: 10MB
- Rejection message for wrong type: "Please upload a CSV or Excel file (.csv, .xlsx, .xls)"

**Server-side error handling:**
- Password-protected Excel → "This file appears to be password-protected. Please remove the password and re-upload."
- Corrupted file → "I couldn't read this file. It may be corrupted. Please try exporting a fresh copy."
- Empty file → "This file has no data rows."

### 3.5 Security

| Concern | Approach |
|---------|----------|
| Anthropic API key | Server-side env var (ANTHROPIC_API_KEY). Never sent to browser. |
| Rocketlane API key | User enters per session. Encrypted in Redis. Passed via server-side proxy only. Never logged. Expires with session (48h). |
| Upstash credentials | Server-side env vars. Never exposed to frontend. |
| File uploads | Parsed server-side in memory. No file stored permanently. |
| CORS | Configured on API routes for Custom App iframe origin. |
| Session isolation | Unique UUIDv4 session IDs. No cross-session data access. |

### 3.6 Environment Variables

| Variable | Purpose |
|----------|---------|
| ANTHROPIC_API_KEY | Claude API access |
| UPSTASH_REDIS_REST_URL | Redis connection |
| UPSTASH_REDIS_REST_TOKEN | Redis auth |
| NEXT_PUBLIC_API_BASE_URL | API base URL (empty for standalone, full Vercel URL for Custom App) |
| SENTRY_DSN | Error tracking |

---

## 4. Agent Brain

### 4.1 System Prompt Architecture

The system prompt is dynamically composed before each Claude API call. It has four sections:

```
lib/prompts/
├── system.ts          ← Base system prompt (identity, PM knowledge, RL data model, rules)
├── tools-schema.ts    ← Tool definitions (JSON schema for each of 8 tools)
└── context.ts         ← Dynamic context builder (injects session state)
```

### 4.2 Section 1 — Identity and Goal

"You are a Rocketlane Project Plan Agent. Your job is to take a project plan file (CSV or Excel) and create it as a fully structured project in Rocketlane — with phases, tasks, subtasks at any nesting depth, milestones, and dependencies.

You are an expert in project management. You understand WBS structure, phase/task hierarchies, dependency types, milestone conventions, and how different PM tools export their data. You use this knowledge to interpret any project plan intelligently, mapping it to Rocketlane's data model."

### 4.3 Section 2 — Domain Knowledge (Three Layers)

#### Layer 1: Project Management Fundamentals

**WBS (Work Breakdown Structure):**
- Hierarchical decomposition: Project → Phases/Deliverables → Tasks/Work Packages → Subtasks/Activities
- 100% rule: every level must account for all work in the parent above
- Summary/container items (phases, groups) roll up dates and effort from their children
- Leaf items are the actual work units

**Phase Patterns in SaaS/Enterprise Implementations:**
- Common flow: Discovery/Requirements → Configuration/Build → Testing/UAT → Training → Data Migration → Go-Live → Handover
- Each phase typically ends with a milestone (sign-off, approval, acceptance)
- Cross-phase dependencies are common (data requirements feed configuration)
- Phases may overlap (build Phase 1 while requirements Phase 2)
- A phase with a single child is likely just a group label, not a separate phase

**Task Dependencies:**
- Finish-to-Start (FS): B can't start until A finishes — the default, most common
- Start-to-Start (SS): B starts when A starts
- Finish-to-Finish (FF): B finishes when A finishes
- Start-to-Finish (SF): B finishes when A starts — very rare
- Lag: delay between linked tasks (positive = wait, negative = overlap)

**Milestones:**
- Zero-duration or short-duration markers for key decision points
- Common keywords: "sign off", "approval", "go-live", "handover", "kickoff", "acceptance", "review complete", "baseline", "cutover"
- Usually at the end of a phase or at a gate between phases

**Status Values (common patterns):**
- Not Started / To Do / Backlog / Open → means work hasn't begun
- In Progress / Active / Doing / WIP → means work is underway
- Complete / Done / Closed / Finished → means work is finished
- Percentage-based: 0% = not started, 1-99% = in progress, 100% = complete
- Some tools use 0.0-1.0 scale (multiply by 100)

**Effort and Duration:**
- Effort = person-hours/days of actual work
- Duration = calendar time the work spans
- Common formats: "5d", "2w", "40h", "1.5 months", bare integers (often days)

#### Layer 2: PM Tool Export Patterns (Knowledge, Not Parsers)

The agent should recognise these patterns but reason about them rather than running hardcoded parsers:

**Smartsheet exports (.xlsx):**
- Hierarchy encoded as cell indentation (alignment.indent property). Indent 0 = project container, 1 = phases, 2 = tasks, 3+ = subtasks.
- CSV exports from Smartsheet convert indentation to leading spaces (typically 4 spaces per level).
- Row 1 at indent 0 is often a project-level summary row — not a phase.
- Dependencies use row-number notation: "4" (FS on row 4), "2FS +15d" (FS with lag), "26SS" (Start-to-Start), "41, 38" (multiple predecessors).
- Duration as "Xd" format.

**MS Project exports:**
- May include WBS/Outline Number column (1, 1.1, 1.1.1, 1.2 — dots indicate depth).
- Or Outline Level column (explicit integer depth).
- Predecessor column similar to Smartsheet notation.

**Asana exports:**
- Section/task hierarchy. Sections become phases, tasks under sections become tasks.
- May use a "Section" column or section headers as rows.

**Monday.com, Wrike, Jira exports:**
- Various formats. May include explicit parent ID columns.
- May use group/board names as phase indicators.

**Generic/manual CSVs:**
- May have a "Level" or "Depth" column with explicit integers.
- May have a "Parent" or "Parent Task" column.
- May have no hierarchy signal at all — agent groups by contextual clues.

The agent should try to recognise these patterns from the data, but when uncertain, ask the user.

#### Layer 3: Rocketlane Data Model

- **Project** → contains Phases (requires `owner.emailId` + `customer.companyName` at creation)
- **Phase** → contains Tasks (requires `startDate` + `dueDate` — BOTH REQUIRED)
- **Task** → can have Subtasks (via `parent.taskId`) — UNLIMITED depth confirmed
- **Task** → can be type `MILESTONE` (diamond icon in Rocketlane UI)
- **Task** → can have Dependencies (set via separate API call after creation)
- **Date format:** Always `YYYY-MM-DD` at API level
- **Task fields:** taskName (required), taskDescription (HTML), startDate, dueDate, effortInMinutes, progress (0-100), atRisk, type (TASK | MILESTONE), status.value (1=To do, 2=In progress, 3=Completed), assignees.members[].emailId
- **autoCreateCompany:** true on project creation creates the company if it doesn't exist
- **Phase dates are REQUIRED** — if the plan doesn't provide them, calculate from child tasks (min startDate, max dueDate)
- **Dependencies require two-pass approach:** create all entities first (collecting IDs), then set dependencies using those IDs

### 4.4 Section 3 — Behavioural Rules

- Never create anything in Rocketlane without explicit user approval
- Never silently flatten deep nesting — always present options to the user
- Never silently drop items — orphan items go under "Ungrouped Tasks" phase, flagged for review
- Reason about column meanings from headers + sample data. Present column mapping to user for confirmation.
- Reason about hierarchy from structural signals (indentation, spaces, WBS numbers, parent columns, contextual clues). Present detected structure for confirmation.
- Auto-suggest milestones based on PM knowledge (keywords, zero-duration, phase-ending position) but always let user toggle them
- Calculate phase dates from child tasks when plan doesn't provide phase-level dates
- When uncertain about ANY interpretation, ask — don't guess. Use clickable option buttons, not free-text questions.
- Handle malformed/empty rows silently — skip empties, keep partial data, note in review summary. Never stop for bad data.
- During execution, if a task fails: log it, continue with remaining items, retry at the end, report outcome.
- Always validate the structured plan programmatically (Gate 1) before showing to user.

### 4.5 Section 4 — Output Format

When the agent returns analysis results, it MUST use structured JSON — not free-text prose. The UI needs parseable data to render the plan review, column mapping, progress, and action buttons.

Plan item schema:
```json
{
  "id": "item_1",
  "name": "string",
  "type": "phase | task | subtask | milestone",
  "parentId": "string | null",
  "depth": 0,
  "startDate": "YYYY-MM-DD | null",
  "dueDate": "YYYY-MM-DD | null",
  "effortInMinutes": "integer | null",
  "description": "string | null",
  "status": "1 | 2 | 3 | null",
  "progress": "0-100 | null",
  "milestoneCandidate": true,
  "milestoneReason": "string | null",
  "dependsOn": ["item_3", "item_5"]
}
```

### 4.6 Dynamic Context Injection

The context builder injects session state before each Claude call:

```typescript
function buildSystemPrompt(state: SessionState): string {
  let prompt = BASE_SYSTEM_PROMPT;

  // Inject current session status and relevant state
  switch (state.status) {
    case "new":
      prompt += "User just started. Needs API key. Offer template download.";
      break;
    case "connected":
      prompt += `Connected to workspace. Projects: ${JSON.stringify(state.rlContext.projects)}. Accounts: ${JSON.stringify(state.rlContext.accounts)}. User can upload file.`;
      break;
    case "analysing":
      prompt += `Analysing uploaded data: ${state.uploadedData.rowCount} rows, ${state.uploadedData.columns.length} columns. Columns: ${state.uploadedData.columns.join(', ')}. Detect hierarchy, map columns, identify milestones, build structured plan.`;
      break;
    case "analysed":
      prompt += `Plan analysed and validated. User reviewing. They can toggle milestones, handle nesting, confirm structure. After approval, collect project details.`;
      break;
    case "approved":
      prompt += `Plan approved. Execute two-pass creation. Project: ${state.config.projectName}, Customer: ${state.config.customerName}`;
      break;
    case "executing":
      prompt += `Execution in progress. ${state.progress.completed}/${state.progress.total} items. ${state.progress.failed} failed.`;
      break;
    case "done":
      prompt += `Complete. Provide summary, RL link, log download.`;
      break;
  }

  if (state.plan) {
    prompt += `\nCurrent plan:\n${JSON.stringify(state.plan)}`;
  }

  return prompt;
}
```

### 4.7 Agent Loop (ReAct Pattern)

```typescript
async function agentLoop(sessionId: string, userMessage: string) {
  const state = await redis.getSessionState(sessionId);
  const systemPrompt = buildSystemPrompt(state);
  const messages = await redis.getMessages(sessionId);
  messages.push({ role: "user", content: userMessage });

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      system: systemPrompt,
      messages,
      tools: TOOL_DEFINITIONS
    });

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const result = await executeTool(block.name, block.input, state);
        if (result.requiresHumanApproval) {
          await redis.saveState(sessionId, state);
          return { type: "approval_needed", plan: result.plan, message: result.message };
        }
        messages.push(/* tool_use + tool_result */);
        continue;
      }
      if (block.type === "text") {
        await redis.saveState(sessionId, state);
        return { type: "response", message: block.text };
      }
    }
  }
}
```

~50 lines. No framework needed.

---

## 5. Agent Tools (8 Total)

### Design Principle: Batch Execution

Claude does NOT call create_task 62 times in a ReAct loop. That would be 62 round-trips to Claude's API. Instead: Claude reasons about structure → calls `execute_creation_pass` once → backend handles sequential RL API calls and writes progress to Redis → frontend polls for updates.

Total Claude API calls per session: ~5-8 turns.
Total Rocketlane API calls: ~70 for a 62-row plan (~40 seconds).

### Tool 1: validate_rocketlane_connection

**Purpose:** Tests API key, gets workspace info.
**When:** After user provides API key.
**Backend:** `GET /projects?limit=1`. 200 = valid, 401 = invalid.
**Input:** `{ api_key: string }`
**Output:** `{ valid: boolean, workspace?: { name, url, userEmail }, error?: string }`
**Error handling:** 401 → re-enter key. 403 → needs admin. Timeout → try again.
**State update:** Encrypt key in session. Set status "connected".

### Tool 2: fetch_rocketlane_context

**Purpose:** Pulls existing projects, accounts, user info for auto-fill and duplicate detection.
**When:** Immediately after connection validated (silent, no user prompt).
**Backend:** `GET /projects`, attempts `GET /companies`.
**Input:** `{}` (no params)
**Output:** `{ projects: [...], accounts: [...], currentUser: { email, name } }`
**State update:** Store in session.rlContext.

### Tool 3: validate_plan_structure

**Purpose:** 11 programmatic checks on Claude's structured plan. Gate 1 — the hallucination killer.
**When:** After Claude produces structured plan. Also after user makes review changes.
**Input:** `{ plan: { projectName, items: [...] }, sourceRowCount: integer }`
**Backend (deterministic code, NOT LLM):**
1. Every item has `name` and `type`
2. Every `parentId` references an existing item
3. Orphan items auto-grouped under "Ungrouped Tasks" phase
4. No circular dependencies
5. Row count matches sourceRowCount (accounting for skipped empty rows)
6. Dates are valid YYYY-MM-DD if present
7. Effort values are positive integers if present
8. Depth consistency: phase=0, task=1, subtask=2+
9. Non-phase items have parentId
10. No duplicate IDs
11. Phase dates present — calculate from children if missing
**Output (success):** `{ valid: true, stats: { phases, tasks, subtasks, milestones, maxDepth, dependencies }, warnings: [...] }`
**Output (failure):** `{ valid: false, errors: [{ code, detail }] }`
**Error handling:** Errors returned to Claude for self-correction.
**State update:** Store validated plan. Set status "analysed".

### Tool 4: create_rocketlane_project

**Purpose:** Creates the project container in Rocketlane.
**When:** After user clicks "Create Project" with details.
**Input:** `{ projectName, ownerEmail, customerName, startDate?, dueDate?, description?, autoCreateCompany: true }`
**Backend:** `POST /projects`
**Output:** `{ success: true, projectId, projectName, projectUrl }`
**State update:** Store projectId. Append to exec log. Set status "executing".

### Tool 5: execute_creation_pass

**Purpose:** Pass 1 — creates ALL phases, tasks, subtasks, milestones in correct order (top-down by depth). Collects Rocketlane IDs in idMap.
**When:** After project created.
**Input:** `{ projectId, items: [{ tempId, name, type, parentTempId, startDate?, dueDate?, effortInMinutes?, description?, status?, progress? }] }`
**Backend execution:**
1. Sort items by depth: phases (0) → tasks (1) → subtasks (2, 3, 4, ...)
2. For each item:
   - phase → `POST /phases` → store phaseId in idMap
   - task/subtask/milestone → resolve parent RL ID from idMap, walk up to find ancestor phaseId → `POST /tasks` → store taskId in idMap
3. Log every API call (timestamp, endpoint, request, response, status, duration_ms, xRequestId)
4. Update progress in Redis after each item
5. On failure per item: log error, mark failed, continue. Retry failed items 3x at end.
**Output:** `{ success, summary: { total, created, failed, duration_seconds }, idMap, failedItems }`

### Tool 6: execute_dependency_pass

**Purpose:** Pass 2 — sets dependencies using IDs from Pass 1.
**When:** After creation pass, if dependencies exist.
**Input:** `{ dependencies: [{ taskTempId, taskRlId, dependsOnTempId, dependsOnRlId, type?: "FS"|"SS"|"FF"|"SF", lagDays?: 0 }] }`
**Backend:** `POST /tasks/{taskRlId}/add-dependencies` for each. Skip if either task's RL ID missing.
**Output:** `{ success, summary: { total, set, failed, skipped } }`

### Tool 7: retry_failed_items

**Purpose:** Retries failed items from execution. User-triggered.
**When:** Only if user requests retry after seeing failures.
**Input:** `{ projectId, failedItems: [...], idMap }`
**Output:** Same as execute_creation_pass but only for retried items.

### Tool 8: get_execution_summary

**Purpose:** Compiles final report from execution log.
**When:** After execution complete.
**Input:** `{ sessionId }`
**Output:** `{ projectId, projectUrl, stats: { phases, tasks, subtasks, milestones, dependencies — planned vs created vs failed }, totalApiCalls, totalDuration_seconds, failedItems, logDownloadReady }`
**State update:** Set status "done".

---

## 6. Agent Autonomy Boundaries

### 6.1 Core Principle

**The agent is autonomous within a step, but never crosses step boundaries without human approval.**

Within each of the 6 workflow steps (Connect → Upload → Analyse → Review & Confirm → Execute → Done), the agent can reason, call tools, retry, and self-correct freely. Transitioning between steps always requires explicit user action.

### 6.2 Autonomy Matrix

**Act Autonomously (no permission needed):**
- Reason about hierarchy from structural signals in the data
- Reason about column meanings from headers and sample values
- Calculate phase dates from child tasks
- Auto-group orphan items under "Ungrouped Tasks" phase
- Normalise dates to YYYY-MM-DD
- Detect milestone candidates from PM knowledge
- Handle empty/malformed/partial rows silently
- Detect and skip project-level summary rows
- Run Gate 1 validation and self-correct
- Retry failed API calls during execution (up to 3x)
- Continue past individual execution failures
- Fetch workspace context after connection validated
- Generate execution summary

**Act Then Inform (do it, tell the user what was done):**
- Column mapping interpretation and its reasoning
- Hierarchy detection method and reasoning
- Orphan item grouping
- Date format detection and normalisation
- Phase date calculation from children
- Dependency detection and what notation pattern it found
- Malformed row handling (skipped X, kept Y with partial data)
- Phase creation from flat data ("I grouped tasks into N phases based on...")
- Status/progress value interpretation
- Summary row detection ("Row 1 looks like a project container, not a phase")

**Stop and Ask (clickable options, not typed responses):**
- Ambiguous dates where DD/MM could be swapped
- Multiple sheets in Excel — which one to use
- Deep nesting beyond depth 3 — keep nested, flatten, or per-item
- No detectable hierarchy after reasoning through all signals
- Duplicate task names — separate items or duplicates?
- Project name, customer/account, owner email — always collected explicitly
- Milestone confirmations — agent suggests, user toggles
- Final plan approval before execution
- Post-execution failure handling (retry, skip, abort)

### 6.3 Human-in-the-Loop Checkpoints (5 mandatory, non-bypassable)

| # | Checkpoint | Agent Shows | User Does |
|---|-----------|------------|-----------|
| 1 | API Key Entry | Welcome message, template download | Enters key |
| 2 | File Upload | Upload area, template link | Drops file |
| 3 | Plan Review | Structured plan with column mapping, hierarchy, milestones, stats, warnings | Reviews, toggles milestones, handles nesting, confirms |
| 4 | Project Details | Auto-filled form: name, customer, owner, dates | Confirms or edits |
| 5 | Execution Approval | Final count summary + estimated API calls/time | Clicks Execute or Go Back |

Plan review (structure) comes BEFORE project details (metadata) — user sees what will be created before deciding where it goes.

### 6.4 Edge Cases

**No detectable hierarchy:** Agent reasons through all known PM tool patterns. If truly flat, proactively creates phase groupings from contextual signals (date clusters, naming patterns, functional grouping) and presents in review. Never stops dead.

**Tasks but no phases:** Agent creates phase suggestions and presents them. Act-then-inform, not stop-and-ask.

**Conflicting dates (child outside parent range):** Auto-extends parent dates. Informs user.

**Massive file (500+ rows):** Warns during review with estimated API calls and time. Informational, not blocking.

**Re-upload after analysis:** Accepted at any point before execution. Resets to Step 2.

**API key expires mid-execution:** Stops immediately. Reports what was created. Asks for new key. Resumes from where it stopped (no re-creation).

**Duplicate project name:** Warns. Lets user choose different name or proceed.

**Cancel mid-execution:** User can cancel. Agent stops, reports partial results, links to partial project in RL.

---

## 7. Validation Gates

### Gate 1: Post-Analysis (Tool: validate_plan_structure)
11 programmatic checks before showing plan to user. See Tool 3 definition.

### Gate 2: Post-Review Diff
Agent summarises changes, counts items, confirms with user before execution.

### Gate 3: Execution API Validation
Every RL API call checked: HTTP 201, expected ID in response, name match, xRequestId captured.

### Gate 4: Post-Execution Reconciliation
Planned vs created counts for phases, tasks, subtasks, milestones, dependencies. Mismatches flagged with specifics.

---

## 8. UI/UX Design

### 8.1 Design Philosophy

Single-column conversational chat with rich components embedded inline. The agent drives the conversation. Questions with discrete options use clickable buttons/chips — never require typed responses.

### 8.2 Visual Design — Rocketlane-Aligned

The UI uses Rocketlane's actual design tokens to feel native to their product ecosystem.

**Color palette (from Rocketlane production CSS — IBM Carbon Design System):**

| Token | Hex | Usage |
|-------|-----|-------|
| --rl-primary | #0F62FE | Primary buttons, links, active states |
| --rl-primary-hover | #0353E9 | Button hover |
| --rl-accent | #8A3FFC | Agent avatar, AI highlights, progress bar, milestone stars — Rocketlane's Nitro/AI color |
| --rl-accent-light | #EDE5FF | Agent message card background |
| --rl-success | #198038 | ✓ checkmarks, completion |
| --rl-warning | #D12771 | ⚠ flags, milestone candidates |
| --rl-error | #da1e28 | ✗ failed items |
| --rl-teal | #08BDBA | Dependency links, info badges |
| --rl-text-primary | #161616 | Primary text |
| --rl-text-secondary | #556268 | Descriptions, timestamps |
| --rl-text-muted | #6F6F6F | Placeholders, disabled |
| --rl-border | #D0D3DA | Card borders, dividers |
| --rl-bg-surface | #F4F4F4 | Component cards |
| --rl-bg-base | #FFFFFF | Page background |
| --rl-bg-dark | #161616 | Header bar |

**Typography:** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

**Why Rocketlane-aligned:** Signals product thinking, looks native when embedded as Custom App, echoes Nitro's purple AI accent.

### 8.3 Layout

```
┌──────────────────────────────────────────┐
│ Header: Agent title + connection badge    │
│         + step indicator dots             │
├──────────────────────────────────────────┤
│ Chat Area (scrollable, full height)       │
│                                          │
│  [Agent messages — left, purple bg]      │
│  [Rich components — full width cards]    │
│  [User messages — right, blue bg]        │
│                                          │
├──────────────────────────────────────────┤
│ Input: [text field] [Send] [Upload icon] │
└──────────────────────────────────────────┘
```

- Max-width 720px, centred on desktop
- Connection badge: persistent "Connected to workspace ✓" after Step 1
- Step indicator: subtle dots showing current position in 6-step flow
- Drag-and-drop on entire chat area

### 8.4 Step-by-Step UI Flow

**Step 1 — Connect:**
- Welcome message with API key input card (inline, not modal)
- Password-masked field + "Connect" button
- Template download links (.xlsx + .csv) below the key input
- On success: "Connected to inbarajb.rocketlane.com ✓" + upload prompt

**Step 2 — Upload:**
- Drop zone card embedded in chat (click-to-browse + drag-and-drop)
- On upload: file summary card (sheet name, row count, column names)
- Multi-sheet: clickable sheet name buttons to select
- "Analysing..." with contextual loading messages

**Step 3 — Analyse (automatic, no user input):**
- Loading messages cycle: "Reading structure...", "Detecting hierarchy...", "Mapping columns...", "Identifying milestones..."
- Agent returns detection summary + column mapping card
- Column mapping card shows interpretation with "Looks Good" / "Let Me Adjust" buttons

**Step 4 — Review & Confirm:**
- **Plan tree component** (interactive, inline in chat):
  - Collapsible phases (▶/▼ arrows, item count in brackets)
  - Milestone toggles (checkbox next to candidates)
  - Items can be toggled "skip" (grayed out, excluded)
  - Task names editable inline (click-to-edit)
  - Deep nesting options (clickable radio buttons)
  - Orphan items section if applicable
  - "Upload Different File" link
- **Plan summary card** alongside tree:
  - Item counts (phases, tasks, subtasks, milestones, dependencies)
  - Max nesting depth
  - Validation results (✓ No orphans, ✓ Dates valid, ⚠ 3 items missing dates)
  - Skipped/malformed row notes
- **"Approve Plan" button**
- After approval → **Project details form** (inline card):
  - Project name (suggested from file/summary row)
  - Customer dropdown (existing accounts + type new)
  - Owner email (pre-filled)
  - Start/due dates (pre-filled from plan)
  - "Create Project" button

**Step 5 — Execute:**
- Execution approval card: final counts + estimated API calls + time
- "Execute" / "Go Back" buttons
- **Progress component** (after Execute clicked):
  - Phase-segmented progress bar (shows which phase is being built)
  - Live action log (auto-scrolling entries: ✓ success, ✗ failed, ⭐ milestone)
  - "View in Rocketlane →" link appears as soon as project shell is created
  - "Cancel Execution" button
- Pass 2 (dependencies) transitions seamlessly after Pass 1

**Step 6 — Done:**
- Completion card: stats, project link, log download
- If failures: failed items listed with "Retry Failed" / "Skip & Finish" buttons
- "Upload New Plan" / "Start Over" buttons

### 8.5 Clickable Options Pattern

Every agent question with discrete answers uses clickable chips/buttons:

```
│ Options presented as clickable buttons:     │
│                                             │
│ [ Option A ]  [ Option B ]  [ Option C ]    │
```

This applies to: sheet selection, ambiguous dates, nesting options, milestone toggles, duplicate handling, failure recovery, and any other decision with 2-5 discrete choices.

Open-ended questions (project name, custom input) use embedded text input fields in cards.

### 8.6 Message Types

1. **Agent text** — left-aligned, agent avatar (purple circle), markdown-rendered
2. **User text** — right-aligned, blue background, white text
3. **Rich components** — full-width cards with subtle background/border (file upload, plan tree, progress, completion)
4. **System notices** — small, centred, muted ("Connected ✓", "File uploaded ✓", "Analysing...")

### 8.7 Responsive

- Desktop (>768px): 720px max-width centred
- Mobile (<480px): full width, chips stack vertically, minimum 44px tap targets

### 8.8 Custom App Adaptations

When embedded in Rocketlane iframe:
- Header bar hidden (RL provides chrome)
- API base URL cross-origin (NEXT_PUBLIC_API_BASE_URL set to Vercel URL)
- Everything else identical

---

## 9. Rocketlane API Reference

### Base URL: `https://api.rocketlane.com/api/1.0`
### Auth: Header `api-key: <key>`

### Create Project
```
POST /projects
{
  "projectName": "required",
  "owner": { "emailId": "required" },
  "customer": { "companyName": "required — case-sensitive" },
  "startDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "autoCreateCompany": true
}
→ 201: { projectId }
```

### Create Phase
```
POST /phases
{
  "phaseName": "required",
  "project": { "projectId": "required integer" },
  "startDate": "YYYY-MM-DD — REQUIRED",
  "dueDate": "YYYY-MM-DD — REQUIRED"
}
→ 201: { phaseId }
```

### Create Task / Subtask / Milestone
```
POST /tasks
{
  "taskName": "required",
  "project": { "projectId": "required integer" },
  "phase": { "phaseId": "integer" },
  "parent": { "taskId": "integer — for subtasks" },
  "type": "TASK | MILESTONE",
  "startDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "effortInMinutes": "integer",
  "progress": "0-100",
  "status": { "value": "1=To do, 2=In progress, 3=Completed" },
  "taskDescription": "HTML string"
}
→ 201: { taskId }
```

### Add Dependencies
```
POST /tasks/{taskId}/add-dependencies
{
  "dependencies": [{ "taskId": "integer" }]
}
```

### Error Codes
- 201: Created
- 400: Bad request (parse error, field message)
- 401: Unauthorized (invalid/expired key)
- 500: Server error

### Important Notes
- Phase dates are REQUIRED — unlike tasks
- Every task needs a phaseId (walk up parent chain to find ancestor phase)
- Subtasks use same /tasks endpoint with parent.taskId
- Milestones use same /tasks endpoint with type: "MILESTONE"
- X-Request-Id header on all responses — capture for debugging
- Unlimited nesting depth confirmed via testing

---

## 10. Repository Structure

```
project-plan-agent/
├── app/
│   ├── page.tsx                    ← Main agent interface
│   ├── layout.tsx                  ← Root layout
│   └── api/
│       ├── chat/route.ts           ← Agent loop (ReAct)
│       ├── upload/route.ts         ← File upload + SheetJS parsing
│       ├── rocketlane/
│       │   ├── project/route.ts    ← Create project proxy
│       │   ├── phase/route.ts      ← Create phase proxy
│       │   ├── task/route.ts       ← Create task proxy
│       │   └── dependency/route.ts ← Add dependencies proxy
│       ├── session/route.ts        ← Session CRUD
│       ├── session/progress/route.ts
│       └── session/log/route.ts
├── components/
│   ├── Chat.tsx                    ← Main chat container
│   ├── MessageBubble.tsx           ← Agent/user message rendering
│   ├── ApiKeyInput.tsx             ← Step 1 card
│   ├── FileUpload.tsx              ← Step 2 drop zone
│   ├── ColumnMapping.tsx           ← Step 3 mapping card
│   ├── PlanTree.tsx                ← Step 4 interactive tree
│   ├── PlanSummary.tsx             ← Step 4 stats card
│   ├── ProjectDetailsForm.tsx      ← Step 4 project form
│   ├── ExecutionProgress.tsx       ← Step 5 progress feed
│   ├── CompletionCard.tsx          ← Step 6 summary
│   └── ClickableOptions.tsx        ← Reusable chip/button options
├── lib/
│   ├── prompts/
│   │   ├── system.ts               ← Base system prompt (identity, PM knowledge, RL model, rules)
│   │   ├── tools-schema.ts         ← Tool definitions
│   │   └── context.ts              ← Dynamic context builder
│   ├── tools/
│   │   ├── validate-connection.ts
│   │   ├── fetch-context.ts
│   │   ├── validate-plan.ts        ← Gate 1 (11 checks)
│   │   ├── create-project.ts
│   │   ├── execute-creation.ts     ← Pass 1
│   │   ├── execute-dependencies.ts ← Pass 2
│   │   ├── retry-failed.ts
│   │   └── execution-summary.ts
│   ├── redis.ts                    ← Upstash client
│   ├── rocketlane.ts               ← RL API client
│   ├── file-parser.ts              ← SheetJS wrapper (extracts indentation)
│   ├── encryption.ts               ← API key encryption
│   └── types.ts                    ← TypeScript types
├── public/
│   ├── template.xlsx               ← Download template
│   └── template.csv
├── middleware.ts                    ← CORS for Custom App
├── next.config.js
├── tailwind.config.js
├── package.json
└── README.md
```

---

## 11. Demo Scenario

**Product:** FM Engine (WhatsApp-first CMMS platform)
**Client:** Shard, UK — purchased FM Engine, needs onboarding
**Source plan:** Adapted from UK Lifts implementation plan (Smartsheet export, 62 rows, 5 levels deep)
**Project dates:** Adjusted to April 20, 2026 → June 30, 2026

The demo CSV should be created from the UK Lifts plan structure with FM Engine context. This is NOT hardcoded into the agent — it's test data. The agent works for ANY project plan.

---

## 12. Build Sequence

### Phase 1: Foundation (get something working end-to-end)
1. Initialize Next.js project with Tailwind
2. Build `/api/upload` route with SheetJS (extracts indentation)
3. Build `/api/chat` route with Claude ReAct loop
4. Build `validate_rocketlane_connection` and `fetch_rocketlane_context` tools
5. Build the chat UI component with message rendering
6. Build API key input component
7. Build file upload component
8. Upstash Redis integration (session state, messages)
9. Claude system prompt (PM knowledge + RL data model + rules)

### Phase 2: Intelligence (the agent brain)
10. Build `validate_plan_structure` tool (Gate 1)
11. Build column mapping card component
12. Build plan tree component (collapsible, milestone toggles)
13. Build plan summary card component
14. Build project details form component
15. Build clickable options component

### Phase 3: Execution (make it create things)
16. Build `create_rocketlane_project` tool
17. Build `execute_creation_pass` tool
18. Build `execute_dependency_pass` tool
19. Build execution progress component (phase-segmented bar, live log)
20. Build `/api/session/progress` polling endpoint
21. Build `retry_failed_items` tool
22. Build `get_execution_summary` tool
23. Build completion card component

### Phase 4: Polish
24. Create demo CSV (Shard FM Engine adaptation)
25. Create downloadable template (XLSX + CSV)
26. End-to-end testing
27. Error handling polish
28. Deploy to Vercel

### Phase 5: Submission
29. Write BRD
30. Create Custom App .zip (if time permits)
31. Set up Spaces in RL project
32. Record walkthrough
33. Submit

---

## 13. Submission Deliverables

| Deliverable | Format |
|-------------|--------|
| Live agent | Vercel URL |
| Pre-built RL project | Created by agent during demo |
| BRD | PDF in RL Spaces |
| Demo CSV | File in RL Spaces |
| Template | Downloadable from agent |
| Source code | GitHub repo |
| Custom App | .zip in RL (bonus) |
| Walkthrough | Recording or screenshots |

Container: Rocketlane project "Rocketlane Assignment" (ID: 5000000073039).

---

## 14. Rocketlane Account Details

- Workspace: inbarajb.rocketlane.com
- Plan: Enterprise (trial)
- Company: FM Engine (https://www.fmengine.space/)
- Owner email: inbarajb91@gmail.com
- Assignment project ID: 5000000073039
