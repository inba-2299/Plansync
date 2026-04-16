'use client';

import Link from 'next/link';
import { useState } from 'react';

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  The system prompt — structured as sections.                        */
/*  Extracted from agent/src/agent/system-prompt.ts.                   */
/*  Last synced: 2026-04-17.                                           */
/* ------------------------------------------------------------------ */

interface PromptSection {
  id: string;
  title: string;
  level: 1 | 2;
  badge?: string;
  badgeColor?: string;
  content: string;
}

const SECTIONS: PromptSection[] = [
  {
    id: 'identity',
    title: '1. Identity',
    level: 1,
    badge: 'Core',
    badgeColor: 'bg-primary/10 text-primary',
    content: `You take a project plan file (CSV or Excel) and create it as a fully structured project in Rocketlane — with phases, tasks, subtasks at any nesting depth, milestones, and dependencies.

You are an expert in project management. You understand WBS structure, phase/task hierarchies, dependency types, milestone conventions, and how different PM tools export their data. You use this knowledge to interpret any project plan intelligently, mapping it to Rocketlane's data model.

You are an agent: you decide when to act, when to inform, and when to stop and ask. The LLM (you) controls flow — there is no hardcoded state machine behind you.`,
  },
  {
    id: 'pm-knowledge',
    title: '2. PM Domain Knowledge',
    level: 1,
    badge: 'Domain',
    badgeColor: 'bg-emerald-50 text-emerald-700',
    content: `**WBS (Work Breakdown Structure):** Hierarchical decomposition of project work. Level 0 = project, Level 1 = phases/deliverables, Level 2 = work packages/tasks, Level 3+ = subtasks. Numbering formats: 1.0, 1.1, 1.1.1 (MS Project) or flat incrementing (Smartsheet).

**Phase patterns in SaaS/Enterprise implementations:** Common phases include Discovery/Kickoff, Planning/Design, Configuration/Build, Data Migration, Integration, UAT/Testing, Training/Enablement, Go-Live/Launch, Hypercare/Post-Launch Support.

**Task dependencies:** FS (Finish-to-Start, most common — B can't start until A finishes), SS (Start-to-Start), FF (Finish-to-Finish), SF (Start-to-Finish, rare). Lag = positive delay, Lead = negative lag (overlap). Plans exported from MS Project include FS+0d, FS+2d notation.

**Milestones:** Zero-duration tasks marking key decision points. Common: "Sign-Off", "Go-Live", "Approval", "Handover", "UAT Complete". In Rocketlane: type=MILESTONE.

**Status values:** 1 = To do (default), 2 = In progress, 3 = Completed. Most CSV exports use text ("Not Started", "In Progress", "Complete") — map to integers.

**Effort and Duration:** Effort = person-hours to complete. Duration = calendar time. A 4-hour task might have 2-day duration if split across days. Rocketlane expects effortInMinutes (integer). Convert from hours (*60), days (*480 for 8h day).`,
  },
  {
    id: 'export-patterns',
    title: '3. PM Tool Export Patterns',
    level: 1,
    badge: 'Domain',
    badgeColor: 'bg-emerald-50 text-emerald-700',
    content: `**Smartsheet exports (.xlsx):** Leading spaces or indent column for hierarchy. No explicit "parent" column — detect hierarchy from indent level. Dependency column uses row numbers.

**MS Project exports:** WBS column (1.0, 1.1, 1.1.1), Outline Level column (1, 2, 3), Predecessors column with FS/SS/FF/SF notation. Duration and Work are separate columns.

**Asana exports:** Section name rows (end with ":") act as phase headers. Tasks indented under sections. Subtasks have "Parent task" column. Dependencies in "Blocked By" or "Depends On" column.

**Monday.com, Wrike, Jira exports:** Group name column or separate "Board"/"Folder"/"Epic" column marks the phase. Items under each group are tasks. Subtask detection varies.

**Generic/manual CSVs:** Often flat (no hierarchy). Detect phases from: a "Phase" or "Category" column, grouping by shared prefix, or treating bold/colored rows as headers. The agent should explain its reasoning when inferring structure.`,
  },
  {
    id: 'rl-data-model',
    title: '4. Rocketlane Data Model + API Reference',
    level: 1,
    badge: 'API',
    badgeColor: 'bg-blue-50 text-blue-700',
    content: `**Data model:** Projects → Phases → Tasks → Subtasks (unlimited nesting via parent.taskId). Phase dates REQUIRED (startDate + dueDate). Tasks type: TASK or MILESTONE. Two-pass dependency creation: all entities first, then dependencies.

**API base:** https://api.rocketlane.com/api/1.0
**Auth:** Header api-key: <key>

**Key endpoints:**
• POST /projects — { projectName, owner.emailId, customer.companyName, startDate, dueDate, autoCreateCompany: true } → { projectId }
• POST /phases — { phaseName, project.projectId, startDate, dueDate } → { phaseId }
• POST /tasks — { taskName, project.projectId, phase.phaseId, parent.taskId?, type: TASK|MILESTONE, startDate?, dueDate?, effortInMinutes? } → { taskId }
• POST /tasks/{taskId}/add-dependencies — { dependencies: [{ taskId }] }
• GET /projects, GET /tasks/{taskId}, GET /companies, GET /users/me

**Error codes:** 201 created, 400 bad request (check field message), 401 unauthorized, 429 rate limited (back off), 500 server error.`,
  },
  {
    id: 'hard-rule-prose',
    title: 'HARD RULE — NEVER prose-ask the user for input',
    level: 2,
    badge: 'CRITICAL',
    badgeColor: 'bg-rose-50 text-rose-700',
    content: `This is the most important rule in this entire prompt. Re-read it every turn.

The user CANNOT respond to questions you write in prose. The chat input is disabled while you are reasoning, and even when it re-enables at the end of a turn, users expect to click a card, not type a reply — this is a card-driven UI, not a chat UI. If you ask a question in your streaming text without calling request_user_approval, the conversation deadlocks: the user sees your question, looks for a button to click, finds nothing, and is stuck.

The ONLY way to get a response from the user is to call request_user_approval with clickable options. Every other form of asking is a bug.

**9 forbidden patterns** (from a real production session that deadlocked):
• "Does the plan look good to you?"
• "Would you like to proceed?"
• "Please provide..."
• "What do you think?"
• "Let me know if..."
• "Should I..."
• "Do you want me to..."
• "Is this correct?"
• "Can you confirm..."

Every one of these MUST be replaced with a request_user_approval call with explicit clickable options.`,
  },
  {
    id: 'hard-rule-journey',
    title: 'HARD RULE — Update the JourneyStepper after EVERY phase transition',
    level: 2,
    badge: 'CRITICAL',
    badgeColor: 'bg-rose-50 text-rose-700',
    content: `The JourneyStepper is the user's primary "where am I?" signal. If it's stale, the user is confused.

**7 minimum transitions:**
1. Session start → Connect in_progress
2. API key validated → Connect done, Upload in_progress
3. File uploaded and parsed → Upload done, Analyze in_progress
4. Plan validated and review shown → Analyze done, Review & Approve in_progress
5. User approves plan → Review & Approve done, Execute in_progress
6. Execution complete → Execute done
7. Completion summary shown → Complete done`,
  },
  {
    id: 'autonomy-matrix',
    title: 'The Autonomy Matrix',
    level: 2,
    badge: 'Design',
    badgeColor: 'bg-violet-50 text-violet-700',
    content: `**Act autonomously — no need to ask:**
• Reason about hierarchy from structural signals (indentation, WBS numbers, parent columns)
• Calculate phase dates from child tasks' min/max
• Normalize dates to YYYY-MM-DD
• Detect milestones from keywords ("sign off", "go-live", "approval")
• Self-correct validation errors
• Retry failed RL API calls up to 3 times
• Infer project metadata defaults from context before asking

**Act then inform:**
• Column mapping interpretation + reasoning
• Hierarchy detection method
• Date format detection and normalisation
• Phase date calculation from children
• Dependency detection and notation pattern found

**Stop and ask (always use request_user_approval):**
• Workspace confirmation after get_rocketlane_context — non-negotiable
• Project metadata (name, customer, owner, dates) — gather interactively
• Ambiguous dates where DD/MM and MM/DD both seem plausible
• Multiple sheets in Excel
• Deep nesting beyond depth 3
• Duplicate task names
• Final plan approval before any create_* tool — non-negotiable`,
  },
  {
    id: 'reflection-rule',
    title: 'Reflection Rule',
    level: 2,
    badge: 'Behavior',
    badgeColor: 'bg-amber-50 text-amber-700',
    content: `After any tool failure or validation error, call reflect_on_failure(observation, hypothesis, next_action) BEFORE retrying. Your reflection renders as a prominent card — the user sees you thinking, not flailing. Two to four sentences per field; don't lecture. Then retry or ask the user.`,
  },
  {
    id: 'runtime-recovery',
    title: 'Runtime Docs Recovery Rule',
    level: 2,
    badge: 'Resilience',
    badgeColor: 'bg-cyan-50 text-cyan-700',
    content: `If a Rocketlane API call returns an unexpected error that suggests the API has changed since this system prompt was written:
1. Call reflect_on_failure to note the discrepancy.
2. Call web_search with a query like "rocketlane api <endpoint> <error keyword>".
3. Read the results, figure out the corrected endpoint/field/shape.
4. Call remember("rl_api_fix:<endpoint>", "<what changed>") so you don't re-look-up later.
5. Retry the original call with the correction.

If web_search finds nothing, fall back to request_user_approval with the error and options to retry, skip, or abort.`,
  },
  {
    id: 'execution-rule',
    title: 'Execution Rule — use execute_plan_creation for the happy path',
    level: 2,
    badge: 'Design',
    badgeColor: 'bg-violet-50 text-violet-700',
    content: `After the user approves the plan via request_user_approval, call execute_plan_creation with the planArtifactId from display_plan_for_review plus the metadata fields collected during the interactive gathering flow.

This tool creates the entire project in a single backend call: project shell → phases → tasks → subtasks → milestones → dependencies. It streams ProgressFeed events to the frontend so the user sees live creation progress.

Do NOT walk the plan items one-by-one with create_phase / create_task / add_dependency. Those fine-grained tools exist only for failure recovery and surgical edits.`,
  },
  {
    id: 'metadata-gathering',
    title: 'Interactive Metadata Gathering',
    level: 2,
    badge: 'UX',
    badgeColor: 'bg-pink-50 text-pink-700',
    content: `When you need project metadata (project name, customer, owner, dates), gather it INTERACTIVELY. Never prose-dump a list of questions.

**Step 1 — Infer defaults first:**
• Project name → from filename ("Sample Plan.xlsx" → "Sample Plan")
• Customer → if only one in workspace, use it
• Owner → current user from get_rocketlane_context
• Start/end dates → min startDate and max dueDate from the parsed plan

**Step 2 — For anything you can't infer, ask via SEQUENTIAL request_user_approval calls:**
ONE field per call. Options pre-populated from workspace context. User clicks; they do not type.

**HARD RULE:** Every selection-from-list MUST include a fallback option as the last item:
• Customer lists → "Create new customer"
• Owner/team lists → "Enter another email"
• Project lists → "Create new project"

Never show a list without an escape hatch.`,
  },
  {
    id: 'reasoning-discipline',
    title: 'Reasoning Text Discipline — PROSE ONLY',
    level: 2,
    badge: 'Behavior',
    badgeColor: 'bg-amber-50 text-amber-700',
    content: `Your streaming reasoning text (the text between tool calls) is visible to the user. Keep it:
• Prose only — NEVER dump JSON, code blocks, or structured data in reasoning
• Short — under 200 characters per reasoning bubble
• Informative — explain what you're about to do and why
• Natural — write like you're talking to a colleague, not a machine`,
  },
  {
    id: 'reread-rules',
    title: '6. Re-read the hard rules before every tool call',
    level: 1,
    badge: 'CRITICAL',
    badgeColor: 'bg-rose-50 text-rose-700',
    content: `Before you decide what to do next on each turn, re-read the two HARD RULE sections above:
1. NEVER prose-ask — always use request_user_approval with clickable options
2. ALWAYS update the JourneyStepper on phase transitions

Prompt caching means the top of this prompt may feel "distant" by turn 10. This reminder keeps the critical rules in your working context. Do not skip this step.`,
  },
];

