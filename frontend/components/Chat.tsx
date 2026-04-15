'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { sendToAgent, fetchJourney, storeRocketlaneApiKey } from '@/lib/agent-client';
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
 * Responsibilities:
 *   - Hold the chronological message list (text bubbles + tool calls + display components + awaiting prompts)
 *   - Hold the JourneyStepper state (separate from the message timeline)
 *   - Hold a "current pending approval" so the input is locked until the user answers
 *   - Wire SSE events from the /agent endpoint to state updates
 *   - Auto-start a session on mount so the agent greets the user and the journey populates
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

// ---------- Initial greeting message ----------

const INITIAL_USER_MESSAGE =
  "Hello! I'd like to set up a project plan in Rocketlane from a CSV file. Please walk me through it — I'll need to provide my Rocketlane API key first, then upload my plan.";

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

  // For text_delta accumulation we need to know which reasoning bubble is "current"
  const currentReasoningIdRef = useRef<string | null>(null);

  // Track the start time of the current reasoning for duration display
  const currentReasoningStartedAtRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
          // Close the current reasoning bubble (auto-collapse)
          const cid = currentReasoningIdRef.current;
          if (cid) {
            updateMessage(cid, (m) =>
              m.kind === 'reasoning' ? { ...m, complete: true, collapsed: true } : m
            );
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
          // Some display components are "stable" (only one at a time, replace previous):
          // - JourneyStepper: NOT a display_component (uses journey_update event)
          // - PlanReviewTree: replace previous occurrence (only one plan at a time)
          // - ProgressFeed: replace previous occurrence (live-updating)
          // - CompletionCard: append (final)
          // Default: append
          const stableComponents = ['PlanReviewTree', 'ProgressFeed'];
          if (stableComponents.includes(event.component)) {
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
            updateMessage(cid, (m) =>
              m.kind === 'reasoning' ? { ...m, complete: true, collapsed: true } : m
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

        case 'done': {
          // Mark current reasoning complete
          const cid = currentReasoningIdRef.current;
          if (cid) {
            updateMessage(cid, (m) =>
              m.kind === 'reasoning' ? { ...m, complete: true, collapsed: true } : m
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
      // Mark the awaiting message as answered
      updateMessage(messageId, (m) =>
        m.kind === 'awaiting'
          ? { ...m, answered: true, selectedLabel: option.label }
          : m
      );
      // Resume the agent with the choice
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
      // If this came from an awaiting prompt, resume with a synthetic "approved" answer
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

  // ---------- File upload handler ----------

  const handleFileUploaded = useCallback(
    (artifactId: string, filename: string, rowCount: number) => {
      // Send a follow-up message to the agent with the artifactId
      sendUserMessage(
        `I've uploaded "${filename}" — ${rowCount} rows. Artifact id: ${artifactId}. Please parse it and walk me through creating the project.`
      );
    },
    [sendUserMessage]
  );

  // ---------- Auto-start on mount ----------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Hydrate journey state in case there's something already there
      const existing = await fetchJourney(sessionId);
      if (cancelled) return;
      if (existing.steps && existing.steps.length > 0) {
        setJourney(existing.steps);
      }
      // Always send the greeting on a fresh page load
      sendUserMessage(INITIAL_USER_MESSAGE, { showInList: false });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streaming]);

  // ---------- Render ----------

  return (
    <div className="min-h-screen bg-surface text-on-surface font-body flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-surface/80 border-b border-outline-variant/30">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
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

      {/* Message timeline */}
      <main className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
          {messages.length === 0 && streaming && (
            <div className="text-center text-on-surface-variant text-sm py-12">
              <span className="material-symbols-outlined text-4xl text-primary/40 mb-2 block">
                hourglass_empty
              </span>
              Initializing agent…
            </div>
          )}

          {messages.map((msg) => {
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
                  />
                );

              case 'error':
                return (
                  <div
                    key={msg.id}
                    className="bg-error-container/30 border border-error/20 rounded-2xl p-4 text-on-error-container"
                  >
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-error">
                        error
                      </span>
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
          })}

          {streaming && messages.length > 0 && !messages.some((m) => m.kind === 'awaiting' && !m.answered) && (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant pl-2 animate-pulse">
              <span className="material-symbols-outlined text-base">auto_awesome</span>
              <span>agent thinking…</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Memory write toasts */}
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

      {/* Footer input area */}
      <footer className="sticky bottom-0 backdrop-blur-md bg-surface/80 border-t border-outline-variant/30">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 bg-surface-container-lowest rounded-2xl shadow-card-sm border border-outline-variant/40 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!streaming && inputValue.trim()) {
                      sendUserMessage(inputValue);
                      setInputValue('');
                    }
                  }
                }}
                placeholder={
                  streaming
                    ? 'Agent is working… (you can type while it works)'
                    : 'Message Plansync agent…'
                }
                disabled={false}
                rows={1}
                className="w-full bg-transparent px-5 py-3 text-sm placeholder:text-outline focus:outline-none resize-none max-h-32"
              />
            </div>
            <button
              onClick={() => {
                if (!streaming && inputValue.trim()) {
                  sendUserMessage(inputValue);
                  setInputValue('');
                }
              }}
              disabled={streaming || !inputValue.trim()}
              className={cn(
                'h-12 w-12 rounded-2xl flex items-center justify-center transition-all',
                'bg-gradient-to-br from-primary to-primary-container text-white shadow-card',
                'hover:scale-105 active:scale-95',
                'disabled:from-outline disabled:to-outline disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none'
              )}
            >
              <span className="material-symbols-outlined text-xl">arrow_upward</span>
            </button>
          </div>
          <div className="text-[11px] text-on-surface-variant text-center mt-2 flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-xs filled">verified_user</span>
            Your data is encrypted end-to-end and never used for training
          </div>
        </div>
      </footer>
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
      return (
        <FileUploadCard
          sessionId={sessionId}
          onUploaded={onFileUploaded}
        />
      );

    case 'ExecutionPlanCard':
      return (
        <ExecutionPlanCard
          goal={String(props.goal ?? '')}
          steps={(props.steps as Array<{ id: string; label: string; status?: string; notes?: string }>) ?? []}
        />
      );

    case 'PlanReviewTree':
      return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <PlanReviewTree
              plan={props.plan as { projectName: string; items: unknown[] }}
              stats={props.stats as Record<string, number>}
            />
          </div>
          <div className="lg:col-span-1">
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
