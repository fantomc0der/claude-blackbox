#!/usr/bin/env bun
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { readJsonLines } from "../src/server/jsonl";
import { object } from "../src/server/normalize";
import { normalizeModel, readUsage } from "../src/server/usage";
import { compareVersions, recordedVersion } from "../src/shared/records";

export { compareVersions };

/**
 * A read-only census of the record shapes in a Claude data directory, for noticing Claude Code format changes. It
 * reports key names, short enumerated identifiers (record type, subtype, block type, model, version, service tier),
 * and counts. It never prints recorded content, a path, or an id of the user, a session, or a request: a value or key
 * that does not have the shape of an expected identifier is counted under a placeholder, an object keyed by data is
 * counted as `(map)`, and every listed set stops at `listLimit` entries. Requests are told apart by a hash of their key,
 * so no id is held in memory either.
 */

/** The most distinct names or values listed for any one set; the rest are summed into one "+N more" entry. */
export const listLimit = 50;

/** The most distinct names any one tally holds in memory; further names are counted under `(overflow)`. */
const distinctLimit = 10_000;

/** A nested object with more keys than this is a map keyed by data, such as ids or paths, rather than a shape. */
const mapKeyLimit = 32;

/** Records carry more top-level fields than nested objects; those from Claude Code 2.1.269 to 2.1.302 have at most 27. */
const recordKeyLimit = 64;

/** Record types that carry a conversation turn and are expected to name the Claude Code version that wrote them. */
export const transcriptTypes = ["user", "assistant", "system", "attachment", "progress"] as const;

const tokenFields = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const;

export type Counts = Record<string, number>;

/** Where the data directory came from; the path itself is never printed because it names the user. */
export type DataDirSource = "--dir" | "CLAUDE_CONFIG_DIR" | "default";

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

/**
 * `usage.iterations` on the one record per request that the index keeps. Claude Code writes a record per content block
 * of a reply, and an early record can carry a partial snapshot of the usage, so comparing every record would count
 * differences that the index never sees.
 */
export interface IterationCensus {
  /** Requests whose kept record has an `iterations` array. */
  requests: number;
  lengths: Counts;
  multiple: number;
  /** Requests whose iteration sum differs from the top-level count in at least one token field. */
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
  /** Distinct requests among them that the index counts, keyed the way it deduplicates usage. */
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
  source: DataDirSource;
  files: { total: number; main: number; subagent: number; unreadable: number };
  /** Directories under `projects` that could not be listed. */
  unlistedDirectories: number;
  lines: { records: number; malformed: number };
  types: Record<string, TypeCensus>;
  usage: UsageCensus;
  models: ModelCensus;
  /** Oldest first; placeholders such as `(unlisted string)` come after every real version. */
  versions: Record<string, VersionCensus>;
  /** Records of each transcript type without a `version`. */
  withoutVersion: Counts;
}

/** The data directory `src/server/cli.ts` reads for the same `--dir` argument and environment. */
export function resolveDataDir(dir?: string, env: Record<string, string | undefined> = process.env): { path: string; source: DataDirSource } {
  if (dir) return { path: resolve(dir), source: "--dir" };
  if (env.CLAUDE_CONFIG_DIR) return { path: resolve(env.CLAUDE_CONFIG_DIR), source: "CLAUDE_CONFIG_DIR" };
  return { path: resolve(join(homedir(), ".claude")), source: "default" };
}

// The ids Claude Code, the API, and cloud providers write: long digit runs (account ids, timestamps), runs of hex that
// mix digits and letters (uuids, hashes), and the prefixes of tool-use, message, and request ids.
function idLike(value: string, digitRun = 6): boolean {
  if (new RegExp(`\\d{${digitRun},}`).test(value)) return true;
  for (const [run] of value.matchAll(/[0-9a-f]{8,}/gi)) if (/\d/.test(run) && /[a-f]/i.test(run)) return true;
  return /^(?:srv)?toolu_|^msg_|^req_|^msgbatch_/i.test(value);
}

function placeholder(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (value === null) return "(null)";
  if (Array.isArray(value)) return "(array)";
  return typeof value === "string" ? "(unlisted string)" : `(${typeof value})`;
}

/** A value Claude Code or the API picks from a fixed set: a record type, subtype, block type, tier, speed, or region. */
function enumLabel(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,39}$/.test(value) && !idLike(value) ? value : placeholder(value);
}

