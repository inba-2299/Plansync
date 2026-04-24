'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}

/* ------------------------------------------------------------------ */
/*  ACTORS — the components involved in a session                      */
/* ------------------------------------------------------------------ */
const ACTORS = [
  { id: 'user', label: 'User', icon: 'person', color: 'bg-blue-50 border-blue-200 text-blue-700', description: 'You — typing in the browser' },
  { id: 'browser', label: 'Browser', icon: 'web', color: 'bg-cyan-50 border-cyan-200 text-cyan-700', description: 'Chrome / Safari running our React frontend' },
  { id: 'vercel', label: 'Vercel', icon: 'cloud', color: 'bg-violet-50 border-violet-200 text-violet-700', description: 'Hosts the Next.js frontend (just static files + a tiny upload proxy)' },
  { id: 'railway', label: 'Railway', icon: 'rocket_launch', color: 'bg-pink-50 border-pink-200 text-pink-700', description: 'Hosts our Express backend with the agent loop' },
  { id: 'dispatcher', label: 'Dispatcher', icon: 'route', color: 'bg-amber-50 border-amber-200 text-amber-700', description: 'A switch statement in our backend that routes tool calls to functions' },
  { id: 'anthropic', label: 'Anthropic', icon: 'psychology', color: 'bg-emerald-50 border-emerald-200 text-emerald-700', description: 'Claude API — the AI brain' },
  { id: 'redis', label: 'Upstash Redis', icon: 'database', color: 'bg-rose-50 border-rose-200 text-rose-700', description: 'Stores all session state (history, events, memory)' },
  { id: 'rocketlane', label: 'Rocketlane', icon: 'workspaces', color: 'bg-indigo-50 border-indigo-200 text-indigo-700', description: 'The destination — where projects get created' },
];

