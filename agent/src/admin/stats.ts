import { getRedis } from '../memory/redis';
import { getSessionUsage } from './usage';

/**
 * Aggregate dashboard stats for the admin portal.
 *
 * Everything here reads from Redis — SCANning session meta keys, aggregating
 * status, counting completions/errors, and pulling recent sessions with
 * filters. Called from `GET /admin/dashboard` via `requireAdminAuth`.
 *
 * Performance note: we SCAN on every dashboard request. For the submission
 * workload (tens of sessions) this is fine. Post-submission optimization:
 * maintain a sorted set of sessions by createdAt so we avoid the O(n) scan.
 */

export interface DashboardStats {
  totalSessions: number;
  runsToday: number;
  successfulToday: number;
  erroredToday: number;
  inProgressNow: number;
  successRatePercent: number; // 0-100
  projectsCreatedToday: number;
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
  /** Derived outcome: 'successful' | 'errored' | 'in_progress' | 'abandoned' */
  derivedStatus: 'successful' | 'errored' | 'in_progress' | 'abandoned';
  /** Per-session usage totals (if tracked) */
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
    lastModel?: string;
  } | null;
}

export type StatusFilter = 'all' | 'successful' | 'errored' | 'in_progress' | 'abandoned';
export type DateRangeFilter = 'today' | '24h' | '7d' | 'all';

const SCAN_COUNT = 200;
const ABANDONED_THRESHOLD_MS = 30 * 60 * 1000; // 30 min idle = abandoned
const ACTIVE_THRESHOLD_MS = 60 * 1000; // last 60s = "in progress now"

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

/** SCAN all session meta keys (O(n), fine for the current workload). */
async function scanAllSessionMetaKeys(): Promise<string[]> {
  const redis = getRedis();
  const keys: string[] = [];
  let cursor: string | number = '0';
  do {
    // Upstash's SCAN signature: scan(cursor, { match, count }) → [cursor, keys]
    const result = (await redis.scan(cursor, {
      match: 'session:*:meta',
      count: SCAN_COUNT,
    })) as [string, string[]] | [number, string[]];
    cursor = result[0];
    keys.push(...(result[1] ?? []));
  } while (cursor !== '0' && cursor !== 0);
  return keys;
}

/**
 * Inspect a session's event log to derive its outcome. Returns the last
 * event type so the dashboard can show e.g. "awaiting_user" for a paused
 * session.
 */
async function inspectSessionEvents(sessionId: string): Promise<{
  eventCount: number;
  lastEventType: string | null;
  hasCompletionSummary: boolean;
  hasError: boolean;
  lastEventTimestamp: number | null;
}> {
  const redis = getRedis();
  const eventsKey = `session:${sessionId}:events`;
  const count = await redis.llen(eventsKey);
  if (count === 0) {
    return {
      eventCount: 0,
      lastEventType: null,
      hasCompletionSummary: false,
      hasError: false,
      lastEventTimestamp: null,
    };
  }

  // Pull tail events. Walking the whole log is wasteful for old sessions
  // with 2000+ events — just read the last 30 to classify and check the
  // full log for "contains completion summary" via a targeted scan.
  const tail = await redis.lrange(eventsKey, -30, -1);

  let lastEventType: string | null = null;
  let hasError = false;
  let hasCompletionSummary = false;

  // Check the tail for terminal events
  for (const raw of tail) {
    try {
      const ev = typeof raw === 'string' ? JSON.parse(raw) : raw;
      lastEventType = ev.type ?? lastEventType;
      if (ev.type === 'error') hasError = true;
      if (ev.type === 'display_component' && ev.component === 'CompletionCard') {
        hasCompletionSummary = true;
      }
      if (
        ev.type === 'display_component' &&
        (ev.component === 'display_completion_summary' ||
          ev.props?.stats?.phasesCreated !== undefined)
      ) {
        hasCompletionSummary = true;
      }
    } catch {}
  }

  // If we haven't seen the completion card in the tail but the session
  // looks DONE-ish, scan further back. Cheap optimization: only do this
  // for sessions that ended (lastEventType === 'done').
  if (!hasCompletionSummary && lastEventType === 'done') {
    // Grab slightly more events — we're looking for a display_component
    // with component === 'CompletionCard' earlier in the log.
    const earlier = await redis.lrange(eventsKey, -100, -31);
    for (const raw of earlier) {
      try {
        const ev = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (ev.type === 'display_component' && ev.component === 'CompletionCard') {
          hasCompletionSummary = true;
          break;
        }
      } catch {}
    }
  }

  return {
    eventCount: count,
    lastEventType,
    hasCompletionSummary,
    hasError,
    lastEventTimestamp: null, // timestamp of last event is not captured in the event log
  };
}

