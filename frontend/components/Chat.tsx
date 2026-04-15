'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  sendToAgent,
  fetchJourney,
  fetchSessionEvents,
  clearSessionEvents,
  storeRocketlaneApiKey,
  uploadPlanFile,
} from '@/lib/agent-client';
import type { AgentEvent, JourneyStep, UiAction } from '@/lib/event-types';
import { JourneyStepper } from './agent-emitted/JourneyStepper';
import { MessageBubble } from './MessageBubble';
import { ReasoningBubble } from './ReasoningBubble';
import { ToolCallLine } from './ToolCallLine';
import { ApiKeyCard } from './agent-emitted/ApiKeyCard';
import { FileUploadCard } from './agent-emitted/FileUploadCard';
import { ExecutionPlanCard } from './agent-emitted/ExecutionPlanCard';
import { PlanReviewTree } from './agent-emitted/PlanReviewTree';
import { PlanIntegrityPanel } from './agent-emitted/PlanIntegrityPanel';
import { ApprovalPrompt } from './agent-emitted/ApprovalPrompt';
import { ProgressFeed } from './agent-emitted/ProgressFeed';
import { ReflectionCard } from './agent-emitted/ReflectionCard';
import { CompletionCard } from './agent-emitted/CompletionCard';
import { cn } from '@/lib/cn';

/**
 * Chat — the main orchestrator component for the Plansync UI.
 *
 * LAYOUT (responsive split UI):
 *
 *   Desktop (≥1024px / lg):
 *     ┌───────────────────────────────────────────────────────┐
 *     │ HEADER (sticky top, full width)                      │
 *     │ JourneyStepper                                        │
 *     ├───────────────────────────────────────────────────────┤
 *     │ PINNED PANELS (sticky, full width, only when active): │
 *     │   ExecutionPlanCard + ProgressFeed                    │
 *     ├────────────────────────────┬──────────────────────────┤
 *     │  AGENT WORKSPACE (60%)     │  YOUR WORKSPACE (40%)    │
 *     │  - reasoning bubbles        │  - user messages          │
 *     │  - tool call lines          │  - approval prompts       │
 *     │  - plan review tree         │  - api key + upload cards │
 *     │  - reflection cards         │  - completion card        │
 *     │  (scrolls independently)   │  (scrolls independently)  │
 *     ├────────────────────────────┴──────────────────────────┤
 *     │ INPUT (sticky bottom, full width)                     │
 *     └───────────────────────────────────────────────────────┘
 *
 *   Mobile (<1024px):
 *     Single chronological timeline, same pinned panels on top,
 *     same footer input. The right-column "your workspace" is
 *     hidden and user-side messages interleave with agent-side
 *     messages in timestamp order. This is a clean fallback, not
 *     a second tab.
 *
 * Responsibilities:
 *   - Hold the chronological message list (UiMessage array)
 *   - Hold the JourneyStepper state (separate from the message timeline)
 *   - Classify each message to left/right/pinned for the split layout
 *   - Wire SSE events from the /agent endpoint to state updates
 *   - Auto-start a session on mount so the agent greets the user
 *
 * Architecture: this component is "smart" (state + side effects). All
 * sub-components are dumb renderers that take props. This matches the
 * agent invariant — frontend has zero business logic, just rendering.
 */

// ---------- UI message types ----------

type UiMessage =
  | { kind: 'user'; id: string; content: string; createdAt: number }
  | {
      kind: 'reasoning';
      id: string;
      content: string;
      complete: boolean;
      collapsed: boolean;
      createdAt: number;
    }
  | {
      kind: 'tool';
      id: string; // toolUseId from Anthropic
      name: string;
      inputJson: string;
      complete: boolean;
      result?: string;
      createdAt: number;
    }
  | {
      kind: 'display';
      id: string;
      component: string;
      props: Record<string, unknown>;
      createdAt: number;
    }
  | {
      kind: 'awaiting';
      id: string;
      toolUseId: string;
      question: string;
      options: Array<{ label: string; value: string; description?: string }>;
      context: string | null;
      answered: boolean;
      selectedLabel?: string;
      createdAt: number;
    }
  | { kind: 'error'; id: string; message: string; createdAt: number };

// ---------- Message classification for split layout ----------

type MessageSide = 'agent' | 'user' | 'pinned' | 'error';

/**
 * Decide which side of the split layout a UiMessage belongs to.
 *
 *   - agent side (left column on desktop): agent-generated content the
 *     user reads but doesn't interact with (reasoning, tool calls, plan
 *     reviews, reflections)
 *   - user side (right column on desktop): interactions that require
 *     user input or are directed AT the user (user messages, approval
 *     prompts, api key card, upload card, completion summary)
 *   - pinned (full-width sticky panel on top): live status surfaces
 *     (execution plan, progress feed)
 *   - error: rendered full-width in the agent column
 */
function classifyMessage(msg: UiMessage): MessageSide {
  switch (msg.kind) {
    case 'user':
      return 'user';
    case 'reasoning':
    case 'tool':
      return 'agent';
    case 'awaiting':
      return 'user';
    case 'display': {
      const c = msg.component;
      if (c === 'ExecutionPlanCard' || c === 'ProgressFeed') return 'pinned';
      if (c === 'ApiKeyCard' || c === 'FileUploadCard' || c === 'CompletionCard') return 'user';
      // PlanReviewTree, ReflectionCard, and anything unknown → agent side
      return 'agent';
    }
    case 'error':
      return 'error';
  }
}

// Display components where re-emissions should REPLACE the previous
// instance instead of appending a new one to the timeline. Keeps the UI
// from stacking duplicates when the agent re-calls a display tool.
// ExecutionPlanCard is here because the agent re-calls create_execution_plan
// after every stage to update step statuses; ProgressFeed is here because
// it's emitted repeatedly during execution.
const STABLE_COMPONENTS = new Set(['PlanReviewTree', 'ProgressFeed', 'ExecutionPlanCard']);

// ---------- Initial greeting message ----------

const INITIAL_USER_MESSAGE =
  "Hello! I'd like to set up a project plan in Rocketlane from a project plan file (CSV or Excel). Please walk me through it — I'll need to provide my Rocketlane API key first, then upload my plan.";

// ---------- Component ----------

