import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { censusFormat, compareVersions, listLimit, renderCensus, resolveDataDir } from "../scripts/inspect-format";
import { removeTestDirectory } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

const secret = "PRIVATE prompt about C:\\work\\orbit";
const at = "2026-10-01T12:00:00.000Z";
// Values and keys that name a person, a session, a request, an account, or a credit. Several are single tokens that a
// loose identifier check would accept, so none of them may appear in the census.
const sentinels = ["PRIVATE", "orbit", "alicekey", "sessionkey", "SENTINEL", "3f2a9c1e", "c0ffee12", "123456789012", "toolu_", "file123456", "fc_token", "Priority Tier", "k39"];

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "blackbox-format-"));
  cleanup.push(() => removeTestDirectory(root));
  return root;
}

async function dataDir(recordings: Record<string, Array<Record<string, unknown> | string>>) {
  const root = await temporary();
  for (const [path, lines] of Object.entries(recordings)) {
    const file = join(root, "projects", path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, lines.map(line => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n");
  }
  return root;
}

function assistant(id: string, extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}, model = "claude-haiku-4-5-20251001") {
  return {
    type: "assistant", uuid: `3f2a9c1e-7b4d-4e8a-9c2f-${id.padStart(12, "0")}`, sessionId: "sessionkey", requestId: `req_011SENTINEL${id}`,
    cwd: "C:\\work\\alicekey", timestamp: at, version: "2.1.300",
    message: {
      id: `msg_01SENTINEL${id}`, role: "assistant", model,
      content: [{ type: "thinking", thinking: secret }, { type: "text", text: secret }],
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, ...usage },
    },
    ...extra,
  };
}

function expectNothingPrivate(printed: string, root: string) {
  for (const sentinel of [...sentinels, root, "blackbox-format-"]) expect(printed).not.toContain(sentinel);
}

