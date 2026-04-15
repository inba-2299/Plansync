import { getRedis } from '../memory/redis';

/**
 * Pre-computed counters for the admin dashboard.
 *
 * Problem they solve: the original `stats.ts` implementation SCANned
 * `session:*:meta` on every dashboard load, then for each session
 * walked the event log to derive outcome (successful / errored / etc.).
 * With ~60 sessions and an event log per session, that's ~360 Upstash
 * REST calls per dashboard hit → 15-40 second load time.
 *
 * Solution: maintain counters that are incremented AT THE MOMENT events
 * happen (session creation, completion, error), so the dashboard just
 * reads a handful of Redis keys instead of SCANning and walking.
 *
 * Storage:
 *   - `admin:sessions:started:{yyyy-mm-dd}`    SET of sessionIds started
 *     that day (set semantics = idempotent dedup if the same session
 *     somehow registers twice)
 *   - `admin:sessions:successful:{yyyy-mm-dd}` SET of sessionIds that
 *     completed (emitted a display_component: CompletionCard)
 *   - `admin:sessions:errored:{yyyy-mm-dd}`    SET of sessionIds that
 *     emitted an error event
 *   - `admin:sessions:by_created`              SORTED SET, score =
 *     createdAt (ms since epoch), member = sessionId. Used by the
 *     Sessions tab to list the most recent N without a SCAN.
 *   - `admin:sessions:active_locks`            SET of sessionIds with
 *     an active loop lock (added on acquireLock, removed on release).
 *
 * TTLs:
 *   - Daily sets: 30 days (so we have a week of history for trend
 *     visuals post-submission)
 *   - Sorted set of all sessions: no TTL (capped at 1000 most recent
 *     via ZREMRANGEBYRANK to keep memory bounded)
 *   - Active locks set: no TTL (short-lived by nature)
 *
 * All writes are fire-and-forget from the callers — a Redis hiccup
 * should never crash the agent loop. Callers use `.catch(() => {})`
 * on every Promise returned from this module.
 */