/**
 * localStorage key that holds the current sessionId for refresh persistence.
 *
 * The value is a `web-...` identifier that maps 1:1 to the Redis session
 * store. We read it synchronously on first render (inside useState's
 * initializer) so the sessionId is stable for the entire component
 * lifetime — the mount effect can then hit `/session/:id/events` with
 * that ID and replay any prior state.
 *
 * On first visit (no stored ID) we generate a fresh one and write it
 * back to localStorage immediately. On subsequent refreshes, the same
 * ID is returned so the backend's event log for that session is
 * reachable.
 *
 * Private browsing / localStorage disabled: the try/catch falls through
 * to generating a per-load random ID (as before), so the app still
 * works — it just loses refresh persistence, which is the expected
 * degradation in private mode.
 */
const SESSION_ID_STORAGE_KEY = 'plansync-session-id';

function loadOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const stored = window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (stored && stored.startsWith('web-')) return stored;
  } catch {
    /* localStorage unavailable (e.g. private mode) — fall through */
  }
  const fresh = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    window.localStorage.setItem(SESSION_ID_STORAGE_KEY, fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}

export function Chat() {
  // Stable session id — persisted to localStorage so a refresh returns
  // to the SAME session (with full hydration from the backend event log)
  // instead of orphaning the old session and starting a fresh one.
  const [sessionId] = useState(loadOrCreateSessionId);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [journey, setJourney] = useState<JourneyStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [memoryToasts, setMemoryToasts] = useState<Array<{ id: string; key: string }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [uploading, setUploading] = useState(false);
  /**
   * Hydration state — tells the user what kind of session this is:
   *   - 'loading'    → initial mount, still fetching the event log
   *   - 'fresh'      → no prior events, greeting the user as a new session
   *   - 'resumed'    → events were replayed, session resumed cleanly
   *   - 'mid-stream' → refresh happened while the agent was mid-response;
   *                    the replay ended on a non-terminal event, show a
   *                    small "check for updates" banner so the user can
   *                    re-fetch /events and append whatever arrived after
   *                    the refresh
   */
  const [hydrationMode, setHydrationMode] = useState<
    'loading' | 'fresh' | 'resumed' | 'mid-stream'
  >('loading');

  // The execution plan is collapsed by default — it's pinned at the top
  // of the agent column (sticky) and would eat too much vertical space
  // if always fully expanded with 8+ steps. Users click the compact bar
  // to expand the full plan, click again to re-collapse.
  const [executionPlanCollapsed, setExecutionPlanCollapsed] = useState(true);

  // For text_delta accumulation we need to know which reasoning bubble is "current"
  const currentReasoningIdRef = useRef<string | null>(null);
  const currentReasoningStartedAtRef = useRef<number | null>(null);

  // Mirror of messages state as a ref, used by callbacks that need to
  // check "is there a pending approval?" without being recreated on
  // every message change. Updated via useEffect below.
  const messagesRef = useRef<UiMessage[]>([]);

  // Scroll targets — one per scroll container
  const agentColEndRef = useRef<HTMLDivElement | null>(null);
  const userColEndRef = useRef<HTMLDivElement | null>(null);
  const mobileEndRef = useRef<HTMLDivElement | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ---------- helpers ----------

  const addMessage = useCallback((msg: UiMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateMessage = useCallback(
    (id: string, updater: (msg: UiMessage) => UiMessage) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
    },
    []
  );

  const showMemoryToast = useCallback((key: string) => {
    const toastId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setMemoryToasts((prev) => [...prev, { id: toastId, key }]);
    setTimeout(() => {
      setMemoryToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 2500);
  }, []);

  // ---------- SSE event handler ----------

  const handleAgentEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case 'text_delta': {
          const cid = currentReasoningIdRef.current;
          if (cid) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === cid && m.kind === 'reasoning'
                  ? { ...m, content: m.content + event.text }
                  : m
              )
            );
          } else {
            const newId = `reasoning-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            currentReasoningIdRef.current = newId;
            currentReasoningStartedAtRef.current = Date.now();
            addMessage({
              kind: 'reasoning',
              id: newId,
              content: event.text,
              complete: false,
              collapsed: false,
              createdAt: Date.now(),
            });
          }
          return;
        }

        case 'tool_use_start': {
          // Mark the previous reasoning bubble complete. Collapse only if
          // it's short filler (< 200 chars); keep long/meaningful content
          // expanded so users don't miss it.
          const cid = currentReasoningIdRef.current;
          if (cid) {
            updateMessage(cid, (m) => {
              if (m.kind !== 'reasoning') return m;
              const isFiller = m.content.trim().length < 200;
              return { ...m, complete: true, collapsed: isFiller };
            });
          }
          currentReasoningIdRef.current = null;
          currentReasoningStartedAtRef.current = null;

          addMessage({
            kind: 'tool',
            id: event.id,
            name: event.name,
            inputJson: '',
            complete: false,
            createdAt: Date.now(),
          });
          return;
        }

        case 'tool_input_delta': {
          updateMessage(event.id, (m) =>
            m.kind === 'tool' ? { ...m, inputJson: m.inputJson + event.partialJson } : m
          );
          return;
        }

        case 'tool_use_end': {
          updateMessage(event.id, (m) =>
            m.kind === 'tool' ? { ...m, complete: true } : m
          );
          return;
        }

        case 'tool_result': {
          updateMessage(event.id, (m) =>
            m.kind === 'tool' ? { ...m, result: event.summary, complete: true } : m
          );
          return;
        }

        case 'display_component': {
          if (STABLE_COMPONENTS.has(event.component)) {
            // Replace any previous instance of this component
            setMessages((prev) => {
              const filtered = prev.filter(
                (m) => !(m.kind === 'display' && m.component === event.component)
              );
              return [
                ...filtered,
                {
                  kind: 'display',
                  id: `disp-${event.component}-${Date.now()}`,
                  component: event.component,
                  props: (event.props as Record<string, unknown>) ?? {},
                  createdAt: Date.now(),
                },
              ];
            });
          } else {
            addMessage({
              kind: 'display',
              id: `disp-${event.component}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              component: event.component,
              props: (event.props as Record<string, unknown>) ?? {},
              createdAt: Date.now(),
            });
          }
          return;
        }

        case 'journey_update': {
          // Defensive normalization at the SSE event boundary.
          //
          // Same risk class as the dependsOn crash from Commit 2f: the
          // backend types `steps` as JourneyStep[], but at runtime the
          // event arrives as parsed JSON and could be malformed (non-
          // array, missing status field, unknown status value). The
          // JourneyStepper component does `steps.map(...)` and looks
          // up `styles[step.status]` without guards — a malformed step
          // would either crash the render or render a colorless pill.
          //
          // Normalize at the boundary: filter to well-shaped step
          // objects, coerce status to a known value, ensure id and
          // label are non-empty strings. Cheaper than hardening every
          // downstream consumer and prevents a future "agent emits
          // weird step shape" bug from turning into a UI crash.
          const validStatuses: ReadonlyArray<JourneyStep['status']> = [
            'pending',
            'in_progress',
            'done',
            'error',
          ];
          // Re-cast through `unknown` because the typed event.steps is
          // JourneyStep[] but we don't trust runtime to honor that.
          const rawSteps: unknown[] = Array.isArray(event.steps)
            ? (event.steps as unknown[])
            : [];
          const normalizedSteps: JourneyStep[] = [];
          for (let idx = 0; idx < rawSteps.length; idx++) {
            const item = rawSteps[idx];
            if (item === null || typeof item !== 'object') continue;
            const obj = item as Record<string, unknown>;
            const id =
              typeof obj.id === 'string' && obj.id.length > 0
                ? obj.id
                : `step-${idx}`;
            const label =
              typeof obj.label === 'string' && obj.label.length > 0
                ? obj.label
                : `Step ${idx + 1}`;
            const status: JourneyStep['status'] =
              typeof obj.status === 'string' &&
              (validStatuses as readonly string[]).includes(obj.status)
                ? (obj.status as JourneyStep['status'])
                : 'pending';
            normalizedSteps.push({ id, label, status });
          }
          setJourney(normalizedSteps);
          return;
        }

        case 'memory_write': {
          showMemoryToast(event.key);
          return;
        }

        case 'awaiting_user': {
          const cid = currentReasoningIdRef.current;
          if (cid) {
            // Keep reasoning expanded on awaiting_user — user needs context
            updateMessage(cid, (m) =>
              m.kind === 'reasoning' ? { ...m, complete: true, collapsed: false } : m
            );
            currentReasoningIdRef.current = null;
          }
          // Defensive shape check: backend loop.ts emits `payload: payload ?? null`,
          // so `event.payload` can legally be `null`. We also harden against
          // malformed shapes (missing question, non-array options) to avoid
          // crashing the chat render if a tool authors something weird.
          const rawPayload = event.payload as
            | {
                question?: unknown;
                options?: unknown;
                context?: unknown;
              }
            | null
            | undefined;
          if (rawPayload && typeof rawPayload === 'object') {
            const question =
              typeof rawPayload.question === 'string'
                ? rawPayload.question
                : '(agent requested input — no question provided)';
            const options = Array.isArray(rawPayload.options)
              ? (rawPayload.options as Array<{
                  label: string;
                  value: string;
                  description?: string;
                }>).filter(
                  (o) =>
                    o && typeof o.label === 'string' && typeof o.value === 'string'
                )
              : [];
            const context =
              typeof rawPayload.context === 'string' ? rawPayload.context : null;

            addMessage({
              kind: 'awaiting',
              id: `await-${event.toolUseId}`,
              toolUseId: event.toolUseId,
              question,
              options,
              context,
              answered: false,
              createdAt: Date.now(),
            });
          }
          setStreaming(false);
          return;
        }

        case 'rate_limited': {
          // Commit 2c will render a dedicated rate-limit card. For now,
          // emit a subtle warning message so we see it during testing.
          addMessage({
            kind: 'error',
            id: `rl-${Date.now()}`,
            message: `Rate limited — retrying in ${event.retryInSeconds}s (attempt ${event.attempt}/${event.maxAttempts})`,
            createdAt: Date.now(),
          });
          return;
        }

        case 'done': {
          // Keep reasoning expanded on done — this is the final message of the turn
          const cid = currentReasoningIdRef.current;
          if (cid) {
            updateMessage(cid, (m) =>
              m.kind === 'reasoning' ? { ...m, complete: true, collapsed: false } : m
            );
            currentReasoningIdRef.current = null;
          }
          setStreaming(false);
          return;
        }

        case 'error': {
          addMessage({
            kind: 'error',
            id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            message: event.message,
            createdAt: Date.now(),
          });
          setStreaming(false);
          return;
        }

        default:
          return;
      }
    },
    [addMessage, updateMessage, showMemoryToast]
  );

  // ---------- Send actions ----------

  const sendUserMessage = useCallback(
    async (text: string, opts: { showInList?: boolean } = { showInList: true }) => {
      if (streaming) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      if (opts.showInList) {
        addMessage({
          kind: 'user',
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: trimmed,
          createdAt: Date.now(),
        });
      }

      currentReasoningIdRef.current = null;
      setStreaming(true);

      await sendToAgent(
        { sessionId, userMessage: trimmed },
        { onEvent: handleAgentEvent }
      );
    },
    [sessionId, streaming, addMessage, handleAgentEvent]
  );

  const sendUiAction = useCallback(
    async (uiAction: UiAction) => {
      currentReasoningIdRef.current = null;
      setStreaming(true);

      await sendToAgent({ sessionId, uiAction }, { onEvent: handleAgentEvent });
    },
    [sessionId, handleAgentEvent]
  );

  // ---------- Approval click handler ----------

  const handleApprovalClick = useCallback(
    (
      messageId: string,
      toolUseId: string,
      option: { label: string; value: string }
    ) => {
      updateMessage(messageId, (m) =>
        m.kind === 'awaiting'
          ? { ...m, answered: true, selectedLabel: option.label }
          : m
      );
      sendUiAction({ toolUseId, data: option.value, label: option.label });
    },
    [updateMessage, sendUiAction]
  );

  // ---------- API key submit handler ----------

  const handleApiKeySubmit = useCallback(
    async (apiKey: string, awaitingMessageId?: string, toolUseId?: string) => {
      const result = await storeRocketlaneApiKey(sessionId, apiKey);
      if (!result.ok) {
        addMessage({
          kind: 'error',
          id: `err-${Date.now()}`,
          message: `Failed to store API key: ${result.error ?? 'unknown'}`,
          createdAt: Date.now(),
        });
        return;
      }
      if (awaitingMessageId && toolUseId) {
        updateMessage(awaitingMessageId, (m) =>
          m.kind === 'awaiting'
            ? { ...m, answered: true, selectedLabel: 'API key submitted' }
            : m
        );
        sendUiAction({ toolUseId, data: 'api_key_submitted', label: 'API key submitted' });
      }
    },
    [sessionId, addMessage, updateMessage, sendUiAction]
  );

  // ---------- File upload handlers ----------

  /**
   * Post-upload flow. Both handlers (inline card and paperclip) funnel
   * into this. If there's an unanswered approval in the current messages
   * (e.g. the agent called request_user_approval with an upload question),
   * we resolve it by sending a uiAction — that maps to a `tool_result` on
   * the backend, which Anthropic requires to match the pending `tool_use`.
   * Otherwise (no pending approval), we send a fresh user text message.
   *
   * This is the fix for the "messages.N: tool_use ids were found without
   * tool_result blocks immediately after" Anthropic 400 that fired when
   * users uploaded a file via the inline FileUploadCard inside an
   * ApprovalPrompt — the tool_use for request_user_approval was being
   * orphaned because sendUserMessage pushes a user-text block, not a
   * tool_result block.
   */
  const resolveUploadOrSend = useCallback(
    (artifactId: string, filename: string, rowCount: number | string) => {
      const unanswered = messagesRef.current.find(
        (m) => m.kind === 'awaiting' && !m.answered
      );
      const resumeText = `I've uploaded "${filename}" — ${rowCount} rows. Artifact id: ${artifactId}. Please parse it and walk me through creating the project.`;

      if (unanswered && unanswered.kind === 'awaiting') {
        // Mark the approval as answered in the UI
        updateMessage(unanswered.id, (m) =>
          m.kind === 'awaiting'
            ? { ...m, answered: true, selectedLabel: `Uploaded: ${filename}` }
            : m
        );
        // Resume via uiAction so the backend emits a tool_result for the
        // pending tool_use. Include the artifact metadata in `data` so the
        // agent has everything it needs to start parsing.
        sendUiAction({
          toolUseId: unanswered.toolUseId,
          data: resumeText,
          label: `Uploaded: ${filename} (${rowCount} rows)`,
        });
      } else {
        // No pending approval — fresh user message
        sendUserMessage(resumeText);
      }
    },
    [sendUiAction, sendUserMessage, updateMessage]
  );

  const handleFileUploaded = useCallback(
    (artifactId: string, filename: string, rowCount: number) => {
      resolveUploadOrSend(artifactId, filename, rowCount);
    },
    [resolveUploadOrSend]
  );

  const handlePaperclipFileSelected = useCallback(
    async (file: File) => {
      if (uploading || streaming) return;
      setUploading(true);
      try {
        const result = await uploadPlanFile(sessionId, file);
        if (!result.artifactId) {
          addMessage({
            kind: 'error',
            id: `err-${Date.now()}`,
            message: `Upload failed: ${result.error ?? 'unknown error'}`,
            createdAt: Date.now(),
          });
          return;
        }
        // Show a user-visible confirmation bubble so they see what they sent
        addMessage({
          kind: 'user',
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: `Uploaded: ${file.name} (${result.rowCount ?? '?'} rows)`,
          createdAt: Date.now(),
        });
        resolveUploadOrSend(
          result.artifactId,
          file.name,
          result.rowCount ?? 'unknown'
        );
      } finally {
        setUploading(false);
      }
    },
    [sessionId, uploading, streaming, addMessage, resolveUploadOrSend]
  );

  // Keep messagesRef.current in sync with the messages state. Used by
  // file upload callbacks that need to read the latest messages (to find
  // a pending approval) without being recreated on every message change.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ---------- Mount: hydrate from backend event log OR start fresh ----------
  //
  // On every page load we try to reconstruct prior state from the Redis
  // event log at /session/:id/events. If there are events, we replay them
  // through `handleAgentEvent` — the same function that processes live
  // streaming events. This rebuilds reasoning bubbles, tool call lines,
  // display components, journey state, and any pending approval EXACTLY
  // as they were before the browser refresh.
  //
  // No replay-specific rendering logic — the state-derivation code path
  // is identical to live streaming. If a bug exists, it exists in both.
  //
  // If the event log is empty, it's either a fresh session (first visit,
  // or new sessionId after "New session" button) OR a session that
  // expired via TTL. Either way we send the INITIAL_USER_MESSAGE to
  // kick off the greeting flow.
  //
  // Last event tells us the state:
  //   - 'done' | 'awaiting_user' | 'error' → terminal, chat idle
  //   - anything else (text_delta, tool_*, etc.) → refresh hit mid-stream,
  //     backend may still be running, show a banner

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [eventsResult, journeyResult] = await Promise.all([
        fetchSessionEvents(sessionId),
        fetchJourney(sessionId),
      ]);
      if (cancelled) return;

      const events = eventsResult.events;

      if (events.length === 0) {
        // Fresh session (or expired TTL). Hydrate journey if present
        // (edge case — shouldn't normally happen if events is empty)
        // and send the greeting.
        if (journeyResult.steps && journeyResult.steps.length > 0) {
          setJourney(journeyResult.steps);
        }
        setHydrationMode('fresh');
        sendUserMessage(INITIAL_USER_MESSAGE, { showInList: false });
        return;
      }

      // Resumed session — replay every event through handleAgentEvent.
      // Each event updates state via the same setters used during live
      // streaming, so the result is bit-for-bit identical to what the
      // user saw before the refresh.
      for (const ev of events) {
        handleAgentEvent(ev);
      }

      // Post-replay: mark previously-answered approvals as answered.
      //
      // Why this is needed: `awaiting_user` events create UiMessages
      // with `answered: false`. But the USER'S CLICK that resolved
      // them isn't an event in the log — it's a separate POST /agent
      // call with a `uiAction` body. So on replay, every approval
      // looks fresh even though the user already dealt with them.
      //
      // The rule: if there's any event in the log AFTER an
      // `awaiting_user`, that approval was answered (evidenced by the
      // fact that the agent kept going). Only the VERY LAST
      // `awaiting_user` is unanswered, and only if it's literally the
      // last event in the log.
      //
      // We don't know WHICH option the user picked (not captured in
      // events), so we show a generic "Answered" label. This is a
      // small UX loss compared to showing the specific choice, but
      // it's honest — the ApprovalPrompt renders with a green
      // checkmark and collapses the chips, making it clear the user
      // has already handled this one.
      markPriorApprovalsAsAnswered(events);

      // Force streaming state to settle. handleAgentEvent only sets
      // streaming=false on terminal events (done/awaiting/error); if
      // the last event was a text_delta or tool_use_start (mid-stream
      // refresh), streaming would still be true. We want it false so
      // the user can type / interact.
      setStreaming(false);

      // Clear the current reasoning ref so a new reasoning bubble is
      // created on the next text_delta instead of appending to the
      // (possibly truncated) last one from before the refresh.
      currentReasoningIdRef.current = null;
      currentReasoningStartedAtRef.current = null;

      // Remember how many events we've already replayed so the
      // "check for updates" handler only appends NEW events.
      seenEventCountRef.current = events.length;

      // Classify the hydration outcome based on the last event.
      const last = events[events.length - 1];
      const isTerminal =
        last.type === 'done' ||
        last.type === 'awaiting_user' ||
        last.type === 'error';
      setHydrationMode(isTerminal ? 'resumed' : 'mid-stream');

      // Don't send INITIAL_USER_MESSAGE — we're resuming an existing
      // conversation. The user sees the full history and picks up
      // where they left off.
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Replay helper: mark prior approvals as answered ----------
  //
  // Called during initial hydration AND during "check for updates"
  // after fetching a fresh event log. Walks the events list backward
  // to find the last awaiting_user event; any OTHER awaiting_user
  // in the list must have been answered (otherwise the agent wouldn't
  // have continued past it). Only the last awaiting is still pending,
  // and only if it's literally the last event in the log (i.e. the
  // current state really is "waiting on user input").

  const markPriorApprovalsAsAnswered = useCallback((events: AgentEvent[]) => {
    // Find the toolUseId of the currently-pending approval (if any).
    // It's the last awaiting_user event AND it must be the last event
    // overall. Any awaiting_user followed by other events was answered.
    let pendingToolUseId: string | null = null;
    const lastIdx = events.length - 1;
    if (lastIdx >= 0 && events[lastIdx].type === 'awaiting_user') {
      const last = events[lastIdx] as Extract<AgentEvent, { type: 'awaiting_user' }>;
      pendingToolUseId = last.toolUseId;
    }

    setMessages((prev) =>
      prev.map((m) => {
        if (m.kind !== 'awaiting') return m;
        // The currently-pending approval stays as-is (still unanswered)
        if (m.toolUseId === pendingToolUseId) return m;
        // Already answered? Leave it alone (preserve the real label if
        // we somehow have it from a live interaction that happened
        // before this replay).
        if (m.answered) return m;
        // Mark as answered with a generic label. We can't recover the
        // user's actual selection because it wasn't an event.
        return { ...m, answered: true, selectedLabel: 'Answered' };
      })
    );
  }, []);

  // ---------- Handlers: New session + Check for updates ----------

  /**
   * "New session" button handler — clears localStorage and reloads the
   * page. The next mount will generate a fresh sessionId and start the
   * greeting flow. The old session's events stay in Redis until the
   * 7-day TTL expires, but are unreachable because we've forgotten the
   * ID.
   *
   * We also best-effort DELETE the old events log so we don't leave
   * orphan data behind — but if that call fails, the reload still
   * proceeds (TTL will handle cleanup eventually).
   */
  const handleNewSession = useCallback(() => {
    if (typeof window === 'undefined') return;
    const confirmed = window.confirm(
      'Start a new session?\n\nYour current conversation will be cleared and you\'ll begin fresh with the agent.'
    );
    if (!confirmed) return;

    // Fire-and-forget: tell the backend to drop the old events log.
    // Not critical — TTL handles it if this fails.
    void clearSessionEvents(sessionId);

    // Clear localStorage so the next mount generates a fresh ID.
    try {
      window.localStorage.removeItem(SESSION_ID_STORAGE_KEY);
    } catch {
      /* ignore */
    }

    // Reload — mount effect will now hit the "fresh session" branch.
    window.location.reload();
  }, [sessionId]);

  /**
   * "Check for updates" handler — for the mid-stream refresh case.
   * Re-fetches the event log and appends any events that arrived after
   * the initial mount replay. This lets the user pull in events emitted
   * by a backend loop that was still running when they refreshed.
   *
   * We track "events seen so far" via a ref on initial replay count,
   * then only replay events at index >= seenCount. Conservative — a
   * missing event never gets replayed twice.
   */
  const seenEventCountRef = useRef<number>(0);
  const handleCheckForUpdates = useCallback(async () => {
    const { events } = await fetchSessionEvents(sessionId);
    const newEvents = events.slice(seenEventCountRef.current);
    if (newEvents.length === 0) {
      // Nothing new yet — quick visual feedback that we checked
      return;
    }
    for (const ev of newEvents) {
      handleAgentEvent(ev);
    }
    seenEventCountRef.current = events.length;

    // Re-run the "mark answered" pass over the full events list so
    // any newly-appended awaiting_user events correctly update the
    // answered state of the now-no-longer-last approvals.
    markPriorApprovalsAsAnswered(events);

    // Re-classify hydration mode based on the new last event
    const last = events[events.length - 1];
    const isTerminal =
      last && (last.type === 'done' || last.type === 'awaiting_user' || last.type === 'error');
    if (isTerminal) {
      setStreaming(false);
      setHydrationMode('resumed');
      currentReasoningIdRef.current = null;
      currentReasoningStartedAtRef.current = null;
    }
  }, [sessionId, handleAgentEvent, markPriorApprovalsAsAnswered]);

  // ---------- Classify messages into sides (memoized) ----------

  const { pinnedMessages, agentMessages, userMessages, errorMessages } = useMemo(() => {
    const pinned: UiMessage[] = [];
    const agent: UiMessage[] = [];
    const user: UiMessage[] = [];
    const errors: UiMessage[] = [];
    for (const m of messages) {
      const side = classifyMessage(m);
      if (side === 'pinned') pinned.push(m);
      else if (side === 'user') user.push(m);
      else if (side === 'error') errors.push(m);
      else agent.push(m);
    }
    return {
      pinnedMessages: pinned,
      agentMessages: agent,
      userMessages: user,
      errorMessages: errors,
    };
  }, [messages]);

  // All non-pinned messages in chronological order — used by the mobile
  // single-column fallback below 1024px.
  const mobileMessages = useMemo(
    () =>
      messages.filter((m) => {
        const side = classifyMessage(m);
        return side !== 'pinned';
      }),
    [messages]
  );

  // ---------- Auto-scroll to bottom on new message ----------

  useEffect(() => {
    agentColEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [agentMessages.length]);

  useEffect(() => {
    userColEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [userMessages.length]);

  useEffect(() => {
    mobileEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mobileMessages.length]);

  // ---------- Message renderer (shared across all three columns) ----------

  const renderMessage = useCallback(
    (msg: UiMessage) => {
      switch (msg.kind) {
        case 'user':
          return <MessageBubble key={msg.id} role="user" content={msg.content} />;

        case 'reasoning':
          return (
            <ReasoningBubble
              key={msg.id}
              content={msg.content}
              complete={msg.complete}
              collapsed={msg.collapsed}
              onToggleCollapse={() =>
                updateMessage(msg.id, (m) =>
                  m.kind === 'reasoning' ? { ...m, collapsed: !m.collapsed } : m
                )
              }
            />
          );

        case 'tool':
          return (
            <ToolCallLine
              key={msg.id}
              name={msg.name}
              inputJson={msg.inputJson}
              complete={msg.complete}
              result={msg.result}
            />
          );

        case 'display':
          return (
            <DisplayComponentRenderer
              key={msg.id}
              component={msg.component}
              props={msg.props}
              sessionId={sessionId}
              onApiKeySubmit={(apiKey) => handleApiKeySubmit(apiKey)}
              onFileUploaded={handleFileUploaded}
            />
          );

        case 'awaiting':
          return (
            <ApprovalPrompt
              key={msg.id}
              question={msg.question}
              options={msg.options}
              context={msg.context}
              answered={msg.answered}
              selectedLabel={msg.selectedLabel}
              onSelect={(option) =>
                handleApprovalClick(msg.id, msg.toolUseId, option)
              }
              sessionId={sessionId}
              toolUseId={msg.toolUseId}
              onApiKeySubmit={(apiKey) =>
                handleApiKeySubmit(apiKey, msg.id, msg.toolUseId)
              }
              onFileUploaded={handleFileUploaded}
            />
          );

        case 'error':
          return (
            <div
              key={msg.id}
              className="bg-error-container/30 border border-error/20 rounded-2xl p-4 text-on-error-container"
            >
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-error">error</span>
                <div className="flex-1">
                  <div className="font-semibold text-error mb-1">Error</div>
                  <div className="text-sm">{msg.message}</div>
                </div>
              </div>
            </div>
          );

        default:
          return null;
      }
    },
    [sessionId, updateMessage, handleApiKeySubmit, handleFileUploaded, handleApprovalClick]
  );

  // ---------- Input state ----------

  const awaitingUnanswered = userMessages.some(
    (m) => m.kind === 'awaiting' && !m.answered
  );
  const inputDisabled = streaming || awaitingUnanswered || uploading;
  const placeholder = uploading
    ? 'Uploading file…'
    : streaming
    ? 'Agent is working — please wait…'
    : awaitingUnanswered
    ? 'Please use the options above to continue…'
    : 'Message Plansync agent…';

  // ---------- Render ----------

  return (
    <div className="h-screen bg-surface text-on-surface font-body flex flex-col overflow-hidden">
      {/* ---------- Header (sticky top, full width) ---------- */}
      <header className="flex-shrink-0 backdrop-blur-md bg-surface/80 border-b border-outline-variant/30">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-card-sm">
              <span className="material-symbols-outlined filled text-white text-base">
                bolt
              </span>
            </div>
            <span className="font-headline font-extrabold text-xl text-on-surface tracking-tight">
              Plansync
            </span>
            <span className="hidden sm:inline-block ml-2 text-xs font-label font-semibold uppercase tracking-widest text-on-surface-variant">
              Rocketlane Project Plan Agent
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleNewSession}
              disabled={streaming}
              title="Clear the current conversation and start a new session"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                'bg-surface-container-low/70 border border-outline-variant/40 text-on-surface-variant',
                'hover:border-primary/40 hover:text-primary hover:bg-primary/5',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-outline-variant/40 disabled:hover:text-on-surface-variant disabled:hover:bg-surface-container-low/70'
              )}
            >
              <span className="material-symbols-outlined text-sm">add_circle</span>
              <span>New session</span>
            </button>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-medium">Connected</span>
            </div>
          </div>
        </div>
        {journey.length > 0 && <JourneyStepper steps={journey} />}
        {hydrationMode === 'mid-stream' && (
          <div className="border-t border-warning/20 bg-warning/5">
            <div className="max-w-screen-2xl mx-auto px-6 py-2 flex items-center gap-3">
              <span className="material-symbols-outlined text-warning text-base">
                sync_problem
              </span>
              <div className="flex-1 min-w-0 text-xs text-on-surface-variant">
                <span className="font-semibold text-warning">
                  Reconnected mid-response.
                </span>{' '}
                The agent may have kept working after the refresh — click to
                pull any new updates.
              </div>
              <button
                type="button"
                onClick={handleCheckForUpdates}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-warning/10 text-warning border border-warning/30 hover:bg-warning/20 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                Check for updates
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ---------- Main split area ---------- */}
      {/* min-h-0 is critical so children with overflow-y-auto actually scroll
          inside a flex container. Without it the children grow to content
          height and the page itself scrolls. */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-screen-2xl mx-auto h-full">
          {/* Mobile: single chronological column (<1024px) */}
          <div className="lg:hidden h-full overflow-y-auto custom-scrollbar">
            {/* Sticky pinned section at the top of the mobile scroll container */}
            {pinnedMessages.length > 0 && (
              <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-outline-variant/20">
                <div className="px-4 sm:px-6 py-3 space-y-2">
                  <PinnedSection
                    pinnedMessages={pinnedMessages}
                    executionPlanCollapsed={executionPlanCollapsed}
                    onToggleExecutionPlan={() =>
                      setExecutionPlanCollapsed((v) => !v)
                    }
                  />
                </div>
              </div>
            )}
            <div className="px-4 sm:px-6 py-6 space-y-4">
              {messages.length === 0 && streaming && <InitializingAgent />}
              {mobileMessages.map(renderMessage)}
              {errorMessages.map(renderMessage)}
              <AgentThinkingHint streaming={streaming} hasAnyMessages={messages.length > 0} awaiting={awaitingUnanswered} />
              <div ref={mobileEndRef} />
            </div>
          </div>

          {/* Desktop: 40/60 split — user LEFT (narrower, reactive), agent RIGHT (wider, content).
               The user acts on the left, watches the agent think on the right. */}
          <div className="hidden lg:grid h-full grid-cols-[2fr_3fr]">
            {/* Your workspace — left column, ~40% width */}
            <section className="flex flex-col min-h-0 bg-surface-container-low/20 border-r border-outline-variant/20">
              <div className="flex-shrink-0 px-8 pt-6 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-secondary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-secondary text-sm filled">
                      person
                    </span>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-variant">
                    Your workspace
                  </span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pb-6">
                <div className="space-y-4">
                  {userMessages.length === 0 && !streaming && (
                    <div className="text-xs text-on-surface-variant/60 italic pt-8 px-2">
                      Your inputs, uploads, and approval choices will appear here.
                    </div>
                  )}
                  {userMessages.map(renderMessage)}
                  <div ref={userColEndRef} />
                </div>
              </div>
            </section>

            {/* Agent workspace — right column, ~60% width */}
            <section className="relative flex flex-col min-h-0">
              <div className="flex-shrink-0 px-8 pt-6 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-primary text-sm filled">
                      smart_toy
                    </span>
                  </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-on-surface-variant">
                    Agent workspace
                  </span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {/* Sticky pinned section — stays at top of the agent column
                    as its content scrolls beneath it. Execution plan is
                    collapsible so it doesn't eat 500px of vertical space
                    with 8+ steps. */}
                {pinnedMessages.length > 0 && (
                  <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm border-b border-outline-variant/20">
                    <div className="px-8 py-3 space-y-2">
                      <PinnedSection
                        pinnedMessages={pinnedMessages}
                        executionPlanCollapsed={executionPlanCollapsed}
                        onToggleExecutionPlan={() =>
                          setExecutionPlanCollapsed((v) => !v)
                        }
                      />
                    </div>
                  </div>
                )}
                <div className="px-8 pb-6 pt-4 space-y-4">
                  {messages.length === 0 && streaming && <InitializingAgent />}
                  {agentMessages.map(renderMessage)}
                  {errorMessages.map(renderMessage)}
                  <AgentThinkingHint streaming={streaming} hasAnyMessages={messages.length > 0} awaiting={awaitingUnanswered} />
                  <div ref={agentColEndRef} />
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* ---------- Memory write toasts (fixed top-right) ---------- */}
      <div className="fixed top-20 right-6 z-50 space-y-2 pointer-events-none">
        {memoryToasts.map((t) => (
          <div
            key={t.id}
            className="bg-tertiary text-white rounded-full px-4 py-2 text-xs font-medium shadow-card-lg animate-fade-in flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">memory</span>
            <span>remembered: {t.key}</span>
          </div>
        ))}
      </div>

      {/* ---------- Footer input (full width, sticky bottom) ---------- */}
      <footer className="flex-shrink-0 backdrop-blur-md bg-surface/80 border-t border-outline-variant/30">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-end gap-2">
            {/* Hidden file input — triggered by the paperclip button */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handlePaperclipFileSelected(file);
                  e.target.value = '';
                }
              }}
            />

            {/* Paperclip — attach project plan */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={inputDisabled}
              title="Attach project plan (CSV or Excel)"
              className={cn(
                'h-12 w-12 rounded-2xl flex items-center justify-center transition-all flex-shrink-0',
                'bg-surface-container-lowest border border-outline-variant/40',
                'text-on-surface-variant hover:text-primary hover:border-primary/40 hover:shadow-card-sm',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-on-surface-variant disabled:hover:border-outline-variant/40 disabled:hover:shadow-none'
              )}
            >
              <span className="material-symbols-outlined text-xl">attach_file</span>
            </button>

            {/* Text input */}
            <div
              className={cn(
                'flex-1 bg-surface-container-lowest rounded-2xl shadow-card-sm border transition-all',
                inputDisabled
                  ? 'border-outline-variant/30 opacity-70'
                  : 'border-outline-variant/40 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10'
              )}
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!inputDisabled && inputValue.trim()) {
                      sendUserMessage(inputValue);
                      setInputValue('');
                    }
                  }
                }}
                placeholder={placeholder}
                disabled={inputDisabled}
                rows={1}
                className="w-full bg-transparent px-5 py-3 text-sm placeholder:text-outline focus:outline-none resize-none max-h-32 disabled:cursor-not-allowed"
              />
            </div>

            {/* Send */}
            <button
              onClick={() => {
                if (!inputDisabled && inputValue.trim()) {
                  sendUserMessage(inputValue);
                  setInputValue('');
                }
              }}
              disabled={inputDisabled || !inputValue.trim()}
              className={cn(
                'h-12 w-12 rounded-2xl flex items-center justify-center transition-all flex-shrink-0',
                'bg-gradient-to-br from-primary to-primary-container text-white shadow-card',
                'hover:scale-105 active:scale-95',
                'disabled:from-outline disabled:to-outline disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none'
              )}
            >
              <span
                className={cn(
                  'material-symbols-outlined text-xl',
                  streaming && 'animate-spin'
                )}
                style={streaming ? { animationDuration: '1.5s' } : undefined}
              >
                {streaming ? 'progress_activity' : 'arrow_upward'}
              </span>
            </button>
          </div>
          <div className="text-[11px] text-on-surface-variant text-center mt-2 flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-xs filled">verified_user</span>
            {streaming
              ? 'Agent is working — please wait for it to finish before sending another message'
              : 'Your data is encrypted end-to-end and never used for training'}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------- Small helper components ----------

