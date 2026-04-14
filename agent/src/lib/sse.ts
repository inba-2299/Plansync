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
 */

export function startSseStream(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

export function makeEmitter(res: Response): (event: AgentEvent) => void {
  return (event: AgentEvent) => {
    // If the client already disconnected, silently drop
    if (res.writableEnded || res.destroyed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

export function endSseStream(res: Response): void {
  if (!res.writableEnded) {
    res.end();
  }
}
