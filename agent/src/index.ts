import express, { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import type { AgentEvent, AnthropicContentBlock } from './types';
import { loadSession, saveSession } from './memory/session';
import { putArtifact } from './memory/artifacts';
import { acquireLock } from './memory/lock';
import {
  appendSessionEvent,
  loadSessionEvents,
  clearSessionEvents,
} from './memory/events';
import {
  recordSessionCompleted,
  recordSessionErrored,
} from './admin/counters';
import { startSseStream, makeEmitter, endSseStream } from './lib/sse';
import { runAgentLoop } from './agent/loop';
import { encrypt } from './lib/crypto';
import type { CsvArtifactContent } from './tools/parse-csv';
import {
  mintAdminToken,
  verifyAdminCredentials,
  isAdminPortalConfigured,
} from './admin/auth';
import {
  requireAdminAuth,
  buildAdminCookieHeader,
  buildClearAdminCookieHeader,
} from './admin/middleware';
import {
  getAdminConfigSnapshot,
  setModel,
  setMaxTokens,
  setMaxRetries,
  setDisabledTools,
} from './admin/config';
import { computeDashboardStats, listRecentSessions } from './admin/stats';
import type { StatusFilter, DateRangeFilter } from './admin/stats';
import { getDailyUsage } from './admin/usage';
import { TOOL_CATALOG, TOOL_CATEGORIES } from './admin/tools-catalog';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

// ---------- middleware ----------

app.use(express.json({ limit: '10mb' }));

// CORS middleware — handles both the Vercel frontend and Rocketlane embed origins
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin ?? '';
  const allowedList = (process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim());

  const isAllowed = allowedList.some((a) => {
    if (a === origin) return true;
    if (a.startsWith('https://*.')) {
      const suffix = a.slice('https://*.'.length);
      return origin.endsWith(suffix);
    }
    return false;
  });

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    // Required for the admin portal's HttpOnly cookie to survive
    // cross-origin fetches. Without this, the browser silently drops
    // the Set-Cookie response header on /admin/login AND refuses to
    // attach the existing cookie on subsequent credentialed requests.
    // Must be a literal "true" (not "True"). Must be set together
    // with a specific Access-Control-Allow-Origin (not "*") for
    // credentials to work — which is what we're doing above.
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // DELETE is for the /session/:id/events endpoint from Commit 2g
  // (used by the "New session" button flow). OPTIONS preflight is
  // always needed for non-simple requests.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ---------- GET / ----------

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send(
    'Plansync agent backend. POST /agent for streaming, POST /upload for file parsing, GET /health for status.'
  );
});

// ---------- GET /health ----------

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '0.1.13',
    env: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      redis: Boolean(process.env.UPSTASH_REDIS_REST_URL),
      encryption: Boolean(process.env.ENCRYPTION_KEY),
    },
    uptime: process.uptime(),
  });
});

// ---------- POST /upload ----------
//
// Accepts raw binary body. Parses with SheetJS, stores as artifact, returns id.
// Query params:
//   sessionId (required) — the session to attach the artifact to
//   filename  (optional) — for display purposes
//
// Frontend sends:
//   fetch(`${AGENT_URL}/upload?sessionId=${sid}&filename=${fname}`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/octet-stream' },
//     body: file,
//   })

