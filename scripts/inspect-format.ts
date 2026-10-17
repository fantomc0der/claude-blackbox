#!/usr/bin/env bun
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { readJsonLines } from "../src/server/jsonl";
import { object } from "../src/server/normalize";
import { normalizeModel, readUsage } from "../src/server/usage";

/**
 * A read-only census of the record shapes in a Claude data directory, for noticing Claude Code format changes. It
 * reports key names, short enumerated identifiers (record type, subtype, block type, model, version, service tier),
 * and counts. It never stores or prints a value that could be recorded content: anything that does not look like an
 * identifier is counted under a placeholder, and every listed set stops at `listLimit` entries.
 */

/** The most distinct names or values listed for any one set; the rest are summed into one "+N more" entry. */
export const listLimit = 50;

/** Record types that carry a conversation turn and are expected to name the Claude Code version that wrote them. */
export const transcriptTypes = ["user", "assistant", "system", "attachment", "progress"] as const;

const tokenFields = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;

export type Counts = Record<string, number>;

export interface TypeCensus {
  records: number;
  /** Recordings with at least one record of this type. */
  recordings: number;
  withoutTimestamp: number;
  withoutVersion: number;
  /** Top-level key names, sorted, with the number of records that have each. */
  keys: Counts;
  /** `subtype` of a `system` record, `attachment.type` of an `attachment`, `data.type` of a `progress` record. */
  subtypes?: Counts;
  /** Key names of the object that carries the subtype: `attachment` or `data`. */
  payloadKeys?: Counts;
  /** Key names of `message` on `user` and `assistant` records. */
  messageKeys?: Counts;
  /** `message.content` block types; a plain string content counts as `(string)`. */
  contentBlocks?: Counts;
}

export interface IterationCensus {
  /** Usage objects with an `iterations` array. */
  records: number;
  lengths: Counts;
  /** Usage objects with more than one iteration. */
  multiple: number;
  /** Usage objects whose iteration sum differs from the top-level count in at least one token field. */
  differing: number;
  /** Per token field, how often the iteration sum is above or below the top-level count. */
  sumAbove: Counts;
  sumBelow: Counts;
  entryKeys: Counts;
  entryTypes: Counts;
}

export interface UsageCensus {
  /** Assistant records with a `message.usage` object; Claude Code repeats one request's usage on each of its records. */
  records: number;
  /** Distinct requests among them, keyed the way the index deduplicates usage. */
  requests: number;
  keys: Counts;
  /** Key names inside each object-valued usage field, such as `cache_creation` or `output_tokens_details`. */
  nestedKeys: Record<string, Counts>;
  iterations: IterationCensus;
  serviceTier: Counts;
  fallbackCreditNonNull: number;
  fallbackCreditKeys: Counts;
  speed: Counts;
  inferenceGeo: Counts;
}

export interface ModelCensus {
  /** Raw `message.model` of assistant records. */
  raw: Counts;
  normalized: Counts;
  /** Where `requestedModel` and `advisorModel` appear, as `<record type>.<path>`. */
  requestedModel: Counts;
  advisorModel: Counts;
  requestedModelValues: Counts;
  advisorModelValues: Counts;
}

export interface VersionCensus {
  records: number;
  recordings: number;
}

export interface FormatCensus {
  directory: string;
  files: { total: number; main: number; subagent: number; unreadable: number };
  /** Directories under `projects` that could not be listed. */
  unlistedDirectories: number;
  lines: { records: number; malformed: number };
  types: Record<string, TypeCensus>;
  usage: UsageCensus;
  models: ModelCensus;
  versions: Record<string, VersionCensus>;
  /** Records of each transcript type without a `version`. */
  withoutVersion: Counts;
}

