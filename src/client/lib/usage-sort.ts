import type { UsageSummary } from "../../shared/types";

export type UsageSort = "cost" | "tokens" | "name";
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortUsage<T extends { usage: UsageSummary }>(rows: T[], sort: UsageSort, name: (row: T) => string): T[] {
  return [...rows].sort((left, right) => {
    const byName = names.compare(name(left), name(right)) || name(left).localeCompare(name(right));
    if (sort === "name") return byName;
    if (sort === "tokens") return Number(right.usage.requests > 0) - Number(left.usage.requests > 0) || right.usage.totalTokens - left.usage.totalTokens || byName;
    const priced = (row: T) => row.usage.requests > row.usage.unpricedRequests;
    return Number(priced(right)) - Number(priced(left)) || right.usage.costUSD - left.usage.costUSD || right.usage.totalTokens - left.usage.totalTokens || byName;
  });
}
