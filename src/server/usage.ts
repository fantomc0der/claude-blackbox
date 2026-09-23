import type { UsageSummary } from "../shared/types";
import { object, string } from "./normalize";

interface Price { input: number; output: number; cacheRead?: number; longContext?: boolean; fast?: number }

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
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15, longContext: true },
  "claude-sonnet-4": { input: 3, output: 15, longContext: true },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-7-sonnet": { input: 3, output: 15 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
};

export interface UsageRecord {
  key: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  cost: number | null;
  recorded: boolean;
  sidechain: boolean;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function readUsage(raw: Record<string, unknown>, sessionId: string, eventId: string): UsageRecord | null {
  const message = object(raw.message);
  if (raw.type !== "assistant" || message.model === "<synthetic>") return null;
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
  const model = string(message.model).replace(/\[[^\]]*\]$/, "").replace(/^(?:(?:us|eu|apac|global)\.)?anthropic\./, "")
    .replace(/-v\d+:\d+$/, "").replace(/[-@]\d{8}$/, "").replace(/-latest$/, "").replace(/^(claude-(?:sonnet|opus)-4)-0$/, "$1");
  const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
  let cost = recordedCost;
  if (cost === null && price) {
    const fast = usage.speed === "fast" || raw.speed === "fast";
    if (!fast || price.fast) {
      const longContext = price.longContext && input + cacheCreation + cacheRead > 200_000;
      const inputRate = price.input * (longContext ? 2 : 1);
      const outputRate = price.output * (longContext ? 1.5 : 1);
      const geography = usage.inference_geo === "us" ? 1.1 : 1;
      cost = (input * inputRate + output * outputRate + (cacheCreation - cacheHour) * inputRate * 1.25
        + cacheHour * inputRate * 2 + cacheRead * inputRate * (price.cacheRead ?? 0.1)) / 1_000_000 * (fast ? price.fast! : 1) * geography;
    }
  }
  return { key, input, output, cacheCreation, cacheRead, cost, recorded: recordedCost !== null, sidechain: raw.isSidechain === true };
}

export function emptyUsage(): UsageSummary {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0, costUSD: 0, requests: 0, unpricedRequests: 0, recordedCostRequests: 0 };
}

export const usageColumns = `coalesce(sum(input),0) AS inputTokens, coalesce(sum(output),0) AS outputTokens,
  coalesce(sum(cache_creation),0) AS cacheCreationTokens, coalesce(sum(cache_read),0) AS cacheReadTokens,
  coalesce(sum(input+output+cache_creation+cache_read),0) AS totalTokens, coalesce(sum(cost),0) AS costUSD,
  count(*) AS requests, coalesce(sum(cost IS NULL),0) AS unpricedRequests, coalesce(sum(recorded),0) AS recordedCostRequests`;
