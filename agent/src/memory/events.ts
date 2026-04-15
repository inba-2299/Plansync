import type { AgentEvent } from '../types';
import { getRedis, SESSION_TTL_SECONDS } from './redis';

/**
 * Per-session SSE event log — the replay source for hydration on refresh.
 *
 * The problem: when a user refreshes the browser mid-session, the
 * frontend loses its in-memory `UiMessage[]` state. The backend already
 * stores the Anthropic conversation history, but that's NOT sufficient
 * to reconstruct the full UI — it lacks synthetic SSE events like
 * `journey_update`, `display_component`, `memory_write`, and
 * `awaiting_user` that only exist in the streaming layer.
 *
 * The solution: every event emitted via the `/agent` route's `emit()`
 * is ALSO pushed into `session:{id}:events`. On refresh, the frontend
 * calls `GET /session/:id/events` and replays the list through the
 * same `handleAgentEvent` function that processes live events —
 * reconstructing reasoning bubbles, tool calls, display cards, journey
 * state, and any pending approval. No duplicated state-derivation logic.
 *
 * Storage: Redis LIST, JSON-encoded events, one per list entry. TTL
 * matches the session TTL (7 days). Writes are fire-and-forget from
 * the route handler — a Redis write failure should not crash the
 * agent loop.
 *
 * Event volume: a typical run emits 100-500 events (~50-300 KB total).
 * Upstash handles this trivially and it's well below their per-request
 * size limits for LRANGE.
 */

function eventsKey(sessionId: string): string {
  return `session:${sessionId}:events`;
}

export async function appendSessionEvent(
  sessionId: string,
  event: AgentEvent
): Promise<void> {
  const redis = getRedis();
  const key = eventsKey(sessionId);
  await redis.rpush(key, JSON.stringify(event));
  // Expire set on every write so active sessions never decay prematurely.
  await redis.expire(key, SESSION_TTL_SECONDS);
}

export async function loadSessionEvents(
  sessionId: string
): Promise<AgentEvent[]> {
  const redis = getRedis();
  const key = eventsKey(sessionId);
  const raw = await redis.lrange(key, 0, -1);
  if (!raw || raw.length === 0) return [];

  const events: AgentEvent[] = [];
  for (const entry of raw) {
    try {
      const parsed = typeof entry === 'string' ? JSON.parse(entry) : entry;
      events.push(parsed as AgentEvent);
    } catch {
      // skip malformed — keep replay robust
    }
  }
  return events;
}

/**
 * Clear all events for a session. Called by explicit "start over" flows
 * that want to reuse a session ID but discard its history. Not called
 * in the happy path — TTL handles normal cleanup.
 */
export async function clearSessionEvents(sessionId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(eventsKey(sessionId));
}

/**
 * Get the number of events stored for a session without pulling them.
 * Useful for quick "does this session have any state?" checks.
 */
export async function countSessionEvents(sessionId: string): Promise<number> {
  const redis = getRedis();
  return await redis.llen(eventsKey(sessionId));
}
