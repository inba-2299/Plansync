import type {
  AnthropicMessage,
  ExecLogEntry,
  IdMapEntry,
  JourneyStep,
  SessionMeta,
} from '../types';
import { getRedis, key, SESSION_TTL_SECONDS, touchSessionTtl } from './redis';

/**
 * Session state — the working memory of one agent run.
 *
 * Loaded from Redis at the start of every POST /agent invocation and
 * persisted back at the end. Redis IS the loop state — the backend is
 * stateless between requests.
 *
 * `history` is the full Anthropic message list (what we send to Claude
 * on every turn). `artifacts` carry full blobs that are NOT inlined in
 * history (tool results reference them by id). `idmap` maps tempIds to
 * real Rocketlane ids during the creation phase.
 */

export interface Session {
  meta: SessionMeta;
  history: AnthropicMessage[];
  idmap: Record<string, IdMapEntry>;
  execlog: ExecLogEntry[];
  remember: Record<string, unknown>;
  journey: JourneyStep[];
  /** True if the agent is waiting for a human response (request_user_approval outstanding) */
  pending: PendingApproval | null;
}

export interface PendingApproval {
  toolUseId: string;
  question: string;
  options: Array<{ label: string; value: string; description?: string }>;
  context?: unknown;
  createdAt: number;
}

/** Create a fresh empty session */
export function newSession(sessionId: string): Session {
  const now = Date.now();
  return {
    meta: {
      sessionId,
      status: 'new',
      createdAt: now,
      ttlAt: now + SESSION_TTL_SECONDS * 1000,
      turnCount: 0,
    },
    history: [],
    idmap: {},
    execlog: [],
    remember: {},
    journey: [],
    pending: null,
  };
}

/**
 * Load a session from Redis. Returns a fresh empty session if none exists.
 *
 * NOTE: artifacts are NOT loaded here — they're fetched on-demand via
 * getArtifact() from memory/artifacts.ts. This keeps the working set small.
 */
export async function loadSession(sessionId: string): Promise<Session> {
  const redis = getRedis();
  const [meta, history, idmap, execlog, remember, journey, pending] =
    await Promise.all([
      redis.hgetall(key.meta(sessionId)),
      redis.lrange(key.history(sessionId), 0, -1),
      redis.hgetall(key.idmap(sessionId)),
      redis.lrange(key.execlog(sessionId), 0, -1),
      redis.hgetall(key.remember(sessionId)),
      redis.hgetall(key.journey(sessionId)),
      redis.hgetall(key.pending(sessionId)),
    ]);

  if (!meta || Object.keys(meta).length === 0) {
    return newSession(sessionId);
  }

  return {
    meta: parseMeta(meta),
    history: (history ?? []).map((s) =>
      typeof s === 'string' ? (JSON.parse(s) as AnthropicMessage) : (s as AnthropicMessage)
    ),
    idmap: parseIdMap(idmap ?? {}),
    execlog: (execlog ?? []).map((s) =>
      typeof s === 'string' ? (JSON.parse(s) as ExecLogEntry) : (s as ExecLogEntry)
    ),
    remember: parseRemember(remember ?? {}),
    journey: parseJourney(journey ?? {}),
    pending: parsePending(pending ?? {}),
  };
}

/**
 * Save the session back to Redis. Overwrites history, idmap, remember,
 * journey, and pending. Does NOT save artifacts — those are written
 * separately by the artifact store at the moment they're created.
 */