/** A model name, which users can configure, so ARNs, paths, URLs, email addresses, and ids are left out. */
function modelLabel(value: unknown): string {
  if (typeof value !== "string") return placeholder(value);
  if (value.startsWith("arn:")) return "(arn)";
  const undated = value.replace(/[-@]20\d{6}(?=$|[-:@])/g, "");
  const named = /^[\w.:@<>[\]/+-]{1,64}$/.test(value) && !value.startsWith("/") && !value.includes("//")
    && !/^[a-z]:\//i.test(value) && !/@[^@/]*\.[a-z]/i.test(value) && !idLike(undated, 8);
  return named ? value : "(unlisted string)";
}

function versionLabel(value: unknown): string {
  return recordedVersion(value) || placeholder(value);
}

function keyName(key: string): string {
  return /^[A-Za-z_$][\w$-]{0,63}$/.test(key) && !idLike(key) ? key : "(unlisted key)";
}

function keyNames(value: unknown, limit = mapKeyLimit): string[] {
  const keys = Object.keys(object(value));
  return keys.length > limit ? ["(map)"] : keys.map(keyName);
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  const name = map.has(key) || map.size < distinctLimit ? key : "(overflow)";
  map.set(name, (map.get(name) ?? 0) + by);
}

function bumpKeys(map: Map<string, number>, value: unknown, limit = mapKeyLimit): void {
  for (const name of keyNames(value, limit)) bump(map, name);
}