app.post(
  '/upload',
  express.raw({ type: '*/*', limit: '10mb' }),
  async (req: Request, res: Response) => {
    try {
      const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
      const filename =
        typeof req.query.filename === 'string' ? req.query.filename : 'upload.csv';

      if (!sessionId) {
        res.status(400).json({ error: 'sessionId query param required' });
        return;
      }

      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'request body must be non-empty binary data' });
        return;
      }

      // Parse with SheetJS
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(req.body, { type: 'buffer', cellDates: true });
      } catch (err) {
        res.status(400).json({
          error: 'failed to parse file',
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      if (workbook.SheetNames.length === 0) {
        res.status(400).json({ error: 'file has no sheets' });
        return;
      }

      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      // Extract rows as JSON
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
        raw: false, // coerce to strings for consistent types
      });

      if (rows.length === 0) {
        res.status(400).json({ error: 'sheet has no rows' });
        return;
      }

      // Extract column headers from the first row's keys (sheet_to_json uses first-row keys)
      const headerRange = sheet['!ref'];
      let columns: string[] = [];
      if (headerRange) {
        const range = XLSX.utils.decode_range(headerRange);
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
          const cell = sheet[cellAddr];
          columns.push(cell ? String(cell.v ?? `col_${c}`) : `col_${c}`);
        }
      }
      if (columns.length === 0) {
        columns = Object.keys(rows[0] ?? {});
      }

      // Store as artifact
      const content: CsvArtifactContent = {
        columns,
        rows,
        rowCount: rows.length,
        sheetNames: workbook.SheetNames,
        sourceFileName: filename,
      };

      const artifact = await putArtifact({
        sessionId,
        kind: 'csv-rows',
        preview: `${filename}: ${rows.length} rows, ${columns.length} columns (${columns.join(', ')})`,
        content,
      });

      res.json({
        artifactId: artifact.id,
        filename,
        rowCount: rows.length,
        columns,
        sheetNames: workbook.SheetNames,
        preview: artifact.preview,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: 'upload failed', detail: message });
    }
  }
);

// ---------- POST /agent ----------
//
// The real ReAct loop endpoint.
//
// Body:
//   {
//     sessionId: string,
//     userMessage?: string,   // user typed text
//     uiAction?: {            // user clicked an approval chip
//       toolUseId: string,
//       data: unknown,        // the option.value from request_user_approval
//       label?: string,       // human label for logging
//     },
//   }
//
// Response: Server-Sent Events stream of AgentEvent union.

app.post('/agent', async (req: Request, res: Response) => {
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  if (!sessionId) {
    res.status(400).json({ error: 'sessionId required' });
    return;
  }

  const userMessage = typeof req.body?.userMessage === 'string' ? req.body.userMessage : undefined;
  const uiAction = req.body?.uiAction as
    | { toolUseId: string; data: unknown; label?: string }
    | undefined;

  // Acquire per-session lock to prevent concurrent writes
  const lock = await acquireLock(sessionId);
  if (!lock) {
    res.status(409).json({ error: 'another request is in progress for this session' });
    return;
  }

  startSseStream(res);
  const baseEmit = makeEmitter(res);

  // Wrap the emitter so every event is ALSO persisted to Redis under
  // `session:{id}:events` AND classified into admin counters.
  //
  // Events log (`session:{id}:events`):
  // This is what powers refresh-hydration on the frontend. When the
  // user refreshes mid-session, the client calls GET /session/:id/events
  // and replays the list through its own handleAgentEvent —
  // reconstructing reasoning bubbles, tool calls, display cards,
  // journey state, and any pending approval without duplicated
  // state-derivation logic.
  //
  // Persistence runs BEFORE forwarding to SSE because we want every
  // event captured even if the client disconnected mid-stream
  // (makeEmitter silently drops writes to a closed response, but
  // persistence must still happen — otherwise a refresh would lose
  // events emitted after the disconnect).
  //
  // Admin counter updates:
  // When we see a successful completion (display_component with
  // component === 'CompletionCard') or an error event, we increment
  // the admin daily counters. This replaces the old pattern of
  // SCANning and walking event logs on every dashboard load — counters
  // are O(1) reads via SCARD.
  //
  // Fire-and-forget: a Redis write failure (either persistence or
  // counters) should never crash the agent loop. All failures are
  // logged and swallowed.
  const emit: (event: AgentEvent) => void = (event) => {
    void appendSessionEvent(sessionId, event).catch((err) => {
      console.error(
        `[events] failed to persist event for ${sessionId}:`,
        err instanceof Error ? err.message : err
      );
    });

    // Classify for admin counters. Set semantics in the counters
    // dedupe automatically — we're safe to fire on every matching
    // event even if the agent re-calls display_completion_summary.
    if (
      event.type === 'display_component' &&
      (event as { component?: string }).component === 'CompletionCard'
    ) {
      void recordSessionCompleted(sessionId).catch(() => {});
    } else if (event.type === 'error') {
      void recordSessionErrored(sessionId).catch(() => {});
    }

    baseEmit(event);
  };

  try {
    const session = await loadSession(sessionId);

    // Inject user input into history
    if (userMessage) {
      session.history.push({
        role: 'user',
        content: userMessage,
      });
    }

    if (uiAction) {
      // Inject as a tool_result for the pending approval
      const resultContent =
        typeof uiAction.data === 'string'
          ? uiAction.data
          : JSON.stringify(uiAction.data);

      const toolResultBlock: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: uiAction.toolUseId,
        content: `User selected: ${uiAction.label ?? resultContent}${
          uiAction.label && resultContent !== uiAction.label ? ` (value: ${resultContent})` : ''
        }`,
      };

      // Prepend any stashed tool_results from non-blocking tools that
      // ran BEFORE the request_user_approval in the same assistant turn.
      // See the big comment in agent/loop.ts where `pendingToolResults`
      // is populated. This is what prevents the Anthropic 400 error
      // "tool_use ids were found without tool_result blocks immediately
      // after".
      const stashed = session.pendingToolResults ?? [];
      session.history.push({
        role: 'user',
        content: [...stashed, toolResultBlock],
      });

      // Clear pending state after consuming
      session.pending = null;
      session.pendingToolResults = null;
    }

    // Run the ReAct loop
    const result = await runAgentLoop(session, emit);

    // Persist session regardless of outcome
    await saveSession(sessionId, session);

    // If the loop ended normally (not already emitted), emit done
    if (result.outcome === 'done' || result.outcome === 'max_turns' || result.outcome === 'error') {
      // These already emit their own done/error events in the loop
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      emit({ type: 'error', message });
    } catch {
      /* stream may already be closed */
    }
  } finally {
    await lock.release();
    endSseStream(res);
  }
});

