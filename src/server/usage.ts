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
const revision = 2;

function stampOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/**
 * Identifies the rates and rules a request of `model` is indexed with; its cost and normalized model are derived only
 * then. Editing one model's rates changes only that model's stamp. Bump the revision when the formula, the reading of
 * `usage.iterations`, the reasons a request goes unpriced, or model normalization changes, which re-indexes every
 * request.
 */
export function rateStamp(model: string): string {
  const price = priceOf(model);
  let stamp = stamps.get(price);
  if (!stamp) stamps.set(price, stamp = stampOf({ revision, price: price ?? null }));
  return stamp;
}

/** The stamp of a request with a share at another model than its own, an advisor's or a fallback hop's, priced or not.
 *  Its row names only the request's own model, so any edit to the table changes this stamp. */
const tableStamp = stampOf({ revision, prices });

/** Whether the bundled table has rates for `model`. */
export function hasRates(model: string): boolean {
  return priceOf(model) !== undefined;
}

/** Whether `rates` is a current stamp for a request of `model`: its own model's, or the whole table's. */
export function currentRates(model: string, rates: string): boolean {
  return rates === rateStamp(model) || rates === tableStamp;
}

/**
 * Why a request has no estimate, in order of precedence: `unnamed` when it recorded no model, `model` when its own
 * model has no bundled rates, `credit` when it presented a fallback credit, `tier` when it used a service tier other
 * than standard, `iteration` when an advisor named no model or ran on a model without bundled rates, or a fallback hop
 * ran on a model without bundled rates, and `fast` when it ran in fast mode on a model without a fast rate.
 */
export type UnpricedReason = "model" | "iteration" | "unnamed" | "fast" | "tier" | "credit";

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
  /** Set exactly when `cost` is null. */
  reason: UnpricedReason | null;
  /** `rateStamp(model)`, or the table's stamp when a share of the request is at another model. */
  rates: string;
  sidechain: boolean;
}

/** One usage object's token counts: a request's top-level `usage`, or one of its `iterations`. */
interface Tokens { input: number; output: number; cacheCreation: number; cacheHour: number; cacheRead: number }

/** A share of a request that one model's rates price, at its fast rate when `fast`. */
interface Share { model: string; tokens: Tokens; fast: boolean }

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeModel(model: string): string {
  return model.replace(/\[[^\]]*\]$/, "").replace(/^(?:(?:us|eu|apac|global)\.)?anthropic[./]/, "")
    .replace(/-v\d+:\d+$/, "").replace(/[-@]\d{8}$/, "").replace(/-latest$/, "")
    .replace(/^claude-.*/, name => name.replace(/(\d)\.(?=\d)/g, "$1-")).replace(/^(claude-(?:sonnet|opus)-4)-0$/, "$1");
}

function tokensOf(usage: Record<string, unknown>): Tokens {
  const cache = object(usage.cache_creation);
  const cacheHour = count(cache.ephemeral_1h_input_tokens);
  return {
    input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheHour,
    cacheCreation: Math.max(count(usage.cache_creation_input_tokens), count(cache.ephemeral_5m_input_tokens) + cacheHour),
  };
}

/** Combines token counts field by field, with `add` for a sum or `Math.max` for the larger of each. */
function combine(all: Tokens[], merge: (left: number, right: number) => number): Tokens {
  const result: Tokens = { input: 0, output: 0, cacheCreation: 0, cacheHour: 0, cacheRead: 0 };
  for (const tokens of all) for (const field of Object.keys(result) as (keyof Tokens)[]) result[field] = merge(result[field], tokens[field]);
  return result;
}

const add = (left: number, right: number) => left + right;

/**
 * Splits a request into the shares Claude Code 2.1.302's cost tracker charges, from the server-side steps the API lists
 * in `usage.iterations`, and returns the tokens the request counts.
 * - The request's own share is its top-level usage at its own model, in its fast mode.
 * - A server-side fallback lists `fallback_message` iterations. When one names a model, the tracker prices the own
 *   share from the hops that name one instead, each at its own model in the request's fast mode. Its reducer charges
 *   only a hop with a model, so a hop that names none costs nothing wherever it falls. It reads only their four counts,
 *   so every cache write of a hop is priced at the 5-minute rate, and when the reply still ended in a refusal, the
 *   last `fallback_message` is free. The stream has already rewritten `message.model` to the model that served the
 *   request, and the tracker files the top-level counts under it.
 * - Each `advisor_message` iteration adds its tokens and a share at its own model, with its own cache split but never
 *   at fast rates: the API leaves advisor tokens out of the top-level counts.
 * - A `message` iteration repeats the top-level counts. When no iteration is a `fallback_message`, a top-level count
 *   below the sum of the iterations other than an advisor's is raised to that sum, so a request never counts fewer
 *   tokens than its steps report. The tracker does not do this; it reads the top-level counts alone.
 */