function bounded(map: Map<string, number>, order: "count" | "name" = "count"): Counts {
  const byCount = [...map].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const kept = byCount.slice(0, listLimit);
  if (order === "name") kept.sort(([a], [b]) => a.localeCompare(b));
  const rest = byCount.slice(listLimit);
  if (rest.length) kept.push([`+${rest.length} more`, rest.reduce((sum, [, count]) => sum + count, 0)]);
  return Object.fromEntries(kept);
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

interface IterationSummary { length: number; keys: string[]; types: string[]; above: string[]; below: string[] }

function summarizeIterations(usage: Record<string, unknown>): IterationSummary | null {
  if (!Array.isArray(usage.iterations)) return null;
  const steps = usage.iterations.map(object);
  const summary: IterationSummary = { length: steps.length, keys: [], types: [], above: [], below: [] };
  for (const step of steps) {
    summary.keys.push(...keyNames(step));
    if (step.type !== undefined) summary.types.push(enumLabel(step.type));
  }
  for (const field of tokenFields) {
    if (!steps.some(step => field in step)) continue;
    const sum = steps.reduce((total, step) => total + tokenCount(step[field]), 0);
    const top = tokenCount(usage[field]);
    if (sum > top) summary.above.push(field);
    if (sum < top) summary.below.push(field);
  }
  return summary;
}

/** One request's record, chosen as the index chooses it: not a sidechain, then the most tokens, then a recorded cost. */
interface RequestPick { sidechain: boolean; total: number; recorded: boolean; cost: number; iterations: IterationSummary | null }

function preferred(next: RequestPick, kept: RequestPick): boolean {
  if (next.sidechain !== kept.sidechain) return !next.sidechain;
  if (next.total !== kept.total) return next.total > kept.total;
  if (next.recorded !== kept.recorded) return next.recorded;
  return next.cost > kept.cost;
}

/** Scans every `projects/**\/*.jsonl` recording under `dataDir` read-only and counts the shapes it finds. */
export async function censusFormat(dataDir: string, source: DataDirSource = "--dir"): Promise<FormatCensus> {
  const files: string[] = [];
  const failures = { count: 0 };
  await discover(join(resolve(dataDir), "projects"), files, failures);
  files.sort();

  const types = new Map<string, TypeTally>();
  const tally = (type: string) => {
    const name = types.has(type) || types.size < distinctLimit ? type : "(overflow)";
    return types.get(name) ?? types.set(name, new TypeTally()).get(name)!;
  };
  const fileTypes: Set<string>[] = [];
  const versions = new Map<string, VersionCensus>();
  const fileVersions: Set<string>[] = [];
  const withoutVersion = new Map<string, number>();
  const lines = { records: 0, malformed: 0 };
  const counts = { total: files.length, main: 0, subagent: 0, unreadable: 0 };
  const requests = new Map<number | bigint, RequestPick>();
  const usage = {
    records: 0, keys: new Map<string, number>(), nested: new Map<string, Map<string, number>>(), nestedObjects: new Map<string, number>(),
    serviceTier: new Map<string, number>(), fallbackCreditNonNull: 0, fallbackCreditKeys: new Map<string, number>(),
    speed: new Map<string, number>(), inferenceGeo: new Map<string, number>(),
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
        sequence++;
        const type = enumLabel(raw.type);
        const entry = tally(type);
        entry.records++;
        seenTypes.add(type);
        if (!hasTimestamp(raw)) entry.withoutTimestamp++;
        bumpKeys(entry.keys, raw, recordKeyLimit);
        if (raw.version === undefined) {
          entry.withoutVersion++;
          if ((transcriptTypes as readonly string[]).includes(type)) bump(withoutVersion, type);
        } else {
          const version = versionLabel(raw.version);
          const known = versions.get(version) ?? versions.set(version, { records: 0, recordings: 0 }).get(version)!;
          known.records++;
          seenVersions.add(version);
        }
        if (type === "system") bump(entry.subtypes, enumLabel(raw.subtype));
        if (type === "attachment") {
          bump(entry.subtypes, enumLabel(object(raw.attachment).type));
          bumpKeys(entry.payloadKeys, raw.attachment);
        }
        if (type === "progress") {
          bump(entry.subtypes, enumLabel(object(raw.data).type));
          bumpKeys(entry.payloadKeys, raw.data);
        }
        const message = object(raw.message);
        if (type === "user" || type === "assistant") {
          bumpKeys(entry.messageKeys, raw.message);
          if (typeof message.content === "string") bump(entry.contentBlocks, "(string)");
          else if (Array.isArray(message.content)) for (const block of message.content) bump(entry.contentBlocks, enumLabel(object(block).type));
          else bump(entry.contentBlocks, placeholder(message.content));
        }
        for (const [field, locations, values] of [["requestedModel", models.requestedModel, models.requestedModelValues], ["advisorModel", models.advisorModel, models.advisorModelValues]] as const) {
          if (field in raw) { bump(locations, `${type}.${field}`); bump(values, modelLabel(raw[field])); }
          if (field in message) { bump(locations, `${type}.message.${field}`); bump(values, modelLabel(message[field])); }
        }
        if (type !== "assistant") continue;
        bump(models.raw, modelLabel(message.model));
        if (typeof message.model === "string") bump(models.normalized, modelLabel(normalizeModel(message.model)));
        if (!message.usage || typeof message.usage !== "object" || Array.isArray(message.usage)) continue;
        const fields = object(message.usage);
        usage.records++;
        const fieldNames = keyNames(fields);
        for (const name of fieldNames) bump(usage.keys, name);
        if (fieldNames[0] !== "(map)") {
          for (const [key, value] of Object.entries(fields)) {
            if (!value || typeof value !== "object" || Array.isArray(value)) continue;
            const name = keyName(key);
            bump(usage.nestedObjects, name);
            const nestedName = usage.nested.has(name) || usage.nested.size < distinctLimit ? name : "(overflow)";
            const nested = usage.nested.get(nestedName) ?? usage.nested.set(nestedName, new Map()).get(nestedName)!;
            bumpKeys(nested, value);
          }
        }
        bump(usage.serviceTier, enumLabel(fields.service_tier));
        bump(usage.speed, enumLabel(fields.speed));
        bump(usage.inferenceGeo, enumLabel(fields.inference_geo));
        if (fields.fallback_credit !== undefined && fields.fallback_credit !== null) {
          usage.fallbackCreditNonNull++;
          // A credit may be a token, so a value that is not an object is counted by its type only.
          const credit = fields.fallback_credit;
          if (typeof credit === "object" && !Array.isArray(credit)) bumpKeys(usage.fallbackCreditKeys, credit);
          else bump(usage.fallbackCreditKeys, typeof credit === "string" ? "(string)" : placeholder(credit));
        }
        const used = readUsage(raw, path, `${path}:${sequence}`);
        if (!used) continue;
        const pick: RequestPick = {
          sidechain: used.sidechain, total: used.input + used.output + used.cacheCreation + used.cacheRead,
          recorded: used.recorded, cost: used.cost ?? -1, iterations: summarizeIterations(fields),
        };
        const id = Bun.hash(used.key);
        const kept = requests.get(id);
        if (!kept || preferred(pick, kept)) requests.set(id, pick);
      }
    } catch {
      counts.unreadable++;
    }
    for (const type of seenTypes) types.get(type)!.recordings++;
    for (const version of seenVersions) versions.get(version)!.recordings++;
    fileTypes.push(seenTypes);
    fileVersions.push(seenVersions);
  }

  const recordingsWithAny = (seen: Set<string>[], names: Set<string>) => seen.filter(set => [...set].some(name => names.has(name))).length;

  const sortedTypes = [...types].sort(([a, x], [b, y]) => y.records - x.records || a.localeCompare(b));
  const typeEntries: [string, TypeCensus][] = sortedTypes.slice(0, listLimit).map(([type, entry]) => [type, entry.result(type)]);
  const restTypes = sortedTypes.slice(listLimit);
  if (restTypes.length) {
    const rest = new TypeTally();
    for (const [, entry] of restTypes) {
      rest.records += entry.records;
      rest.withoutTimestamp += entry.withoutTimestamp;
      rest.withoutVersion += entry.withoutVersion;
    }
    rest.recordings = recordingsWithAny(fileTypes, new Set(restTypes.map(([type]) => type)));
    typeEntries.push([`+${restTypes.length} more`, rest.result("")]);
  }

  const sortedVersions = [...versions].sort(([a], [b]) => compareVersions(a, b));
  const versionEntries = sortedVersions.slice(-listLimit);
  const olderVersions = sortedVersions.slice(0, -listLimit);
  if (olderVersions.length) {
    versionEntries.unshift([`+${olderVersions.length} more`, {
      records: olderVersions.reduce((sum, [, entry]) => sum + entry.records, 0),
      recordings: recordingsWithAny(fileVersions, new Set(olderVersions.map(([version]) => version))),
    }]);
  }

  const nestedOrder = [...usage.nestedObjects].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const nestedEntries: [string, Counts][] = nestedOrder.slice(0, listLimit).sort(([a], [b]) => a.localeCompare(b))
    .map(([name]) => [name, bounded(usage.nested.get(name) ?? new Map(), "name")]);
  const nestedRest = nestedOrder.slice(listLimit);
  if (nestedRest.length) nestedEntries.push([`+${nestedRest.length} more`, { objects: nestedRest.reduce((sum, [, count]) => sum + count, 0) }]);

  const iterations = {
    requests: 0, lengths: new Map<string, number>(), multiple: 0, differing: 0, sumAbove: new Map<string, number>(),
    sumBelow: new Map<string, number>(), entryKeys: new Map<string, number>(), entryTypes: new Map<string, number>(),
  };
  for (const { iterations: summary } of requests.values()) {
    if (!summary) continue;
    iterations.requests++;
    bump(iterations.lengths, String(summary.length));
    if (summary.length > 1) iterations.multiple++;
    if (summary.above.length || summary.below.length) iterations.differing++;
    for (const name of summary.keys) bump(iterations.entryKeys, name);
    for (const name of summary.types) bump(iterations.entryTypes, name);
    for (const field of summary.above) bump(iterations.sumAbove, field);
    for (const field of summary.below) bump(iterations.sumBelow, field);
  }

  return {
    source,
    files: counts,
    unlistedDirectories: failures.count,
    lines,
    types: Object.fromEntries(typeEntries),
    usage: {
      records: usage.records, requests: requests.size, keys: bounded(usage.keys, "name"), nestedKeys: Object.fromEntries(nestedEntries),
      iterations: {
        requests: iterations.requests, lengths: bounded(iterations.lengths), multiple: iterations.multiple,
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
    versions: Object.fromEntries(versionEntries),
    withoutVersion: bounded(withoutVersion),
  };
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
  out.push(`Claude data directory: ${census.source === "default" ? "default (~/.claude)" : `from ${census.source}`}`);
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
  out.push("", `Usage: ${usage.records} assistant records with message.usage, ${usage.requests} distinct requests the index counts`);
  out.push(`  keys: ${list(usage.keys, usage.records)}`);
  for (const [key, counts] of Object.entries(usage.nestedKeys)) out.push(`  ${key} keys: ${list(counts)}`);
  const steps = usage.iterations;
  out.push(`  iterations, on each request's indexed record: ${steps.requests} requests, ${steps.multiple} with more than one, ${steps.differing} whose sum differs from the top-level counts`);
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
      const { path, source } = resolveDataDir(values.dir);
      const census = await censusFormat(path, source);
      console.log(values.json ? JSON.stringify(census, null, 2) : renderCensus(census));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
