import express, { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import type { AgentEvent, AnthropicContentBlock } from './types';
import { loadSession, saveSession } from './memory/session';
import { putArtifact } from './memory/artifacts';
import { acquireLock } from './memory/lock';
import { startSseStream, makeEmitter, endSseStream } from './lib/sse';
import { runAgentLoop } from './agent/loop';
import { encrypt } from './lib/crypto';
import type { CsvArtifactContent } from './tools/parse-csv';

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
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
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
    version: '0.1.1',
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
  const emit = makeEmitter(res);

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

      session.history.push({
        role: 'user',
        content: [toolResultBlock],
      });

      // Clear pending
      session.pending = null;
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

// ---------- boot ----------

app.listen(PORT, () => {
  console.log(`Plansync agent listening on port ${PORT}`);
  console.log(`  Anthropic: ${process.env.ANTHROPIC_API_KEY ? 'ok' : 'MISSING'}`);
  console.log(`  Redis:     ${process.env.UPSTASH_REDIS_REST_URL ? 'ok' : 'MISSING'}`);
  console.log(`  Crypto:    ${process.env.ENCRYPTION_KEY ? 'ok' : 'MISSING'}`);
});
