'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchDashboard,
  fetchTools,
  fetchRecentSessions,
  updateAdminConfig,
  updateDisabledTools,
  adminLogout,
  formatUsdCost,
  formatTokens,
  formatRelativeTime,
} from '@/lib/admin-client';
import type {
  DashboardPayload,
  RecentSessionRow,
  StatusFilter,
  DateRangeFilter,
  ToolCatalogEntry,
  ToolCategoryMeta,
} from '@/lib/admin-client';
import { cn } from '@/lib/cn';

/**
 * Plansync Admin — Tabbed Dashboard
 *
 * Rewritten from the v1 single-page implementation after it became
 * obvious that loading everything at once was ~30 seconds of latency
 * (see MEMORY.md post-v1 fix for the full diagnosis). The current
 * design is a four-tab layout where:
 *
 *   • Observability (default) — stat cards + usage by model.
 *     Loads from the fast /admin/dashboard endpoint (pre-computed
 *     Redis counters, ~200ms).
 *   • Runtime Config — model / max_tokens / retry cap editor.
 *     Uses the dashboard payload's config snapshot (already loaded
 *     with the Observability tab, so tab switching is instant).
 *   • Agent Tools — 7 categories × 22 tools with toggle.
 *     Loaded on first click via /admin/tools (~50ms; static catalog).
 *   • Recent Sessions — filterable table.
 *     Lazy-loaded via /admin/sessions on first click AND on every
 *     filter change. Uses the new sorted set for fast reads.
 *
 * Per-tab data lives in local state, fetched on-demand. Tab switching
 * is instant after the initial fetch (no loading state re-renders the
 * entire page).
 */

type TabId = 'observability' | 'config' | 'tools' | 'sessions';

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheap, fast)' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (balanced)' },
  {
    value: 'claude-opus-4-5',
    label: 'Claude Opus 4.5 (expensive, highest capability)',
  },
];

