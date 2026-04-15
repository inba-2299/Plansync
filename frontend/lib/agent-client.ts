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
