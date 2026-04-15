/**
 * Admin portal API client.
 *
 * All admin requests go to the Railway backend (not the local Vercel
 * proxy) and carry the `plansync_admin_token` cookie via
 * `credentials: 'include'`. The cookie is HttpOnly, so JavaScript
 * can't read it, but the browser automatically attaches it on
 * cross-origin requests when credentials is 'include'.
 *
 * This requires the backend to respond with:
 *   Access-Control-Allow-Origin: <exact Vercel origin>
 *   Access-Control-Allow-Credentials: true
 *
 * (Already set up in agent/src/index.ts CORS middleware for
 * the same-origin Plansync flows — admin inherits the same config.)
 *
 * On 401: the caller should redirect to /admin/login. All fetch
 * helpers return `{ok, status, data, error}` so consumers can
 * branch cleanly without try/catch noise.
 */

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  code?: string;
}

async function adminFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<ApiResult<T>> {
  const url = `${AGENT_URL}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const errObj = (parsed ?? {}) as { error?: string; code?: string };
      return {
        ok: false,
        status: res.status,
        error: errObj.error ?? `HTTP ${res.status}`,
        code: errObj.code,
      };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------- Types mirrored from backend ----------

export type ToolCategory =
  | 'input'
  | 'planning'
  | 'memory'
  | 'hitl'
  | 'creation'
  | 'verification'
  | 'display'
  | 'runtime_recovery';

export interface ToolCatalogEntry {
  name: string;
  displayName: string;
  category: ToolCategory;
  icon: string;
  description: string;
  canDisable: boolean;
  isServerTool?: boolean;
}

export interface ToolCategoryMeta {
  id: ToolCategory;
  label: string;
  description: string;
  icon: string;
}

export type StatusFilter = 'all' | 'successful' | 'errored' | 'in_progress' | 'abandoned';
export type DateRangeFilter = 'today' | '24h' | '7d' | 'all';

export interface DashboardStats {
  totalSessions: number;
  runsToday: number;
  successfulToday: number;
  erroredToday: number;
  inProgressNow: number;
  successRatePercent: number;
  projectsCreatedToday: number;
  todayCostUsd: number;
  avgCostPerRunUsd: number;
  todayTotalTokens: number;
  todayTurns: number;
}

export interface AdminConfigSnapshot {
  model: { effective: string; hasOverride: boolean; envDefault: string | undefined };
  maxTokens: { effective: number; hasOverride: boolean; envDefault: number };
  maxRetries: { effective: number; hasOverride: boolean; envDefault: number };
  disabledTools: string[];
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

export interface DailyUsageSummary {
  date: string;
  totalTurns: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: Record<string, {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
  }>;
}

export interface DashboardPayload {
  stats: DashboardStats;
  config: AdminConfigSnapshot;
  dailyUsage: DailyUsageSummary;
  recentSessions: RecentSessionRow[];
  generatedAt: number;
}

// ---------- Endpoint helpers ----------

export async function adminLogin(
  username: string,
  password: string
): Promise<ApiResult<{ ok: true; expiresAt: number }>> {
  return adminFetch('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function adminLogout(): Promise<ApiResult<{ ok: true }>> {
  return adminFetch('/admin/logout', { method: 'POST' });
}

export async function adminMe(): Promise<ApiResult<{ authenticated: true }>> {
  return adminFetch('/admin/me', { method: 'GET' });
}

export interface DashboardQuery {
  dateRange?: DateRangeFilter;
  status?: StatusFilter;
  search?: string;
  limit?: number;
}

export async function fetchDashboard(
  query: DashboardQuery = {}
): Promise<ApiResult<DashboardPayload>> {
  const params = new URLSearchParams();
  if (query.dateRange) params.set('dateRange', query.dateRange);
  if (query.status) params.set('status', query.status);
  if (query.search) params.set('search', query.search);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return adminFetch(`/admin/dashboard${qs ? `?${qs}` : ''}`);
}

export async function fetchTools(): Promise<
  ApiResult<{
    categories: ToolCategoryMeta[];
    tools: ToolCatalogEntry[];
    disabledTools: string[];
  }>
> {
  return adminFetch('/admin/tools');
}

export async function updateAdminConfig(patch: {
  model?: string | null;
  maxTokens?: number | null;
  maxRetries?: number | null;
}): Promise<ApiResult<{ ok: true; config: AdminConfigSnapshot }>> {
  return adminFetch('/admin/config', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
}

export async function updateDisabledTools(
  tools: string[]
): Promise<ApiResult<{ ok: true; disabledTools: string[] }>> {
  return adminFetch('/admin/config/disabled-tools', {
    method: 'POST',
    body: JSON.stringify({ tools }),
  });
}

// ---------- Display helpers ----------

export function formatUsdCost(costUsd: number): string {
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.01) return `<$0.01`;
  return `$${costUsd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