function InitializingAgent() {
  return (
    <div className="text-center text-on-surface-variant text-sm py-12">
      <span className="material-symbols-outlined text-4xl text-primary/40 mb-2 block">
        hourglass_empty
      </span>
      Initializing agent…
    </div>
  );
}

/**
 * PinnedSection — renders the sticky-top cards that live INSIDE the agent
 * column (and at the top of the mobile single-column timeline).
 *
 * Two types of pinned cards are supported:
 *   - ExecutionPlanCard: wrapped in a collapsible shell. Default collapsed
 *     (shows a one-line summary bar with current step + progress). Click
 *     to expand the full card.
 *   - ProgressFeed: rendered directly (it's compact enough on its own).
 *
 * Putting this inside the agent column instead of full-width at the top
 * is deliberate — an 8-step execution plan is ~500px tall, which would
 * eat most of the viewport and squash the agent/user workspaces into
 * unusable slivers. By pinning inside the column + making the plan
 * collapsible, the user column stays completely clean and the agent
 * column gets its full height back.
 */
function PinnedSection({
  pinnedMessages,
  executionPlanCollapsed,
  onToggleExecutionPlan,
}: {
  pinnedMessages: UiMessage[];
  executionPlanCollapsed: boolean;
  onToggleExecutionPlan: () => void;
}) {
  return (
    <>
      {pinnedMessages.map((m) => {
        if (m.kind !== 'display') return null;

        if (m.component === 'ExecutionPlanCard') {
          return (
            <CompactableExecutionPlan
              key={m.id}
              plan={m.props}
              collapsed={executionPlanCollapsed}
              onToggle={onToggleExecutionPlan}
            />
          );
        }

        if (m.component === 'ProgressFeed') {
          return (
            <ProgressFeed
              key={m.id}
              completed={Number(m.props.completed ?? 0)}
              total={Number(m.props.total ?? 0)}
              percent={Number(m.props.percent ?? 0)}
              currentPhase={m.props.currentPhase as string | undefined}
              detail={m.props.detail as string | undefined}
            />
          );
        }

        return null;
      })}
    </>
  );
}

