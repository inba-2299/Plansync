import { getRedis } from '../memory/redis';

/**
 * Admin-adjustable runtime config.
 *
 * These settings are stored in Redis (as individual keys under the
 * `admin:config:*` namespace) and read by the agent loop at the start
 * of each turn. If a Redis value is present, it takes precedence over
 * the environment variable / compile-time constant. If not, the env
 * default applies.
 *
 * This means the admin can change the model, max_tokens, retry count,
 * and disabled tools list WITHOUT a Railway redeploy — the change
 * takes effect on the next turn (of any running session).
 *
 * Currently supported keys:
 *   admin:config:model           → ANTHROPIC_MODEL override (string)
 *   admin:config:maxTokens       → max_tokens override (number)
 *   admin:config:maxRetries      → 429 retry cap override (number)
 *   admin:config:temperature     → temperature override (0.0-1.0)
 *   admin:config:disabledTools   → JSON array of tool names to hide
 *
 * Every setter uses a one-shot write. Every getter tries Redis, then
 * falls back. No TTL on these keys — admin settings are sticky until
 * manually changed.
 */

const KEY_MODEL = 'admin:config:model';
const KEY_MAX_TOKENS = 'admin:config:maxTokens';
const KEY_MAX_RETRIES = 'admin:config:maxRetries';
const KEY_TEMPERATURE = 'admin:config:temperature';
const KEY_DISABLED_TOOLS = 'admin:config:disabledTools';

/** Defaults — used when Redis has no override AND env var is missing. */
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TEMPERATURE = 1;

// ---------------- Getters (used by loop.ts on every turn) ----------------

/**
 * Resolve the Anthropic model to use. Precedence:
 *   1. admin:config:model (Redis)
 *   2. process.env.ANTHROPIC_MODEL
 *   3. throws — model MUST be configured somewhere
 */
export async function getEffectiveModel(): Promise<string> {
  const redis = getRedis();
  try {
    const override = await redis.get<string>(KEY_MODEL);
    if (typeof override === 'string' && override.length > 0) {
      return override;
    }
  } catch {
    // Redis hiccup — fall through to env var
  }
  const envModel = process.env.ANTHROPIC_MODEL;
  if (typeof envModel === 'string' && envModel.length > 0) {
    return envModel;
  }
  throw new Error(
    'No model configured — set admin:config:model in Redis or ANTHROPIC_MODEL env var'
  );
}

/** Resolve max_tokens for the next Anthropic call. */
export async function getEffectiveMaxTokens(): Promise<number> {
  const redis = getRedis();
  try {
    const override = await redis.get<number | string>(KEY_MAX_TOKENS);
    if (override !== null && override !== undefined) {
      const n = Number(override);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    // fall through
  }
  return DEFAULT_MAX_TOKENS;
}

/** Resolve the temperature for the next Anthropic call. */
export async function getEffectiveTemperature(): Promise<number> {
  const redis = getRedis();
  try {
    const override = await redis.get<number | string>(KEY_TEMPERATURE);
    if (override !== null && override !== undefined) {
      const n = Number(override);
      if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    }
  } catch {
    // fall through
  }
  return DEFAULT_TEMPERATURE;
}

/** Resolve the 429 retry cap. */
export async function getEffectiveMaxRetries(): Promise<number> {
  const redis = getRedis();
  try {
    const override = await redis.get<number | string>(KEY_MAX_RETRIES);
    if (override !== null && override !== undefined) {
      const n = Number(override);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    // fall through
  }
  return DEFAULT_MAX_RETRIES;
}

/**
 * Resolve the set of disabled tools. Returns an empty array when
 * nothing is disabled (the common case).
 *
 * Note: `request_user_approval` is protected at the setter level —
 * it cannot be added to the disabled list because it's the only
 * blocking tool and disabling it would break the entire UX.
 */
export async function getDisabledTools(): Promise<string[]> {
  const redis = getRedis();
  try {
    const raw = await redis.get<string | string[]>(KEY_DISABLED_TOOLS);
    if (raw === null || raw === undefined) return [];
    if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string');
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed))
          return parsed.filter((t) => typeof t === 'string');
      } catch {
        return [];
      }
    }
  } catch {
    // fall through
  }
  return [];
}

// ---------------- Setters (called from admin routes) ----------------

/** Write the model override. Pass `null` to clear and fall back to env. */
export async function setModel(model: string | null): Promise<void> {
  const redis = getRedis();
  if (model === null) {
    await redis.del(KEY_MODEL);
    return;
  }
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error('model must be a non-empty string or null');
  }
  await redis.set(KEY_MODEL, model);
}