export default function AdminDashboardPage() {
  const router = useRouter();

  // ---------- Global state (loaded on mount) ----------
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [toolsPayload, setToolsPayload] = useState<{
    categories: ToolCategoryMeta[];
    tools: ToolCatalogEntry[];
    disabledTools: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---------- Tab state ----------
  const [activeTab, setActiveTab] = useState<TabId>('observability');

  // ---------- Sessions tab state (lazy-loaded) ----------
  const [sessions, setSessions] = useState<RecentSessionRow[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeFilter>('7d');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  // ---------- Config form state (pending edits) ----------
  const [pendingModel, setPendingModel] = useState<string>('');
  const [pendingMaxTokens, setPendingMaxTokens] = useState<string>('');
  const [pendingMaxRetries, setPendingMaxRetries] = useState<string>('');
  const [savingConfig, setSavingConfig] = useState(false);

  // ---------- Tool toggle state ----------
  const [pendingDisabled, setPendingDisabled] = useState<Set<string>>(new Set());
  const [savingTools, setSavingTools] = useState(false);

  // ============================================================================
  // Data loaders
  // ============================================================================

  /** Load the fast dashboard payload (stats + config + daily usage). */
  const loadDashboard = useCallback(async () => {
    const res = await fetchDashboard();
    if (!res.ok) {
      if (res.status === 401) {
        router.replace('/admin/login');
        return;
      }
      setError(res.error ?? 'Failed to load dashboard');
      return;
    }
    if (res.data) {
      setDashboard(res.data);
      setPendingModel(res.data.config.model.effective);
      setPendingMaxTokens(String(res.data.config.maxTokens.effective));
      setPendingMaxRetries(String(res.data.config.maxRetries.effective));
      setPendingDisabled(new Set(res.data.config.disabledTools));
    }
  }, [router]);

  /** Load the tool catalog (static) + current disabled set. */
  const loadTools = useCallback(async () => {
    const res = await fetchTools();
    if (!res.ok) {
      if (res.status === 401) {
        router.replace('/admin/login');
        return;
      }
      setError(res.error ?? 'Failed to load tools');
      return;
    }
    if (res.data) setToolsPayload(res.data);
  }, [router]);

  /**
   * Load recent sessions with the current filters. Triggered on:
   *   1. First click on the Sessions tab
   *   2. Any filter change while on the Sessions tab
   */
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetchRecentSessions({
        dateRange,
        status: statusFilter,
        search: search.trim(),
        limit: 50,
      });
      if (!res.ok) {
        if (res.status === 401) {
          router.replace('/admin/login');
          return;
        }
        setError(res.error ?? 'Failed to load sessions');
        return;
      }
      if (res.data) {
        setSessions(res.data.sessions);
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [dateRange, statusFilter, search, router]);

  // ============================================================================
  // Lifecycle
  // ============================================================================

  // Initial load — fast path only (dashboard + tools). No session fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadDashboard(), loadTools()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard, loadTools]);

  // Sessions tab: lazy-load on first click.
  useEffect(() => {
    if (activeTab === 'sessions' && sessions === null && !sessionsLoading) {
      loadSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Sessions tab: refetch when filters change (only if the tab is open).
  useEffect(() => {
    if (activeTab !== 'sessions') return;
    loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, statusFilter]);

  // Debounced search input → refetch
  useEffect(() => {
    if (activeTab !== 'sessions') return;
    const handle = setTimeout(() => {
      loadSessions();
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleLogout = useCallback(async () => {
    await adminLogout();
    router.replace('/admin/login');
  }, [router]);

  const handleSaveConfig = useCallback(async () => {
    if (savingConfig) return;
    setSavingConfig(true);
    try {
      const patch: {
        model?: string | null;
        maxTokens?: number | null;
        maxRetries?: number | null;
      } = {};
      if (pendingModel && pendingModel !== dashboard?.config.model.effective) {
        patch.model = pendingModel;
      }
      const mt = Number(pendingMaxTokens);
      if (
        Number.isFinite(mt) &&
        mt > 0 &&
        mt !== dashboard?.config.maxTokens.effective
      ) {
        patch.maxTokens = mt;
      }
      const mr = Number(pendingMaxRetries);
      if (
        Number.isFinite(mr) &&
        mr >= 0 &&
        mr !== dashboard?.config.maxRetries.effective
      ) {
        patch.maxRetries = mr;
      }
      if (Object.keys(patch).length === 0) {
        setSavingConfig(false);
        return;
      }
      const res = await updateAdminConfig(patch);
      if (!res.ok) {
        setError(res.error ?? 'Failed to save config');
        return;
      }
      await loadDashboard();
    } finally {
      setSavingConfig(false);
    }
  }, [
    savingConfig,
    pendingModel,
    pendingMaxTokens,
    pendingMaxRetries,
    dashboard,
    loadDashboard,
  ]);

  const handleToggleTool = useCallback((toolName: string) => {
    setPendingDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  }, []);

  const handleSaveTools = useCallback(async () => {
    if (savingTools) return;
    setSavingTools(true);
    try {
      const res = await updateDisabledTools(Array.from(pendingDisabled));
      if (!res.ok) {
        setError(res.error ?? 'Failed to save tool toggles');
        return;
      }
      await loadTools();
    } finally {
      setSavingTools(false);
    }
  }, [savingTools, pendingDisabled, loadTools]);

  // ============================================================================
  // Derived state
  // ============================================================================

  const toolsByCategory = useMemo(() => {
    if (!toolsPayload) return {};
    const grouped: Record<string, ToolCatalogEntry[]> = {};
    for (const t of toolsPayload.tools) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }
    return grouped;
  }, [toolsPayload]);

  const hasPendingToolChanges = useMemo(() => {
    if (!toolsPayload) return false;
    const currentSet = new Set(toolsPayload.disabledTools);
    if (currentSet.size !== pendingDisabled.size) return true;
    const pending = Array.from(pendingDisabled);
    for (let i = 0; i < pending.length; i++) {
      if (!currentSet.has(pending[i])) return true;
    }
    return false;
  }, [pendingDisabled, toolsPayload]);

  const hasPendingConfigChanges = useMemo(() => {
    if (!dashboard) return false;
    if (pendingModel !== dashboard.config.model.effective) return true;
    if (Number(pendingMaxTokens) !== dashboard.config.maxTokens.effective)
      return true;
    if (Number(pendingMaxRetries) !== dashboard.config.maxRetries.effective)
      return true;
    return false;
  }, [dashboard, pendingModel, pendingMaxTokens, pendingMaxRetries]);

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-surface text-on-surface font-body flex items-center justify-center">
        <div className="flex items-center gap-3 text-on-surface-variant">
          <span className="material-symbols-outlined text-primary animate-spin text-2xl">
            progress_activity
          </span>
          <span className="text-sm font-semibold">
            Loading admin dashboard…
          </span>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="min-h-screen bg-surface text-on-surface font-body flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <span className="material-symbols-outlined text-error text-4xl">
            error
          </span>
          <div className="font-headline font-bold text-lg">
            Failed to load admin dashboard
          </div>
          <p className="text-sm text-on-surface-variant">
            {error ??
              'The backend returned no data. Check that the admin portal is configured and you are signed in.'}
          </p>
          <button
            onClick={() => router.replace('/admin/login')}
            className="px-4 py-2 bg-primary text-white rounded-xl font-semibold text-sm"
          >
            Go to login
          </button>
        </div>
      </div>
    );
  }

  const { stats, config, dailyUsage } = dashboard;

  return (
    <div className="min-h-screen bg-surface text-on-surface font-body">
      {/* ========== Top bar ========== */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-surface/85 border-b border-outline-variant/30">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-card-sm">
              <span className="material-symbols-outlined filled text-white text-base">
                bolt
              </span>
            </div>
            <div>
              <div className="font-headline font-extrabold text-lg text-on-surface tracking-tight leading-none">
                Plansync
              </div>
              <div className="text-[9px] uppercase tracking-[0.2em] font-bold text-primary mt-0.5">
                Admin Console
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors"
            >
              ← Back to app
            </a>
            <button
              onClick={handleLogout}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all',
                'bg-surface-container-low/70 border border-outline-variant/40 text-on-surface-variant',
                'hover:border-error/40 hover:text-error hover:bg-error/5'
              )}
            >
              <span className="material-symbols-outlined text-sm">logout</span>
              Sign out
            </button>
          </div>
        </div>
        {/* ========== Tabs ========== */}
        <div className="max-w-screen-2xl mx-auto px-6 pb-0">
          <nav className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
            <TabButton
              id="observability"
              activeTab={activeTab}
              onClick={setActiveTab}
              icon="leaderboard"
              label="Observability"
            />
            <TabButton
              id="config"
              activeTab={activeTab}
              onClick={setActiveTab}
              icon="tune"
              label="Runtime Config"
              badge={hasPendingConfigChanges ? 'unsaved' : undefined}
            />
            <TabButton
              id="tools"
              activeTab={activeTab}
              onClick={setActiveTab}
              icon="construction"
              label={`Agent Tools (${toolsPayload?.tools.length ?? 22})`}
              badge={hasPendingToolChanges ? 'unsaved' : undefined}
            />
            <TabButton
              id="sessions"
              activeTab={activeTab}
              onClick={setActiveTab}
              icon="history"
              label="Recent Sessions"
            />
          </nav>
        </div>
      </header>

      {/* ========== Main ========== */}
      <main className="max-w-screen-2xl mx-auto px-6 py-6">
        {/* OBSERVABILITY TAB */}
        {activeTab === 'observability' && (
          <div className="space-y-6 animate-fade-in">
            <section>
              <SectionHeader
                icon="leaderboard"
                label="Today's activity"
                description="Pre-computed counters updated in real-time on every agent event. Reads in ~200ms."
              />
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-3">
                <StatCard
                  icon="rocket_launch"
                  label="Runs today"
                  value={String(stats.runsToday)}
                  sublabel={`${stats.totalSessions} all time`}
                  tone="primary"
                />
                <StatCard
                  icon="check_circle"
                  label="Success rate"
                  value={`${stats.successRatePercent}%`}
                  sublabel={`${stats.successfulToday} of ${stats.successfulToday + stats.erroredToday} terminal today`}
                  tone="success"
                />
                <StatCard
                  icon="sync"
                  label="Active now"
                  value={String(stats.inProgressNow)}
                  sublabel="in progress"
                  tone="info"
                />
                <StatCard
                  icon="error"
                  label="Errors today"
                  value={String(stats.erroredToday)}
                  sublabel={
                    stats.erroredToday === 0 ? 'all clear' : 'review below'
                  }
                  tone={stats.erroredToday > 0 ? 'error' : 'success'}
                />
                <StatCard
                  icon="payments"
                  label="Est. cost today"
                  value={formatUsdCost(stats.todayCostUsd)}
                  sublabel={`${formatTokens(stats.todayTotalTokens)} tokens (est.)`}
                  tone="tertiary"
                />
                <StatCard
                  icon="calculate"
                  label="Avg cost/run"
                  value={formatUsdCost(stats.avgCostPerRunUsd)}
                  sublabel={`across ${stats.runsToday || 0} runs today`}
                  tone="tertiary"
                />
              </div>
            </section>

            {Object.keys(dailyUsage.byModel).length > 0 && (
              <section>
                <SectionHeader
                  icon="analytics"
                  label="Today's usage by model"
                  description="Token breakdown and estimated cost per Anthropic model in use today. Cost numbers are estimates — cross-check against your Anthropic console for exact billing."
                />
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {Object.entries(dailyUsage.byModel).map(([model, totals]) => (
                    <div
                      key={model}
                      className="bg-surface-container-lowest rounded-2xl shadow-card-sm border border-outline-variant/30 p-4"
                    >
                      <div className="flex items-baseline justify-between mb-2">
                        <code className="text-xs font-mono font-bold text-on-surface">
                          {model}
                        </code>
                        <div className="text-lg font-headline font-extrabold text-primary">
                          {formatUsdCost(totals.costUsd)}
                        </div>
                      </div>
                      <div className="text-[10px] text-on-surface-variant space-y-0.5">
                        <div className="flex justify-between">
                          <span>Input</span>
                          <span className="font-mono tabular-nums">
                            {formatTokens(totals.input)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Output</span>
                          <span className="font-mono tabular-nums">
                            {formatTokens(totals.output)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cache read</span>
                          <span className="font-mono tabular-nums">
                            {formatTokens(totals.cacheRead)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cache write</span>
                          <span className="font-mono tabular-nums">
                            {formatTokens(totals.cacheWrite)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* RUNTIME CONFIG TAB */}
        {activeTab === 'config' && (
          <div className="space-y-6 animate-fade-in">
            <SectionHeader
              icon="tune"
              label="Runtime config"
              description="Changes take effect on the next agent turn. No Railway redeploy needed."
            />
            <div className="bg-surface-container-lowest rounded-3xl shadow-card border border-outline-variant/30 overflow-hidden">
              <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">
                    Anthropic model
                  </label>
                  <select
                    value={pendingModel}
                    onChange={(e) => setPendingModel(e.target.value)}
                    className="w-full bg-white border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                  >
                    {MODEL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                    {!MODEL_OPTIONS.find((o) => o.value === pendingModel) && (
                      <option value={pendingModel}>
                        {pendingModel} (current override)
                      </option>
                    )}
                  </select>
                  <div className="mt-1.5 text-[11px] text-on-surface-variant flex items-center gap-1.5">
                    {config.model.hasOverride ? (
                      <>
                        <span className="material-symbols-outlined text-warning text-xs">
                          bolt
                        </span>
                        <span>
                          Redis override active · env default:{' '}
                          <code className="font-mono">
                            {config.model.envDefault ?? 'not set'}
                          </code>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-on-surface-variant text-xs">
                          settings
                        </span>
                        <span>
                          Using env default:{' '}
                          <code className="font-mono">
                            {config.model.envDefault ?? 'not set'}
                          </code>
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">
                    Max output tokens
                  </label>
                  <input
                    type="number"
                    value={pendingMaxTokens}
                    onChange={(e) => setPendingMaxTokens(e.target.value)}
                    min={512}
                    max={64000}
                    step={512}
                    className="w-full bg-white border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                  />
                  <div className="mt-1.5 text-[11px] text-on-surface-variant">
                    Default: {config.maxTokens.envDefault.toLocaleString()}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5">
                    429 retry cap
                  </label>
                  <input
                    type="number"
                    value={pendingMaxRetries}
                    onChange={(e) => setPendingMaxRetries(e.target.value)}
                    min={0}
                    max={10}
                    step={1}
                    className="w-full bg-white border border-outline-variant/30 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                  />
                  <div className="mt-1.5 text-[11px] text-on-surface-variant">
                    Default: {config.maxRetries.envDefault}
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 border-t border-outline-variant/20 bg-surface-container-low/30 flex items-center justify-end gap-2">
                <button
                  disabled={!hasPendingConfigChanges || savingConfig}
                  onClick={handleSaveConfig}
                  className={cn(
                    'px-4 py-2 rounded-xl text-sm font-headline font-bold transition-all',
                    'bg-gradient-to-r from-primary to-primary-container text-white shadow-card-sm',
                    'hover:scale-[1.01] active:scale-[0.99]',
                    'disabled:from-outline disabled:to-outline disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none'
                  )}
                >
                  {savingConfig
                    ? 'Saving…'
                    : hasPendingConfigChanges
                      ? 'Save changes'
                      : 'No changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TOOLS TAB */}
        {activeTab === 'tools' && toolsPayload && (
          <div className="space-y-4 animate-fade-in">
            <SectionHeader
              icon="construction"
              label={`Agent tools (${toolsPayload.tools.length})`}
              description="Every tool the agent has access to, grouped by function. Toggle to disable — except request_user_approval which is protected (it's the only blocking tool). Changes apply to the next turn of any running session."
            />
            {toolsPayload.categories.map((cat) => {
              const tools = toolsByCategory[cat.id] ?? [];
              if (tools.length === 0) return null;
              return (
                <div
                  key={cat.id}
                  className="bg-surface-container-lowest rounded-3xl shadow-card border border-outline-variant/30 overflow-hidden"
                >
                  <div className="bg-gradient-to-br from-primary/5 to-secondary/5 px-5 py-3 border-b border-outline-variant/20 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-primary text-base">
                        {cat.icon}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-widest font-bold text-primary">
                        {cat.label} ({tools.length})
                      </div>
                      <div className="text-xs text-on-surface-variant">
                        {cat.description}
                      </div>
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tools.map((tool) => {
                      const isDisabled = pendingDisabled.has(tool.name);
                      const canToggle = tool.canDisable;
                      return (
                        <button
                          key={tool.name}
                          disabled={!canToggle}
                          onClick={() => canToggle && handleToggleTool(tool.name)}
                          className={cn(
                            'text-left rounded-2xl p-3 transition-all border',
                            canToggle
                              ? 'cursor-pointer hover:shadow-card-sm'
                              : 'cursor-not-allowed',
                            isDisabled
                              ? 'bg-error/5 border-error/30 hover:border-error/50'
                              : canToggle
                                ? 'bg-surface-container-low border-outline-variant/30 hover:border-primary/40'
                                : 'bg-primary/5 border-primary/30'
                          )}
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={cn(
                                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                                isDisabled
                                  ? 'bg-error/10 text-error'
                                  : canToggle
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-primary/20 text-primary'
                              )}
                            >
                              <span className="material-symbols-outlined text-base">
                                {tool.icon}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <code className="text-xs font-mono font-bold text-on-surface truncate">
                                  {tool.name}
                                </code>
                                {!canToggle && (
                                  <span
                                    className="material-symbols-outlined text-[13px] text-primary flex-shrink-0"
                                    title="Required — cannot disable"
                                  >
                                    lock
                                  </span>
                                )}
                                {tool.isServerTool && (
                                  <span
                                    className="material-symbols-outlined text-[13px] text-info flex-shrink-0"
                                    title="Anthropic server tool"
                                  >
                                    cloud
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-on-surface-variant mt-0.5 leading-snug line-clamp-3">
                                {tool.description}
                              </div>
                              <div className="mt-2 flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider',
                                    isDisabled
                                      ? 'bg-error/10 text-error'
                                      : 'bg-success/10 text-success'
                                  )}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                                  {isDisabled ? 'Disabled' : 'Enabled'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {hasPendingToolChanges && (
              <div className="sticky bottom-4 flex items-center justify-end gap-2 px-1">
                <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-full shadow-card-lg px-4 py-2 flex items-center gap-3">
                  <span className="text-xs text-on-surface-variant">
                    You have unsaved toggle changes
                  </span>
                  <button
                    disabled={savingTools}
                    onClick={handleSaveTools}
                    className={cn(
                      'px-4 py-1.5 rounded-full text-xs font-headline font-bold transition-all',
                      'bg-gradient-to-r from-primary to-primary-container text-white shadow-card-sm',
                      'hover:scale-[1.01] active:scale-[0.99]',
                      'disabled:from-outline disabled:to-outline disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none'
                    )}
                  >
                    {savingTools ? 'Saving…' : 'Save tool toggles'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SESSIONS TAB */}
        {activeTab === 'sessions' && (
          <div className="space-y-4 animate-fade-in">
            <SectionHeader
              icon="history"
              label="Recent sessions"
              description="Lazy-loaded from a pre-built sorted set. Reads the top 50 most recent sessions then applies filters client-side. Click a sessionId to copy it to your clipboard."
            />
            <div className="bg-surface-container-lowest rounded-3xl shadow-card border border-outline-variant/30 overflow-hidden">
              <div className="px-5 py-3 border-b border-outline-variant/20 bg-surface-container-low/30 flex flex-wrap items-center gap-2">
                <SegmentedControl
                  value={dateRange}
                  onChange={(v) => setDateRange(v as DateRangeFilter)}
                  options={[
                    { value: 'today', label: 'Today' },
                    { value: '24h', label: '24h' },
                    { value: '7d', label: '7d' },
                    { value: 'all', label: 'All time' },
                  ]}
                />
                <SegmentedControl
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as StatusFilter)}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'successful', label: 'Success' },
                    { value: 'errored', label: 'Errors' },
                    { value: 'in_progress', label: 'Active' },
                    { value: 'abandoned', label: 'Abandoned' },
                  ]}
                />
                <div className="flex-1 min-w-[180px] max-w-xs">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search sessionId…"
                    className="w-full bg-white border border-outline-variant/30 rounded-full px-4 py-1.5 text-xs focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                  />
                </div>
                {sessionsLoading && (
                  <span className="material-symbols-outlined text-primary animate-spin text-sm">
                    progress_activity
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-left bg-surface-container-low/30">
                    <tr className="border-b border-outline-variant/20">
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant">
                        Session
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant">
                        Created
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant">
                        Status
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant text-right">
                        Turns
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant text-right">
                        Events
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant text-right">
                        Tokens
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant text-right">
                        Est. cost
                      </th>
                      <th className="px-4 py-2.5 font-bold uppercase tracking-wider text-[10px] text-on-surface-variant">
                        Last event
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsLoading && sessions === null && (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-on-surface-variant italic"
                        >
                          Loading recent sessions…
                        </td>
                      </tr>
                    )}
                    {!sessionsLoading &&
                      sessions !== null &&
                      sessions.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-4 py-8 text-center text-on-surface-variant italic"
                          >
                            No sessions match the current filters.
                          </td>
                        </tr>
                      )}
                    {(sessions ?? []).map((s) => {
                      const totalTokens =
                        (s.usage?.input ?? 0) +
                        (s.usage?.output ?? 0) +
                        (s.usage?.cacheRead ?? 0) +
                        (s.usage?.cacheWrite ?? 0);
                      return (
                        <tr
                          key={s.sessionId}
                          className="border-b border-outline-variant/10 hover:bg-surface-container-low/20 transition-colors"
                        >
                          <td className="px-4 py-2">
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(s.sessionId)
                              }
                              className="text-left group"
                              title="Click to copy full sessionId"
                            >
                              <code className="text-[11px] font-mono text-on-surface group-hover:text-primary">
                                {s.sessionId.slice(0, 20)}…{s.sessionId.slice(-4)}
                              </code>
                            </button>
                            {s.projectName && (
                              <div className="text-[10px] text-on-surface-variant italic mt-0.5 truncate max-w-[16rem]">
                                {s.projectName}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-on-surface-variant text-[11px]">
                            {formatRelativeTime(s.createdAt)}
                          </td>
                          <td className="px-4 py-2">
                            <StatusBadge status={s.derivedStatus} />
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            {s.turnCount}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums text-on-surface-variant">
                            {s.eventCount}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            {formatTokens(totalTokens)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            {s.usage ? formatUsdCost(s.usage.costUsd) : '—'}
                          </td>
                          <td className="px-4 py-2 text-[10px] font-mono text-on-surface-variant">
                            {s.lastEventType ?? '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Error banner at bottom */}
        {error && (
          <div className="mt-6 p-3 bg-error-container/30 rounded-xl text-xs text-error border border-error/20">
            <strong>Error:</strong> {error}
            <button
              onClick={() => setError(null)}
              className="float-right text-error font-bold"
            >
              dismiss
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function TabButton({
  id,
  activeTab,
  onClick,
  icon,
  label,
  badge,
}: {
  id: TabId;
  activeTab: TabId;
  onClick: (id: TabId) => void;
  icon: string;
  label: string;
  badge?: string;
}) {
  const isActive = activeTab === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold border-b-2 transition-all whitespace-nowrap',
        isActive
          ? 'border-primary text-primary'
          : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant/40'
      )}
    >
      <span
        className={cn(
          'material-symbols-outlined text-base',
          isActive ? 'text-primary' : 'text-on-surface-variant'
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
      {badge && (
        <span className="ml-1 text-[9px] font-bold uppercase tracking-wider text-warning bg-warning/10 border border-warning/30 rounded-full px-2 py-0.5">
          {badge}
        </span>
      )}
    </button>
  );
}

function SectionHeader({
  icon,
  label,
  description,
}: {
  icon: string;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="material-symbols-outlined text-primary">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-headline font-extrabold text-base text-on-surface">
          {label}
        </div>
        <div className="text-[11px] text-on-surface-variant">{description}</div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  sublabel: string;
  tone: 'primary' | 'success' | 'info' | 'error' | 'tertiary';
}) {
  const toneClasses = {
    primary: 'text-primary bg-primary/10',
    success: 'text-success bg-success/10',
    info: 'text-info bg-info/10',
    error: 'text-error bg-error/10',
    tertiary: 'text-tertiary bg-tertiary/10',
  };
  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-card-sm border border-outline-variant/30 p-3">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant">
          {label}
        </div>
        <div
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
            toneClasses[tone]
          )}
        >
          <span className="material-symbols-outlined text-base">{icon}</span>
        </div>
      </div>
      <div className="text-2xl font-headline font-extrabold text-on-surface tabular-nums">
        {value}
      </div>
      <div className="text-[10px] text-on-surface-variant mt-0.5">
        {sublabel}
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex bg-surface-container-low rounded-full p-0.5 border border-outline-variant/30">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1 rounded-full text-[11px] font-semibold transition-all',
            value === opt.value
              ? 'bg-primary text-white shadow-card-sm'
              : 'text-on-surface-variant hover:text-on-surface'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: 'successful' | 'errored' | 'in_progress' | 'abandoned';
}) {
  const config = {
    successful: {
      label: 'Success',
      tone: 'bg-success/10 text-success border-success/30',
      icon: 'check',
    },
    errored: {
      label: 'Error',
      tone: 'bg-error/10 text-error border-error/30',
      icon: 'close',
    },
    in_progress: {
      label: 'Active',
      tone: 'bg-primary/10 text-primary border-primary/30',
      icon: 'progress_activity',
    },
    abandoned: {
      label: 'Abandoned',
      tone: 'bg-outline/10 text-outline border-outline/30',
      icon: 'logout',
    },
  } as const;
  const c = config[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
        c.tone
      )}
    >
      <span className="material-symbols-outlined text-[11px]">{c.icon}</span>
      {c.label}
    </span>
  );
}
