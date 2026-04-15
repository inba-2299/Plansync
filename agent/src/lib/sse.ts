import type { Response } from 'express';
import type { AgentEvent } from '../types';

/**
 * Server-Sent Events (SSE) helpers for the /agent streaming endpoint.
 *
 * Why not a library: SSE is trivially simple over a plain Express Response.
 * We set headers once, write `data: {...}\n\n` per event, and close on done.
 *
 * Important: X-Accel-Buffering: no disables nginx/cloudflare/railway-edge
 * buffering so events flow through immediately. Without it, events batch
 * up and arrive in chunks instead of streaming.
 *
 * Heartbeat: startSseStream also schedules a comment-line keepalive
 * every 15 seconds. SSE spec §9.2.6 treats lines starting with `:` as
 * comments — the EventSource client ignores them but intermediate
 * proxies (Railway edge, Cloudflare, nginx) see TCP activity and
 * don't drop the idle connection. Without this, Haiku / Sonnet calls
 * that take >60s to start streaming (common with large histories)
 * get silently disconnected mid-turn — the frontend hangs on "agent
 * thinking…" forever because the EventSource sees no data but no
 * error either (half-closed from its perspective).
 */

const KEEPALIVE_INTERVAL_MS = 15_000;

// Store the interval handle on the response so endSseStream can clean it
// up. Using a symbol-style hidden field instead of a WeakMap because we
// have tight coupling to Express.Response anyway.
type ResponseWithKeepalive = Response & {
  __plansyncKeepalive?: NodeJS.Timeout;
};

export function startSseStream(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Schedule a keepalive ping every 15 seconds. Comment lines (`:`) are
  // valid SSE per §9.2.6, ignored by the client, but count as TCP
  // activity for intermediate proxies.
  const keepaliveInterval: NodeJS.Timeout = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(keepaliveInterval);
      return;
    }
    try {
      res.write(`: keepalive ${new Date().toISOString()}\n\n`);
    } catch {
      // Writing failed (connection closed mid-flight). Clean up.
      clearInterval(keepaliveInterval);
    }
  }, KEEPALIVE_INTERVAL_MS);

  // Unref so the interval doesn't keep the Node process alive during
  // shutdown — only matters if we ever add graceful shutdown, but cheap.
  if (typeof keepaliveInterval.unref === 'function') {
    keepaliveInterval.unref();
  }

  (res as ResponseWithKeepalive).__plansyncKeepalive = keepaliveInterval;

  // Also clear on client disconnect (fires when the browser tab closes
  // or navigates away mid-stream).
  res.on('close', () => {
    const r = res as ResponseWithKeepalive;
    if (r.__plansyncKeepalive) {
      clearInterval(r.__plansyncKeepalive);
      r.__plansyncKeepalive = undefined;
    }
  });
}

export function makeEmitter(res: Response): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    // If the client already disconnected, silently drop
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

export function endSseStream(res: Response): void {
  // Clean up the keepalive interval on normal end
  const r = res as ResponseWithKeepalive;
  if (r.__plansyncKeepalive) {
    clearInterval(r.__plansyncKeepalive);
    r.__plansyncKeepalive = undefined;
  }
  if (!res.writableEnded) {
    res.end();
  }
}