test("census counts record shapes, usage fields, models, and versions without keeping content or ids", async () => {
  const root = await dataDir({
    "orbit/session-a.jsonl": [
      { type: "user", uuid: "3f2a9c1e-0000-4000-8000-000000000001", sessionId: "sessionkey", cwd: "C:\\work\\alicekey", timestamp: at, version: "2.1.300", message: { role: "user", content: secret } },
      // A partial snapshot of request one: the index keeps the later record with the full usage, so its iteration sum
      // above the partial output count must not count as a difference.
      assistant("one", { requestedModel: "/home/alicekey/acme", advisorModel: "alicekey@example.com" }, {
        output_tokens: 1, service_tier: "priority", speed: "fast", inference_geo: "us", fallback_credit: { credit_usd: 1 },
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, ["__proto__"]: { a: 1 },
        iterations: [{ type: "message", input_tokens: 10, output_tokens: 20 }],
      }),
      assistant("one", {}, { service_tier: "standard", iterations: [{ type: "message", input_tokens: 10, output_tokens: 20 }] }),
      assistant("two", {}, {
        input_tokens: 4, output_tokens: 30, service_tier: "Priority Tier",
        iterations: [{ type: "message", input_tokens: 4, output_tokens: 15 }, { type: "advisor_message", input_tokens: 9, output_tokens: 15 }],
      }, "arn:aws:bedrock:us-east-1:123456789012:x"),
      { type: "system", subtype: "turn_duration", durationMs: 1000, timestamp: at, version: "2.1.300", uuid: "s1" },
      { type: "system", subtype: "C:/Users/alicekey", timestamp: at, version: "2.1.300", uuid: "s2" },
      { type: "system", subtype: "toolu_01ABCDEFGH", timestamp: at, version: "2.1.300", uuid: "s3" },
      { type: "attachment", attachment: { type: "hook_success", stdout: secret, toolu_01ABCDEFGH: 1, "3f2a9c1e7b4d5e6f": 1, file123456: 1, c0ffee12ab34: 1 }, timestamp: at, version: "2.1.300", uuid: "a1" },
      { type: "attachment", attachment: { type: "file123456" }, timestamp: at, version: "2.1.300", uuid: "a2" },
      { type: "progress", data: { type: "hook_progress", ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, index])) }, timestamp: "not a time", version: "not-a-version", uuid: "p1" },
      { type: "ai-title", aiTitle: secret, sessionId: "sessionkey" },
      { type: secret, [secret]: 1 },
      "{not json",
    ],
    "orbit/session-a/subagents/agent-x.jsonl": [
      { type: "user", uuid: "u2", sessionId: "sessionkey", timestamp: at, message: { role: "user", content: [{ type: "text", text: secret }] } },
      assistant("three", { version: "2.1.301", isSidechain: true }, { input_tokens: 1, output_tokens: 2, fallback_credit: "fc_token_value" }, "c0ffee12ab34"),
      { type: "system", subtype: "informational", timestamp: at, version: "2.1.300-beta.1", uuid: "s4" },
    ],
  });
  const census = await censusFormat(root);

  expect(census.source).toBe("--dir");
  expect(census.files).toEqual({ total: 2, main: 1, subagent: 1, unreadable: 0 });
  expect(census.lines).toEqual({ records: 15, malformed: 1 });
  expect(census.types.user).toMatchObject({ records: 2, recordings: 2, withoutTimestamp: 0, withoutVersion: 1, contentBlocks: { "(string)": 1, text: 1 } });
  expect(census.types.user!.keys).toMatchObject({ cwd: 1, message: 2, version: 1 });
  expect(census.types.assistant).toMatchObject({ records: 4, recordings: 2, contentBlocks: { thinking: 4, text: 4 } });
  expect(census.types.assistant!.keys).toMatchObject({ requestedModel: 1, advisorModel: 1 });
  expect(census.types.system!.subtypes).toEqual({ "(unlisted string)": 2, informational: 1, turn_duration: 1 });
  expect(census.types.attachment).toMatchObject({ subtypes: { hook_success: 1, "(unlisted string)": 1 }, payloadKeys: { "(unlisted key)": 4, stdout: 1, type: 2 } });
  expect(census.types.progress).toMatchObject({ withoutTimestamp: 1, subtypes: { hook_progress: 1 }, payloadKeys: { "(map)": 1 } });
  expect(census.types["ai-title"]).toMatchObject({ records: 1, withoutTimestamp: 1, withoutVersion: 1 });
  expect(census.types["(unlisted string)"]!.keys).toEqual({ "(unlisted key)": 1, type: 1 });
  expect(census.withoutVersion).toEqual({ user: 1 });

  expect(census.usage).toMatchObject({
    records: 4, requests: 3, fallbackCreditNonNull: 2, fallbackCreditKeys: { "(string)": 1, credit_usd: 1 },
    serviceTier: { "(missing)": 1, "(unlisted string)": 1, priority: 1, standard: 1 }, speed: { "(missing)": 3, fast: 1 }, inferenceGeo: { "(missing)": 3, us: 1 },
  });
  expect(census.usage.nestedKeys).toMatchObject({ cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 1 }, fallback_credit: { credit_usd: 1 } });
  expect(Object.hasOwn(census.usage.nestedKeys, "__proto__")).toBe(true);
  expect(Object.hasOwn(census.usage.keys, "__proto__")).toBe(true);
  expect(census.usage.iterations).toEqual({
    requests: 2, lengths: { 1: 1, 2: 1 }, multiple: 1, differing: 1, sumAbove: { input_tokens: 1 }, sumBelow: {},
    entryKeys: { input_tokens: 3, output_tokens: 3, type: 3 }, entryTypes: { message: 2, advisor_message: 1 },
  });
  expect(census.models.raw).toEqual({ "claude-haiku-4-5-20251001": 2, "(arn)": 1, "(unlisted string)": 1 });
  expect(census.models.normalized).toEqual({ "claude-haiku-4-5": 2, "(arn)": 1, "(unlisted string)": 1 });
  expect(census.models).toMatchObject({
    requestedModel: { "assistant.requestedModel": 1 }, requestedModelValues: { "(unlisted string)": 1 },
    advisorModel: { "assistant.advisorModel": 1 }, advisorModelValues: { "(unlisted string)": 1 },
  });
  expect(Object.keys(census.versions)).toEqual(["2.1.300-beta.1", "2.1.300", "2.1.301", "(unlisted string)"]);
  expect(census.versions["2.1.300"]).toEqual({ records: 9, recordings: 1 });

  expectNothingPrivate(JSON.stringify(census) + renderCensus(census), root);
});