// ---------- POST /session/:id/apikey ----------
//
// Encrypts the user's Rocketlane API key with AES-256-GCM and stores it on
// the session meta. Called by the frontend after the user submits their key
// via the ApiKeyCard. Also used by test scripts to pre-populate the session
// key without going through the UI.
//
// Body: { apiKey: string }

app.post('/session/:id/apikey', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : '';
    if (!sessionId || !apiKey) {
      res.status(400).json({ error: 'sessionId (path) and apiKey (body) required' });
      return;
    }
    const session = await loadSession(sessionId);
    session.meta.rlApiKeyEnc = encrypt(apiKey);
    await saveSession(sessionId, session);
    res.json({ ok: true, sessionId, keyLength: apiKey.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- GET /session/:id/journey ----------
//
// Journey stepper hydration for reconnect. The frontend calls this on
// initial page load (and on reconnect) so the sticky JourneyStepper shows
// the current state immediately without waiting for the next SSE event.

app.get('/session/:id/journey', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    const session = await loadSession(sessionId);
    res.json({ steps: session.journey });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- GET /session/:id/events ----------
//
// Full SSE event replay for browser-refresh hydration. Returns every
// AgentEvent that was emitted on this session (reasoning text deltas,
// tool calls, display components, journey updates, memory writes,
// rate-limit notices, awaiting_user, done, error — everything).
//
// The frontend calls this once on page load with the sessionId it
// read from localStorage. If the list is empty, treat it as a fresh
// session. Otherwise, replay each event through handleAgentEvent to
// reconstruct the UI state (reasoning bubbles, tool call lines, plan
// review tree, execution plan, pending approvals, etc.) — exactly as
// it was before the refresh.
//
// The last event tells you the current state:
//   - 'done' → turn complete, user idle
//   - 'awaiting_user' → waiting on an approval click
//   - 'error' → something failed, show the error
//   - anything else (text_delta, tool_use_*, etc.) → the refresh hit
//     mid-stream; the backend may still be running, show a "check for
//     updates" hint and let the user re-fetch to see the rest

app.get('/session/:id/events', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    const events = await loadSessionEvents(sessionId);
    res.json({ events, count: events.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- DELETE /session/:id ----------
//
// Clear a session's events log. Called by the frontend's "New session"
// button flow so that explicitly starting over doesn't leave orphan
// event logs behind. The actual session data (meta, history, journey,
// etc.) is left alone because it's keyed on sessionId and a new
// sessionId will just start fresh anyway — but the events log is
// tied to the sessionId and would be seen on any future replay call,
// so we clear it explicitly.
//
// Note: this is NOT destructive to the main session store. It only
// touches `session:{id}:events`. The other session keys naturally
// expire via the 7-day TTL.

app.delete('/session/:id/events', async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.id;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    await clearSessionEvents(sessionId);
    res.json({ ok: true, sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ============================================================================
// ADMIN PORTAL ROUTES
// ============================================================================
//
// The admin portal is an operator dashboard (Inbaraj) for observing running
// sessions, adjusting runtime config (model, max_tokens, retries, disabled
// tools), and viewing token usage + cost estimates. It is NOT for end users.
//
// Auth: HMAC-signed token in an HttpOnly cookie. Credentials are set on
// Railway via ADMIN_USERNAME + ADMIN_PASSWORD env vars. If either is
// missing, every /admin/* endpoint returns 503 (fail-closed).
//
// Routes:
//   POST   /admin/login       — username/password, issues cookie on success
//   POST   /admin/logout      — clears the cookie
//   GET    /admin/me          — returns {authenticated: boolean} for the UI
//   GET    /admin/dashboard   — stats + recent sessions (supports filters)
//   GET    /admin/tools       — tool catalog for the UI grid
//   GET    /admin/config      — current effective config snapshot
//   POST   /admin/config      — update one or more config values
//   POST   /admin/config/disabled-tools — replace disabled tools list

// ---------- POST /admin/login ----------
app.post('/admin/login', async (req: Request, res: Response) => {
  try {
    if (!isAdminPortalConfigured()) {
      res.status(503).json({
        error:
          'Admin portal is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars on the backend.',
        code: 'portal_not_configured',
      });
      return;
    }
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || !password) {
      res.status(400).json({ error: 'username and password required' });
      return;
    }
    if (!verifyAdminCredentials(username, password)) {
      // Intentionally generic error — don't leak which field was wrong
      res.status(401).json({ error: 'Invalid credentials', code: 'invalid_credentials' });
      return;
    }
    const { token, expiresAt } = mintAdminToken();
    const lifetimeSeconds = Math.max(1, Math.round((expiresAt - Date.now()) / 1000));
    res.setHeader('Set-Cookie', buildAdminCookieHeader(token, lifetimeSeconds));
    res.json({ ok: true, expiresAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- POST /admin/logout ----------
app.post('/admin/logout', (_req: Request, res: Response) => {
  res.setHeader('Set-Cookie', buildClearAdminCookieHeader());
  res.json({ ok: true });
});

// ---------- GET /admin/me ----------
// Used by the frontend /admin route to check if the current cookie is
// valid BEFORE rendering the dashboard. If 401 → redirect to /admin/login.
app.get('/admin/me', requireAdminAuth, (_req: Request, res: Response) => {
  res.json({ authenticated: true });
});

// ---------- GET /admin/dashboard ----------
//
// Returns the FAST part of the dashboard: stats, config, daily usage.
// The expensive recent-sessions list is NOT included here — it's
// lazy-loaded via GET /admin/sessions when the user clicks the
// Sessions tab. This split is what makes the dashboard load in
// ~200ms instead of ~30 seconds.
//
// No query params — this endpoint always returns "now" data.
app.get('/admin/dashboard', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const [stats, config, dailyUsage] = await Promise.all([
      computeDashboardStats(),
      getAdminConfigSnapshot(),
      getDailyUsage(),
    ]);

    // Compute the two "today's cost" stat cards from dailyUsage
    const todayCostUsd = dailyUsage.totalCostUsd;
    const avgCostPerRun =
      stats.runsToday > 0 ? todayCostUsd / stats.runsToday : 0;

    res.json({
      stats: {
        ...stats,
        todayCostUsd,
        avgCostPerRunUsd: avgCostPerRun,
        todayTotalTokens: dailyUsage.totalTokens,
        todayTurns: dailyUsage.totalTurns,
      },
      config,
      dailyUsage,
      generatedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- GET /admin/sessions ----------
//
// Lazy-loaded recent sessions table. Fetched ONLY when the user
// clicks the Sessions tab in the admin dashboard (or when the
// filter inputs change). This is the formerly-expensive query that
// walked every session's event log — now it uses the pre-built
// `admin:sessions:by_created` sorted set to pick the top N recent
// sessionIds, and per-session outcome is derived from the
// `admin:sessions:successful/errored` counter sets (O(1) SISMEMBER).
//
// Query params:
//   dateRange: today | 24h | 7d | all   (default: all)
//   status:    all | successful | errored | in_progress | abandoned  (default: all)
//   search:    partial sessionId match   (default: empty)
//   limit:     max rows (default 25, max 100)
app.get('/admin/sessions', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const dateRange = (typeof req.query.dateRange === 'string'
      ? req.query.dateRange
      : 'all') as DateRangeFilter;
    const status = (typeof req.query.status === 'string'
      ? req.query.status
      : 'all') as StatusFilter;
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query.limit ?? 25))
    );

    const recentSessions = await listRecentSessions({
      dateRange,
      status,
      search,
      limit,
    });

    res.json({ sessions: recentSessions, generatedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- GET /admin/tools ----------
// Returns the full tool catalog for the UI grid. Static metadata (names,
// descriptions, categories) plus the current disabled list so the UI knows
// which toggles are on/off.
app.get('/admin/tools', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const config = await getAdminConfigSnapshot();
    res.json({
      categories: TOOL_CATEGORIES,
      tools: TOOL_CATALOG,
      disabledTools: config.disabledTools,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- GET /admin/config ----------
app.get('/admin/config', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const snapshot = await getAdminConfigSnapshot();
    res.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---------- POST /admin/config ----------
// Accepts partial updates: { model?, maxTokens?, maxRetries? }
// Pass `null` to clear an override (falls back to env var).
app.post('/admin/config', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      model?: string | null;
      maxTokens?: number | null;
      maxRetries?: number | null;
    };

    const promises: Promise<void>[] = [];
    if ('model' in body) promises.push(setModel(body.model ?? null));
    if ('maxTokens' in body)
      promises.push(setMaxTokens(body.maxTokens ?? null));
    if ('maxRetries' in body)
      promises.push(setMaxRetries(body.maxRetries ?? null));

    await Promise.all(promises);
    const snapshot = await getAdminConfigSnapshot();
    res.json({ ok: true, config: snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

// ---------- POST /admin/config/disabled-tools ----------
// Replaces the disabled tools list. Body: { tools: string[] }
// The setter filters out `request_user_approval` automatically.
app.post(
  '/admin/config/disabled-tools',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    try {
      const tools = Array.isArray(req.body?.tools) ? req.body.tools : [];
      const applied = await setDisabledTools(tools);
      res.json({ ok: true, disabledTools: applied });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  }
);

// ---------- boot ----------

app.listen(PORT, () => {
  console.log(`Plansync agent listening on port ${PORT}`);
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'ok' : 'MISSING'}`);
  console.log(`  Redis:     ${process.env.UPSTASH_REDIS_REST_URL ? 'ok' : 'MISSING'}`);
  console.log(`  Crypto:    ${process.env.ENCRYPTION_KEY ? 'ok' : 'MISSING'}`);
  console.log(
    `  Admin:     ${isAdminPortalConfigured() ? 'configured' : 'NOT CONFIGURED (set ADMIN_USERNAME + ADMIN_PASSWORD)'}`
  );
});