/**
 * CompactableExecutionPlan — a wrapper around ExecutionPlanCard that
 * alternates between a one-line compact summary bar and the full card.
 *
 * Compact (default):
 *   [📋] EXECUTION PLAN · Step 3 of 8 · Validating plan integrity  [▼]
 *
 * Expanded:
 *   [▲ Collapse]
 *   ┌──────────────────────────────────────┐
 *   │ <full ExecutionPlanCard>             │
 *   └──────────────────────────────────────┘
 *
 * The compact summary computes "current step" as: the first step with
 * status 'in_progress', falling back to (done count + 1) so we show
 * the next step if nothing is actively in progress.
 */
function CompactableExecutionPlan({
  plan,
  collapsed,
  onToggle,
}: {
  plan: Record<string, unknown>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const steps =
    (plan.steps as Array<{
      id: string;
      label: string;
      status?: string;
      notes?: string;
    }>) ?? [];
  const totalSteps = steps.length;
  const inProgressIdx = steps.findIndex((s) => s.status === 'in_progress');
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const allDone = totalSteps > 0 && doneCount === totalSteps;

  // Prefer in_progress. If none in progress, show the step after the last done
  // (or the last step if all done).
  const displayIdx =
    inProgressIdx >= 0
      ? inProgressIdx
      : allDone
      ? totalSteps - 1
      : Math.min(doneCount, totalSteps - 1);
  const currentStep = steps[displayIdx];
  const stepNumber =
    inProgressIdx >= 0 ? inProgressIdx + 1 : allDone ? totalSteps : doneCount + 1;

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all',
          'bg-surface-container-low/70 border border-outline-variant/30',
          'hover:bg-surface-container hover:border-primary/30'
        )}
      >
        <span className="material-symbols-outlined text-primary text-base flex-shrink-0">
          checklist
        </span>
        <span className="text-[10px] uppercase tracking-[0.15em] font-bold text-primary flex-shrink-0">
          Execution plan
        </span>
        <span className="text-outline-variant flex-shrink-0">·</span>
        <span className="text-sm font-semibold text-on-surface tabular-nums flex-shrink-0">
          {allDone ? `All ${totalSteps} steps done` : `Step ${stepNumber} of ${totalSteps}`}
        </span>
        {currentStep && !allDone && (
          <>
            <span className="text-outline-variant flex-shrink-0">·</span>
            <span className="text-sm text-on-surface-variant truncate flex-1 min-w-0">
              {currentStep.label}
            </span>
          </>
        )}
        {allDone && <div className="flex-1" />}
        <span className="material-symbols-outlined text-on-surface-variant text-base flex-shrink-0">
          expand_more
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary hover:text-primary-container transition-colors rounded-lg hover:bg-primary/5"
      >
        <span className="material-symbols-outlined text-sm">expand_less</span>
        Collapse plan
      </button>
      <ExecutionPlanCard
        goal={String(plan.goal ?? '')}
        steps={steps}
      />
    </div>
  );
}