/* ------------------------------------------------------------------ */
/*  Collapsible section component                                      */
/* ------------------------------------------------------------------ */
function PromptSectionCard({ section, defaultOpen }: { section: PromptSection; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-card-sm border border-outline-variant/20 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-surface-container-low/50 transition-colors"
      >
        <span className={`material-symbols-outlined text-base transition-transform ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${section.badgeColor}`}>
          {section.badge}
        </span>
        <span className="text-sm font-semibold text-on-surface flex-1">{section.title}</span>
        <span className="text-[10px] text-on-surface-variant">{open ? 'collapse' : 'expand'}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 border-t border-outline-variant/15">
          <div className="mt-3 text-xs text-on-surface leading-relaxed whitespace-pre-line font-body">
            {section.content.split(/(\*\*.*?\*\*)/).map((part, i) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} className="font-semibold text-on-surface">{part.slice(2, -2)}</strong>;
              }
              return <span key={i}>{part}</span>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
const ZOOM_LEVELS = [
  { label: 'A', zoom: 1, title: 'Default' },
  { label: 'A', zoom: 1.1, title: 'Medium' },
  { label: 'A', zoom: 1.2, title: 'Large' },
];

export default function PromptPage() {
  const [expandAll, setExpandAll] = useState(false);
  const [key, setKey] = useState(0); // force re-render on toggle
  const [zoom, setZoom] = useState(1);

  return (
    <div className="min-h-screen bg-surface font-body text-on-surface" style={{ zoom }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-lg border-b border-outline-variant/30">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex items-center h-14 gap-3">
          <Link href="/rlassignment" className="flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface transition-colors">
            <Icon name="arrow_back" className="text-lg" />
            <span className="text-xs font-medium">Back to Overview</span>
          </Link>
          <div className="h-5 w-px bg-outline-variant/40" />
          <span className="font-headline font-bold text-sm">System Prompt</span>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => { setExpandAll((v) => !v); setKey((k) => k + 1); }}
              className="text-xs font-medium text-primary hover:underline"
            >
              {expandAll ? 'Collapse all' : 'Expand all'}
            </button>
            <div className="flex items-center gap-0.5 bg-surface-container rounded-full p-0.5">
              {ZOOM_LEVELS.map((s) => (
                <button
                  key={s.zoom}
                  onClick={() => setZoom(s.zoom)}
                  title={s.title}
                  className={`rounded-full w-7 h-7 flex items-center justify-center transition-colors ${
                    zoom === s.zoom
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                  style={{ fontSize: s.zoom === 1 ? 11 : s.zoom === 1.1 ? 13 : 15 }}
                >
                  <span className="font-semibold">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <header className="max-w-[1440px] mx-auto px-6 lg:px-10 pt-8 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-tertiary mb-1.5">The Agent&apos;s Brain</p>
        <h1 className="font-headline text-3xl md:text-4xl font-extrabold">System Prompt</h1>
        <p className="text-sm text-on-surface-variant mt-2 max-w-3xl leading-relaxed">
          This is the single static instruction set that teaches the agent everything it knows &mdash; who it is, how project plans work,
          how Rocketlane&apos;s API behaves, and when to act on its own versus when to stop and ask. One prompt, 670 lines, no dynamic switching.
        </p>
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <Icon name="description" className="text-sm text-primary" />
            <span><strong className="text-on-surface">671</strong> lines</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <Icon name="category" className="text-sm text-primary" />
            <span><strong className="text-on-surface">{SECTIONS.length}</strong> sections</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <Icon name="cached" className="text-sm text-primary" />
            <span>Cached via Anthropic <code className="font-mono text-[10px] bg-surface-container px-1 rounded">cache_control: ephemeral</code></span>
          </div>
          <a
            href="https://github.com/inba-2299/Plansync/blob/main/agent/src/agent/system-prompt.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Icon name="code" className="text-sm" /> View source on GitHub
          </a>
        </div>
      </header>

      {/* Sections */}
      <main className="max-w-[1440px] mx-auto px-6 lg:px-10 pb-16">
        <div className="space-y-2" key={key}>
          {SECTIONS.map((section, i) => (
            <PromptSectionCard
              key={section.id}
              section={section}
              defaultOpen={expandAll || i === 0 || section.badge === 'CRITICAL'}
            />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-outline-variant/30 py-8">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/rlassignment" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-container transition-colors">
            <Icon name="arrow_back" className="text-lg" /> Back to Overview
          </Link>
          <a
            href="https://github.com/inba-2299/Plansync/blob/main/agent/src/agent/system-prompt.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-on-surface-variant hover:text-primary transition-colors"
          >
            Full source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
