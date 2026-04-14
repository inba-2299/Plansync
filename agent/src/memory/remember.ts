import { getRedis, key } from './redis';

/**
 * Working memory — named facts the agent wants to track across turns
 * without cluttering the conversation history.
 *
 * The agent calls remember(sessionId, 'user_date_format', 'DD/MM') and
 * recall(sessionId, 'user_date_format') to get it back. Values are
 * JSON-encoded so any serializable shape works.
 *
 * NOTE: this is a lower-level helper. The agent-facing remember/recall
 * tools live in src/tools/ and also emit memory_write events for the UI toast.
 */

export async function remember(
  sessionId: string,
  memoryKey: string,
  value: unknown
): Promise<void> {
  const redis = getRedis();
  await redis.hset(key.remember(sessionId), {
    [memoryKey]: JSON.stringify(value),
  });
}

export async function recall<T = unknown>(
  sessionId: string,
  memoryKey: string
): Promise<T | null> {
  const redis = getRedis();
  const raw = await redis.hget(key.remember(sessionId), memoryKey);
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T);
  } catch {
    return null;
  }
}

export async function recallAll(
  sessionId: string
): Promise<Record<string, unknown>> {
  const redis = getRedis();
  const raw = (await redis.hgetall(key.remember(sessionId))) ?? {};
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

export async function forget(sessionId: string, memoryKey: string): Promise<void> {
  const redis = getRedis();
  await redis.hdel(key.remember(sessionId), memoryKey);
}