function AgentThinkingHint({
  streaming,
  hasAnyMessages,
  awaiting,
}: {
  streaming: boolean;
  hasAnyMessages: boolean;
  awaiting: boolean;
}) {
  if (!streaming || !hasAnyMessages || awaiting) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-on-surface-variant pl-2 animate-pulse">
      <span className="material-symbols-outlined text-base">auto_awesome</span>
      <span>agent thinking…</span>
    </div>
  );
}

// ---------- Display component renderer ----------

interface DisplayComponentRendererProps {
  component: string;
  props: Record<string, unknown>;
  sessionId: string;
  onApiKeySubmit: (apiKey: string) => void;
  onFileUploaded: (artifactId: string, filename: string, rowCount: number) => void;
}

function DisplayComponentRenderer({
  component,
  props,
  sessionId,
  onApiKeySubmit,
  onFileUploaded,
}: DisplayComponentRendererProps) {
  switch (component) {
    case 'ApiKeyCard':
      return <ApiKeyCard onSubmit={onApiKeySubmit} />;

    case 'FileUploadCard':
      return <FileUploadCard sessionId={sessionId} onUploaded={onFileUploaded} />;

    case 'ExecutionPlanCard':
      return (
        <ExecutionPlanCard
          goal={String(props.goal ?? '')}
          steps={
            (props.steps as Array<{
              id: string;
              label: string;
              status?: string;
              notes?: string;
            }>) ?? []
          }
        />
      );

    case 'PlanReviewTree':
      return (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <PlanReviewTree
              plan={props.plan as { projectName: string; items: unknown[] }}
              stats={props.stats as Record<string, number>}
            />
          </div>
          <div className="xl:col-span-1">
            <PlanIntegrityPanel
              stats={props.stats as Record<string, number>}
              warnings={(props.warnings as string[]) ?? []}
              errors={(props.errors as Array<{ code: string; detail: string }>) ?? []}
            />
          </div>
        </div>
      );

    case 'ProgressFeed':
      return (
        <ProgressFeed
          completed={Number(props.completed ?? 0)}
          total={Number(props.total ?? 0)}
          percent={Number(props.percent ?? 0)}
          currentPhase={props.currentPhase as string | undefined}
          detail={props.detail as string | undefined}
        />
      );

    case 'ReflectionCard':
      return (
        <ReflectionCard
          observation={String(props.observation ?? '')}
          hypothesis={String(props.hypothesis ?? '')}
          nextAction={String(props.nextAction ?? '')}
        />
      );

    case 'CompletionCard':
      return (
        <CompletionCard
          stats={props.stats as Record<string, number>}
          projectUrl={props.projectUrl as string | undefined}
          projectName={props.projectName as string | undefined}
          projectId={props.projectId as number | undefined}
        />
      );

    default:
      return (
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-2xl p-4 text-on-surface-variant text-sm">
          <div className="font-mono text-xs">unknown display_component: {component}</div>
        </div>
      );
  }
}