const DAILY_COUNTER_TTL_SECONDS = 30 * 24 * 60 * 60;
const RECENT_SESSIONS_CAP = 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a Date as yyyy-mm-dd in UTC. Used as the daily key suffix. */
function utcDateKey(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

// ---------- Session lifecycle events ----------

/**
 * Called the first time we see a sessionId — specifically, when
 * `loadSession` returns a fresh session because no meta existed in
 * Redis. Adds to today's started set AND to the global recent-sessions
 * sorted set. The sorted set is capped at 1000 to keep memory bounded.
 */
export async function recordSessionStarted(sessionId: string): Promise<void> {
  try {
    const redis = getRedis();
    const now = Date.now();
    const key = `admin:sessions:started:${utcDateKey()}`;
    await redis.sadd(key, sessionId);
    await redis.expire(key, DAILY_COUNTER_TTL_SECONDS);

    // Add to the global recent-sessions sorted set. Score = createdAt.
    await redis.zadd('admin:sessions:by_created', {
      score: now,
      member: sessionId,
    });
    // Keep only the top RECENT_SESSIONS_CAP most recent. ZREMRANGEBYRANK
    // removes by rank (not score), so we remove items ranked 0..N-cap-1,
    // i.e. the oldest ones beyond the cap.
    await redis.zremrangebyrank(
      'admin:sessions:by_created',
      0,
      -RECENT_SESSIONS_CAP - 1
    );
  } catch (err) {
    console.error(
      '[counters] recordSessionStarted failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Called when a display_component: CompletionCard event emits — meaning
 * the agent successfully finished a run. Set semantics dedupe if the
 * agent re-calls display_completion_summary (which would emit twice).
 */
export async function recordSessionCompleted(sessionId: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `admin:sessions:successful:${utcDateKey()}`;
    await redis.sadd(key, sessionId);
    await redis.expire(key, DAILY_COUNTER_TTL_SECONDS);
  } catch (err) {
    console.error(
      '[counters] recordSessionCompleted failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Called when an `error` event emits. Set semantics dedupe if the same
 * session errors multiple times in quick succession.
 */
export async function recordSessionErrored(sessionId: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `admin:sessions:errored:${utcDateKey()}`;
    await redis.sadd(key, sessionId);
    await redis.expire(key, DAILY_COUNTER_TTL_SECONDS);
  } catch (err) {
    console.error(
      '[counters] recordSessionErrored failed:',
      err instanceof Error ? err.message : err
    );
  }
}

// ---------- Active locks ----------

/** Called from acquireLock on success. */
export async function recordLockAcquired(sessionId: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.sadd('admin:sessions:active_locks', sessionId);
  } catch (err) {
    console.error(
      '[counters] recordLockAcquired failed:',
      err instanceof Error ? err.message : err
    );
  }
}

/** Called from the lock release path. */
export async function recordLockReleased(sessionId: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.srem('admin:sessions:active_locks', sessionId);
  } catch (err) {
    console.error(
      '[counters] recordLockReleased failed:',
      err instanceof Error ? err.message : err
    );
  }
}

// ---------- Reads (for the dashboard) ----------

export interface DailyCounters {
  started: number;
  successful: number;
  errored: number;
}

/**
 * Read today's (or a given day's) counters in a single parallel call.
 * Returns zeros if any key is missing (empty sets).
 */
export async function readDailyCounters(
  date: Date = new Date()
): Promise<DailyCounters> {
  const redis = getRedis();
  const d = utcDateKey(date);
  try {
    const [started, successful, errored] = await Promise.all([
      redis.scard(`admin:sessions:started:${d}`),
      redis.scard(`admin:sessions:successful:${d}`),
      redis.scard(`admin:sessions:errored:${d}`),
    ]);
    return {
      started: Number(started ?? 0),
      successful: Number(successful ?? 0),
      errored: Number(errored ?? 0),
    };
  } catch (err) {
    console.error(
      '[counters] readDailyCounters failed:',
      err instanceof Error ? err.message : err
    );
    return { started: 0, successful: 0, errored: 0 };
  }
}

/** Total number of sessions ever tracked in the sorted set. */
export async function readTotalSessionCount(): Promise<number> {
  const redis = getRedis();
  try {
    const count = await redis.zcard('admin:sessions:by_created');
    return Number(count ?? 0);
  } catch {
    return 0;
  }
}

/** Number of sessions with an active lock right now. */
export async function readActiveSessionCount(): Promise<number> {
  const redis = getRedis();
  try {
    const count = await redis.scard('admin:sessions:active_locks');
    return Number(count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * List the most recent N sessionIds from the sorted set (newest first).
 * This is the fast-path for the Sessions tab — avoids the full SCAN
 * across `session:*:meta`.
 *
 * The Upstash Redis client's `zrange` with `rev: true` returns members
 * in descending score order. We pass indices 0..limit-1.
 */
export async function listRecentSessionIds(limit = 50): Promise<string[]> {
  const redis = getRedis();
  try {
    const ids = await redis.zrange(
      'admin:sessions:by_created',
      0,
      limit - 1,
      { rev: true }
    );
    return (ids as string[]) ?? [];
  } catch (err) {
    console.error(
      '[counters] listRecentSessionIds failed:',
      err instanceof Error ? err.message : err
    );
    return [];
  }
}

/**
 * Is the given sessionId in the "successful today" set? Used to tag
 * individual session rows in the Sessions table with their outcome.
 */
export async function isSessionSuccessful(
  sessionId: string,
  date: Date = new Date()
): Promise<boolean> {
  const redis = getRedis();
  try {
    const isMember = await redis.sismember(
      `admin:sessions:successful:${utcDateKey(date)}`,
      sessionId
    );
    return Number(isMember) === 1;
  } catch {
    return false;
  }
}

/** Same, for errored. */
export async function isSessionErrored(
  sessionId: string,
  date: Date = new Date()
): Promise<boolean> {
  const redis = getRedis();
  try {
    const isMember = await redis.sismember(
      `admin:sessions:errored:${utcDateKey(date)}`,
      sessionId
    );
    return Number(isMember) === 1;
  } catch {
    return false;
  }
}
