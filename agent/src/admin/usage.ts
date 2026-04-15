import { getRedis } from '../memory/redis';

/**
 * Token usage + cost tracking for the admin dashboard.
 *
 * Every time the agent loop gets a response from Anthropic, it calls
 * `recordUsage()` with the usage object from `stream.finalMessage()`.
 * We persist two kinds of counters:
 *
 *   1. Per-session: `session:{id}:usage` HASH with totals
 *      (input_tokens, output_tokens, cache_read, cache_write)
 *      so the admin dashboard can show cost per session in the recent
 *      sessions table.
 *
 *   2. Per-day aggregate: `admin:usage:daily:{yyyy-mm-dd}` HASH with
 *      totals broken down by model (model-specific field names like
 *      `claude-sonnet-4-5:input`). Used for the "today's cost" stat
 *      card on the dashboard.
 *
 * We compute cost estimates with a lookup table of approximate
 * Anthropic pricing. Prices are APPROXIMATE — the admin UI labels them
 * as estimates. For exact billing, the user should reference their
 * Anthropic console.
 */

// ---------- Pricing table (USD per million tokens) ----------
//
// Source: Anthropic public pricing page (anthropic.com/pricing), values
// current as of 2026-04-16. Numbers here should be cross-checked against
// the current published prices before making billing decisions — the
// admin dashboard labels cost as "Estimated" and users should always
// verify against their actual Anthropic console for exact billing.
//
// Pricing model for all Claude 4.5 family models:
//   - Base input: charged per input token (USD/MTok)
//   - Base output: charged per output token (USD/MTok)
//   - Cache read (input token served from a cached context): 10% of
//     the base input rate
//   - Cache write (input token stored for caching, via a
//     cache_control marker): 125% of the base input rate
//
// If Anthropic updates pricing, change only this object — everything
// else (per-session totals, daily aggregates, dashboard display)
// flows from here via `estimateCostUsd()`.

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': {
    inputPer1M: 1.0,
    outputPer1M: 5.0,
    cacheReadPer1M: 0.1,
    cacheWritePer1M: 1.25,
  },
  'claude-sonnet-4-5': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  'claude-opus-4-5': {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
};

/** Fall back to Sonnet's pricing for unknown models. */
const FALLBACK_PRICING: ModelPricing = PRICING['claude-sonnet-4-5'];