function splitRequest(usage: Record<string, unknown>, model: string, refused: boolean, fast: boolean): { tokens: Tokens; shares: Share[] } {
  const steps = Array.isArray(usage.iterations) ? usage.iterations.map(object) : [];
  const last = steps.findLastIndex(step => step.type === "fallback_message");
  const summed = combine(last < 0 ? steps.filter(step => step.type !== "advisor_message").map(tokensOf) : [], add);
  const own = combine([tokensOf(usage), summed], Math.max);
  const hop = (step: Record<string, unknown>) => step.type === "fallback_message" && string(step.model) !== "";
  const hops = steps.flatMap((step, index): Share[] => hop(step) && !(refused && index === last)
    ? [{ model: normalizeModel(string(step.model)), tokens: tokensOf({ ...step, cache_creation: undefined }), fast }] : []);
  const advisors = steps.filter(step => step.type === "advisor_message").map((step): Share => ({ model: normalizeModel(string(step.model)), tokens: tokensOf(step), fast: false }));
  const shares = steps.some(hop) ? hops : [{ model, tokens: own, fast }];
  return { tokens: combine([own, ...advisors.map(advisor => advisor.tokens)], add), shares: [...shares, ...advisors] };
}

/**
 * Why a request without a recorded cost has no estimate, or null when it has one. A missing or unrated own model comes
 * first, so the request keeps its "Model not recognized" flag and its model's name in the usage note. Claude Code's
 * tracker never reads `service_tier` and prices priority and batch requests at standard rates, but the API charges more
 * for priority and less for batch, and this table has rates for neither. Claude Code only copies `fallback_credit`:
 * the API decides what a request that presented one is billed, so no rate applies.
 */
function unpriced(usage: Record<string, unknown>, model: string, shares: Share[]): UnpricedReason | null {
  const unrated = shares.filter(share => !priceOf(share.model));
  if (unrated.some(share => share.model === model)) return model ? "model" : "unnamed";
  if (usage.fallback_credit !== undefined && usage.fallback_credit !== null) return "credit";
  if (typeof usage.service_tier === "string" && usage.service_tier !== "standard") return "tier";
  if (unrated.length) return "iteration";
  return shares.some(share => share.fast && !priceOf(share.model)!.fast) ? "fast" : null;
}

/** The cost of `tokens` at `price`; with `fast`, the caller has checked that the price has a fast rate. */
function costOf(price: Price, tokens: Tokens, fast: boolean, geography: number): number {
  const { input, output, cacheCreation, cacheHour, cacheRead } = tokens;
  const longContext = price.longContext && input + cacheCreation + cacheRead > price.longContext.above ? price.longContext : undefined;
  const inputRate = price.input * (longContext?.input ?? 1);
  const outputRate = price.output * (longContext?.output ?? 1);
  return (input * inputRate + output * outputRate + (cacheCreation - cacheHour) * inputRate * 1.25
    + cacheHour * inputRate * 2 + cacheRead * inputRate * (price.cacheRead ?? 0.1)) / 1_000_000 * (fast ? price.fast! : 1) * geography;
}

/** Reads one assistant record's request usage. A copy that names no model is read as `knownModel` when an earlier copy
 *  of the same request named it. */
export function readUsage(raw: Record<string, unknown>, sessionId: string, eventId: string, knownModel = ""): UsageRecord | null {
  const message = object(raw.message);
  if (raw.type !== "assistant" || message.model === syntheticModel) return null;
  const usage = object(message.usage);
  const cache = object(usage.cache_creation);
  const fields = [usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens, cache.ephemeral_5m_input_tokens, cache.ephemeral_1h_input_tokens];
  const recordedCost = typeof raw.costUSD === "number" && Number.isFinite(raw.costUSD) && raw.costUSD >= 0 ? raw.costUSD : null;
  if (!fields.some(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) && recordedCost === null) return null;
  const messageId = string(message.id);
  const requestId = string(raw.requestId) || string(raw.request_id);
  const key = messageId ? JSON.stringify(["message", messageId, requestId || string(raw.sessionId) || sessionId])
    : JSON.stringify(["event", string(raw.sessionId) || sessionId, string(raw.uuid) || eventId]);
  const model = normalizeModel(string(message.model)) || knownModel;
  const fast = usage.speed === "fast" || raw.speed === "fast";
  const request = splitRequest(usage, model, message.stop_reason === "refusal", fast);
  const effort = [message.effort, raw.effort, object(message.output_config).effort, object(raw.output_config).effort]
    .map(value => string(value).trim().toLowerCase()).find(value => isFacetValue(value, 80)) || null;
  const reason = recordedCost === null ? unpriced(usage, model, request.shares) : null;
  // Claude Code applies the request's region to every share, an advisor's and a fallback hop's included.
  const geography = usage.inference_geo === "us" ? 1.1 : 1;
  const cost = recordedCost ?? (reason ? null : request.shares.reduce((sum, share) => sum + costOf(priceOf(share.model)!, share.tokens, share.fast, geography), 0));
  const { input, output, cacheCreation, cacheRead } = request.tokens;
  return {
    key, model, effort, input, output, cacheCreation, cacheRead, cost, recorded: recordedCost !== null, reason,
    rates: request.shares.some(share => share.model !== model) ? tableStamp : rateStamp(model), sidechain: raw.isSidechain === true,
  };
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
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUSD: 0, requests: 0, unpricedRequests: 0, unratedRequests: 0, unratedIterationRequests: 0, unnamedRequests: 0, fastRequests: 0, tierRequests: 0, creditRequests: 0, recordedCostRequests: 0 };
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
  coalesce(sum(reason='iteration'),0) AS unratedIterationRequests, coalesce(sum(reason='unnamed'),0) AS unnamedRequests,
  coalesce(sum(reason='fast'),0) AS fastRequests, coalesce(sum(reason='tier'),0) AS tierRequests, coalesce(sum(reason='credit'),0) AS creditRequests,
  coalesce(sum(recorded),0) AS recordedCostRequests`;
