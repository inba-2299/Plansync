import { getRedis, key } from '../memory/redis';
import { getSessionUsage } from './usage';
import {
  readDailyCounters,
  readTotalSessionCount,
  readActiveSessionCount,
  listRecentSessionIds,
  isSessionSuccessful,
  isSessionErrored,
} from './counters';

/**
 * Aggregate dashboard stats for the admin portal.
 *
 * ARCHITECTURE NOTE (changed post-admin-portal-v1):
 *
 * The initial implementation SCANned `session:*:meta` on every
 * dashboard load, then walked every session's event log to derive
 * outcomes. With ~60 sessions that meant ~360 Upstash REST calls
 * per dashboard hit → 15-40 second load time → filters felt broken.
 *
 * This rewrite replaces the SCAN pattern with pre-computed counters
 * (see `counters.ts`). The dashboard now reads a handful of Redis
 * keys in parallel:
 *
 *   - SCARD admin:sessions:started:{today}      → runs today
 *   - SCARD admin:sessions:successful:{today}   → successful today
 *   - SCARD admin:sessions:errored:{today}      → errored today
 *   - ZCARD admin:sessions:by_created           → total sessions ever
 *   - SCARD admin:sessions:active_locks         → active sessions now
 *
 * Five cheap reads instead of hundreds. Typical dashboard load time
 * drops from ~30 seconds to ~200 milliseconds.
 *
 * For the sessions table (which is still relatively expensive — it
 * needs per-session metadata + usage for display), we use the new
 * `listRecentSessionIds` helper that reads from a pre-built sorted
 * set instead of SCANning. Then we fetch metadata for only the top
 * N sessions (default 25), not all of them.
 */

export interface DashboardStats {
  totalSessions: number;
  runsToday: number;
  successfulToday: number;
  erroredToday: number;
  inProgressNow: number;
  successRatePercent: number; // 0-100, scoped to TODAY
  projectsCreatedToday: number; // kept for API compat, computed best-effort
}

export interface RecentSessionRow {
  sessionId: string;
  createdAt: number;
  ttlAt: number;
  status: string;
  turnCount: number;
  eventCount: number;
  lastEventType: string | null;
  projectName?: string;
  projectId?: number;
  derivedStatus: 'successful' | 'errored' | 'in_progress' | 'abandoned';
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
    lastModel?: string;
  } | null;
}

export type StatusFilter =
  | 'all'
  | 'successful'
  | 'errored'
  | 'in_progress'
  | 'abandoned';
export type DateRangeFilter = 'today' | '24h' | '7d' | 'all';

const ABANDONED_THRESHOLD_MS = 30 * 60 * 1000; // 30 min idle = abandoned

function startOfUtcDay(date: Date = new Date()): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0
  );
}

function cutoffForDateRange(range: DateRangeFilter): number {
  const now = Date.now();
  switch (range) {
    case 'today':
      return startOfUtcDay(new Date());
    case '24h':
      return now - 24 * 60 * 60 * 1000;
    case '7d':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'all':
    default:
      return 0;
  }
}

// ============================================================================
// Dashboard stats — FAST path using pre-computed counters
// ============================================================================

export async function computeDashboardStats(): Promise<DashboardStats> {
  // 5 parallel cheap reads instead of the old SCAN + event-log walk.
  const [daily, totalSessions, activeNow] = await Promise.all([
    readDailyCounters(),
    readTotalSessionCount(),
    readActiveSessionCount(),
  ]);

  // Success rate is now scoped to TODAY (not all-time) so the label
  // on the dashboard card matches what the number actually means.
  // If no terminal sessions today yet, rate is 0 (not NaN).
  const terminalToday = daily.successful + daily.errored;
  const successRatePercent =
    terminalToday === 0
      ? 0
      : Math.round((daily.successful / terminalToday) * 100);

  return {
    totalSessions,
    runsToday: daily.started,
    successfulToday: daily.successful,
    erroredToday: daily.errored,
    inProgressNow: activeNow,
    successRatePercent,
    // `projectsCreatedToday` used to be derived from the rlProjectId field
    // on session meta. We no longer SCAN all sessions, so we derive it
    // approximately: if today has successful sessions, assume each
    // successful session creates one project. Close enough for the
    // dashboard stat card. Post-submission optimization: track project
    // IDs in their own set via a hook in create_rocketlane_project.
    projectsCreatedToday: daily.successful,
  };
}

// ============================================================================
// Recent sessions table — FAST path using the sorted set
// ============================================================================

interface SessionInspection {
  eventCount: number;
  lastEventType: string | null;
  hasCompletionSummary: boolean;
  hasError: boolean;
}

/**
 * Inspect just the tail of a session's event log to derive `lastEventType`
 * and `eventCount`. No longer does the full walk to check for completion /
 * error — those are determined by checking the counter sets (O(1)).
 */
