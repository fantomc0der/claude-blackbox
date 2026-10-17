import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { censusFormat, listLimit, renderCensus } from "../scripts/inspect-format";
import { removeTestDirectory } from "./helpers";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

const secret = "PRIVATE prompt about C:\\work\\orbit";
const at = "2026-10-01T12:00:00.000Z";

async function dataDir(recordings: Record<string, Array<Record<string, unknown> | string>>) {
  const root = await mkdtemp(join(tmpdir(), "blackbox-format-"));
  cleanup.push(() => removeTestDirectory(root));
  for (const [path, lines] of Object.entries(recordings)) {
    const file = join(root, "projects", path);
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, lines.map(line => typeof line === "string" ? line : JSON.stringify(line)).join("\n") + "\n");
  }
  return root;
}

function assistant(id: string, extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return {
    type: "assistant", uuid: `uuid-${id}-${Math.random()}`, sessionId: "session-a", requestId: `request-${id}`, cwd: "C:\\work\\orbit",
    timestamp: at, version: "2.1.300",
    message: {
      id: `msg-${id}`, role: "assistant", model: "anthropic/claude-fable-5.1",
      content: [{ type: "thinking", thinking: secret }, { type: "text", text: secret }],
      usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 5, ...usage },
    },
    ...extra,
  };
}

test("census counts record shapes, usage fields, models, and versions without keeping content", async () => {
  const root = await dataDir({
    "orbit/session-a.jsonl": [
      { type: "user", uuid: "u1", sessionId: "session-a", cwd: "C:\\work\\orbit", timestamp: at, version: "2.1.300", message: { role: "user", content: secret } },
      assistant("one", { requestedModel: "claude-fable-5-1[1m]" }, {
        service_tier: "priority", speed: "fast", inference_geo: "us", fallback_credit: { credit_usd: 1 },
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
        iterations: [{ type: "message", input_tokens: 4, output_tokens: 15 }, { type: "advisor", input_tokens: 6, output_tokens: 15 }],
      }),
      assistant("one", {}, { service_tier: "standard", iterations: [{ type: "message", input_tokens: 10, output_tokens: 20 }] }),
      { type: "system", subtype: "turn_duration", durationMs: 1000, timestamp: at, version: "2.1.300", uuid: "s1" },
      { type: "system", subtype: secret, content: secret, timestamp: at, version: "2.1.300", uuid: "s2" },
      { type: "attachment", attachment: { type: "hook_success", stdout: secret }, timestamp: at, version: "2.1.300", uuid: "a1" },
      { type: "progress", data: { type: "hook_progress", command: secret }, timestamp: "not a time", version: "2.1.300", uuid: "p1" },
      { type: "ai-title", aiTitle: secret, sessionId: "session-a" },
      { type: secret, [secret]: 1 },
      "{not json",
    ],
    "orbit/session-a/subagents/agent-x.jsonl": [
      { type: "user", uuid: "u2", sessionId: "session-a", timestamp: at, message: { role: "user", content: [{ type: "text", text: secret }] } },
      assistant("two", { version: "2.1.301", isSidechain: true }, { fallback_credit: "fc_token_value" }),
    ],
  });
  const census = await censusFormat(root);

  expect(census.files).toEqual({ total: 2, main: 1, subagent: 1, unreadable: 0 });
  expect(census.lines).toEqual({ records: 11, malformed: 1 });
  expect(census.types.user).toMatchObject({ records: 2, recordings: 2, withoutTimestamp: 0, withoutVersion: 1, contentBlocks: { "(string)": 1, text: 1 } });
  expect(census.types.user!.keys).toMatchObject({ cwd: 1, message: 2, version: 1 });
  expect(census.types.assistant).toMatchObject({ records: 3, recordings: 2, contentBlocks: { thinking: 3, text: 3 } });
  expect(census.types.assistant!.keys.requestedModel).toBe(1);
  expect(census.types.system!.subtypes).toEqual({ "(unlisted string)": 1, turn_duration: 1 });
  expect(census.types.attachment).toMatchObject({ subtypes: { hook_success: 1 }, payloadKeys: { stdout: 1, type: 1 } });
  expect(census.types.progress).toMatchObject({ withoutTimestamp: 1, subtypes: { hook_progress: 1 }, payloadKeys: { command: 1, type: 1 } });
  expect(census.types["ai-title"]).toMatchObject({ records: 1, withoutTimestamp: 1, withoutVersion: 1 });
  expect(census.types["(unlisted string)"]!.keys).toEqual({ "(unlisted key)": 1, type: 1 });
  expect(census.withoutVersion).toEqual({ user: 1 });

  expect(census.usage).toMatchObject({
    records: 3, requests: 2, fallbackCreditNonNull: 2, fallbackCreditKeys: { "(string)": 1, credit_usd: 1 },
    serviceTier: { "(missing)": 1, priority: 1, standard: 1 }, speed: { "(missing)": 2, fast: 1 }, inferenceGeo: { "(missing)": 2, us: 1 },
    nestedKeys: { cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 1 } },
  });
  expect(census.usage.iterations).toMatchObject({
    records: 2, multiple: 1, differing: 1, lengths: { 1: 1, 2: 1 }, sumAbove: { output_tokens: 1 }, sumBelow: {},
    entryTypes: { message: 2, advisor: 1 },
  });
  expect(census.models.raw).toEqual({ "anthropic/claude-fable-5.1": 3 });
  expect(census.models.normalized).toEqual({ "claude-fable-5-1": 3 });
  expect(census.models.requestedModel).toEqual({ "assistant.requestedModel": 1 });
  expect(census.models.requestedModelValues).toEqual({ "claude-fable-5-1[1m]": 1 });
  expect(census.versions).toEqual({ "2.1.300": { records: 7, recordings: 1 }, "2.1.301": { records: 1, recordings: 1 } });

  const printed = JSON.stringify(census) + renderCensus(census);
  expect(printed).not.toContain("PRIVATE");
  expect(printed).not.toContain("orbit");
  expect(printed).not.toContain("fc_token");
});

test("census lists at most the limit of distinct values and sums the rest", async () => {
  const extra = 5;
  const records = Array.from({ length: listLimit + extra }, (_, index) => ({ type: "system", subtype: `kind_${String(index).padStart(2, "0")}`, timestamp: at, version: `2.0.${index}` }));
  const census = await censusFormat(await dataDir({ "orbit/session-b.jsonl": records, "orbit/session-c.jsonl": records.slice(0, 1) }));
  const subtypes = census.types.system!.subtypes!;
  expect(Object.keys(subtypes)).toHaveLength(listLimit + 1);
  expect(subtypes[`+${extra} more`]).toBe(extra);
  expect(Object.keys(census.versions)).toHaveLength(listLimit + 1);
  expect(census.versions[`2.0.${listLimit + extra - 1}`]).toEqual({ records: 1, recordings: 1 });
  expect(census.versions["2.0.0"]).toBeUndefined();
  expect(census.versions[`+${extra} more`]).toEqual({ records: extra + 1, recordings: 2 });
});

test("the command line reads the --dir directory and prints JSON", async () => {
  const root = await dataDir({ "orbit/session-c.jsonl": [assistant("three")] });
  const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "scripts", "inspect-format.ts"), "--dir", root, "--json"]);
  expect(run.exitCode).toBe(0);
  const census = JSON.parse(run.stdout.toString());
  expect(census.files.total).toBe(1);
  expect(census.types.assistant.records).toBe(1);
});