function getPricing(model: string): ModelPricing {
  return PRICING[model] ?? FALLBACK_PRICING;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function estimateCostUsd(model: string, totals: UsageTotals): number {
  const p = getPricing(model);
  return (
    (totals.input * p.inputPer1M) / 1_000_000 +
    (totals.output * p.outputPer1M) / 1_000_000 +
    (totals.cacheRead * p.cacheReadPer1M) / 1_000_000 +
    (totals.cacheWrite * p.cacheWritePer1M) / 1_000_000
  );
}

// ---------------- Recording ----------------

/** Pad a number to 2 digits for date strings. */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a Date as yyyy-mm-dd in UTC. */
function toUtcDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Record a single Anthropic response's token usage to both the per-session
 * hash and the per-day aggregate. Called from loop.ts after every turn.
 *
 * Fire-and-forget — this MUST NOT throw back into the loop. Redis hiccups
 * should not crash an agent run over a stats write.
 */
export async function recordUsage(
  sessionId: string,
  model: string,
  usage: TokenUsage | undefined
): Promise<void> {
  if (!usage) return;
  try {
    const redis = getRedis();
    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
    const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
    const totals: UsageTotals = {
      input,
      output,
      cacheRead,
      cacheWrite,
    };
    const costUsd = estimateCostUsd(model, totals);

    const sessionKey = `session:${sessionId}:usage`;
    const dailyKey = `admin:usage:daily:${toUtcDateKey(new Date())}`;

    // Per-session: HINCRBY on each field. We use HINCRBYFLOAT for cost
    // since it's a fraction; the token counts are HINCRBY (integer).
    await Promise.all([
      redis.hincrby(sessionKey, 'input', input),
      redis.hincrby(sessionKey, 'output', output),
      redis.hincrby(sessionKey, 'cacheRead', cacheRead),
      redis.hincrby(sessionKey, 'cacheWrite', cacheWrite),
      redis.hincrbyfloat(sessionKey, 'costUsd', costUsd),
      redis.hset(sessionKey, { lastModel: model }),
      redis.expire(sessionKey, 7 * 24 * 60 * 60), // match session TTL

      // Daily aggregate — broken down by model so the dashboard can
      // show per-model stats.
      redis.hincrby(dailyKey, `${model}:input`, input),
      redis.hincrby(dailyKey, `${model}:output`, output),
      redis.hincrby(dailyKey, `${model}:cacheRead`, cacheRead),
      redis.hincrby(dailyKey, `${model}:cacheWrite`, cacheWrite),
      redis.hincrbyfloat(dailyKey, `${model}:costUsd`, costUsd),
      redis.hincrby(dailyKey, 'totalTurns', 1),
      redis.expire(dailyKey, 30 * 24 * 60 * 60), // 30 days of history
    ]);
  } catch (err) {
    // Log but never throw
    console.error(
      '[usage] failed to record token usage:',
      err instanceof Error ? err.message : err
    );
  }
}

// ---------------- Reading (for the dashboard) ----------------

export interface DailyUsageSummary {
  date: string;
  totalTurns: number;
  byModel: Record<string, UsageTotals & { costUsd: number }>;
  totalTokens: number;
  totalCostUsd: number;
}

/** Read a single day's aggregate usage. */
export async function getDailyUsage(date: Date = new Date()): Promise<DailyUsageSummary> {
  const redis = getRedis();
  const dateKey = toUtcDateKey(date);
  const key = `admin:usage:daily:${dateKey}`;

  const raw = await redis.hgetall<Record<string, string | number>>(key);
  const byModel: Record<string, UsageTotals & { costUsd: number }> = {};
  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalTurns = 0;

  if (raw) {
    for (const [field, value] of Object.entries(raw)) {
      if (field === 'totalTurns') {
        totalTurns = Number(value) || 0;
        continue;
      }
      // field format: "<model>:<metric>"
      const colonIdx = field.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const model = field.slice(0, colonIdx);
      const metric = field.slice(colonIdx + 1);
      const numValue = Number(value) || 0;

      if (!byModel[model]) {
        byModel[model] = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          costUsd: 0,
        };
      }
      if (metric === 'input') {
        byModel[model].input = numValue;
        totalTokens += numValue;
      } else if (metric === 'output') {
        byModel[model].output = numValue;
        totalTokens += numValue;
      } else if (metric === 'cacheRead') {
        byModel[model].cacheRead = numValue;
        totalTokens += numValue;
      } else if (metric === 'cacheWrite') {
        byModel[model].cacheWrite = numValue;
        totalTokens += numValue;
      } else if (metric === 'costUsd') {
        byModel[model].costUsd = numValue;
        totalCostUsd += numValue;
      }
    }
  }

  return {
    date: dateKey,
    totalTurns,
    byModel,
    totalTokens,
    totalCostUsd,
  };
}

/** Read per-session usage totals (used by the recent sessions table). */
export async function getSessionUsage(
  sessionId: string
): Promise<(UsageTotals & { costUsd: number; lastModel?: string }) | null> {
  const redis = getRedis();
  const raw = await redis.hgetall<Record<string, string | number>>(
    `session:${sessionId}:usage`
  );
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    input: Number(raw.input ?? 0),
    output: Number(raw.output ?? 0),
    cacheRead: Number(raw.cacheRead ?? 0),
    cacheWrite: Number(raw.cacheWrite ?? 0),
    costUsd: Number(raw.costUsd ?? 0),
    lastModel: raw.lastModel ? String(raw.lastModel) : undefined,
  };
}
