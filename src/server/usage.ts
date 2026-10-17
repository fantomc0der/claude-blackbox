import { createHash } from "node:crypto";
import type { RecordedCost, RecordedModelUsage, UsageSummary } from "../shared/types";
import { object, string, syntheticModel } from "./normalize";
import { isFacetValue } from "./facets";
import { recordedDuration } from "../shared/records";

/** Rate multipliers for a request whose prompt, counting cache reads and writes, is over `above` tokens. */
interface LongContext { above: number; input: number; output: number }
interface Price { input: number; output: number; cacheRead?: number; longContext?: LongContext; fast?: number }

const legacyLongContext: LongContext = { above: 200_000, input: 2, output: 1.5 };

const prices: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.025 },
  "claude-mythos-5-1": { input: 10, output: 50, cacheRead: 0.025 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.05, fast: 2 },
  "claude-opus-5": { input: 5, output: 25, fast: 2 },
  "claude-opus-4-8": { input: 5, output: 25, fast: 2 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25, fast: 1 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4": { input: 15, output: 75 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.05 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15, longContext: legacyLongContext },
  "claude-sonnet-4": { input: 3, output: 15, longContext: legacyLongContext },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longContext: { above: 100_000, input: 5, output: 5 } },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
};

function priceOf(model: string): Price | undefined {
  return Object.hasOwn(prices, model) ? prices[model] : undefined;
}

const stamps = new Map<Price | undefined, string>();

/**
 * Identifies the rates and rules a request of `model` is indexed with; its cost and normalized model are derived only
 * then. Editing one model's rates changes only that model's stamp. Bump the revision when the formula or model
 * normalization changes, which re-indexes every request.
 */
export function rateStamp(model: string): string {
  const price = priceOf(model);
  let stamp = stamps.get(price);
  if (!stamp) stamps.set(price, stamp = createHash("sha256").update(JSON.stringify({ revision: 1, price: price ?? null })).digest("hex").slice(0, 16));
  return stamp;
}

export interface UsageRecord {
  key: string;
  model: string;
  effort: string | null;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  cost: number | null;
  recorded: boolean;
  /** No recorded cost and no bundled rates for a named model, as opposed to fast mode without a known rate or no model. */
  unrated: boolean;
  sidechain: boolean;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeModel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, "").replace(/^(?:(?:us|eu|apac|global)\.)?anthropic[./]/, "")
    .replace(/-v\d+:\d+$/, "").replace(/[-@]\d{8}$/, "").replace(/-latest$/, "")
    .replace(/^claude-.*/, name => name.replace(/(\d)\.(?=\d)/g, "$1-")).replace(/^(claude-(?:sonnet|opus)-4)-0$/, "$1");
}

