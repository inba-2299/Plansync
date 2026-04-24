'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <div className={`w-3 h-3 rounded-full border-2 transition-all ${
      done ? 'bg-success border-success' : active ? 'bg-primary border-primary scale-125' : 'bg-surface-container border-outline-variant'
    }`} />
  );
}

/* ------------------------------------------------------------------ */
/*  Interactive section wrapper                                        */
/* ------------------------------------------------------------------ */
function InteractiveSection({
  id, title, sub, steps, icon,
}: {
  id: string;
  title: string;
  sub: string;
  icon: string;
  steps: Array<{ label: string; detail: string; visual: React.ReactNode }>;
}) {
  const [step, setStep] = useState(0);

  return (
    <section id={id} className="scroll-mt-20 py-10 md:py-14">
      <div className="max-w-[1440px] mx-auto px-6 lg:px-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon name={icon} className="text-primary text-xl" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-tertiary">{sub}</p>
            <h2 className="font-headline text-xl md:text-2xl font-extrabold text-on-surface">{title}</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left — step controls */}
          <div>
            {/* Step dots */}
            <div className="flex items-center gap-2 mb-4">
              {steps.map((_, i) => (
                <button key={i} onClick={() => setStep(i)} className="p-1">
                  <StepDot active={i === step} done={i < step} />
                </button>
              ))}
              <span className="text-[10px] text-on-surface-variant ml-2">Step {step + 1} of {steps.length}</span>
            </div>

            {/* Step list */}
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`w-full text-left px-4 py-2.5 rounded-lg transition-all ${
                    i === step
                      ? 'bg-primary/10 border border-primary/30'
                      : i < step
                        ? 'bg-success/5 border border-success/15'
                        : 'bg-surface-container border border-outline-variant/20 hover:border-primary/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {i < step && <Icon name="check_circle" className="text-success text-sm" />}
                    {i === step && <Icon name="play_circle" className="text-primary text-sm" />}
                    {i > step && <span className="w-4 h-4 rounded-full border border-outline-variant text-[9px] font-bold flex items-center justify-center text-on-surface-variant">{i + 1}</span>}
                    <span className={`text-xs font-semibold ${i === step ? 'text-primary' : i < step ? 'text-success' : 'text-on-surface'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i === step && (
                    <p className="text-[11px] text-on-surface-variant mt-1.5 leading-relaxed ml-6">{s.detail}</p>
                  )}
                </button>
              ))}
            </div>

            {/* Nav buttons */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface-variant disabled:opacity-30 hover:border-primary/30"
              >
                Previous
              </button>
              <button
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                disabled={step === steps.length - 1}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-on-primary disabled:opacity-30"
              >
                Next
              </button>
              {step === steps.length - 1 && (
                <button onClick={() => setStep(0)} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-primary hover:underline">
                  Replay
                </button>
              )}
            </div>
          </div>

          {/* Right — animated visual */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-card p-6 min-h-[320px] flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25 }}
                className="w-full"
              >
                {steps[step].visual}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Visual building blocks                                             */
/* ------------------------------------------------------------------ */
function FlowBox({ label, sub, color = 'primary', icon, active = false }: {
  label: string; sub?: string; color?: string; icon: string; active?: boolean;
}) {
  const colors: Record<string, string> = {
    primary: 'bg-primary/10 border-primary/30 text-primary',
    tertiary: 'bg-tertiary/10 border-tertiary/30 text-tertiary',
    success: 'bg-success/10 border-success/30 text-success',
    rose: 'bg-rose-50 border-rose-200 text-rose-600',
    amber: 'bg-amber-50 border-amber-200 text-amber-600',
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colors[color]} ${active ? 'ring-2 ring-offset-1 ring-primary shadow-card' : ''}`}>
      <div className="flex items-center gap-2">
        <Icon name={icon} className="text-lg" />
        <div>
          <div className="text-xs font-bold">{label}</div>
          {sub && <div className="text-[10px] opacity-70">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return <div className="flex justify-center py-1"><Icon name="arrow_downward" className="text-outline/40 text-sm" /></div>;
}

function CodeSnippet({ code }: { code: string }) {
  return (
    <pre className="bg-on-surface/[0.03] rounded-lg px-4 py-3 text-[10px] font-mono text-on-surface leading-relaxed overflow-x-auto border border-outline-variant/15">
      {code}
    </pre>
  );
}

function DataFlow({ from, to, label, active = false }: { from: string; to: string; label: string; active?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] ${active ? 'bg-primary/10 border border-primary/20' : 'bg-surface-container border border-outline-variant/15'}`}>
      <span className="font-semibold text-on-surface">{from}</span>
      <Icon name="arrow_forward" className={`text-xs ${active ? 'text-primary' : 'text-outline'}`} />
      <span className="font-semibold text-on-surface">{to}</span>
      <span className="text-on-surface-variant ml-auto">{label}</span>
    </div>
  );
}

/* ================================================================== */
/*  SECTION DATA                                                       */
/* ================================================================== */

const REACT_LOOP_STEPS = [
  {
    label: 'User sends a message',
    detail: 'The frontend POSTs to /agent with the sessionId + userMessage. The backend loads the session from Redis, pushes the message to history, and starts the loop.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="person" label="User" sub="Types message or clicks approval" color="blue" active />
        <Arrow />
        <DataFlow from="Frontend" to="POST /agent" label="{ sessionId, userMessage }" active />
        <Arrow />
        <FlowBox icon="database" label="Redis" sub="loadSession(sessionId) → history, meta, idmap, remember" color="amber" />
        <Arrow />
        <FlowBox icon="psychology" label="Agent Loop" sub="Ready to start turn 1" color="primary" />
      </div>
    ),
  },
  {
    label: 'Claude reasons (streaming)',
    detail: 'The full conversation history + system prompt + 22 tool schemas are sent to Anthropic. Claude streams back text (reasoning) and tool_use blocks. The backend forwards each chunk as an SSE event.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="psychology" label="Agent Loop" sub="Turn N starts" color="primary" active />
        <Arrow />
        <CodeSnippet code={`anthropic.messages.stream({
  model: "claude-haiku-4-5",
  system: SYSTEM_PROMPT,     // 671 lines, cached
  messages: history,          // conversation so far
  tools: TOOL_SCHEMAS,        // 22 tool definitions
})`} />
        <Arrow />
        <div className="flex gap-2">
          <FlowBox icon="text_fields" label="Text delta" sub="Streams to UI live" color="primary" />
          <FlowBox icon="build" label="Tool use" sub="Agent wants to call a tool" color="tertiary" />
        </div>
      </div>
    ),
  },
  {
    label: 'Tool dispatch + execution',
    detail: 'When Claude emits a tool_use block, the dispatcher routes it to the right function. The tool does its work (validation, API call, memory write) and returns a summary. Non-blocking tools return immediately; request_user_approval pauses the loop.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="psychology" label="Claude says" sub='tool_use: validate_plan({ plan: ... })' color="primary" />
        <Arrow />
        <FlowBox icon="route" label="Dispatcher" sub="Routes by tool name → validate-plan.ts" color="blue" active />
        <Arrow />
        <div className="grid grid-cols-2 gap-2">
          <FlowBox icon="check_circle" label="Tool runs" sub="11 checks, returns errors" color="success" />
          <FlowBox icon="inventory_2" label="Artifact store" sub="Full report stored, summary returned" color="amber" />
        </div>
        <Arrow />
        <CodeSnippet code={`tool_result: "✗ PLAN INVALID — 3 errors:
  • [CIRCULAR_DEP] A → B → A
  • [ORPHAN] task-7 has no parent
  • [BAD_DATE] task-3 startDate after dueDate"`} />
      </div>
    ),
  },
  {
    label: 'Claude reads result + decides next action',
    detail: 'The tool result goes back into the conversation as a tool_result message. Claude reads it, reasons about it (visible in the UI), and decides what to do next — fix the plan, ask the user, call another tool, or end its turn.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="psychology" label="Claude reads the result" sub="Reasons about what to do next" color="primary" active />
        <Arrow />
        <div className="rounded-xl bg-primary/5 border border-primary/15 p-4">
          <p className="text-[11px] text-on-surface italic leading-relaxed">&quot;The validator found 3 errors. The circular dependency is between tasks A and B — I need to remove one direction. The orphan task-7 should go under Phase 2. The date on task-3 has start and end swapped. Let me fix these and re-validate.&quot;</p>
          <p className="text-[10px] text-on-surface-variant mt-2">↑ This reasoning streams live to the user</p>
        </div>
        <Arrow />
        <div className="grid grid-cols-3 gap-2">
          <FlowBox icon="build" label="Call another tool" sub="Self-correct" color="tertiary" />
          <FlowBox icon="front_hand" label="Ask the user" sub="request_user_approval" color="rose" />
          <FlowBox icon="stop_circle" label="End turn" sub="Done reasoning" color="success" />
        </div>
      </div>
    ),
  },
  {
    label: 'Loop continues or pauses',
    detail: 'If stop_reason is "end_turn", the loop is done. If it\'s "tool_use", the loop continues (back to step 3). If the tool is request_user_approval, the loop pauses and waits for the user to click an option — then resumes from step 1.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-success/5 border border-success/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="check_circle" className="text-success text-base" />
              <span className="text-xs font-bold text-success">stop_reason: end_turn</span>
            </div>
            <p className="text-[10px] text-on-surface-variant">Agent is done. Save session to Redis. Send &quot;done&quot; SSE event. Unlock input.</p>
          </div>
          <div className="rounded-xl bg-tertiary/5 border border-tertiary/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="sync" className="text-tertiary text-base" />
              <span className="text-xs font-bold text-tertiary">stop_reason: tool_use</span>
            </div>
            <p className="text-[10px] text-on-surface-variant">Agent wants to call a tool. Dispatch it, push result to history, loop back to step 2.</p>
          </div>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="front_hand" className="text-rose-600 text-base" />
            <span className="text-xs font-bold text-rose-700">tool: request_user_approval</span>
          </div>
          <p className="text-[10px] text-on-surface-variant">Loop PAUSES. Approval card rendered in UI. User clicks an option → new POST /agent with uiAction → loop resumes from step 1.</p>
        </div>
      </div>
    ),
  },
];

