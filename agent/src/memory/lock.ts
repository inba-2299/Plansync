import { getRedis, key } from './redis';

/**
 * Per-session lock — prevents two concurrent POST /agent invocations from
 * stomping on the same session's state.
 *
 * Pattern: SET NX EX — atomic "set if not exists" with a TTL. If the lock
 * is held, the second caller gets a 409 Conflict from the route handler
 * and surfaces it to the frontend as "another request is in progress".
 *
 * TTL is generous (5 minutes) because Claude streaming + tool execution
 * can legitimately take a couple of minutes on a 62-row plan. Railway
 * has no hard request timeout, so this is safe.
 */

const DEFAULT_TTL_SECONDS = 300;

export interface LockAcquired {
  /** Release the lock. Idempotent — safe to call in a finally block. */
  release: () => Promise<void>;
}

export async function acquireLock(
  sessionId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<LockAcquired | null> {
  const redis = getRedis();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(key.lock(sessionId), token, {
    nx: true,
    ex: ttlSeconds,
  });
  if (result !== 'OK') return null;

  return {
    release: async () => {
      // Safe release: only delete if we still own the token (best-effort).
      // Upstash doesn't expose Lua but a simple read-check-delete is fine here
      // because we only care about avoiding stomping, not strict correctness.
      try {
        const current = await redis.get(key.lock(sessionId));
        if (current === token) {
          await redis.del(key.lock(sessionId));
        }
      } catch {
        /* ignore — the lock will expire on its own */
      }
    },
  };
}