export async function setMaxTokens(maxTokens: number | null): Promise<void> {
  const redis = getRedis();
  if (maxTokens === null) {
    await redis.del(KEY_MAX_TOKENS);
    return;
  }
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new Error('maxTokens must be a positive number or null');
  }
  await redis.set(KEY_MAX_TOKENS, maxTokens);
}

export async function setTemperature(temperature: number | null): Promise<void> {
  const redis = getRedis();
  if (temperature === null) {
    await redis.del(KEY_TEMPERATURE);
    return;
  }
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    throw new Error('temperature must be between 0.0 and 1.0, or null');
  }
  await redis.set(KEY_TEMPERATURE, temperature);
}

export async function setMaxRetries(maxRetries: number | null): Promise<void> {
  const redis = getRedis();
  if (maxRetries === null) {
    await redis.del(KEY_MAX_RETRIES);
    return;
  }
  if (!Number.isFinite(maxRetries) || maxRetries < 0) {
    throw new Error('maxRetries must be a non-negative number or null');
  }
  await redis.set(KEY_MAX_RETRIES, maxRetries);
}

/**
 * Replace the disabled tools list. The SAFETY RAIL:
 * `request_user_approval` cannot be disabled because it's the only
 * blocking tool and disabling it would prevent the agent from asking
 * the user anything, effectively breaking the UX. Any attempt to
 * include it is silently filtered out.
 */
const PROTECTED_TOOLS = new Set(['request_user_approval']);

export async function setDisabledTools(tools: string[]): Promise<string[]> {
  const redis = getRedis();
  if (!Array.isArray(tools)) {
    throw new Error('tools must be an array of strings');
  }
  const cleaned = tools
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .filter((t) => !PROTECTED_TOOLS.has(t));
  await redis.set(KEY_DISABLED_TOOLS, JSON.stringify(cleaned));
  return cleaned;
}

/**
 * Snapshot all admin config values for the dashboard. Returns the
 * effective values (Redis override or env fallback) plus a flag
 * indicating whether an override is active.
 */
export async function getAdminConfigSnapshot(): Promise<{
  model: { effective: string; hasOverride: boolean; envDefault: string | undefined };
  maxTokens: { effective: number; hasOverride: boolean; envDefault: number };
  temperature: { effective: number; hasOverride: boolean; envDefault: number };
  maxRetries: { effective: number; hasOverride: boolean; envDefault: number };
  disabledTools: string[];
}> {
  const redis = getRedis();

  const [modelOverride, maxTokensOverride, temperatureOverride, maxRetriesOverride, disabledTools] =
    await Promise.all([
      redis.get<string>(KEY_MODEL).catch(() => null),
      redis.get<number | string>(KEY_MAX_TOKENS).catch(() => null),
      redis.get<number | string>(KEY_TEMPERATURE).catch(() => null),
      redis.get<number | string>(KEY_MAX_RETRIES).catch(() => null),
      getDisabledTools(),
    ]);

  const envModel = process.env.ANTHROPIC_MODEL;
  const effectiveModel =
    typeof modelOverride === 'string' && modelOverride.length > 0
      ? modelOverride
      : (envModel ?? '(not set)');

  const parsedMaxTokens = Number(maxTokensOverride);
  const effectiveMaxTokens =
    maxTokensOverride != null && Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
      ? parsedMaxTokens
      : DEFAULT_MAX_TOKENS;

  const parsedMaxRetries = Number(maxRetriesOverride);
  const effectiveMaxRetries =
    maxRetriesOverride != null && Number.isFinite(parsedMaxRetries) && parsedMaxRetries >= 0
      ? parsedMaxRetries
      : DEFAULT_MAX_RETRIES;

  return {
    model: {
      effective: effectiveModel,
      hasOverride: typeof modelOverride === 'string' && modelOverride.length > 0,
      envDefault: envModel,
    },
    maxTokens: {
      effective: effectiveMaxTokens,
      hasOverride: maxTokensOverride !== null && maxTokensOverride !== undefined,
      envDefault: DEFAULT_MAX_TOKENS,
    },
    temperature: (() => {
      const parsed = Number(temperatureOverride);
      const effective = temperatureOverride != null && Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_TEMPERATURE;
      return { effective, hasOverride: temperatureOverride !== null && temperatureOverride !== undefined, envDefault: DEFAULT_TEMPERATURE };
    })(),
    maxRetries: {
      effective: effectiveMaxRetries,
      hasOverride: maxRetriesOverride !== null && maxRetriesOverride !== undefined,
      envDefault: DEFAULT_MAX_RETRIES,
    },
    disabledTools,
  };
}