const SESSION_STICKY_STEPS = [
  {
    label: 'Every event persisted to Redis',
    detail: 'Every SSE event the agent emits (text_delta, tool_use, display_component, journey_update, awaiting_user, done, error) is RPUSHed to a Redis list BEFORE being sent to the browser. Even if the browser disconnects mid-stream, events are captured.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="psychology" label="Agent emits event" sub="text_delta, tool_use, display_component..." color="primary" active />
        <Arrow />
        <div className="grid grid-cols-2 gap-2">
          <FlowBox icon="database" label="Redis RPUSH" sub='session:{id}:events → [..., event]' color="amber" />
          <FlowBox icon="wifi" label="SSE to browser" sub="res.write(event)" color="blue" />
        </div>
        <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[10px] text-amber-700">
          <strong>Key:</strong> Redis write happens FIRST, before the SSE write. So if the browser disconnects, the event is still saved.
        </div>
      </div>
    ),
  },
  {
    label: 'SessionId in localStorage',
    detail: 'On first visit, a sessionId is generated and stored in localStorage. Every subsequent page load reads the SAME sessionId — so the browser always reconnects to the same Redis session, even after a refresh.',
    visual: (
      <div className="space-y-3">
        <CodeSnippet code={`// First visit:
sessionId = crypto.randomUUID()
localStorage['plansync-session-id'] = sessionId

// Every subsequent load:
sessionId = localStorage['plansync-session-id']
// → same ID → same Redis session`} />
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[10px] text-blue-700">
          <strong>Why this matters:</strong> Without this, every page refresh would create a new sessionId, orphaning the Redis session. The user would lose all progress.
        </div>
      </div>
    ),
  },
  {
    label: 'Browser refresh → fetch event log',
    detail: 'On mount, the frontend calls GET /session/{id}/events. If events exist, it means this is a resumed session. The frontend replays every event through the same handleAgentEvent function that processes live streaming.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="refresh" label="Browser refreshes" sub="Page reloads, component mounts" color="blue" active />
        <Arrow />
        <DataFlow from="Frontend" to="GET /session/:id/events" label="{ events: [...], count: 47 }" active />
        <Arrow />
        <FlowBox icon="replay" label="Replay loop" sub="for (event of events) handleAgentEvent(event)" color="tertiary" />
        <Arrow />
        <div className="grid grid-cols-2 gap-2 text-center">
          <FlowBox icon="chat" label="Reasoning bubbles" sub="Reconstructed" color="success" />
          <FlowBox icon="account_tree" label="Plan review tree" sub="Reconstructed" color="success" />
          <FlowBox icon="linear_scale" label="Journey stepper" sub="Reconstructed" color="success" />
          <FlowBox icon="check_circle" label="Approval states" sub="Prior = answered" color="success" />
        </div>
      </div>
    ),
  },
  {
    label: 'Prior approvals marked as answered',
    detail: 'The replay code uses a rule: if there\'s any event AFTER an awaiting_user event, that approval was answered (because the agent kept going). Only the very last awaiting_user is still pending.',
    visual: (
      <div className="space-y-2">
        {[
          { event: 'awaiting_user: "Provide API key"', status: 'answered', reason: 'Agent continued after this' },
          { event: 'awaiting_user: "Confirm workspace"', status: 'answered', reason: 'Agent continued after this' },
          { event: 'awaiting_user: "Pick customer"', status: 'answered', reason: 'Agent continued after this' },
          { event: 'awaiting_user: "Approve plan"', status: 'pending', reason: 'Last event — still waiting' },
        ].map((e, i) => (
          <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-[11px] ${
            e.status === 'answered' ? 'bg-success/5 border-success/20' : 'bg-amber-50 border-amber-200'
          }`}>
            <Icon name={e.status === 'answered' ? 'check_circle' : 'pending'} className={`text-sm ${e.status === 'answered' ? 'text-success' : 'text-amber-600'}`} />
            <span className="font-mono text-on-surface flex-1">{e.event}</span>
            <span className={`text-[10px] ${e.status === 'answered' ? 'text-success' : 'text-amber-600'}`}>{e.reason}</span>
          </div>
        ))}
      </div>
    ),
  },
];

const ERROR_RECOVERY_STEPS = [
  {
    label: 'Tool call fails',
    detail: 'A Rocketlane API call returns a 400 error, or a validation check finds issues, or an unexpected response shape is returned. The tool returns an error summary to Claude.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="build" label="create_phase" sub="POST /phases → 400 Bad Request" color="rose" active />
        <Arrow />
        <CodeSnippet code={`tool_result: "ERROR: Rocketlane returned 400:
  field 'dueDate' is required for phases.
  Your request omitted dueDate."`} />
      </div>
    ),
  },
  {
    label: 'Agent reflects (visible to user)',
    detail: 'The system prompt REQUIRES the agent to call reflect_on_failure before retrying. This renders a visible "thinking" card so the user sees deliberation, not random retries.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="psychology" label="Agent calls reflect_on_failure" sub="Required before any retry" color="tertiary" active />
        <Arrow />
        <div className="rounded-xl bg-tertiary/5 border border-tertiary/20 p-4 space-y-2">
          <div className="text-[10px] font-semibold text-tertiary uppercase tracking-wider">Reflection card (visible to user)</div>
          <div className="text-[11px] text-on-surface leading-relaxed">
            <p><strong>Observation:</strong> Phase creation failed — Rocketlane requires dueDate on phases but the plan has no dates for this phase.</p>
            <p className="mt-1"><strong>Hypothesis:</strong> The source CSV didn&apos;t include phase-level dates. I need to derive them from the child tasks&apos; min/max dates.</p>
            <p className="mt-1"><strong>Next action:</strong> Calculate the phase dates from children and retry the creation.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    label: 'Agent self-corrects and retries',
    detail: 'Based on its reflection, the agent fixes the issue (derives dates from children, restructures the plan, corrects a field) and retries. No user intervention needed for issues the agent can reason about.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="auto_fix_high" label="Agent fixes the issue" sub="Derives phase dates from child tasks" color="success" active />
        <Arrow />
        <FlowBox icon="replay" label="Retries the tool call" sub="create_phase with derived dates" color="primary" />
        <Arrow />
        <FlowBox icon="check_circle" label="Success" sub="Phase created — continues with next item" color="success" />
        <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[10px] text-emerald-700">
          <strong>The user saw:</strong> the reflection card (so they know it hit an issue) and the success (so they know it recovered). Transparent, not a black box.
        </div>
      </div>
    ),
  },
  {
    label: 'If self-correction fails → ask the user',
    detail: 'When the agent can\'t fix it alone (ambiguous data, missing info, repeated failures), it falls back to request_user_approval with clear options: retry, skip, abort, or provide more info.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="error" label="Self-correction failed" sub="Tried 2 approaches, both failed" color="rose" active />
        <Arrow />
        <FlowBox icon="front_hand" label="request_user_approval" sub="Asks user with clear options" color="amber" />
        <Arrow />
        <div className="space-y-1.5">
          {['Retry with different parameters', 'Skip this item and continue', 'Abort the entire run', 'Let me provide the missing data'].map((opt) => (
            <div key={opt} className="px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/20 text-[11px] text-on-surface flex items-center gap-2">
              <Icon name="radio_button_unchecked" className="text-xs text-primary" />
              {opt}
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const MEMORY_STEPS = [
  {
    label: 'Three types of memory',
    detail: 'The agent has three distinct memory systems, each serving a different purpose. Together they keep the context window small while preserving all the information the agent needs.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2">
          <FlowBox icon="history" label="Conversation History" sub="Full message log — sent to Claude every turn. Carries summaries, not full blobs." color="primary" />
          <FlowBox icon="inventory_2" label="Artifact Store" sub="Large payloads (CSV data, validation reports, plan trees). Agent queries on demand via query_artifact." color="amber" />
          <FlowBox icon="bookmark" label="Working Memory (remember/recall)" sub="Named key-value facts: user_date_format=DD/MM, customer_choice=Acme. Persists across turns without bloating history." color="tertiary" />
        </div>
      </div>
    ),
  },
  {
    label: 'Why artifacts matter',
    detail: 'A 60-row plan as JSON is ~8000 tokens. If that\'s in history and replayed every turn, by turn 10 you\'re sending 80,000 tokens of repeated plan data. Artifacts break this cycle.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
            <div className="text-[10px] font-bold text-rose-700 mb-2">Without artifacts</div>
            <div className="space-y-1 text-[10px] text-rose-800">
              <p>Turn 1: 8,000 tok (plan in history)</p>
              <p>Turn 5: 40,000 tok (plan × 5)</p>
              <p>Turn 10: 80,000 tok (plan × 10)</p>
              <p className="font-bold mt-2">$3+/run, hits rate limits</p>
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="text-[10px] font-bold text-emerald-700 mb-2">With artifacts</div>
            <div className="space-y-1 text-[10px] text-emerald-800">
              <p>Turn 1: 200 tok (summary + artifactId)</p>
              <p>Turn 5: 1,000 tok (summaries only)</p>
              <p>Turn 10: 2,000 tok (summaries only)</p>
              <p className="font-bold mt-2">$0.86/run, no rate limits</p>
            </div>
          </div>
        </div>
        <CodeSnippet code={`// What goes in history (small):
tool_result: "✓ PLAN VALID. 8 phases, 21 tasks. artifact:abc123"

// What goes in artifact store (large):
{ phases: [...], tasks: [...], validationReport: {...} }
// Retrieved on-demand via query_artifact("abc123")`} />
      </div>
    ),
  },
  {
    label: 'Working memory — remember / recall',
    detail: 'Small facts the agent needs across turns but shouldn\'t clutter history. Stored as a key-value hash in Redis, loaded once per session, available to any tool.',
    visual: (
      <div className="space-y-3">
        <div className="text-[11px] text-on-surface font-semibold mb-2">Example remember calls the agent makes:</div>
        <div className="space-y-1.5">
          {[
            { key: 'user_date_format', value: 'DD/MM/YYYY', when: 'After user confirms ambiguous date format' },
            { key: 'customer_choice', value: 'Plansync Test Corp', when: 'After user picks a customer' },
            { key: 'rl_api_fix:createPhase', value: 'dueDate is required', when: 'After discovering API requirement' },
            { key: 'summary_rows_skipped', value: '2', when: 'After detecting and skipping summary rows' },
          ].map((m) => (
            <div key={m.key} className="px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/15 flex items-start gap-2">
              <Icon name="bookmark" className="text-tertiary text-sm mt-0.5 shrink-0" />
              <div>
                <div className="text-[10px] font-mono"><strong>{m.key}</strong> = {m.value}</div>
                <div className="text-[10px] text-on-surface-variant">{m.when}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const SSE_STREAMING_STEPS = [
  {
    label: 'Anthropic → Backend → Browser',
    detail: 'Anthropic streams token-by-token. The backend receives each chunk, wraps it as an SSE event (data: JSON\\n\\n), and forwards it to the browser. Every event is also stored to Redis for replay on refresh.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="cloud" label="Anthropic API" sub="Streams tokens one by one" color="blue" active />
        <Arrow />
        <FlowBox icon="dns" label="Backend (Express)" sub="Receives chunk, wraps as SSE event" color="primary" />
        <Arrow />
        <div className="grid grid-cols-2 gap-2">
          <FlowBox icon="database" label="Redis RPUSH" sub="Stored for replay" color="amber" />
          <FlowBox icon="wifi" label="SSE to Browser" sub='res.write("data: " + JSON)' color="success" />
        </div>
        <CodeSnippet code={`// Each chunk from Anthropic becomes:
res.write(\`data: \${JSON.stringify({
  type: "text_delta",
  text: "The plan has 8 phases..."
})}\\n\\n\`);`} />
      </div>
    ),
  },
  {
    label: 'Event types',
    detail: 'The backend emits different SSE event types, each mapped to a specific UI component. The frontend routes each event type to the right handler.',
    visual: (
      <div className="space-y-1.5">
        {[
          { type: 'text_delta', desc: 'Reasoning text — streams into chat bubble', icon: 'text_fields', color: 'primary' },
          { type: 'tool_use_start / end', desc: 'Tool calls — renders tool activity indicator', icon: 'build', color: 'tertiary' },
          { type: 'display_component', desc: 'Rich cards — plan tree, validation report', icon: 'widgets', color: 'success' },
          { type: 'journey_update', desc: 'Stepper state — updates JourneyStepper', icon: 'linear_scale', color: 'blue' },
          { type: 'awaiting_user', desc: 'Approval card — pauses loop, shows options', icon: 'front_hand', color: 'rose' },
          { type: 'done', desc: 'Turn complete — unlocks input', icon: 'check_circle', color: 'success' },
          { type: 'error', desc: 'Error message — renders error banner', icon: 'error', color: 'rose' },
        ].map((e) => (
          <div key={e.type} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/15 text-[11px]">
            <Icon name={e.icon} className={`text-sm text-${e.color === 'primary' ? 'primary' : e.color === 'tertiary' ? 'tertiary' : e.color === 'success' ? 'success' : e.color === 'rose' ? 'rose-600' : 'blue-600'}`} />
            <span className="font-mono font-semibold text-on-surface w-36 shrink-0">{e.type}</span>
            <span className="text-on-surface-variant">{e.desc}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    label: 'Heartbeat keepalive',
    detail: 'Every 15 seconds the backend sends a comment line (: heartbeat) to prevent Railway/Cloudflare proxy idle timeout (60\u2013100s). Without this, long Anthropic calls would silently drop the connection.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <FlowBox icon="psychology" label="Claude thinking" sub="20s+ for complex plans" color="primary" active />
          <FlowBox icon="cloud" label="Railway proxy" sub="Idle timeout: 60s" color="amber" />
          <FlowBox icon="security" label="Cloudflare" sub="Idle timeout: 100s" color="amber" />
        </div>
        <Arrow />
        <CodeSnippet code={`// Every 15 seconds during agent processing:
const heartbeat = setInterval(() => {
  res.write(": heartbeat\\n\\n");  // SSE comment
}, 15_000);

// Browser ignores SSE comments — but the
// proxy sees traffic and keeps the connection alive.`} />
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[10px] text-amber-700">
          <strong>Without heartbeat:</strong> If Claude takes 45s to reason about a complex plan, Railway closes the connection at 60s of silence. The user sees a blank screen. With heartbeat, the connection stays open indefinitely.
        </div>
      </div>
    ),
  },
];

const VALIDATION_LOOP_STEPS = [
  {
    label: '11 programmatic checks',
    detail: 'The validate_plan tool runs 11 checks against the parsed plan. Each check returns specific, actionable errors the agent can reason about and fix.',
    visual: (
      <div className="space-y-1.5">
        {[
          { check: 'MISSING_NAME', desc: 'Item has no name/title' },
          { check: 'BROKEN_PARENT_REF', desc: 'parentId points to nonexistent item' },
          { check: 'ORPHAN', desc: 'Non-phase item with no parent' },
          { check: 'CIRCULAR_DEP', desc: 'Dependency cycle detected (A → B → A)' },
          { check: 'ROW_COUNT_MISMATCH', desc: 'Parsed items \u2260 CSV row count' },
          { check: 'BAD_DATE', desc: 'Start date after due date' },
          { check: 'BAD_EFFORT', desc: 'Negative or non-numeric effort value' },
          { check: 'DEPTH_INCONSISTENCY', desc: 'Depth levels skip (1 → 3, missing 2)' },
          { check: 'NON_PHASE_NO_PARENT', desc: 'Task/subtask not under any phase' },
          { check: 'DUPLICATE_ID', desc: 'Two items share the same ID' },
          { check: 'PHASE_DATES_MISSING', desc: 'Phase has no start/due date' },
        ].map((c) => (
          <div key={c.check} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/15 text-[10px]">
            <span className="font-mono font-bold text-rose-600 w-40 shrink-0">{c.check}</span>
            <span className="text-on-surface-variant">{c.desc}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    label: 'Self-correction cycle',
    detail: 'The agent calls validate_plan, reads the errors, reasons about fixes, modifies the plan, and re-validates. This loop repeats until the plan is clean or the agent determines it needs user input.',
    visual: (
      <div className="space-y-3">
        <FlowBox icon="build" label="validate_plan()" sub="Run 11 checks" color="primary" active />
        <Arrow />
        <CodeSnippet code={`tool_result: "\u2717 PLAN INVALID — 3 errors:
  • [CIRCULAR_DEP] task-A → task-B → task-A
  • [ORPHAN] task-7 has no parent phase
  • [PHASE_DATES_MISSING] Phase 3 has no dates"`} />
        <Arrow />
        <FlowBox icon="psychology" label="Agent reasons" sub="Fix circular dep, assign orphan, derive dates" color="tertiary" />
        <Arrow />
        <FlowBox icon="auto_fix_high" label="Agent modifies plan" sub="Removes dep, moves orphan, calculates dates" color="success" />
        <Arrow />
        <FlowBox icon="replay" label="validate_plan() again" sub="Re-run all 11 checks" color="primary" />
        <Arrow />
        <FlowBox icon="check_circle" label="PLAN VALID" sub="0 errors — ready for execution" color="success" />
      </div>
    ),
  },
  {
    label: 'What the agent can vs can\u2019t fix alone',
    detail: 'The agent can autonomously fix structural issues. But when data is genuinely ambiguous or missing, it falls back to request_user_approval.',
    visual: (
      <div className="space-y-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="text-[10px] font-bold text-emerald-700 mb-2 flex items-center gap-1.5">
            <Icon name="auto_fix_high" className="text-sm" /> CAN fix autonomously
          </div>
          <div className="space-y-1 text-[10px] text-emerald-800">
            <p>Missing phase dates → derive from child tasks&apos; min/max</p>
            <p>Orphan items → group under synthetic phase</p>
            <p>Date format normalization → detect and standardize</p>
            <p>Duplicate ID resolution → append suffix</p>
          </div>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
          <div className="text-[10px] font-bold text-rose-700 mb-2 flex items-center gap-1.5">
            <Icon name="front_hand" className="text-sm" /> CANNOT fix → asks the user
          </div>
          <div className="space-y-1 text-[10px] text-rose-800">
            <p>Ambiguous DD/MM dates → is 04/05 April 5 or May 4?</p>
            <p>No detectable hierarchy at all → flat list, no phases</p>
            <p>Missing data that requires domain knowledge</p>
            <p>Contradictory instructions in the CSV</p>
          </div>
        </div>
      </div>
    ),
  },
];

const OBSERVABILITY_STEPS = [
  {
    label: 'Pre-computed counters, not derived stats',
    detail: 'The v1 admin dashboard took 30 seconds because it SCANned every Redis session on every page load (~360 calls). v2 uses pre-computed counters: SADD on session start, SADD on completion, SADD on error. Dashboard reads 5 SCARD calls → 200ms load.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
            <div className="text-[10px] font-bold text-rose-700 mb-2">v1: SCAN on every load</div>
            <div className="space-y-1 text-[10px] text-rose-800">
              <p>SCAN 0 MATCH session:* → ~120 keys</p>
              <p>GET each key → ~120 calls</p>
              <p>Filter by date → ~120 checks</p>
              <p className="font-bold mt-2">~360 Redis calls, 30s load</p>
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="text-[10px] font-bold text-emerald-700 mb-2">v2: Pre-computed sets</div>
            <div className="space-y-1 text-[10px] text-emerald-800">
              <p>SCARD stats:sessions:all</p>
              <p>SCARD stats:sessions:today</p>
              <p>SCARD stats:sessions:success:today</p>
              <p>SCARD stats:sessions:error:today</p>
              <p>SCARD stats:sessions:active</p>
              <p className="font-bold mt-2">5 Redis calls, 200ms load</p>
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    label: 'What the dashboard shows',
    detail: 'Six stat cards for session health at a glance, plus a daily usage breakdown by model showing token consumption and estimated cost.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Total Sessions', value: '47', icon: 'tag', color: 'primary' },
            { label: 'Runs Today', value: '12', icon: 'today', color: 'blue' },
            { label: 'Successful Today', value: '10', icon: 'check_circle', color: 'success' },
            { label: 'Errored Today', value: '2', icon: 'error', color: 'rose' },
            { label: 'Active Now', value: '3', icon: 'bolt', color: 'amber' },
            { label: 'Success Rate', value: '83%', icon: 'percent', color: 'success' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-surface-container border border-outline-variant/15 p-3 text-center">
              <Icon name={s.icon} className={`text-lg ${s.color === 'primary' ? 'text-primary' : s.color === 'success' ? 'text-success' : s.color === 'rose' ? 'text-rose-600' : s.color === 'amber' ? 'text-amber-600' : 'text-blue-600'}`} />
              <div className="text-lg font-bold text-on-surface mt-1">{s.value}</div>
              <div className="text-[9px] text-on-surface-variant">{s.label}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg bg-surface-container border border-outline-variant/15 px-3 py-2 text-[10px] text-on-surface-variant">
          <strong>Daily usage breakdown:</strong> Input tokens, output tokens, cache read, cache write, estimated cost — grouped by model (Haiku vs Sonnet).
        </div>
      </div>
    ),
  },
  {
    label: 'Runtime config without redeploy',
    detail: 'Admin can change model, max tokens, temperature, and retry cap via the dashboard. Changes write to Redis. The agent loop reads config FRESH at the start of every turn. No Railway redeploy needed.',
    visual: (
      <div className="space-y-3">
        <div className="space-y-1.5">
          {[
            { key: 'model', value: 'claude-haiku-4-5 → claude-sonnet-4-5', desc: 'Switch to higher-capability model' },
            { key: 'max_tokens', value: '4096 → 8192', desc: 'Allow longer agent responses' },
            { key: 'temperature', value: '0.3 → 0.5', desc: 'More creative reasoning' },
            { key: 'retry_cap', value: '3 → 5', desc: 'More retries before giving up' },
          ].map((c) => (
            <div key={c.key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/15">
              <span className="font-mono text-[10px] font-bold text-primary w-24 shrink-0">{c.key}</span>
              <span className="font-mono text-[10px] text-on-surface flex-1">{c.value}</span>
              <span className="text-[9px] text-on-surface-variant">{c.desc}</span>
            </div>
          ))}
        </div>
        <Arrow />
        <FlowBox icon="database" label="Redis config:agent" sub="Written by admin dashboard" color="amber" active />
        <Arrow />
        <FlowBox icon="psychology" label="Agent loop reads fresh config" sub="Every turn, not every deploy" color="primary" />
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[10px] text-emerald-700">
          <strong>Effect:</strong> Takes effect on the very next agent turn. No redeploy, no restart, no downtime.
        </div>
      </div>
    ),
  },
];

const TOKEN_OPTIMIZATION_STEPS = [
  {
    label: 'The $3 problem',
    detail: 'Before optimization, each run on Sonnet cost ~$3. The system prompt (671 lines) + tool schemas (22 tools) + growing history = massive input tokens on every turn.',
    visual: (
      <div className="space-y-3">
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
          <div className="text-[10px] font-bold text-rose-700 mb-2">Before optimization (per run)</div>
          <div className="space-y-1.5 text-[10px] text-rose-800">
            <DataFlow from="System prompt" to="671 lines" label="~8,000 tokens" />
            <DataFlow from="Tool schemas" to="22 tools" label="~7,000 tokens" />
            <DataFlow from="History" to="12 turns" label="~15,000 tokens" />
            <div className="border-t border-rose-200 pt-1.5 mt-1.5 font-bold">
              = ~30,000 input tokens per turn x 15 turns = ~$3/run
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    label: 'Prompt caching',
    detail: 'cache_control: ephemeral on the system prompt and the last tool schema. After turn 1, ~15,000 tokens of prompt + tools are cached and charged at 10% of the base rate. Saves ~70% on input costs.',
    visual: (
      <div className="space-y-3">
        <CodeSnippet code={`messages.stream({
  system: [{
    type: "text",
    text: SYSTEM_PROMPT,        // 671 lines
    cache_control: { type: "ephemeral" }  // <-- cached
  }],
  tools: [...toolSchemas, {
    ...lastTool,
    cache_control: { type: "ephemeral" }  // <-- cached
  }],
})`} />
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
            <div className="text-[10px] font-bold text-rose-700 mb-1">Turn 1 (cold)</div>
            <p className="text-[10px] text-rose-800">15,000 tokens at full price</p>
            <p className="text-[10px] text-rose-800 font-bold">= $0.045</p>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
            <div className="text-[10px] font-bold text-emerald-700 mb-1">Turns 2-15 (cached)</div>
            <p className="text-[10px] text-emerald-800">15,000 tokens at 10% rate</p>
            <p className="text-[10px] text-emerald-800 font-bold">= $0.0045 each</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    label: 'Artifact pattern',
    detail: 'Large payloads (plan JSON, validation reports) stored in Redis, not in conversation history. History carries summaries + artifactId. Agent calls query_artifact on demand. Prevents exponential token growth.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
            <div className="text-[10px] font-bold text-rose-700 mb-2">Without artifacts</div>
            <div className="space-y-1 text-[10px] text-rose-800">
              <p>Turn 1: plan in history (8K tok)</p>
              <p>Turn 5: plan x5 (40K tok)</p>
              <p>Turn 10: plan x10 (80K tok)</p>
              <p className="font-bold mt-1">Exponential growth</p>
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="text-[10px] font-bold text-emerald-700 mb-2">With artifacts</div>
            <div className="space-y-1 text-[10px] text-emerald-800">
              <p>Turn 1: summary (200 tok)</p>
              <p>Turn 5: summaries (1K tok)</p>
              <p>Turn 10: summaries (2K tok)</p>
              <p className="font-bold mt-1">Linear growth</p>
            </div>
          </div>
        </div>
        <CodeSnippet code={`// In history (small):
"✓ PLAN VALID. 8 phases, 21 tasks. artifact:abc123"

// In Redis (large, on-demand):
query_artifact("abc123") → { phases: [...], tasks: [...] }`} />
      </div>
    ),
  },
  {
    label: 'Batch execution',
    detail: 'The architectural reversal. 15\u201330 tool calls per execution became 1 call. Each tool call resends full history. Fewer calls = dramatically fewer input tokens. $3 → $0.86.',
    visual: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
            <div className="text-[10px] font-bold text-rose-700 mb-2">Before: fine-grained tools</div>
            <div className="space-y-1 text-[10px] text-rose-800">
              <p>create_phase x8 = 8 calls</p>
              <p>create_task x15 = 15 calls</p>
              <p>add_dependency x7 = 7 calls</p>
              <p className="border-t border-rose-200 pt-1 mt-1 font-bold">30 calls x 30K input tok = 900K tok</p>
              <p className="font-bold">~$3.00 / run</p>
            </div>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="text-[10px] font-bold text-emerald-700 mb-2">After: execute_plan_creation</div>
            <div className="space-y-1 text-[10px] text-emerald-800">
              <p>execute_plan_creation x1 = 1 call</p>
              <p>Backend creates all items</p>
              <p>Returns single summary</p>
              <p className="border-t border-emerald-200 pt-1 mt-1 font-bold">1 call x 30K input tok = 30K tok</p>
              <p className="font-bold">~$0.86 / run</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-2 text-[10px] text-on-surface">
          <strong>71% cost reduction.</strong> Fine-grained tools still exist for failure recovery and surgical edits — but the happy path is one deterministic batch call.
        </div>
      </div>
    ),
  },
];

/* ------------------------------------------------------------------ */
/*  NAV                                                                */
/* ------------------------------------------------------------------ */
const SECTIONS = [
  { id: 'react-loop', label: 'ReAct Loop' },
  { id: 'session-sticky', label: 'Session Stickiness' },
  { id: 'error-recovery', label: 'Error Recovery' },
  { id: 'memory', label: 'Memory Architecture' },
  { id: 'streaming', label: 'SSE Streaming' },
  { id: 'validation', label: 'Validation Loop' },
  { id: 'observability', label: 'Observability' },
  { id: 'token-optimization', label: 'Token Optimization' },
];

const ZOOM_LEVELS = [
  { label: 'A', zoom: 1, title: 'Default' },
  { label: 'A', zoom: 1.1, title: 'Medium' },
  { label: 'A', zoom: 1.2, title: 'Large' },
];

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */
export default function HowItWorksPage() {
  const [zoom, setZoom] = useState(1);

  return (
    <div className="min-h-screen bg-surface font-body text-on-surface" style={{ zoom }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-lg border-b border-outline-variant/30">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex items-center h-14 gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <Link href="/rlassignment" className="flex items-center gap-1.5 mr-4 shrink-0">
            <Icon name="arrow_back" className="text-lg text-on-surface-variant" />
            <span className="text-xs font-medium text-on-surface-variant">Overview</span>
          </Link>
          <div className="h-5 w-px bg-outline-variant/40 mr-2 shrink-0" />
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="text-xs font-medium px-3 py-1.5 rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors shrink-0">
              {s.label}
            </a>
          ))}
          <div className="ml-auto shrink-0 flex items-center gap-0.5 bg-surface-container rounded-full p-0.5">
            {ZOOM_LEVELS.map((s) => (
              <button key={s.zoom} onClick={() => setZoom(s.zoom)} title={s.title}
                className={`rounded-full w-7 h-7 flex items-center justify-center transition-colors ${zoom === s.zoom ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}
                style={{ fontSize: s.zoom === 1 ? 11 : s.zoom === 1.1 ? 13 : 15 }}>
                <span className="font-semibold">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Header */}
      <header className="max-w-[1440px] mx-auto px-6 lg:px-10 pt-8 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-tertiary mb-1.5">Interactive Deep Dive</p>
        <h1 className="font-headline text-3xl md:text-4xl font-extrabold">How the Agent Works</h1>
        <p className="text-sm text-on-surface-variant mt-2 max-w-3xl leading-relaxed">
          Step through each key mechanism &mdash; click the steps on the left to see what happens at each stage.
          Every diagram shows real data flow from the actual codebase.
        </p>
      </header>

      {/* Sections */}
      <InteractiveSection id="react-loop" title="The ReAct Loop" sub="Core mechanism" icon="sync" steps={REACT_LOOP_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="session-sticky" title="Refresh-Safe Sessions" sub="Session stickiness" icon="refresh" steps={SESSION_STICKY_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="error-recovery" title="Error Recovery" sub="Self-correction" icon="auto_fix_high" steps={ERROR_RECOVERY_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="memory" title="Memory Architecture" sub="Context management" icon="memory" steps={MEMORY_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="streaming" title="SSE Streaming" sub="Real-time delivery" icon="stream" steps={SSE_STREAMING_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="validation" title="Validation Loop" sub="Plan integrity" icon="verified" steps={VALIDATION_LOOP_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="observability" title="Observability" sub="Admin dashboard" icon="monitoring" steps={OBSERVABILITY_STEPS} />

      <div className="border-t border-outline-variant/20" />

      <InteractiveSection id="token-optimization" title="Token Optimization" sub="Cost reduction" icon="savings" steps={TOKEN_OPTIMIZATION_STEPS} />

      {/* Footer */}
      <footer className="border-t border-outline-variant/30 py-8 mt-10">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/rlassignment" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-container transition-colors">
            <Icon name="arrow_back" className="text-lg" /> Back to Overview
          </Link>
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <Link href="/rlassignment/prompt" className="hover:text-primary transition-colors">System Prompt</Link>
            <Link href="/rlassignment/scope" className="hover:text-primary transition-colors">Scope Details</Link>
            <a href="https://github.com/inba-2299/Plansync" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">Source Code</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
