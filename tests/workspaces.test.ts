import { describe, expect, test } from "bun:test";
import type { Workspace } from "../src/shared/types";
import { emptyUsage } from "../src/server/usage";
import { visibleWorkspaces, workspaceSort } from "../src/client/lib/workspaces";

function workspace(name: string, count: number, costUSD: number): Workspace {
  return { id: `/work/${name}`, name, paths: [`/work/${name}`], count, grouped: false, usage: { ...emptyUsage(), requests: 1, costUSD } };
}

describe("workspace navigation", () => {
  const entries = [workspace("orbit-10", 12, 1), workspace("Zeta", 20, 0), workspace("Orbit-2", 3, 10), workspace("alpha", 3, 10)];
  const names = (sort: "sessions" | "cost" | "name", filter = "") => visibleWorkspaces(entries, sort, filter).map(entry => entry.name);

  test("defaults safely and validates saved preferences", () => {
    for (const value of [null, "", "invalid", "sessions", "__proto__"]) expect(workspaceSort(value)).toBe("sessions");
    expect(workspaceSort("cost")).toBe("cost");
    expect(workspaceSort("name")).toBe("name");
  });

  test("sorts by count, all-time cost or natural folder name without mutating the catalog", () => {
    const original = entries.slice();
    expect(names("sessions")).toEqual(["Zeta", "orbit-10", "alpha", "Orbit-2"]);
    expect(names("cost")).toEqual(["alpha", "Orbit-2", "orbit-10", "Zeta"]);
    expect(names("name")).toEqual(["alpha", "Orbit-2", "orbit-10", "Zeta"]);
    expect(entries).toEqual(original);
  });

  test("matches names and any grouped path, case-insensitively with either path separator", () => {
    expect(names("name", " ORBIT- ")).toEqual(["Orbit-2", "orbit-10"]);
    const group = { ...workspace("Shared project", 4, 50), grouped: true, paths: ["C:\\work\\orbit-main", "/work/orbit-clone"] };
    for (const filter of ["shared", "C:/WORK/orbit", "\\work\\orbit-clone"]) {
      expect(visibleWorkspaces([group], "name", filter)).toEqual([group]);
    }
    expect(visibleWorkspaces([group], "cost", "absent")).toEqual([]);
    expect(visibleWorkspaces([], "name", "")).toEqual([]);
  });

  test("sorts real zero cost before unknown costs and uses deterministic tie breakers", () => {
    const missing = { ...workspace("A missing", 1, 0), usage: emptyUsage() };
    const unpriced = { ...workspace("B unpriced", 1, 0), usage: { ...emptyUsage(), requests: 1, unpricedRequests: 1 } };
    const zero = workspace("C zero", 1, 0);
    const partial = { ...workspace("D partial", 1, 2), usage: { ...emptyUsage(), requests: 2, unpricedRequests: 1, costUSD: 2 } };
    expect(visibleWorkspaces([missing, unpriced, zero, partial], "cost", "")).toEqual([partial, zero, missing, unpriced]);
    const first = { ...zero, id: "/clone-a" }, second = { ...zero, id: "/clone-b" };
    for (const sort of ["sessions", "cost", "name"] as const) {
      expect(visibleWorkspaces([second, first], sort, "")).toEqual([first, second]);
    }
  });
});