export function readUsage(raw: Record<string, unknown>, sessionId: string, eventId: string): UsageRecord | null {
  const message = object(raw.message);
  if (raw.type !== "assistant" || message.model === syntheticModel) return null;
  const usage = object(message.usage);
  const cache = object(usage.cache_creation);
  const fields = [usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens, cache.ephemeral_5m_input_tokens, cache.ephemeral_1h_input_tokens];
  const recordedCost = typeof raw.costUSD === "number" && Number.isFinite(raw.costUSD) && raw.costUSD >= 0 ? raw.costUSD : null;
  if (!fields.some(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) && recordedCost === null) return null;
  const input = count(usage.input_tokens), output = count(usage.output_tokens), cacheRead = count(usage.cache_read_input_tokens);
  const cacheHour = count(cache.ephemeral_1h_input_tokens);
  const cacheCreation = Math.max(count(usage.cache_creation_input_tokens), count(cache.ephemeral_5m_input_tokens) + cacheHour);
  const messageId = string(message.id);
  const requestId = string(raw.requestId) || string(raw.request_id);
  const key = messageId ? JSON.stringify(["message", messageId, requestId || string(raw.sessionId) || sessionId])
    : JSON.stringify(["event", string(raw.sessionId) || sessionId, string(raw.uuid) || eventId]);
  const model = normalizeModel(string(message.model));
  const price = priceOf(model);
  const effort = [message.effort, raw.effort, object(message.output_config).effort, object(raw.output_config).effort]
    .map(value => string(value).trim().toLowerCase()).find(value => isFacetValue(value, 80)) || null;
  let cost = recordedCost;
  if (cost === null && price) {
    const fast = usage.speed === "fast" || raw.speed === "fast";
    if (!fast || price.fast) {
      const longContext = price.longContext && input + cacheCreation + cacheRead > price.longContext.above ? price.longContext : undefined;
      const inputRate = price.input * (longContext?.input ?? 1);
      const outputRate = price.output * (longContext?.output ?? 1);
      const geography = usage.inference_geo === "us" ? 1.1 : 1;
      cost = (input * inputRate + output * outputRate + (cacheCreation - cacheHour) * inputRate * 1.25
        + cacheHour * inputRate * 2 + cacheRead * inputRate * (price.cacheRead ?? 0.1)) / 1_000_000 * (fast ? price.fast! : 1) * geography;
    }
  }
  return { key, model, effort, input, output, cacheCreation, cacheRead, cost, recorded: recordedCost !== null, unrated: cost === null && !price && model !== "", sidechain: raw.isSidechain === true };
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Reads Claude Code's own running total from a `cost-state` record. Claude Code writes one at the end of each turn and
 * on resume, files the type as last-wins, and restores its tracker from it, so the last record in a recording holds the
 * session's total so far. `modelUsage` is keyed by the requested model string (`claude-opus-5[1m]`,
 * `claude-haiku-4-5-20251001`), which `normalizeModel()` maps onto the rate table's keys; models that normalize to the
 * same key are summed. A record without a readable `totalCostUSD` is not a total. The tracker's `totalAPIDuration`
 * and `totalToolDuration` come along as measured time; `totalDuration` does not, because the tracker's clock is
 * restored across resumes of the session, so it measures process time rather than the recording.
 */
export function readCostState(raw: Record<string, unknown>): RecordedCost | null {
  if (raw.type !== "cost-state") return null;
  const costUSD = money(raw.totalCostUSD);
  if (costUSD === null) return null;
  const started = typeof raw.startTime === "number" ? raw.startTime : Date.parse(string(raw.startTime));
  const models = new Map<string, RecordedModelUsage>();
  for (const [name, entry] of Object.entries(object(raw.modelUsage))) {
    const model = normalizeModel(name);
    if (!isFacetValue(model)) continue;
    const usage = object(entry);
    const total = models.get(model) ?? { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, webSearchRequests: 0, costUSD: 0 };
    total.inputTokens += count(usage.inputTokens);
    total.outputTokens += count(usage.outputTokens);
    total.thinkingTokens += count(usage.thinkingTokens);
    total.cacheCreationTokens += count(usage.cacheCreationInputTokens);
    total.cacheReadTokens += count(usage.cacheReadInputTokens);
    total.webSearchRequests += count(usage.webSearchRequests);
    total.costUSD += money(usage.costUSD) ?? 0;
    models.set(model, total);
  }
  return {
    costUSD,
    startedAt: Number.isFinite(started) ? new Date(started).toISOString() : "",
    unknownModelCost: raw.hasUnknownModelCost === true,
    models: Object.fromEntries(models),
    apiDurationMs: recordedDuration(raw.totalAPIDuration),
    toolDurationMs: recordedDuration(raw.totalToolDuration),
  };
}

export function emptyUsage(): UsageSummary {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUSD: 0, requests: 0, unpricedRequests: 0, unratedRequests: 0, recordedCostRequests: 0 };
}

/** Adds every counter of `source` to `target`; summaries only hold sums, so disjoint request sets combine exactly. */
export function addUsage(target: UsageSummary, source: UsageSummary): UsageSummary {
  for (const key of Object.keys(target) as (keyof UsageSummary)[]) target[key] += source[key];
  return target;
}

export const usageColumns = `coalesce(sum(input),0) AS inputTokens, coalesce(sum(output),0) AS outputTokens,
  coalesce(sum(cache_creation),0) AS cacheCreationTokens, coalesce(sum(cache_read),0) AS cacheReadTokens,
  coalesce(sum(input+output+cache_creation+cache_read),0) AS totalTokens, coalesce(sum(cost),0) AS costUSD,
  count(*) AS requests, coalesce(sum(cost IS NULL),0) AS unpricedRequests, coalesce(sum(unrated),0) AS unratedRequests,
  coalesce(sum(recorded),0) AS recordedCostRequests`;