/** The data directory `src/server/cli.ts` reads for the same `--dir` argument. */
export function resolveDataDir(dir?: string): string {
  return resolve(dir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
}

// Only enumerated identifiers are ever printed. A value that does not look like one, such as free text or a path with
// spaces, is counted under a placeholder so an unexpected archive cannot leak its content through the census.
function label(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (typeof value !== "string") return `(${value === null ? "null" : Array.isArray(value) ? "array" : typeof value})`;
  return /^[\w.:@<>[\]/+-]{1,64}$/.test(value) ? value : "(unlisted string)";
}

function keyName(key: string): string {
  return /^[A-Za-z_$][\w$-]{0,63}$/.test(key) ? key : "(unlisted key)";
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function bumpKeys(map: Map<string, number>, value: unknown): void {
  for (const key of Object.keys(object(value))) bump(map, keyName(key));
}

function bounded(map: Map<string, number>, order: "count" | "name" = "count"): Counts {
  const byCount = [...map].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const kept = byCount.slice(0, listLimit);
  if (order === "name") kept.sort(([a], [b]) => a.localeCompare(b));
  const result: Counts = Object.fromEntries(kept);
  const rest = byCount.slice(listLimit);
  if (rest.length) result[`+${rest.length} more`] = rest.reduce((sum, [, count]) => sum + count, 0);
  return result;
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function hasTimestamp(raw: Record<string, unknown>): boolean {
  return typeof raw.timestamp === "string" && Number.isFinite(Date.parse(raw.timestamp));
}

function isSubagent(path: string): boolean {
  return path.includes(`${sep}subagents${sep}`) || basename(path).startsWith("agent-");
}

async function discover(directory: string, files: string[], failures: { count: number }, depth = 0): Promise<void> {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (object(error).code !== "ENOENT") failures.count++;
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await discover(path, files, failures, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
}

class TypeTally {
  records = 0;
  recordings = 0;
  withoutTimestamp = 0;
  withoutVersion = 0;
  keys = new Map<string, number>();
  subtypes = new Map<string, number>();
  payloadKeys = new Map<string, number>();
  messageKeys = new Map<string, number>();
  contentBlocks = new Map<string, number>();

  result(type: string): TypeCensus {
    const census: TypeCensus = {
      records: this.records, recordings: this.recordings, withoutTimestamp: this.withoutTimestamp,
      withoutVersion: this.withoutVersion, keys: bounded(this.keys, "name"),
    };
    if (type === "system" || type === "attachment" || type === "progress") census.subtypes = bounded(this.subtypes);
    if (type === "attachment" || type === "progress") census.payloadKeys = bounded(this.payloadKeys, "name");
    if (type === "user" || type === "assistant") {
      census.messageKeys = bounded(this.messageKeys, "name");
      census.contentBlocks = bounded(this.contentBlocks);
    }
    return census;
  }
}

/** Scans every `projects/**\/*.jsonl` recording under `dataDir` read-only and counts the shapes it finds. */
export async function censusFormat(dataDir: string): Promise<FormatCensus> {
  const directory = resolve(dataDir);
  const files: string[] = [];
  const failures = { count: 0 };
  await discover(join(directory, "projects"), files, failures);
  files.sort();

  const types = new Map<string, TypeTally>();
  const tally = (type: string) => types.get(type) ?? types.set(type, new TypeTally()).get(type)!;
  const versions = new Map<string, VersionCensus>();
  const fileVersions: Set<string>[] = [];
  const withoutVersion = new Map<string, number>();
  const lines = { records: 0, malformed: 0 };
  const counts = { total: files.length, main: 0, subagent: 0, unreadable: 0 };
  const usage = {
    records: 0, requests: new Set<string>(), keys: new Map<string, number>(), nested: new Map<string, Map<string, number>>(),
    serviceTier: new Map<string, number>(), fallbackCreditNonNull: 0, fallbackCreditKeys: new Map<string, number>(),
    speed: new Map<string, number>(), inferenceGeo: new Map<string, number>(),
  };
  const iterations = {
    records: 0, lengths: new Map<string, number>(), multiple: 0, differing: 0, sumAbove: new Map<string, number>(),
    sumBelow: new Map<string, number>(), entryKeys: new Map<string, number>(), entryTypes: new Map<string, number>(),
  };
  const models = {
    raw: new Map<string, number>(), normalized: new Map<string, number>(), requestedModel: new Map<string, number>(),
    advisorModel: new Map<string, number>(), requestedModelValues: new Map<string, number>(), advisorModelValues: new Map<string, number>(),
  };

  for (const path of files) {
    if (isSubagent(path)) counts.subagent++;
    else counts.main++;
    const seenTypes = new Set<string>();
    const seenVersions = new Set<string>();
    try {
      const { size } = await stat(path);
      let sequence = 0;
      for await (const line of readJsonLines(path, 0, size)) {
        if (line.malformed) lines.malformed++;
        const raw = line.value;
        if (!raw) continue;
        lines.records++;
        const type = label(raw.type);
        const entry = tally(type);
        entry.records++;
        seenTypes.add(type);
        if (!hasTimestamp(raw)) entry.withoutTimestamp++;
        bumpKeys(entry.keys, raw);
        if (raw.version === undefined) {
          entry.withoutVersion++;
          if ((transcriptTypes as readonly string[]).includes(type)) bump(withoutVersion, type);
        } else {
          const version = label(raw.version);
          const known = versions.get(version) ?? versions.set(version, { records: 0, recordings: 0 }).get(version)!;
          known.records++;
          seenVersions.add(version);
        }
        if (type === "system") bump(entry.subtypes, label(raw.subtype));
        if (type === "attachment") {
          bump(entry.subtypes, label(object(raw.attachment).type));
          bumpKeys(entry.payloadKeys, raw.attachment);
        }
        if (type === "progress") {
          bump(entry.subtypes, label(object(raw.data).type));
          bumpKeys(entry.payloadKeys, raw.data);
        }
        const message = object(raw.message);
        if (type === "user" || type === "assistant") {
          bumpKeys(entry.messageKeys, raw.message);
          if (typeof message.content === "string") bump(entry.contentBlocks, "(string)");
          else if (Array.isArray(message.content)) for (const block of message.content) bump(entry.contentBlocks, label(object(block).type));
          else bump(entry.contentBlocks, label(message.content));
        }
        for (const [field, locations, values] of [["requestedModel", models.requestedModel, models.requestedModelValues], ["advisorModel", models.advisorModel, models.advisorModelValues]] as const) {
          if (field in raw) { bump(locations, `${type}.${field}`); bump(values, label(raw[field])); }
          if (field in message) { bump(locations, `${type}.message.${field}`); bump(values, label(message[field])); }
        }
        if (type === "assistant") {
          bump(models.raw, label(message.model));
          if (typeof message.model === "string") bump(models.normalized, label(normalizeModel(message.model)));
          const used = readUsage(raw, path, `${path}:${sequence}`);
          if (used) usage.requests.add(used.key);
        }
        sequence++;
        if (type !== "assistant" || !message.usage || typeof message.usage !== "object" || Array.isArray(message.usage)) continue;
        const fields = object(message.usage);
        usage.records++;
        for (const [key, value] of Object.entries(fields)) {
          const name = keyName(key);
          bump(usage.keys, name);
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const nested = usage.nested.get(name) ?? usage.nested.set(name, new Map()).get(name)!;
            bumpKeys(nested, value);
          }
        }
        bump(usage.serviceTier, label(fields.service_tier));
        bump(usage.speed, label(fields.speed));
        bump(usage.inferenceGeo, label(fields.inference_geo));
        if (fields.fallback_credit !== undefined && fields.fallback_credit !== null) {
          usage.fallbackCreditNonNull++;
          // A credit may be a token, so a value that is not an object is counted by its type only.
          const credit = fields.fallback_credit;
          if (typeof credit === "object" && !Array.isArray(credit)) bumpKeys(usage.fallbackCreditKeys, credit);
          else bump(usage.fallbackCreditKeys, `(${Array.isArray(credit) ? "array" : typeof credit})`);
        }
        if (!Array.isArray(fields.iterations)) continue;
        const steps = fields.iterations.map(object);
        iterations.records++;
        bump(iterations.lengths, String(steps.length));
        if (steps.length > 1) iterations.multiple++;
        let differs = false;
        for (const step of steps) {
          bumpKeys(iterations.entryKeys, step);
          if (step.type !== undefined) bump(iterations.entryTypes, label(step.type));
        }
        for (const field of tokenFields) {
          if (!steps.some(step => field in step)) continue;
          const sum = steps.reduce((total, step) => total + tokenCount(step[field]), 0);
          const top = tokenCount(fields[field]);
          if (sum > top) bump(iterations.sumAbove, field);
          if (sum < top) bump(iterations.sumBelow, field);
          if (sum !== top) differs = true;
        }
        if (differs) iterations.differing++;
      }
    } catch {
      counts.unreadable++;
    }
    for (const type of seenTypes) types.get(type)!.recordings++;
    for (const version of seenVersions) versions.get(version)!.recordings++;
    fileVersions.push(seenVersions);
  }

  const sortedTypes = [...types].sort(([a, x], [b, y]) => y.records - x.records || a.localeCompare(b));
  const typeCensus: Record<string, TypeCensus> = {};
  for (const [type, entry] of sortedTypes.slice(0, listLimit)) typeCensus[type] = entry.result(type);
  const restTypes = sortedTypes.slice(listLimit);
  if (restTypes.length) {
    const rest = new TypeTally();
    for (const [, entry] of restTypes) { rest.records += entry.records; rest.recordings += entry.recordings; }
    typeCensus[`+${restTypes.length} more`] = rest.result("");
  }
  const sortedVersions = [...versions].sort(([a], [b]) => compareVersions(a, b));
  const versionCensus: Record<string, VersionCensus> = Object.fromEntries(sortedVersions.slice(-listLimit));
  if (sortedVersions.length > listLimit) {
    const older = sortedVersions.slice(0, -listLimit);
    const olderNames = new Set(older.map(([version]) => version));
    versionCensus[`+${older.length} more`] = {
      records: older.reduce((sum, [, entry]) => sum + entry.records, 0),
      recordings: fileVersions.filter(seen => [...seen].some(version => olderNames.has(version))).length,
    };
  }
  const nestedKeys: Record<string, Counts> = {};
  for (const [key, map] of [...usage.nested].sort(([a], [b]) => a.localeCompare(b)).slice(0, listLimit)) nestedKeys[key] = bounded(map, "name");

  return {
    directory,
    files: counts,
    unlistedDirectories: failures.count,
    lines,
    types: typeCensus,
    usage: {
      records: usage.records, requests: usage.requests.size, keys: bounded(usage.keys, "name"), nestedKeys,
      iterations: {
        records: iterations.records, lengths: bounded(iterations.lengths), multiple: iterations.multiple,
        differing: iterations.differing, sumAbove: bounded(iterations.sumAbove), sumBelow: bounded(iterations.sumBelow),
        entryKeys: bounded(iterations.entryKeys, "name"), entryTypes: bounded(iterations.entryTypes),
      },
      serviceTier: bounded(usage.serviceTier), fallbackCreditNonNull: usage.fallbackCreditNonNull,
      fallbackCreditKeys: bounded(usage.fallbackCreditKeys, "name"), speed: bounded(usage.speed), inferenceGeo: bounded(usage.inferenceGeo),
    },
    models: {
      raw: bounded(models.raw), normalized: bounded(models.normalized), requestedModel: bounded(models.requestedModel),
      advisorModel: bounded(models.advisorModel), requestedModelValues: bounded(models.requestedModelValues),
      advisorModelValues: bounded(models.advisorModelValues),
    },
    versions: versionCensus,
    withoutVersion: bounded(withoutVersion),
  };
}

function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split(/[.+-]/).map(part => /^\d+$/.test(part) ? Number(part) : part);
  const left = parts(a), right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index], y = right[index];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

function list(counts: Counts, total?: number): string {
  const entries = Object.entries(counts);
  if (!entries.length) return "none";
  return entries.map(([name, count]) => total !== undefined && count === total && !name.startsWith("+") ? name : `${name} ${count}`).join(", ");
}

/** The census as plain text; it holds only the identifiers and counts the census itself holds. */
export function renderCensus(census: FormatCensus): string {
  const out: string[] = [];
  const { files, lines, usage, models } = census;
  out.push(`Claude data directory: ${census.directory}`);
  out.push(`Files: ${files.total} (main ${files.main}, subagent ${files.subagent}, unreadable ${files.unreadable}), unlisted directories ${census.unlistedDirectories}`);
  out.push(`Records: ${lines.records}, malformed lines ${lines.malformed}`);
  out.push("", "Record types (records, recordings, without timestamp, without version):");
  for (const [type, entry] of Object.entries(census.types)) {
    out.push(`  ${type}: ${entry.records}, ${entry.recordings}, ${entry.withoutTimestamp}, ${entry.withoutVersion}`);
    if (type.startsWith("+")) continue;
    out.push(`    keys: ${list(entry.keys, entry.records)}`);
    if (entry.subtypes) out.push(`    subtypes: ${list(entry.subtypes)}`);
    if (entry.payloadKeys) out.push(`    ${type === "attachment" ? "attachment" : "data"} keys: ${list(entry.payloadKeys, entry.records)}`);
    if (entry.messageKeys) out.push(`    message keys: ${list(entry.messageKeys, entry.records)}`);
    if (entry.contentBlocks) out.push(`    content blocks: ${list(entry.contentBlocks)}`);
  }
  out.push("", `Transcript records without version: ${list(census.withoutVersion)}`);
  out.push("", `Usage: ${usage.records} assistant records with message.usage, ${usage.requests} distinct requests`);
  out.push(`  keys: ${list(usage.keys, usage.records)}`);
  for (const [key, counts] of Object.entries(usage.nestedKeys)) out.push(`  ${key} keys: ${list(counts)}`);
  const steps = usage.iterations;
  out.push(`  iterations: ${steps.records} records, ${steps.multiple} with more than one, ${steps.differing} whose sum differs from the top-level counts`);
  out.push(`    lengths: ${list(steps.lengths)}`);
  out.push(`    entry keys: ${list(steps.entryKeys)}`);
  out.push(`    entry types: ${list(steps.entryTypes)}`);
  out.push(`    sum above top level: ${list(steps.sumAbove)}`);
  out.push(`    sum below top level: ${list(steps.sumBelow)}`);
  out.push(`  service_tier: ${list(usage.serviceTier)}`);
  out.push(`  speed: ${list(usage.speed)}`);
  out.push(`  inference_geo: ${list(usage.inferenceGeo)}`);
  out.push(`  fallback_credit non-null: ${usage.fallbackCreditNonNull}${usage.fallbackCreditNonNull ? ` (${list(usage.fallbackCreditKeys)})` : ""}`);
  out.push("", "Models (assistant message.model):");
  out.push(`  raw: ${list(models.raw)}`);
  out.push(`  normalized: ${list(models.normalized)}`);
  out.push(`  requestedModel: ${list(models.requestedModel)}${Object.keys(models.requestedModelValues).length ? ` (values: ${list(models.requestedModelValues)})` : ""}`);
  out.push(`  advisorModel: ${list(models.advisorModel)}${Object.keys(models.advisorModelValues).length ? ` (values: ${list(models.advisorModelValues)})` : ""}`);
  out.push("", "Claude Code versions (records, recordings):");
  for (const [version, entry] of Object.entries(census.versions)) out.push(`  ${version}: ${entry.records}, ${entry.recordings}`);
  return out.join("\n");
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: {
      dir: { type: "string", short: "d" }, json: { type: "boolean", default: false }, help: { type: "boolean", short: "h" },
    }, strict: true });
    if (values.help) {
      console.log(`Usage: bun scripts/inspect-format.ts [--dir <path>] [--json]

Counts the record types, keys, and usage fields in a Claude data directory's recordings without printing their content.
  -d, --dir <path>  Claude data directory (default: CLAUDE_CONFIG_DIR or ~/.claude)
  --json            Print the census as JSON`);
    } else {
      const census = await censusFormat(resolveDataDir(values.dir));
      console.log(values.json ? JSON.stringify(census, null, 2) : renderCensus(census));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
