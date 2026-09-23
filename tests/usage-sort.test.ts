import { expect, test } from "bun:test";
import { sortUsage } from "../src/client/lib/usage-sort";
import { emptyUsage } from "../src/server/usage";

test("usage sorting is metric-first regardless of missing effort and never treats unknown cost as zero", () => {
  const rows = [
    { model: "unpriced", effort: "high", usage: { ...emptyUsage(), requests: 1, unpricedRequests: 1, totalTokens: 5000 } },
    { model: "cheap", effort: "high", usage: { ...emptyUsage(), requests: 1, costUSD: 1, totalTokens: 2000 } },
    { model: "expensive", effort: null, usage: { ...emptyUsage(), requests: 1, costUSD: 10, totalTokens: 1000 } },
    { model: "zero", effort: null, usage: { ...emptyUsage(), requests: 1, totalTokens: 0 } },
    { model: "missing", effort: null, usage: emptyUsage() },
  ];
  const name = (row: typeof rows[number]) => row.model;
  expect(sortUsage(rows, "cost", name).map(name)).toEqual(["expensive", "cheap", "zero", "unpriced", "missing"]);
  expect(sortUsage(rows, "tokens", name).map(name)).toEqual(["unpriced", "cheap", "expensive", "zero", "missing"]);
  expect(sortUsage(rows, "name", name).map(name)).toEqual(["cheap", "expensive", "missing", "unpriced", "zero"]);
  expect(rows[0].model).toBe("unpriced");
});