test("census lists at most the limit of distinct values and sums the rest", async () => {
  const extra = 5;
  const records = Array.from({ length: listLimit + extra }, (_, index) => ({ type: "system", subtype: `kind_${String(index).padStart(2, "0")}`, timestamp: at, version: `2.0.${index}` }));
  const types = Array.from({ length: listLimit + 2 }, (_, index) => ({ type: `type_${String(index).padStart(2, "0")}`, timestamp: at }));
  const census = await censusFormat(await dataDir({
    "orbit/session-b.jsonl": [...records, ...types.slice(0, listLimit)],
    "orbit/session-c.jsonl": [records[0]!, ...types.slice(listLimit)],
  }));
  const subtypes = census.types.system!.subtypes!;
  expect(Object.keys(subtypes)).toHaveLength(listLimit + 1);
  expect(subtypes[`+${extra} more`]).toBe(extra);
  expect(Object.keys(census.types)).toHaveLength(listLimit + 1);
  expect(census.types["+3 more"]).toMatchObject({ records: 3, recordings: 2 });
  expect(Object.keys(census.versions)).toHaveLength(listLimit + 1);
  expect(census.versions[`2.0.${listLimit + extra - 1}`]).toEqual({ records: 1, recordings: 1 });
  expect(census.versions["2.0.0"]).toBeUndefined();
  expect(census.versions[`+${extra} more`]).toEqual({ records: extra + 1, recordings: 2 });
});

test("census bounds the nested usage objects it lists by how often they appear", async () => {
  const objects = (from: number) => Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`obj_${String(from + index).padStart(2, "0")}`, { x: 1 }]));
  const census = await censusFormat(await dataDir({ "orbit/session-d.jsonl": [assistant("four", {}, objects(0)), assistant("five", {}, objects(26))] }));
  expect(Object.keys(census.usage.nestedKeys)).toHaveLength(listLimit + 1);
  expect(census.usage.nestedKeys.obj_49).toEqual({ x: 1 });
  expect(census.usage.nestedKeys.obj_50).toBeUndefined();
  expect(census.usage.nestedKeys["+2 more"]).toEqual({ objects: 2 });
});

test("versions sort semantically, prereleases before their release, placeholders last", () => {
  const sorted = ["(unlisted string)", "2.1.10", "2.1.9", "2.1.10-beta.2", "2.1.10-beta.10", "2.1.10-alpha", "(null)"].sort(compareVersions);
  expect(sorted).toEqual(["2.1.9", "2.1.10-alpha", "2.1.10-beta.2", "2.1.10-beta.10", "2.1.10", "(null)", "(unlisted string)"]);
});

test("the data directory comes from --dir, then CLAUDE_CONFIG_DIR, then the default, and is never printed", async () => {
  expect(resolveDataDir("x", { CLAUDE_CONFIG_DIR: "y" }).source).toBe("--dir");
  expect(resolveDataDir(undefined, { CLAUDE_CONFIG_DIR: "y" })).toEqual({ path: resolve("y"), source: "CLAUDE_CONFIG_DIR" });
  expect(resolveDataDir("", {}).source).toBe("default");

  const root = await dataDir({ "orbit/session-e.jsonl": [assistant("six")] });
  const empty = await temporary();
  const script = join(import.meta.dir, "..", "scripts", "inspect-format.ts");
  // CLAUDE_CONFIG_DIR always names a temporary directory, so a regression in argument handling never scans real data.
  const run = (args: string[], configDir: string) => Bun.spawnSync([process.execPath, script, ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } });

  const json = run(["--dir", root, "--json"], empty);
  expect(json.exitCode).toBe(0);
  expect(JSON.parse(json.stdout.toString())).toMatchObject({ source: "--dir", files: { total: 1 }, types: { assistant: { records: 1 } } });

  const text = run([], root);
  expect(text.exitCode).toBe(0);
  const output = text.stdout.toString();
  expect(output).toContain("Claude data directory: from CLAUDE_CONFIG_DIR");
  expect(output).toContain("Files: 1 (main 1, subagent 0, unreadable 0)");
  for (const printed of [json.stdout.toString(), output]) expectNothingPrivate(printed, root);
});
