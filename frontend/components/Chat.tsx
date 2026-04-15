'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  sendToAgent,
  fetchJourney,
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

export function Chat() {
  // Stable session id for the lifetime of this page load
  const [sessionId] = useState(() => {
    if (typeof window === 'undefined') return 'ssr';
    return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  });

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [journey, setJourney] = useState<JourneyStep[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [memoryToasts, setMemoryToasts] = useState<Array<{ id: string; key: string }>>([]);
  const [inputValue, setInputValue] = useState('');
  const [uploading, setUploading] = useState(false);

  // For text_delta accumulation we need to know which reasoning bubble is "current"
  const currentReasoningIdRef = useRef<string | null>(null);
  const currentReasoningStartedAtRef = useRef<number | null>(null);

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
          setJourney(event.steps);
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
          if (event.payload) {
            addMessage({
              kind: 'awaiting',
              id: `await-${event.toolUseId}`,
              toolUseId: event.toolUseId,
              question: event.payload.question,
              options: event.payload.options,
              context: event.payload.context ?? null,
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

  const handleFileUploaded = useCallback(
    (artifactId: string, filename: string, rowCount: number) => {
      sendUserMessage(
        `I've uploaded "${filename}" — ${rowCount} rows. Artifact id: ${artifactId}. Please parse it and walk me through creating the project.`
      );
    },
    [sendUserMessage]
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
        addMessage({
          kind: 'user',
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          content: `Uploaded: ${file.name} (${result.rowCount ?? '?'} rows)`,
          createdAt: Date.now(),
        });
        sendUserMessage(
          `I've uploaded "${file.name}" — ${result.rowCount ?? 'unknown'} rows. Artifact id: ${result.artifactId}. Please parse it and walk me through creating the project.`,
          { showInList: false }
        );
      } finally {
        setUploading(false);
      }
    },
    [sessionId, uploading, streaming, addMessage, sendUserMessage]
  );

  // ---------- Auto-start on mount ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await fetchJourney(sessionId);
      if (cancelled) return;
      if (existing.steps && existing.steps.length > 0) {
        setJourney(existing.steps);
      }
      sendUserMessage(INITIAL_USER_MESSAGE, { showInList: false });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="font-medium">Connected</span>
          </div>
        </div>
        {journey.length > 0 && <JourneyStepper steps={journey} />}
      </header>

      {/* ---------- Pinned panels (full width, glass backdrop) ---------- */}
      {pinnedMessages.length > 0 && (
        <div className="flex-shrink-0 border-b border-outline-variant/20 bg-surface-container-low/40 backdrop-blur-sm">
          <div className="max-w-screen-2xl mx-auto px-6 py-4 space-y-3">
            {pinnedMessages.map((m) => (
              <DisplayComponentRenderer
                key={m.id}
                component={(m as Extract<UiMessage, { kind: 'display' }>).component}
                props={(m as Extract<UiMessage, { kind: 'display' }>).props}
                sessionId={sessionId}
                onApiKeySubmit={(apiKey) => handleApiKeySubmit(apiKey)}
                onFileUploaded={handleFileUploaded}
              />
            ))}
          </div>
        </div>
      )}

      {/* ---------- Main split area ---------- */}
      {/* min-h-0 is critical so children with overflow-y-auto actually scroll
          inside a flex container. Without it the children grow to content
          height and the page itself scrolls. */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-screen-2xl mx-auto h-full">
          {/* Mobile: single chronological column (<1024px) */}
          <div className="lg:hidden h-full overflow-y-auto custom-scrollbar">
            <div className="px-4 sm:px-6 py-6 space-y-4">
              {messages.length === 0 && streaming && <InitializingAgent />}
              {mobileMessages.map(renderMessage)}
              {errorMessages.map(renderMessage)}
              <AgentThinkingHint streaming={streaming} hasAnyMessages={messages.length > 0} awaiting={awaitingUnanswered} />
              <div ref={mobileEndRef} />
            </div>
          </div>

          {/* Desktop: 60/40 split with vertical divider (≥1024px) */}
          <div className="hidden lg:grid h-full grid-cols-[3fr_2fr]">
            {/* Agent workspace — left column, ~60% width */}
            <section className="relative flex flex-col min-h-0 border-r border-outline-variant/20">
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
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-8 pb-6">
                <div className="space-y-4">
                  {messages.length === 0 && streaming && <InitializingAgent />}
                  {agentMessages.map(renderMessage)}
                  {errorMessages.map(renderMessage)}
                  <AgentThinkingHint streaming={streaming} hasAnyMessages={messages.length > 0} awaiting={awaitingUnanswered} />
                  <div ref={agentColEndRef} />
                </div>
              </div>
            </section>

            {/* User workspace — right column, ~40% width */}
            <section className="flex flex-col min-h-0 bg-surface-container-low/20">
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