function ActorBadge({ id, large = false }: { id: string; large?: boolean }) {
  const actor = ACTORS.find((a) => a.id === id);
  if (!actor) return null;
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border ${actor.color} ${large ? 'px-3 py-2' : 'px-2 py-1'}`}>
      <Icon name={actor.icon} className={large ? 'text-base' : 'text-sm'} />
      <span className={`font-semibold ${large ? 'text-xs' : 'text-[10px]'}`}>{actor.label}</span>
    </div>
  );
}

function FlowLine({ from, to, label, code, active = true }: { from: string; to: string; label: string; code?: string; active?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${active ? 'bg-surface-container-lowest border-primary/30' : 'bg-surface-container border-outline-variant/20 opacity-50'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <ActorBadge id={from} />
        <Icon name="arrow_forward" className="text-primary text-sm" />
        <ActorBadge id={to} />
      </div>
      <div className="text-[11px] font-semibold text-on-surface mb-0.5">{label}</div>
      {code && (
        <pre className="text-[10px] font-mono text-on-surface-variant bg-surface-container/50 rounded px-2 py-1 mt-1.5 overflow-x-auto">{code}</pre>
      )}
    </div>
  );
}

function StoredInRedis({ keyName, content }: { keyName: string; content: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="save" className="text-rose-600 text-sm" />
        <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Saved to Redis</span>
      </div>
      <pre className="text-[10px] font-mono text-rose-900 bg-white/60 rounded px-2 py-1.5 mt-1">{`Key:   ${keyName}\nValue: ${content}`}</pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SESSION LIFECYCLE STAGES                                           */
/* ------------------------------------------------------------------ */
interface Stage {
  num: number;
  title: string;
  what: string;
  actors: string[];
  flows: React.ReactNode;
  whyMatters: string;
}

const STAGES: Stage[] = [
  {
    num: 1,
    title: 'User opens the page',
    what: 'The user navigates to plansync-tau.vercel.app. The browser fetches the React app from Vercel\u2019s CDN.',
    actors: ['user', 'browser', 'vercel'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="user" to="browser" label="Types URL or clicks link" />
        <FlowLine from="browser" to="vercel" label="GET / (the React app)" code="GET https://plansync-tau.vercel.app/" />
        <FlowLine from="vercel" to="browser" label="Returns HTML, JS, CSS bundle" code="200 OK + 145 KB of assets" />
      </div>
    ),
    whyMatters: 'No backend involved yet. Vercel just serves static files — fast, cached at edge locations. The React app boots up in the browser.',
  },
  {
    num: 2,
    title: 'Browser generates or reads sessionId',
    what: 'On mount, the React app checks localStorage for a sessionId. If none exists, it generates a fresh UUID. This UUID is the anchor for everything that follows.',
    actors: ['browser'],
    flows: (
      <div className="space-y-2">
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <ActorBadge id="browser" />
            <span className="text-[11px] text-cyan-800">checks localStorage</span>
          </div>
          <pre className="text-[10px] font-mono text-cyan-900 bg-white/60 rounded px-2 py-1.5">{`let sessionId = localStorage['plansync-session-id'];
if (!sessionId) {
  sessionId = crypto.randomUUID();   // e.g. "7e4c8b2a-9f3d-..."
  localStorage['plansync-session-id'] = sessionId;
}`}</pre>
        </div>
      </div>
    ),
    whyMatters: 'The browser is the source of truth for session identity. Redis has zero knowledge of UUIDs until the browser sends one. If you delete localStorage, the session is orphaned.',
  },
  {
    num: 3,
    title: 'Browser checks for existing session events',
    what: 'The frontend asks the backend: "Are there any past events for this sessionId?" If yes \u2014 this is a refresh, replay them. If no \u2014 this is a fresh session, send the greeting.',
    actors: ['browser', 'railway', 'redis'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="browser" to="railway" label="Fetch event log" code="GET /session/{sessionId}/events" />
        <FlowLine from="railway" to="redis" label="Read events list" code='LRANGE session:{id}:events 0 -1' />
        <FlowLine from="redis" to="railway" label="Returns 0 events (fresh session)" />
        <FlowLine from="railway" to="browser" label="Returns { events: [], count: 0 }" />
      </div>
    ),
    whyMatters: 'This is what makes Plansync refresh-safe. If the user refreshes mid-conversation, the backend replays every event that was emitted before the disconnect. The UI reconstructs itself exactly.',
  },
  {
    num: 4,
    title: 'Frontend sends greeting trigger',
    what: 'For a fresh session, the frontend sends a synthetic message to wake up the agent. This opens an SSE connection that stays open while the agent works.',
    actors: ['browser', 'vercel', 'railway'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="browser" to="railway" label="Open SSE connection" code={`POST /agent
{ sessionId, userMessage: "Hi" }
Accept: text/event-stream`} />
        <div className="text-[10px] text-on-surface-variant italic px-3">
          \u2191 This connection stays open for the entire agent run (could be 30-90 seconds)
        </div>
      </div>
    ),
    whyMatters: 'POST /agent is special \u2014 it doesn\u2019t close immediately like normal HTTP. The server keeps it open and streams events back as the agent works. This is Server-Sent Events (SSE).',
  },
  {
    num: 5,
    title: 'Backend loads session from Redis, starts agent loop',
    what: 'The backend receives the request, loads any existing session state from Redis, and starts the ReAct loop. This is where the agent actually begins thinking.',
    actors: ['railway', 'redis'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="railway" to="redis" label="Load session state" code={`HGETALL session:{id}:meta
LRANGE session:{id}:history 0 -1
HGETALL session:{id}:remember`} />
        <FlowLine from="redis" to="railway" label="Returns hydrated session object" />
        <div className="rounded-lg border border-pink-200 bg-pink-50 p-3 text-[11px] text-pink-800">
          <strong>Now the loop starts:</strong> while turn count &lt; 40, ask Claude what to do next.
        </div>
      </div>
    ),
    whyMatters: 'The backend is stateless \u2014 every request rebuilds the full session from Redis. This means the backend can be restarted, redeployed, or scaled horizontally without losing user sessions.',
  },
  {
    num: 6,
    title: 'Backend calls Anthropic Claude API (streaming)',
    what: 'The backend sends the system prompt, conversation history, and 22 tool schemas to Claude. Claude streams back text and tool_use blocks as they\u2019re generated.',
    actors: ['railway', 'anthropic'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="railway" to="anthropic" label="Stream request" code={`anthropic.messages.stream({
  model: "claude-haiku-4-5",
  system: SYSTEM_PROMPT,    // 671 lines, cached
  messages: history,
  tools: TOOL_SCHEMAS,      // 22 tool definitions
  temperature: 1
})`} />
        <FlowLine from="anthropic" to="railway" label="Streams chunks back" code={`event: text_delta — "Let me check..."
event: text_delta — " your workspace context"
event: tool_use_start — get_rocketlane_context`} />
      </div>
    ),
    whyMatters: 'The cache_control: ephemeral on the system prompt and tools means Anthropic charges 10% of the normal rate for repeated content after turn 1. This single optimization saved ~70% on input costs.',
  },
  {
    num: 7,
    title: 'Backend forwards events to browser via SSE',
    what: 'As Claude streams chunks to the backend, the backend forwards each chunk as an SSE event to the browser \u2014 AND saves it to Redis simultaneously.',
    actors: ['railway', 'redis', 'browser'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="railway" to="redis" label="Persist event FIRST" code={`RPUSH session:{id}:events
"{ type: 'text_delta', text: 'Let me check...' }"`} />
        <FlowLine from="railway" to="browser" label="THEN send via SSE" code={`data: { "type": "text_delta", "text": "Let me check..." }\\n\\n`} />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
          <strong>Critical detail:</strong> Redis write happens BEFORE the SSE write. So even if the browser disconnects, the event is captured and replayable.
        </div>
      </div>
    ),
    whyMatters: 'This dual-write is what makes refresh-safe sessions work. The browser sees events live; Redis sees them whether or not the browser is connected.',
  },
  {
    num: 8,
    title: 'Claude wants to call a tool',
    what: 'Claude\u2019s response includes a tool_use block: it wants the backend to run a specific function. The backend hands this to the dispatcher.',
    actors: ['anthropic', 'railway', 'dispatcher'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="anthropic" to="railway" label="Sends tool_use block" code={`{
  "type": "tool_use",
  "id": "toolu_abc",
  "name": "get_rocketlane_context",
  "input": {}
}`} />
        <FlowLine from="railway" to="dispatcher" label="Hands off to dispatcher" code={`dispatch({
  name: "get_rocketlane_context",
  input: {},
  ctx: { session, emit, ... }
})`} />
      </div>
    ),
    whyMatters: 'Claude itself never executes code. It generates a structured request. The dispatcher reads that request and routes it to the right function in our backend. This is the entire trust model \u2014 the agent reasons, our code acts.',
  },
  {
    num: 9,
    title: 'Dispatcher routes to the actual tool function',
    what: 'The dispatcher is a switch statement. It matches the tool name to a function and invokes it. The function does real work (calling Rocketlane, validating, querying Redis).',
    actors: ['dispatcher', 'rocketlane', 'redis'],
    flows: (
      <div className="space-y-2">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <ActorBadge id="dispatcher" />
            <span className="text-[11px] text-amber-800">switch (toolName)</span>
          </div>
          <pre className="text-[10px] font-mono text-amber-900 bg-white/60 rounded px-2 py-1.5">{`switch (name) {
  case 'get_rocketlane_context':
    return getRocketlaneContextTool(input, ctx);
  case 'validate_plan':
    return validatePlanTool(input, ctx);
  case 'execute_plan_creation':
    return executePlanCreationTool(input, ctx);
  // ... 22 cases total
}`}</pre>
        </div>
        <FlowLine from="dispatcher" to="rocketlane" label="Tool calls Rocketlane API" code={`GET https://api.rocketlane.com/api/1.0/projects
api-key: <decrypted from Redis>`} />
        <FlowLine from="rocketlane" to="dispatcher" label="Returns workspace data" code={`200 OK
{ data: [{ projectId, name, customer, ... }] }`} />
      </div>
    ),
    whyMatters: 'The dispatcher is the trust boundary. Anything Claude wants to do has to go through here. We can audit, rate-limit, or block specific tool calls in one place.',
  },
  {
    num: 10,
    title: 'Tool returns result, dispatcher sends it back to Claude',
    what: 'The function finishes, returns a summary string. The backend wraps it as a tool_result message and adds it to the conversation history. Claude reads it on the next turn.',
    actors: ['dispatcher', 'railway', 'anthropic'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="dispatcher" to="railway" label="Tool finishes" code={`return {
  summary: "Found 6 projects, 8 customers, 4 team members.
            artifact:rl-context-abc",
  artifactId: "rl-context-abc"
}`} />
        <StoredInRedis keyName="session:{id}:artifacts" content='{ "rl-context-abc": { ...full context... } }' />
        <FlowLine from="railway" to="anthropic" label="Next turn includes tool_result" code={`messages.push({
  role: "user",
  content: [{
    type: "tool_result",
    tool_use_id: "toolu_abc",
    content: "Found 6 projects, 8 customers..."
  }]
})`} />
      </div>
    ),
    whyMatters: 'Note: only the SUMMARY goes back to Claude. The full context lives in the artifact store in Redis. This is what keeps token costs low \u2014 a 60-row plan would cost $3/run if we sent it back every turn. With artifacts, it costs $0.86.',
  },
  {
    num: 11,
    title: 'Loop continues OR pauses for user',
    what: 'Claude reads the tool result, reasons about it, and either calls another tool (loop continues) or asks the user a question (loop pauses).',
    actors: ['anthropic', 'railway', 'browser', 'user'],
    flows: (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[11px] font-bold text-emerald-700 mb-1.5">Path A: Loop continues</div>
            <p className="text-[10px] text-emerald-800">Claude calls another tool \u2014 e.g. parse_csv, validate_plan. Back to Step 6.</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <div className="text-[11px] font-bold text-rose-700 mb-1.5">Path B: Loop pauses</div>
            <p className="text-[10px] text-rose-800">Claude calls request_user_approval. Backend persists pending state, sends awaiting_user event to browser.</p>
          </div>
        </div>
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ActorBadge id="browser" />
            <span className="text-[11px] text-cyan-800">renders approval card</span>
          </div>
          <p className="text-[10px] text-cyan-900">User sees a card with clickable options. The SSE connection closes. Backend state is saved to Redis.</p>
        </div>
        <FlowLine from="user" to="browser" label="Clicks an option" />
        <FlowLine from="browser" to="railway" label="New POST /agent with the answer" code={`POST /agent
{ sessionId, uiAction: { toolUseId, value: "Acme Inc." } }`} />
        <div className="text-[11px] text-on-surface-variant italic px-3">\u2191 Loop resumes from Step 5 with the user\u2019s answer added to history</div>
      </div>
    ),
    whyMatters: 'request_user_approval is the ONLY tool that pauses the loop. Every other tool returns immediately. This is what makes the agent feel responsive \u2014 it only stops when it genuinely needs human input.',
  },
  {
    num: 12,
    title: 'Agent finishes \u2014 emits done event, saves session',
    what: 'When Claude says stop_reason: end_turn AND there are no more tool_uses to handle, the loop exits. Backend saves final session state to Redis and closes the SSE connection.',
    actors: ['anthropic', 'railway', 'redis', 'browser'],
    flows: (
      <div className="space-y-2">
        <FlowLine from="anthropic" to="railway" label="Final response" code={`{ stop_reason: "end_turn", content: [...] }`} />
        <StoredInRedis keyName="session:{id}:history" content="[ ...all messages from this turn... ]" />
        <StoredInRedis keyName="session:{id}:meta" content="{ turnCount: 14, rlProjectId: 5000123456 }" />
        <FlowLine from="railway" to="browser" label="Send done event, close SSE" code={`data: { "type": "done", "stopReason": "end_turn" }\\n\\n`} />
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-[11px] text-cyan-800">
          Browser receives <code>done</code>, re-enables the chat input, marks the journey stepper as complete.
        </div>
      </div>
    ),
    whyMatters: 'The session is now fully persisted. If the user closes the browser and comes back tomorrow (within 48h TTL), they can resume. If they refresh the page, every event replays. The session is "done" but not destroyed.',
  },
];

/* ------------------------------------------------------------------ */
/*  ZOOM levels                                                        */
/* ------------------------------------------------------------------ */
const ZOOM_LEVELS = [
  { label: 'A', zoom: 1, title: 'Default' },
  { label: 'A', zoom: 1.1, title: 'Medium' },
  { label: 'A', zoom: 1.2, title: 'Large' },
];

/* ================================================================== */
/*  PAGE                                                               */
/* ================================================================== */
export default function SessionExplainerPage() {
  const [zoom, setZoom] = useState(1);
  const [stage, setStage] = useState(1);

  const current = STAGES.find((s) => s.num === stage)!;

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
          <span className="font-headline font-bold text-sm">Session Lifecycle</span>
          <div className="ml-auto flex items-center gap-0.5 bg-surface-container rounded-full p-0.5">
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
        <p className="text-xs font-semibold uppercase tracking-widest text-tertiary mb-1.5">Step-by-Step Walkthrough</p>
        <h1 className="font-headline text-3xl md:text-4xl font-extrabold">A Full Session, Stage by Stage</h1>
        <p className="text-sm text-on-surface-variant mt-2 max-w-3xl leading-relaxed">
          Click through 12 stages to see exactly what happens from the moment a user opens the page to the moment the project is created in Rocketlane. Every stage shows which actors are involved and what data flows between them.
        </p>
      </header>

      {/* Actor legend */}
      <section className="max-w-[1440px] mx-auto px-6 lg:px-10 mb-8">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-5 shadow-card-sm">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="groups" className="text-primary text-base" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface">The 8 Actors Involved</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {ACTORS.map((a) => (
              <div key={a.id} className={`rounded-lg border p-2.5 ${a.color}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon name={a.icon} className="text-base" />
                  <span className="text-xs font-bold">{a.label}</span>
                </div>
                <p className="text-[10px] opacity-80 leading-tight">{a.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stage controls */}
      <section className="max-w-[1440px] mx-auto px-6 lg:px-10 mb-6">
        <div className="flex items-center gap-1 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
          {STAGES.map((s) => (
            <button
              key={s.num}
              onClick={() => setStage(s.num)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                stage === s.num
                  ? 'bg-primary text-on-primary shadow-card-sm'
                  : stage > s.num
                    ? 'bg-success/10 text-success border border-success/20'
                    : 'bg-surface-container border border-outline-variant/20 text-on-surface-variant hover:border-primary/30'
              }`}
            >
              <span className="mr-1.5 opacity-70">{s.num}.</span>{s.title}
            </button>
          ))}
        </div>
      </section>

      {/* Current stage detail */}
      <section className="max-w-[1440px] mx-auto px-6 lg:px-10 pb-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.num}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
              {/* Left: stage info */}
              <div>
                <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-card-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-9 h-9 rounded-full bg-primary text-on-primary font-bold flex items-center justify-center text-sm">{current.num}</div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-tertiary">Stage {current.num} of 12</span>
                  </div>
                  <h2 className="font-headline text-base font-extrabold text-on-surface mb-2 leading-tight">{current.title}</h2>
                  <p className="text-xs text-on-surface-variant leading-relaxed mb-4">{current.what}</p>

                  <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Actors Involved</div>
                  <div className="flex flex-wrap gap-1.5">
                    {current.actors.map((a) => (
                      <ActorBadge key={a} id={a} large />
                    ))}
                  </div>
                </div>

                {/* Why it matters */}
                <div className="mt-4 bg-tertiary/[0.05] rounded-2xl border border-tertiary/15 p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Icon name="lightbulb" className="text-tertiary text-sm" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-tertiary">Why this matters</span>
                  </div>
                  <p className="text-[11px] text-on-surface leading-relaxed">{current.whyMatters}</p>
                </div>

                {/* Nav */}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setStage((s) => Math.max(1, s - 1))}
                    disabled={stage === 1}
                    className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-surface-container border border-outline-variant/30 text-on-surface-variant disabled:opacity-30 hover:border-primary/30 transition-colors"
                  >
                    \u2190 Previous
                  </button>
                  <button
                    onClick={() => setStage((s) => Math.min(STAGES.length, s + 1))}
                    disabled={stage === STAGES.length}
                    className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-primary text-on-primary disabled:opacity-30 transition-colors"
                  >
                    Next \u2192
                  </button>
                </div>
              </div>

              {/* Right: data flow */}
              <div className="bg-surface-container-low/50 rounded-2xl border border-outline-variant/20 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Icon name="route" className="text-primary text-base" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface">Data Flow</h3>
                </div>
                {current.flows}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </section>

      {/* Footer */}
      <footer className="border-t border-outline-variant/30 py-8 mt-10">
        <div className="max-w-[1440px] mx-auto px-6 lg:px-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/rlassignment" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary-container transition-colors">
            <Icon name="arrow_back" className="text-lg" /> Back to Overview
          </Link>
          <div className="flex items-center gap-4 text-xs text-on-surface-variant">
            <Link href="/rlassignment/how-it-works" className="hover:text-primary transition-colors">How It Works</Link>
            <Link href="/rlassignment/prompt" className="hover:text-primary transition-colors">System Prompt</Link>
            <Link href="/rlassignment/scope" className="hover:text-primary transition-colors">Scope Details</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