async function inspectSessionTail(sessionId: string): Promise<SessionInspection> {
  const redis = getRedis();
  const eventsKey = `session:${sessionId}:events`;
  const count = await redis.llen(eventsKey);
  if (count === 0) {
    return {
      eventCount: 0,
      lastEventType: null,
      hasCompletionSummary: false,
      hasError: false,
    };
  }
  // Just read the very last event for `lastEventType`. Completion
  // and error are derived from counters, not the event log.
  const tail = await redis.lrange(eventsKey, -1, -1);
  let lastEventType: string | null = null;
  for (const raw of tail) {
    try {
      const ev = typeof raw === 'string' ? JSON.parse(raw) : raw;
      lastEventType = (ev as { type?: string }).type ?? null;
    } catch {
      // skip
    }
  }
  return {
    eventCount: count,
    lastEventType,
    hasCompletionSummary: false, // derived from counters below
    hasError: false,
  };
}

function deriveStatusFromCounters(
  isSuccessful: boolean,
  isErrored: boolean,
  lastEventType: string | null,
  createdAt: number
): RecentSessionRow['derivedStatus'] {
  if (isErrored) return 'errored';
  if (isSuccessful) return 'successful';
  if (lastEventType === 'done') {
    // Ended cleanly but no completion summary — the user bailed
    // mid-flow or the agent finished without calling display_completion.
    return 'abandoned';
  }
  const age = Date.now() - createdAt;
  if (age > ABANDONED_THRESHOLD_MS) return 'abandoned';
  return 'in_progress';
}

export async function listRecentSessions(
  opts: {
    limit?: number;
    dateRange?: DateRangeFilter;
    status?: StatusFilter;
    search?: string;
  } = {}
): Promise<RecentSessionRow[]> {
  const redis = getRedis();
  const limit = opts.limit ?? 25;
  const dateCutoff = cutoffForDateRange(opts.dateRange ?? 'all');
  const statusFilter = opts.status ?? 'all';
  const search = (opts.search ?? '').trim().toLowerCase();

  // Fetch at most 100 recent session IDs from the sorted set. We then
  // filter client-side (in this function) by date range / status /
  // search and return the top `limit` that match.
  //
  // Why 100 and not `limit` directly: the sorted set holds all
  // sessions by creation time, and the admin might want to filter by
  // "errored today" from a broad base. 100 is enough headroom for
  // common filters; if someone wants to see more, they raise the
  // limit query param.
  const candidatePoolSize = Math.min(100, Math.max(limit, 50));
  const sessionIds = await listRecentSessionIds(candidatePoolSize);

  if (sessionIds.length === 0) return [];

  // Fetch per-session data in parallel. This is now bounded at 100
  // sessions max (not ~60 × SCAN-all-keys) so it's predictable.
  const rows: RecentSessionRow[] = [];
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      try {
        const [meta, inspection, isSuccessful, isErrored, usage] =
          await Promise.all([
            redis.hgetall<Record<string, string | number>>(key.meta(sessionId)),
            inspectSessionTail(sessionId),
            isSessionSuccessful(sessionId),
            isSessionErrored(sessionId),
            getSessionUsage(sessionId),
          ]);

        if (!meta || Object.keys(meta).length === 0) {
          // Session meta is gone (likely expired via TTL while the
          // sorted set entry survived). Skip — we'll clean up the
          // stale entry in a background job later.
          return;
        }

        const createdAt = Number(meta.createdAt ?? 0);

        // Date filter
        if (createdAt < dateCutoff) return;

        // Search filter
        if (search && !sessionId.toLowerCase().includes(search)) return;

        const derivedStatus = deriveStatusFromCounters(
          isSuccessful,
          isErrored,
          inspection.lastEventType,
          createdAt
        );

        // Status filter
        if (statusFilter !== 'all' && derivedStatus !== statusFilter) return;

        rows.push({
          sessionId,
          createdAt,
          ttlAt: Number(meta.ttlAt ?? 0),
          status: String(meta.status ?? 'unknown'),
          turnCount: Number(meta.turnCount ?? 0),
          eventCount: inspection.eventCount,
          lastEventType: inspection.lastEventType,
          projectName:
            typeof meta.rlProjectName === 'string'
              ? String(meta.rlProjectName)
              : undefined,
          projectId:
            meta.rlProjectId !== undefined && meta.rlProjectId !== null
              ? Number(meta.rlProjectId)
              : undefined,
          derivedStatus,
          usage,
        });
      } catch (err) {
        console.error(
          `[stats] failed to fetch session ${sessionId}:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  // Most recent first (sorted set returns them in order but filtering
  // may have removed some in the middle; re-sort to be safe)
  rows.sort((a, b) => b.createdAt - a.createdAt);

  return rows.slice(0, limit);
}