function deriveStatus(
  hasCompletionSummary: boolean,
  hasError: boolean,
  lastEventType: string | null,
  createdAt: number
): RecentSessionRow['derivedStatus'] {
  if (hasError) return 'errored';
  if (hasCompletionSummary) return 'successful';
  if (lastEventType === 'done') {
    // Ended cleanly but no completion summary — probably the user bailed
    // mid-flow (closed tab, etc.)
    return 'abandoned';
  }
  // Still going or awaiting
  const age = Date.now() - createdAt;
  if (age > ABANDONED_THRESHOLD_MS) return 'abandoned';
  return 'in_progress';
}

/**
 * Aggregate dashboard stats — for the 5 stat cards at the top of the
 * admin dashboard. Also feeds into the recent sessions table below.
 */
export async function computeDashboardStats(): Promise<DashboardStats> {
  const redis = getRedis();
  const metaKeys = await scanAllSessionMetaKeys();
  const todayStart = startOfUtcDay();

  let runsToday = 0;
  let successfulToday = 0;
  let erroredToday = 0;
  let inProgressNow = 0;
  let projectsCreatedToday = 0;
  let totalCompletedAllTime = 0;
  let totalTerminalAllTime = 0;

  for (const metaKey of metaKeys) {
    const meta = await redis.hgetall<Record<string, string | number>>(metaKey);
    if (!meta || Object.keys(meta).length === 0) continue;

    const sessionId = metaKey.replace(/^session:/, '').replace(/:meta$/, '');
    const createdAt = Number(meta.createdAt ?? 0);
    const isToday = createdAt >= todayStart;

    // Inspect events for outcome
    const insp = await inspectSessionEvents(sessionId);

    if (isToday) {
      runsToday++;
    }
    if (insp.hasCompletionSummary) {
      totalCompletedAllTime++;
      totalTerminalAllTime++;
      if (isToday) successfulToday++;
    }
    if (insp.hasError) {
      totalTerminalAllTime++;
      if (isToday) erroredToday++;
    }
    if (meta.rlProjectId && isToday) {
      projectsCreatedToday++;
    }

    // "In progress now" — session is still active (pending approval or
    // recently emitted an event)
    const derivedStatus = deriveStatus(
      insp.hasCompletionSummary,
      insp.hasError,
      insp.lastEventType,
      createdAt
    );
    if (derivedStatus === 'in_progress') {
      inProgressNow++;
    }
  }

  const successRatePercent =
    totalTerminalAllTime === 0
      ? 0
      : Math.round((totalCompletedAllTime / totalTerminalAllTime) * 100);

  return {
    totalSessions: metaKeys.length,
    runsToday,
    successfulToday,
    erroredToday,
    inProgressNow,
    successRatePercent,
    projectsCreatedToday,
  };
}

/**
 * List recent sessions with metadata, optionally filtered by date range
 * and status. Sorted most-recent first.
 */
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

  const metaKeys = await scanAllSessionMetaKeys();
  const rows: RecentSessionRow[] = [];

  for (const metaKey of metaKeys) {
    const meta = await redis.hgetall<Record<string, string | number>>(metaKey);
    if (!meta || Object.keys(meta).length === 0) continue;

    const sessionId = metaKey.replace(/^session:/, '').replace(/:meta$/, '');
    const createdAt = Number(meta.createdAt ?? 0);

    // Date filter
    if (createdAt < dateCutoff) continue;

    // Search filter
    if (search && !sessionId.toLowerCase().includes(search)) continue;

    // Inspect events
    const insp = await inspectSessionEvents(sessionId);
    const derivedStatus = deriveStatus(
      insp.hasCompletionSummary,
      insp.hasError,
      insp.lastEventType,
      createdAt
    );

    // Status filter
    if (statusFilter !== 'all' && derivedStatus !== statusFilter) continue;

    // Pull usage
    const usage = await getSessionUsage(sessionId);

    rows.push({
      sessionId,
      createdAt,
      ttlAt: Number(meta.ttlAt ?? 0),
      status: String(meta.status ?? 'unknown'),
      turnCount: Number(meta.turnCount ?? 0),
      eventCount: insp.eventCount,
      lastEventType: insp.lastEventType,
      projectName:
        typeof meta.rlProjectName === 'string' ? String(meta.rlProjectName) : undefined,
      projectId:
        meta.rlProjectId !== undefined && meta.rlProjectId !== null
          ? Number(meta.rlProjectId)
          : undefined,
      derivedStatus,
      usage,
    });
  }

  // Sort most-recent first
  rows.sort((a, b) => b.createdAt - a.createdAt);

  return rows.slice(0, limit);
}
