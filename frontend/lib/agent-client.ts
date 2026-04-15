import type { AgentEvent, UiAction } from './event-types';

/**
 * SSE client for the /agent endpoint.
 *
 * Streams events from the Plansync agent backend (Railway) to the
 * frontend. Hands events to per-type callbacks; the consumer (Chat.tsx)
 * decides how to render them.
 *
 * Auto-resume: when the agent emits `awaiting_user`, the stream closes.
 * The consumer collects user input (e.g. a click on an option) and calls
 * `sendToAgent({sessionId, uiAction})` to resume — no special API here,
 * just a second call with the appropriate payload.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

export interface SendToAgentPayload {
  sessionId: string;
  userMessage?: string;
  uiAction?: UiAction;
}

export interface AgentEventHandlers {
  onEvent: (event: AgentEvent) => void;
  onError?: (err: Error) => void;
}

/**
 * POST to /agent and stream the response. Returns when the stream ends
 * (either `done`, `awaiting_user`, or `error`).
 */
export async function sendToAgent(
  payload: SendToAgentPayload,
  handlers: AgentEventHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL}/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    handlers.onEvent({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!res.ok || !res.body) {
    const message = `HTTP ${res.status}: ${res.statusText}`;
    handlers.onError?.(new Error(message));
    handlers.onEvent({ type: 'error', message });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        if (!part.startsWith('data: ')) continue;
        let event: AgentEvent;
        try {
          event = JSON.parse(part.slice(6));
        } catch {
          continue; // skip malformed
        }
        handlers.onEvent(event);
      }
    }
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
    handlers.onEvent({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Store the user's Rocketlane API key on a session via the dedicated
 * /session/:id/apikey endpoint. Encrypted server-side at rest.
 */
export async function storeRocketlaneApiKey(
  sessionId: string,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${AGENT_URL}/session/${sessionId}/apikey`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean; error?: string };
    return { ok: Boolean(data.ok), error: data.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Upload a CSV/Excel file. Goes through the Vercel /api/upload proxy
 * which forwards to the Railway backend's /upload endpoint.
 */
export async function uploadPlanFile(
  sessionId: string,
  file: File
): Promise<{ artifactId?: string; rowCount?: number; columns?: string[]; error?: string }> {
  try {
    const res = await fetch(
      `/api/upload?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return (await res.json()) as {
      artifactId: string;
      rowCount: number;
      columns: string[];
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Fetch the current journey state for a session — used on initial page
 * load / reconnect to hydrate the JourneyStepper before any SSE events
 * arrive.
 */
export async function fetchJourney(
  sessionId: string
): Promise<{ steps: import('./event-types').JourneyStep[] }> {
  try {
    const res = await fetch(`${AGENT_URL}/session/${sessionId}/journey`);
    if (!res.ok) return { steps: [] };
    return (await res.json()) as { steps: import('./event-types').JourneyStep[] };
  } catch {
    return { steps: [] };
  }
}

/**
 * Fetch the full SSE event log for a session — used for refresh-hydration.
 *
 * Every event the agent ever emitted for this session (text deltas, tool
 * calls, display components, journey updates, pending approvals, errors)
 * is returned in chronological order. The frontend replays them through
 * `handleAgentEvent` on mount to reconstruct the exact UI state from
 * before the browser refresh.
 *
 * Returns `{ events: [], count: 0 }` if the session doesn't exist, is
 * empty, or the network call fails — callers can treat an empty list
 * as "fresh session, start the greeting flow".
 */
export async function fetchSessionEvents(
  sessionId: string
): Promise<{ events: import('./event-types').AgentEvent[]; count: number }> {
  try {
    const res = await fetch(`${AGENT_URL}/session/${sessionId}/events`);
    if (!res.ok) return { events: [], count: 0 };
    return (await res.json()) as {
      events: import('./event-types').AgentEvent[];
      count: number;
    };
  } catch {
    return { events: [], count: 0 };
  }
}

/**
 * Clear the event log for a session — called by the "New session" button
 * flow so that a fresh start doesn't leave the old event log behind.
 * This does NOT touch the core session state (Redis still has history,
 * journey, idmap, etc.) — only the replay log is cleared.
 *
 * Best-effort: failures are swallowed because this is a cleanup step, not
 * a correctness step. TTL eventually cleans up the log anyway.
 */
export async function clearSessionEvents(sessionId: string): Promise<void> {
  try {
    await fetch(`${AGENT_URL}/session/${sessionId}/events`, {
      method: 'DELETE',
    });
  } catch {
    // ignore
  }
}
