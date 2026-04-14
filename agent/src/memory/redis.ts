import { Redis } from '@upstash/redis';

/**
 * Singleton Upstash Redis client.
 *
 * Reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env.
 * Throws on first call if they're missing — we never want to silently
 * fall back to a mock in production.
 */

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Upstash Redis not configured: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in env'
    );
  }

  client = new Redis({ url, token });
  return client;
}

/** TTL (seconds) for every session key. 48 hours. */
export const SESSION_TTL_SECONDS = 48 * 60 * 60;

/** Namespace helper: produces canonical keys for a session */
export const key = {
  meta: (sessionId: string) => `session:${sessionId}:meta`,
  history: (sessionId: string) => `session:${sessionId}:history`,
  artifacts: (sessionId: string) => `session:${sessionId}:artifacts`,
  idmap: (sessionId: string) => `session:${sessionId}:idmap`,
  execlog: (sessionId: string) => `session:${sessionId}:execlog`,
  remember: (sessionId: string) => `session:${sessionId}:remember`,
  journey: (sessionId: string) => `session:${sessionId}:journey`,
  pending: (sessionId: string) => `session:${sessionId}:pending`,
  lock: (sessionId: string) => `session:${sessionId}:lock`,
} as const;

/**
 * Refresh TTL on every session key so it doesn't decay while active.
 * Called from saveSession after every loop iteration.
 */
export async function touchSessionTtl(sessionId: string): Promise<void> {
  const redis = getRedis();
  const keys = [
    key.meta(sessionId),
    key.history(sessionId),
    key.artifacts(sessionId),
    key.idmap(sessionId),
    key.execlog(sessionId),
    key.remember(sessionId),
    key.journey(sessionId),
    key.pending(sessionId),
  ];
  await Promise.all(keys.map((k) => redis.expire(k, SESSION_TTL_SECONDS)));
}