export async function saveSession(
  sessionId: string,
  session: Session
): Promise<void> {
  const redis = getRedis();
  const pipe = redis.pipeline();

  // Meta — overwrite full hash
  pipe.del(key.meta(sessionId));
  pipe.hset(key.meta(sessionId), flattenMeta(session.meta));

  // History — overwrite list by delete + lpush-all
  pipe.del(key.history(sessionId));
  if (session.history.length > 0) {
    pipe.rpush(
      key.history(sessionId),
      ...session.history.map((m) => JSON.stringify(m))
    );
  }

  // idmap — overwrite
  pipe.del(key.idmap(sessionId));
  if (Object.keys(session.idmap).length > 0) {
    pipe.hset(
      key.idmap(sessionId),
      Object.fromEntries(
        Object.entries(session.idmap).map(([k, v]) => [k, JSON.stringify(v)])
      )
    );
  }

  // execlog — append-only (but we store the whole thing on save for simplicity)
  pipe.del(key.execlog(sessionId));
  if (session.execlog.length > 0) {
    pipe.rpush(
      key.execlog(sessionId),
      ...session.execlog.map((e) => JSON.stringify(e))
    );
  }

  // remember (working memory)
  pipe.del(key.remember(sessionId));
  if (Object.keys(session.remember).length > 0) {
    pipe.hset(
      key.remember(sessionId),
      Object.fromEntries(
        Object.entries(session.remember).map(([k, v]) => [k, JSON.stringify(v)])
      )
    );
  }

  // journey (current stepper state — replace)
  pipe.del(key.journey(sessionId));
  if (session.journey.length > 0) {
    pipe.hset(
      key.journey(sessionId),
      Object.fromEntries(
        session.journey.map((step, idx) => [`${idx}:${step.id}`, JSON.stringify(step)])
      )
    );
  }

  // pending approval — replace or delete
  pipe.del(key.pending(sessionId));
  if (session.pending) {
    pipe.hset(key.pending(sessionId), {
      toolUseId: session.pending.toolUseId,
      question: session.pending.question,
      options: JSON.stringify(session.pending.options),
      context: JSON.stringify(session.pending.context ?? null),
      createdAt: session.pending.createdAt,
    });
  }

  await pipe.exec();
  await touchSessionTtl(sessionId);
}

// ---------- internal parsers ----------

function parseMeta(raw: Record<string, unknown>): SessionMeta {
  return {
    sessionId: String(raw.sessionId ?? ''),
    status: String(raw.status ?? 'new'),
    createdAt: Number(raw.createdAt ?? Date.now()),
    ttlAt: Number(raw.ttlAt ?? Date.now() + SESSION_TTL_SECONDS * 1000),
    turnCount: Number(raw.turnCount ?? 0),
    rlApiKeyEnc: raw.rlApiKeyEnc ? String(raw.rlApiKeyEnc) : undefined,
    rlWorkspaceId:
      raw.rlWorkspaceId !== undefined ? Number(raw.rlWorkspaceId) : undefined,
  };
}

function flattenMeta(meta: SessionMeta): Record<string, string | number> {
  const out: Record<string, string | number> = {
    sessionId: meta.sessionId,
    status: meta.status,
    createdAt: meta.createdAt,
    ttlAt: meta.ttlAt,
    turnCount: meta.turnCount,
  };
  if (meta.rlApiKeyEnc) out.rlApiKeyEnc = meta.rlApiKeyEnc;
  if (meta.rlWorkspaceId !== undefined) out.rlWorkspaceId = meta.rlWorkspaceId;
  return out;
}

function parseIdMap(raw: Record<string, unknown>): Record<string, IdMapEntry> {
  const out: Record<string, IdMapEntry> = {};
  for (const [k, v] of Object.entries(raw)) {
    try {
      out[k] = typeof v === 'string' ? JSON.parse(v) : (v as IdMapEntry);
    } catch {
      /* skip malformed entries */
    }
  }
  return out;
}

function parseRemember(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    try {
      out[k] = typeof v === 'string' ? JSON.parse(v) : v;
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function parseJourney(raw: Record<string, unknown>): JourneyStep[] {
  const entries = Object.entries(raw);
  const steps: Array<{ idx: number; step: JourneyStep }> = [];
  for (const [k, v] of entries) {
    const idx = Number(k.split(':')[0]);
    if (Number.isNaN(idx)) continue;
    try {
      const step = typeof v === 'string' ? JSON.parse(v) : (v as JourneyStep);
      steps.push({ idx, step });
    } catch {
      /* skip */
    }
  }
  steps.sort((a, b) => a.idx - b.idx);
  return steps.map((s) => s.step);
}

function parsePending(raw: Record<string, unknown>): PendingApproval | null {
  if (!raw || Object.keys(raw).length === 0) return null;
  try {
    return {
      toolUseId: String(raw.toolUseId ?? ''),
      question: String(raw.question ?? ''),
      options:
        typeof raw.options === 'string'
          ? JSON.parse(raw.options)
          : (raw.options as PendingApproval['options']),
      context:
        typeof raw.context === 'string' ? JSON.parse(raw.context) : raw.context,
      createdAt: Number(raw.createdAt ?? Date.now()),
    };
  } catch {
    return null;
  }
}
