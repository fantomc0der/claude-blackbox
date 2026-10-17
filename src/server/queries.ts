import type { Database, SQLQueryBindings } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Catalog, ContentBlock, DirectoryUsage, EventPage, EventTimeline, FindMatches, ModelUsage, RecordedCost, RecordedCostTotal, ReplayEvent, Session, SessionFamily, SessionFamilyMember, SessionPage, SessionSummary, SummaryRecord, TimelineBucket, UsageSummary, WorkspaceGroup } from "../shared/types";
import { stripAnsi } from "../shared/ansi";
import { resultDecision } from "../shared/decisions";
import { newestVersions } from "../shared/records";
import { displaySnippet, normalize, object, pathName, requestMessageType, string } from "./normalize";
import { dateBound, ftsPhrase, numericBound, pageNumber, parseSearch } from "./search";
import { addUsage, emptyUsage, normalizeModel, usageColumns } from "./usage";
import { facetLimit, isFacetValue } from "./facets";
import { addedDirectory, buildSummary, changeTools, contentBlocks, isAddDirCommand, placeSummary, recordText, summaryRecordIds, type SummaryCall, type SummaryRoot } from "./summary";

const timelineBucketLimit = 1500;
const findMatchLimit = 5000;
const callInputKeys = 32;
const callInputLength = 2000;
const timelineGranularities = [[16, 60_000], [15, 600_000], [13, 3_600_000], [10, 86_400_000]] as const;
type TimelineRow = { at: string | null; count: number; first: number; last: number; errors: number };
/**
 * A `sessions` row as `Recorder` reads it back (`SELECT * FROM sessions`), and as the queries here select it through
 * `columns` and `joins`, which add the recording's workspace group, bookmark, and `session_costs` row.
 */
export interface SourceRow {
  id: string; session_id: string; source: string; cwd: string; title: string; branch: string; model: string;
  started: string; updated: string; events: number; messages: number; tools: number; errors: number;
  edits: number; agent: number; size: number; mtime: number; cursor: number; fingerprint: string;
  warnings: number; named: number; identity: string; tailprint: string; turns: number; active_ms: number;
  version: string; unrecognized: number; api_errors: number; decisions: number;
  group_id?: string; group_name?: string; bookmarked?: number;
  recorded_cost?: number | null; recorded_started?: string | null; recorded_unknown?: number | null; recorded_models?: string | null;
  recorded_api_ms?: number | null; recorded_tool_ms?: number | null;
}

interface StoredEvent { raw: string; event_id: string; sequence: number; offset: number; text: string }

interface LaunchRow {
  parent_id: string;
  tool_id: string;
  event_id: string;
  name: string;
  call_raw: string;
  result_raw: string | null;
  result_event_raw: string | null;
}

interface LaunchEvidence {
  parentId: string;
  toolId: string;
  eventId: string;
  label: string;
}

const joins = `FROM sessions s LEFT JOIN group_paths gp ON gp.path = s.cwd
  LEFT JOIN groups g ON g.id = gp.group_id LEFT JOIN bookmarks b ON b.session_id = s.id
  LEFT JOIN session_costs sc ON sc.session_id = s.id`;
const columns = `s.*, g.id AS group_id, g.name AS group_name, (b.session_id IS NOT NULL) AS bookmarked,
  sc.cost AS recorded_cost, sc.started AS recorded_started, sc.unknown_models AS recorded_unknown, sc.model_usage AS recorded_models,
  sc.api_ms AS recorded_api_ms, sc.tool_ms AS recorded_tool_ms`;
const snippetLimit = 262_144;
const sessionUsageJoin = `LEFT JOIN (SELECT session_id, count(*) AS usageRequests, count(cost) AS pricedRequests,
  sum(cost) AS knownCost, sum(input+output+cache_creation+cache_read) AS usageTokens
  FROM usage_records GROUP BY session_id) session_usage ON session_usage.session_id=s.id`;

function toolCondition(column: string, tool: string): string {
  return tool === "mcp__" ? `instr(char(10)||lower(${column}),char(10)||'mcp__')>0`
    : `instr(char(10)||lower(${column})||char(10),char(10)||lower(?)||char(10))>0`;
}

function boundedLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled session";
}

/** The `session_costs` row joined onto a session row, or null when the recording carries no `cost-state` record. */
function recordedCostOf(row: SourceRow): RecordedCost | null {
  if (typeof row.recorded_cost !== "number") return null;
  let models: RecordedCost["models"] = {};
  try { models = JSON.parse(row.recorded_models || "{}") as RecordedCost["models"]; } catch { /* an unreadable breakdown leaves the total */ }
  return {
    costUSD: row.recorded_cost, startedAt: row.recorded_started || "", unknownModelCost: row.recorded_unknown === 1, models,
    apiDurationMs: typeof row.recorded_api_ms === "number" ? row.recorded_api_ms : null,
    toolDurationMs: typeof row.recorded_tool_ms === "number" ? row.recorded_tool_ms : null,
  };
}

function agentFileId(source: string): string {
  return /^agent-(.+)\.jsonl$/i.exec(basename(source))?.[1] || "";
}

function belongsToRoot(agent: SourceRow, root: SourceRow): boolean {
  const prefix = join(dirname(root.source), basename(root.source, ".jsonl"), "subagents") + sep;
  return agent.source.startsWith(prefix) || (agent.session_id === root.session_id && dirname(agent.source) === dirname(root.source));
}

function rootSourceForAgent(source: string): string {
  const marker = `${sep}subagents${sep}`;
  const position = source.indexOf(marker);
  if (position < 0) return "";
  const sessionDirectory = source.slice(0, position);
  return join(dirname(sessionDirectory), `${basename(sessionDirectory)}.jsonl`);
}

function jsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return object(JSON.parse(raw)); }
  catch { return {}; }
}

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map(entry => {
    if (typeof entry === "string") return entry;
    const block = object(entry);
    return string(block.text) || resultText(block.content);
  }).join("\n");
}

function agentIdsFromLaunch(row: LaunchRow): string[] {
  const ids = new Set<string>();
  const result = jsonRecord(row.result_raw);
  const content = resultText(result.content);
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*agent(?:Id|_id)\s*:\s*([\w.-]+)(?:[ \t]+\([^\r\n]*\))?\s*$/i.exec(line);
    if (match) ids.add(match[1]);
  }
  for (const raw of [jsonRecord(row.call_raw), jsonRecord(row.result_event_raw)]) {
    for (const candidate of [object(raw.toolUseResult), object(object(raw.message).toolUseResult)]) {
      const agentId = string(candidate.agentId);
      if (agentId) ids.add(agentId);
    }
  }
  return [...ids];
}

function launchLabel(row: LaunchRow): string {
  const raw = jsonRecord(row.call_raw);
  const content = object(raw.message).content ?? raw.content;
  const block = Array.isArray(content) ? content.map(object).find(item => item.type === "tool_use" && item.id === row.tool_id) : undefined;
  const input = object(block?.input);
  return boundedLabel(string(input.description) || string(input.name) || string(input.prompt) || row.name);
}

/**
 * What the read side needs from the index `Recorder` maintains: the connection, the recording root that each session's
 * source is shown relative to, the status the catalog reports, and `emit()`, which tells live clients that a bookmark
 * or workspace group changed.
 */
export interface RecordingIndex {
  readonly db: Database;
  readonly dataDir: string;
  readonly indexedAt: string;
  readonly scanWarnings: number;
  emit(ids?: string[]): void;
}

/**
 * The read side of the derived index: the queries the HTTP routes serve, from the library listing and the catalog
 * through a recording's events, matches, timeline, and summary, and the bookmarks and workspace groups kept beside the
 * index. `Recorder` owns one over its connection and calls `forget()` as it indexes, since the caches here are derived
 * from what it writes.
 */
export class RecordingQueries {
  private readonly index: RecordingIndex;
  private readonly db: Database;
  private readonly dataDir: string;
  // Usage per workspace, which a scan or a change to the groups makes stale.
  private workspaceUsage: Map<string, UsageSummary> | null = null;
  private catalogFacets: Pick<Catalog, "models" | "toolsUsed" | "efforts" | "versions" | "unrecognizedKinds" | "facetsLimited"> | null = null;
  private replayFacets = new Map<string, EventPage["facets"]>();
  private replayTimelines = new Map<string, { total: number; rows: TimelineRow[] }>();
  private replaySummaries = new Map<string, { total: number; summary: SessionSummary }>();

  constructor(index: RecordingIndex) {
    this.index = index;
    this.db = index.db;
    this.dataDir = index.dataDir;
  }

  /**
   * Drops what was derived from the recordings in `ids` and from the set of recordings: the replay facets, timeline, and
   * summary of each, the catalog's facets, and the usage per workspace. `Recorder` calls it as it publishes a scan's
   * changes; a change to the groups drops the usage per workspace itself.
   */
  forget(ids: string[]): void {
    this.catalogFacets = null;
    this.workspaceUsage = null;
    for (const id of ids) { this.replayFacets.delete(id); this.replayTimelines.delete(id); this.replaySummaries.delete(id); }
  }

  private session(row: SourceRow): Session {
    return {
      id: row.id, sessionId: row.session_id, title: row.title, cwd: row.cwd,
      workspace: row.group_name || pathName(row.cwd), groupId: row.group_id || null,
      branch: row.branch, model: row.model, startedAt: row.started, updatedAt: row.updated,
      eventCount: row.events, messageCount: row.messages, toolCount: row.tools, errorCount: row.errors,
      apiErrorCount: row.api_errors, decisionCount: row.decisions,
      hasEdits: Boolean(row.edits), bookmarked: Boolean(row.bookmarked), isAgent: Boolean(row.agent),
      active: Date.now() - Date.parse(row.updated) < 120_000 && Date.now() - row.mtime < 120_000,
      source: relative(this.dataDir, row.source),
      usage: this.db.query<UsageSummary, [string]>(`SELECT ${usageColumns} FROM usage_records WHERE session_id=?`).get(row.id)!,
      recordedCost: recordedCostOf(row),
      activeTime: row.turns > 0 ? { durationMs: row.active_ms, turns: row.turns } : null,
      version: row.version, unrecognizedCount: row.unrecognized,
    };
  }

  getSession(id: string): Session | null {
    const row = this.db.query<SourceRow, [string]>(`SELECT ${columns} ${joins} WHERE s.id=?`).get(id);
    return row ? this.session(row) : null;
  }

  subagents(id: string): Session[] {
    const parent = this.db.query<SourceRow, [string]>(`SELECT ${columns} ${joins} WHERE s.id=? AND s.agent=0`).get(id);
    if (!parent) return [];
    const prefix = join(dirname(parent.source), basename(parent.source, ".jsonl"), "subagents") + sep;
    return this.db.query<SourceRow, [string, string, string]>(`SELECT ${columns} ${joins}
      WHERE s.agent=1 AND (substr(s.source,1,length(?))=? OR s.session_id=?) ORDER BY s.started,s.id`)
      .all(prefix, prefix, parent.session_id)
      .filter(row => row.source.startsWith(prefix) || dirname(row.source) === dirname(parent.source))
      .map(row => this.session(row));
  }

  family(id: string): SessionFamily {
    const requestedRow = this.db.query<SourceRow, [string]>(`SELECT ${columns} ${joins} WHERE s.id=?`).get(id);
    if (!requestedRow) throw new Error("Session not found");
    const requested = this.session(requestedRow);
    const orphan = (): SessionFamily => ({ rootId: null, members: [{ session: requested, parentId: null, spawnEventId: null, spawnToolId: null, label: boundedLabel(requested.title), depth: null }], launches: {} });
    let root = requestedRow;
    if (requestedRow.agent) {
      const roots = this.db.query<SourceRow, [string, string]>(`SELECT ${columns} ${joins} WHERE s.agent=0 AND (s.source=? OR s.session_id=?)`)
        .all(rootSourceForAgent(requestedRow.source), requestedRow.session_id)
        .filter(candidate => belongsToRoot(requestedRow, candidate));
      if (roots.length !== 1) return orphan();
      root = roots[0];
    }
    const prefix = join(dirname(root.source), basename(root.source, ".jsonl"), "subagents") + sep;
    const directory = dirname(root.source) + sep;
    const familyScope = "s.agent=1 AND (substr(s.source,1,length(?))=? OR (s.session_id=? AND substr(s.source,1,length(?))=? AND instr(substr(s.source,length(?)+1),?)=0))";
    const familyBindings = [prefix, prefix, root.session_id, directory, directory, directory, sep];
    const descendantRows = this.db.query<SourceRow, SQLQueryBindings[]>(`SELECT ${columns} ${joins}
      WHERE ${familyScope}
      ORDER BY s.started,s.id LIMIT ?`)
      .all(...familyBindings, 501);
    const limited = descendantRows.length > 500;
    const descendants = descendantRows.slice(0, 500);
    if (requestedRow.agent && !descendants.some(candidate => candidate.id === requestedRow.id)) descendants.splice(-1, 1, requestedRow);
    if (requestedRow.agent && !descendants.some(candidate => candidate.id === requestedRow.id)) return orphan();
    if (limited) return this.limitedFamily(requestedRow, root, descendants, familyScope, familyBindings);
    const rows = [root, ...descendants].sort((left, right) => left.id === root.id ? -1 : right.id === root.id ? 1 : left.started.localeCompare(right.started) || left.id.localeCompare(right.id));
    const sessions = new Map(rows.map(row => [row.id, this.session(row)]));
    const childrenByAgentId = new Map<string, string>();
    const duplicateAgentIds = new Set<string>();
    for (const child of descendants) {
      const agentId = agentFileId(child.source);
      if (!agentId) continue;
      if (childrenByAgentId.has(agentId)) duplicateAgentIds.add(agentId);
      else childrenByAgentId.set(agentId, child.id);
    }
    for (const agentId of duplicateAgentIds) childrenByAgentId.delete(agentId);
    const evidenceByChild = new Map<string, LaunchEvidence[]>();
    for (const launch of this.launchRows(rows.map(row => row.id))) {
      const agentIds = agentIdsFromLaunch(launch);
      if (agentIds.length !== 1) continue;
      const childId = childrenByAgentId.get(agentIds[0]);
      if (!childId) continue;
      if (childId === launch.parent_id) continue;
      const evidence: LaunchEvidence = { parentId: launch.parent_id, toolId: launch.tool_id, eventId: launch.event_id, label: launchLabel(launch) };
      evidenceByChild.set(childId, [...(evidenceByChild.get(childId) || []), evidence]);
    }
    const relations = new Map<string, { parentId: string | null; spawnEventId: string | null; spawnToolId: string | null; label: string }>();
    for (const child of descendants) {
      const evidence = evidenceByChild.get(child.id) || [];
      const unique = evidence.length === 1 ? evidence[0] : null;
      relations.set(child.id, unique ? { parentId: unique.parentId, spawnEventId: unique.eventId, spawnToolId: unique.toolId, label: unique.label }
        : { parentId: null, spawnEventId: null, spawnToolId: null, label: boundedLabel(sessions.get(child.id)!.title) });
    }
    const cyclic = new Set<string>();
    for (const child of descendants) {
      const path: string[] = [];
      const positions = new Map<string, number>();
      let current: string | null = child.id;
      while (current && current !== root.id) {
        const previous = positions.get(current);
        if (previous !== undefined) { for (const memberId of path.slice(previous)) cyclic.add(memberId); break; }
        positions.set(current, path.length);
        path.push(current);
        current = relations.get(current)?.parentId || null;
      }
    }
    for (const memberId of cyclic) relations.set(memberId, { parentId: null, spawnEventId: null, spawnToolId: null, label: boundedLabel(sessions.get(memberId)!.title) });
    const depth = (memberId: string, trail = new Set<string>()): number | null => {
      if (memberId === root.id) return 0;
      if (trail.has(memberId)) return null;
      const parentId = relations.get(memberId)?.parentId;
      if (!parentId || !sessions.has(parentId)) return null;
      trail.add(memberId);
      const parentDepth = depth(parentId, trail);
      trail.delete(memberId);
      return parentDepth === null ? null : parentDepth + 1;
    };
    const members: SessionFamilyMember[] = rows.map(row => {
      const session = sessions.get(row.id)!;
      if (row.id === root.id) return { session, parentId: null, spawnEventId: null, spawnToolId: null, label: boundedLabel(session.title), depth: 0 };
      const relation = relations.get(row.id)!;
      return { session, ...relation, depth: depth(row.id) };
    });
    const launchesForRequest: Record<string, string> = {};
    for (const child of descendants) {
      const evidence = evidenceByChild.get(child.id);
      if (evidence?.length === 1 && evidence[0].parentId === requestedRow.id && !cyclic.has(child.id)) launchesForRequest[evidence[0].toolId] = child.id;
    }
    return { rootId: root.id, members, launches: launchesForRequest };
  }

  private launchRows(ids: string[]) {
    const placeholders = ids.map(() => "?").join(",");
    return this.db.query<LaunchRow, string[]>(`SELECT calls.session_id AS parent_id,calls.tool_id,call_events.event_id,calls.name,
      call_events.raw AS call_raw,results.raw AS result_raw,result_events.raw AS result_event_raw
      FROM tool_calls calls JOIN events call_events ON call_events.rowid=calls.event_row
      LEFT JOIN tool_results results ON results.session_id=calls.session_id AND results.tool_id=calls.tool_id
      LEFT JOIN events result_events ON result_events.rowid=results.event_row
      WHERE calls.session_id IN (${placeholders}) AND lower(calls.name) IN ('agent','task') ORDER BY call_events.sequence`).iterate(...ids);
  }

  private limitedFamily(requested: SourceRow, root: SourceRow, descendants: SourceRow[], scope: string, bindings: string[]): SessionFamily {
    const references = new Map<string, { toolId: string; label: string } | null>();
    for (const launch of this.launchRows([requested.id])) {
      const ids = agentIdsFromLaunch(launch);
      if (ids.length !== 1) continue;
      const agentId = ids[0];
      if (references.has(agentId)) references.set(agentId, null);
      else if (references.size < 500) references.set(agentId, { toolId: launch.tool_id, label: launchLabel(launch) });
    }
    const matches = new Map<string, string | null>();
    if (references.size) {
      for (const candidate of this.db.query<Pick<SourceRow, "id" | "source">, string[]>(`SELECT s.id,s.source FROM sessions s WHERE ${scope}`).iterate(...bindings)) {
        const agentId = agentFileId(candidate.source);
        if (references.get(agentId)) matches.set(agentId, matches.has(agentId) ? null : candidate.id);
      }
    }
    const selected = new Map<string, SourceRow>();
    if (requested.agent) selected.set(requested.id, requested);
    const launches: Record<string, string> = {};
    const labels = new Map<string, string>();
    for (const [agentId, reference] of references) {
      const childId = matches.get(agentId);
      if (!reference || !childId || childId === requested.id || selected.size >= 500) continue;
      const child = this.db.query<SourceRow, [string]>(`SELECT ${columns} ${joins} WHERE s.id=?`).get(childId);
      if (!child) continue;
      selected.set(childId, child);
      launches[reference.toolId] = childId;
      labels.set(childId, reference.label);
    }
    for (const descendant of descendants) {
      if (selected.size >= 500) break;
      selected.set(descendant.id, descendant);
    }
    const rows = [root, ...[...selected.values()].sort((left, right) => left.started.localeCompare(right.started) || left.id.localeCompare(right.id))];
    return {
      rootId: root.id,
      members: rows.map(row => ({ session: this.session(row), parentId: null, spawnEventId: null, spawnToolId: null, label: labels.get(row.id) || boundedLabel(row.title), depth: row.id === root.id ? 0 : null })),
      launches,
      limited: true,
    };
  }

  list(params: URLSearchParams): SessionPage {
    const conditions: string[] = [];
    const bindings: SQLQueryBindings[] = [];
    const selectionJoins = `${joins} ${sessionUsageJoin}`;
    const terms = parseSearch(params.get("q") || "");
    for (const term of terms) {
      const hasTokens = /[\p{L}\p{N}]/u.test(term.value);
      const match = hasTokens ? `s.id IN (SELECT e.session_id FROM event_fts JOIN events e ON e.rowid=event_fts.rowid WHERE event_fts MATCH ?)`
        : `s.id IN (SELECT session_id FROM events WHERE instr(lower(text),lower(?))>0)`;
      conditions.push(`${term.exclude ? "NOT " : ""}(${match} OR instr(lower(s.title || ' ' || s.cwd || ' ' || s.branch || ' ' || s.model || ' ' || coalesce(g.name,'')), lower(?))>0)`);
      bindings.push(hasTokens ? ftsPhrase(term.value) : term.value, term.value);
    }
    const workspace = params.get("workspace");
    if (workspace) {
      conditions.push("(g.id=? OR s.cwd=?)"); bindings.push(workspace, workspace === "unknown" ? "" : workspace);
    }
    for (const [key, column] of [["cwd", "s.cwd"], ["branch", "s.branch"]]) {
      if (params.get(key)) { conditions.push(`${column}=?`); bindings.push(params.get(key)!); }
    }
    const model = params.get("model");
    const effort = params.get("effort");
    const effortMissing = params.get("effortMissing") === "1";
    if (model && !effort && !effortMissing) {
      conditions.push(`(EXISTS (SELECT 1 FROM events e WHERE e.session_id=s.id AND e.model=?)
        OR EXISTS (SELECT 1 FROM usage_records model_usage WHERE model_usage.session_id=s.id AND model_usage.model=?))`);
      bindings.push(model, normalizeModel(model));
    }
    if (effort || effortMissing) {
      conditions.push(`EXISTS (SELECT 1 FROM usage_records model_usage WHERE model_usage.session_id=s.id
        ${effortMissing ? " AND model_usage.effort IS NULL" : ""}${effort ? " AND model_usage.effort=?" : ""}${model ? " AND model_usage.model IN (?,?)" : ""})`);
      if (effort) bindings.push(effort);
      if (model) bindings.push(model, normalizeModel(model));
    }
    if (params.get("version")) {
      conditions.push("EXISTS (SELECT 1 FROM session_facets version_facet WHERE version_facet.session_id=s.id AND version_facet.kind='version' AND version_facet.value=?)");
      bindings.push(params.get("version")!);
    }
    if (params.get("bookmarked") === "1") conditions.push("b.session_id IS NOT NULL");
    if (params.get("errors") === "1") conditions.push("s.errors>0");
    if (params.get("edits") === "1") conditions.push("s.edits>0");
    // Hiding subagents only narrows the listing. Their requests were spent on behalf of the main sessions, so the usage
    // totals keep counting them below. "Subagents only" still scopes both the listing and its usage to the subagents.
    const hideAgents = params.get("agents") !== "1" && params.get("agents") !== "only";
    if (params.get("agents") === "only") conditions.push("s.agent=1");
    const pricing = params.get("pricing");
    if (pricing === "complete") conditions.push("session_usage.usageRequests>0 AND session_usage.pricedRequests=session_usage.usageRequests");
    if (pricing === "partial") conditions.push("session_usage.pricedRequests>0 AND session_usage.pricedRequests<session_usage.usageRequests");
    if (pricing === "unpriced") conditions.push("session_usage.usageRequests>0 AND session_usage.pricedRequests=0");
    if (pricing === "missing") conditions.push("session_usage.session_id IS NULL");
    for (const [key, column, comparison, integer] of [
      ["minCost", "session_usage.knownCost", ">=", false], ["maxCost", "session_usage.knownCost", "<=", false],
      ["minTokens", "session_usage.usageTokens", ">=", true], ["maxTokens", "session_usage.usageTokens", "<=", true],
      ["minRecords", "s.events", ">=", true], ["maxRecords", "s.events", "<=", true],
    ] as const) {
      const value = numericBound(params.get(key), integer);
      if (value === null) continue;
      conditions.push(`${column}${comparison}?`);
      bindings.push(value);
      if (key.endsWith("Cost")) conditions.push("session_usage.pricedRequests=session_usage.usageRequests");
    }
    if (params.get("active") === "1") {
      conditions.push("s.updated>=? AND s.mtime>=?");
      bindings.push(new Date(Date.now() - 120_000).toISOString(), Date.now() - 120_000);
    }
    if (params.get("days")) {
      const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 3650);
      conditions.push("s.updated>=?"); bindings.push(new Date(Date.now() - days * 86400000).toISOString());
    }
    for (const [key, comparison] of [["after", ">="], ["before", "<="]]) {
      const date = dateBound(params.get(key), key === "before", params.get(`${key}Tz`));
      if (date) {
        conditions.push(`s.updated ${comparison} ?`);
        bindings.push(date);
      }
    }
    if (params.get("tool")) {
      const tool = params.get("tool")!;
      if (!isFacetValue(tool)) conditions.push("0");
      else {
        conditions.push(`EXISTS (SELECT 1 FROM events e WHERE e.session_id=s.id AND ${toolCondition("e.tools", tool)})`);
        if (tool !== "mcp__") bindings.push(tool);
      }
    }
    const scope = (extra: string[]) => [...conditions, ...extra].length ? `WHERE ${[...conditions, ...extra].join(" AND ")}` : "";
    const usageWhere = scope([]);
    const where = scope(hideAgents ? ["s.agent=0"] : []);
    const total = this.db.query<{ total: number }, SQLQueryBindings[]>(`SELECT count(*) AS total ${selectionJoins} ${where}`).get(...bindings)!.total;
    const limit = Math.max(1, pageNumber(params.get("limit"), 50, 100));
    const offset = Math.min(pageNumber(params.get("offset"), 0, 1_000_000), Math.floor(Math.max(0, total - 1) / limit) * limit);
    const orders: Record<string, string> = {
      recent: "s.updated DESC", oldest: "s.updated ASC", activity: "s.events DESC",
      cost: "(coalesce(session_usage.pricedRequests,0)>0) DESC, session_usage.knownCost DESC",
      "cost-asc": "(coalesce(session_usage.pricedRequests,0)>0) DESC, session_usage.knownCost ASC",
      tokens: "(session_usage.usageRequests IS NOT NULL) DESC, session_usage.usageTokens DESC",
      "tokens-asc": "(session_usage.usageRequests IS NOT NULL) DESC, session_usage.usageTokens ASC",
      errors: "s.errors DESC", tools: "s.tools DESC", duration: "(julianday(s.updated)-julianday(s.started)) DESC",
      // Recordings without a measured turn have no active time, so they follow every measured one rather than ranking as 0.
      active: "(s.turns>0) DESC, s.active_ms DESC",
      title: "s.title COLLATE NOCASE ASC",
    };
    const sort = params.get("sort") || "recent";
    const order = Object.hasOwn(orders, sort) ? orders[sort] : orders.recent;
    const rows = this.db.query<SourceRow, SQLQueryBindings[]>(`SELECT ${columns} ${selectionJoins} ${where} ORDER BY ${order},s.updated DESC,s.id LIMIT ? OFFSET ?`).all(...bindings, limit, offset);
    const positive = terms.find(term => !term.exclude && /[\p{L}\p{N}]/u.test(term.value));
    const items = rows.map(row => {
      const session = this.session(row);
      if (positive) {
        const match = this.db.query<{ snippet: string; event_id: string; raw: string; category: ReplayEvent["category"]; role: string }, [string, string]>(`SELECT snippet(event_fts,0,'','', ' … ',28) AS snippet,e.event_id,e.raw,e.category,e.role
          FROM event_fts JOIN events e ON e.rowid=event_fts.rowid WHERE event_fts MATCH ? AND e.session_id=? ORDER BY rank LIMIT 1`)
          .get(ftsPhrase(positive.value), row.id);
        if (match) {
          session.snippet = (match.raw.length > snippetLimit ? "" : displaySnippet(match.raw, positive.value)) || stripAnsi(match.snippet);
          session.matchEventId = match.event_id;
          // The replay chooses its opening view from these, since the view decides which records the anchor offset counts.
          session.matchCategory = match.category;
          if (match.role) session.matchRole = match.role as ReplayEvent["role"];
        }
      }
      return session;
    });
    // Folder rows are split by recording type so the share of hidden subagents comes out of the same deduplicated pass.
    const usageRows = this.db.query<UsageSummary & { dimension: "directory" | "model"; cwd: string; agent: number; model: string; effort: string | null }, SQLQueryBindings[]>(`WITH ranked AS (
      SELECT usage.*, s.cwd, s.agent, row_number() OVER (PARTITION BY request_key ORDER BY sidechain,
        input+output+cache_creation+cache_read DESC, recorded DESC, cost DESC, effort IS NULL, s.started, s.id) AS position
      FROM usage_records usage JOIN sessions s ON s.id=usage.session_id
      LEFT JOIN group_paths gp ON gp.path=s.cwd LEFT JOIN groups g ON g.id=gp.group_id
      LEFT JOIN bookmarks b ON b.session_id=s.id ${sessionUsageJoin} ${usageWhere}
    ), selected AS (SELECT * FROM ranked WHERE position=1)
      SELECT 'directory' AS dimension,cwd,agent,'' AS model,NULL AS effort,${usageColumns} FROM selected GROUP BY cwd,agent
      UNION ALL SELECT 'model' AS dimension,'' AS cwd,0 AS agent,model,effort,${usageColumns} FROM selected GROUP BY model,effort`).all(...bindings);
    const directoryCounts = this.db.query<{ cwd: string; sessions: number; withUsage: number }, SQLQueryBindings[]>(
      `SELECT s.cwd, count(*) AS sessions, sum(EXISTS(SELECT 1 FROM usage_records WHERE session_id=s.id)) AS withUsage ${selectionJoins} ${usageWhere} GROUP BY s.cwd`).all(...bindings);
    const byDirectory = new Map<string, UsageSummary>();
    const modelUsage: ModelUsage[] = [];
    const hiddenAgentUsage = emptyUsage();
    for (const { dimension, cwd, agent, model, effort, ...usage } of usageRows) {
      if (dimension === "model") { modelUsage.push({ model, effort, usage }); continue; }
      addUsage(byDirectory.get(cwd) ?? byDirectory.set(cwd, emptyUsage()).get(cwd)!, usage);
      if (agent && hideAgents) addUsage(hiddenAgentUsage, usage);
    }
    modelUsage.sort((left, right) => right.usage.costUSD - left.usage.costUSD || right.usage.totalTokens - left.usage.totalTokens
      || left.model.localeCompare(right.model) || (left.effort || "").localeCompare(right.effort || ""));
    const directories: DirectoryUsage[] = directoryCounts.map(directory => ({ ...directory, usage: byDirectory.get(directory.cwd) || emptyUsage() }))
      .sort((left, right) => right.usage.costUSD - left.usage.costUSD || right.usage.totalTokens - left.usage.totalTokens || left.cwd.localeCompare(right.cwd));
    const usage = emptyUsage();
    for (const directory of directories) addUsage(usage, directory.usage);
    const counted = directoryCounts.reduce((sums, directory) => ({ sessions: sums.sessions + directory.sessions, withUsage: sums.withUsage + directory.withUsage }), { sessions: 0, withUsage: 0 });
    // Claude Code's totals are per session and already count that session's subagents, so they are summed over the same
    // scope as `usage`, hidden subagents included, and a subagent recording contributes only when it carries its own.
    const recordedCost = this.db.query<RecordedCostTotal, SQLQueryBindings[]>(
      `SELECT coalesce(sum(sc.cost),0) AS costUSD, count(sc.cost) AS recordings ${selectionJoins} ${usageWhere}`).get(...bindings)!;
    return { items, total, offset, limit, usage, directories, modelUsage, sessionsWithUsage: counted.withUsage, hiddenAgents: counted.sessions - total, hiddenAgentUsage, recordedCost };
  }

  private eventFilter(id: string, params: URLSearchParams): { filter: string; bindings: SQLQueryBindings[] } {
    const bindings: SQLQueryBindings[] = [id];
    let filter = "e.session_id=?";
    const kind = params.get("kind");
    if (kind === "conversation") filter += " AND e.category NOT IN ('system','hidden')";
    else if (kind === "tool") filter += " AND e.has_tools=1";
    else if (kind === "thinking") filter += " AND e.has_thinking=1";
    else if (kind === "prompts") filter += " AND e.role='user' AND e.category='message'";
    else if (kind === "responses") filter += " AND e.role='assistant' AND e.category='message'";
    else if (kind === "edits") filter += ` AND (EXISTS (SELECT 1 FROM tool_calls call WHERE call.event_row=e.rowid AND lower(call.name) IN ('edit','write','multiedit','notebookedit'))
      OR EXISTS (SELECT 1 FROM tool_results result JOIN tool_calls call ON call.session_id=result.session_id AND call.tool_id=result.tool_id
        WHERE result.event_row=e.rowid AND lower(call.name) IN ('edit','write','multiedit','notebookedit')))`;
    else if (["message", "system"].includes(kind || "")) { filter += " AND e.category=?"; bindings.push(kind!); }
    // The Errors view shows the tools a decision stopped, or an interruption or cancellation ended, beside the failures,
    // each labelled; only the failures count toward a recording's errors and the activity strip's error bars.
    if (params.get("errors") === "1") filter += " AND (e.error=1 OR e.decision=1)";
    if (params.get("q")) { filter += " AND instr(lower(e.text),lower(?))>0"; bindings.push(params.get("q")!.slice(0, 1000)); }
    for (const field of ["model", "cwd"]) {
      if (params.get(field)) { filter += ` AND e.${field}=?`; bindings.push(params.get(field)!); }
    }
    const tool = params.get("tool");
    if (tool && !isFacetValue(tool)) filter += " AND 0";
    else if (tool) {
      const callMatch = tool === "mcp__" ? "substr(lower(call.name),1,5)='mcp__'" : "lower(call.name)=lower(?)";
      filter += ` AND (${toolCondition("e.tools", tool)} OR EXISTS (
        SELECT 1 FROM tool_results result JOIN tool_calls call ON call.session_id=result.session_id AND call.tool_id=result.tool_id
        WHERE result.event_row=e.rowid AND ${callMatch}))`;
      if (tool !== "mcp__") bindings.push(tool, tool);
    }
    for (const [field, comparison] of [["after", ">="], ["before", "<="]]) {
      const date = dateBound(params.get(field), field === "before", params.get(`${field}Tz`));
      if (date) { filter += ` AND e.timestamp!='' AND e.timestamp${comparison}?`; bindings.push(date); }
    }
    return { filter, bindings };
  }

  events(id: string, params: URLSearchParams): EventPage {
    const { filter, bindings } = this.eventFilter(id, params);
    const total = this.db.query<{ total: number }, SQLQueryBindings[]>(`SELECT count(*) AS total FROM events e WHERE ${filter}`).get(...bindings)!.total;
    const limit = Math.max(1, pageNumber(params.get("limit"), 80, 200));
    let offset = pageNumber(params.get("offset"), 0, 1_000_000);
    if (params.get("anchor")) {
      const anchor = this.db.query<{ sequence: number }, [string, string]>("SELECT sequence FROM events WHERE session_id=? AND event_id=?").get(id, params.get("anchor")!);
      if (anchor) {
        offset = this.db.query<{ count: number }, SQLQueryBindings[]>(`SELECT count(*) AS count FROM events e WHERE ${filter} AND e.sequence<?`).get(...bindings, anchor.sequence)!.count;
        if (params.get("context") === "1") offset = Math.max(0, offset - 8);
      }
    }
    offset = Math.min(offset, Math.max(0, total - 1));
    const items = this.db.query<StoredEvent, SQLQueryBindings[]>(`SELECT e.raw,e.event_id,e.sequence,e.offset,e.text FROM events e WHERE ${filter} ORDER BY e.sequence LIMIT ? OFFSET ?`)
      .all(...bindings, limit, offset).map(row => {
        const event = normalize(JSON.parse(row.raw), id, row.offset, row.sequence);
        // A message copy's searchable text depends on the records before it, so the page carries the stored text that
        // Find and the `q` filter test.
        return event.type === requestMessageType ? { ...event, text: row.text } : event;
      });
    const unfilteredTotal = this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM events WHERE session_id=?").get(id)!.total;
    const hiddenTotal = this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM events WHERE session_id=? AND category='hidden'").get(id)!.total;
    let facets = this.replayFacets.get(id);
    if (!facets) {
      const tools = this.facetValues("tool", id), models = this.facetValues("model", id), directories = this.facetValues("cwd", id);
      facets = { tools: tools.values, models: models.values, directories: directories.values, limited: tools.limited || models.limited || directories.limited };
      if (this.replayFacets.size >= 32) this.replayFacets.delete(this.replayFacets.keys().next().value!);
      this.replayFacets.set(id, facets);
    }
    return { items, total, offset, limit, unfilteredTotal, hiddenTotal, facets };
  }

  // Lists the records that contain `find`, using the same substring test as the `q` filter, at their positions under
  // the rest of the filter. The client steps through these and pages with `offset=position`, so a match on a later page
  // is reachable without loading every page in between.
  matches(id: string, params: URLSearchParams): FindMatches {
    const find = (params.get("find") || "").slice(0, 1000);
    if (!find) return { total: 0, limited: false, items: [] };
    const { filter, bindings } = this.eventFilter(id, params);
    const limit = Math.max(1, pageNumber(params.get("limit"), findMatchLimit, findMatchLimit));
    const rows = this.db.query<{ position: number; sequence: number; id: string; total: number }, SQLQueryBindings[]>(`SELECT position, sequence, id, count(*) OVER () AS total FROM (
        SELECT row_number() OVER (ORDER BY e.sequence) - 1 AS position, e.sequence, e.event_id AS id, instr(lower(e.text),lower(?))>0 AS found
        FROM events e WHERE ${filter}) WHERE found ORDER BY position LIMIT ?`).all(find, ...bindings, limit);
    const total = rows[0]?.total ?? 0;
    return { total, limited: rows.length < total, items: rows.map(({ position, sequence, id }) => ({ position, sequence, id })) };
  }

  // The files a recording changed and read, grouped under the folders it worked in. The grouping is cached per recording
  // size like the timeline. Positions follow the request's replay filters, as in `matches()`, so a summary entry opens
  // the page that holds its record, or reports that the active view hides it.
  summary(id: string, params: URLSearchParams): SessionSummary {
    const total = this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM events WHERE session_id=?").get(id)!.total;
    let cached = this.replaySummaries.get(id);
    if (cached?.total !== total) {
      cached = { total, summary: this.summaryData(id) };
      this.replaySummaries.delete(id);
      if (this.replaySummaries.size >= 32) this.replaySummaries.delete(this.replaySummaries.keys().next().value!);
      this.replaySummaries.set(id, cached);
    }
    const { filter, bindings } = this.eventFilter(id, params);
    const rows = this.db.query<{ id: string; position: number }, SQLQueryBindings[]>(`SELECT id, position FROM (
        SELECT e.event_id AS id, row_number() OVER (ORDER BY e.sequence) - 1 AS position FROM events e WHERE ${filter})
      WHERE id IN (SELECT value FROM json_each(?))`).all(...bindings, JSON.stringify(summaryRecordIds(cached.summary)));
    return placeSummary(cached.summary, new Map(rows.map(row => [row.id, row.position])));
  }

  // Inputs are read from each call's own record, one record at a time, because a Write record carries the whole file it
  // wrote. A result's error flag is found in SQL for the same reason: a Read result carries the whole file it read. The
  // stored result is serialized JSON, where a quote inside recorded text is always escaped, so the flag cannot be faked.
  // Only a flagged result travels, to tell a failure from a decision, an interruption, or a cancellation; the record's
  // `toolDenialKind` travels with it, copied onto the stored result by `normalize()`.
  private summaryData(id: string): SessionSummary {
    const record = (row: { id: string; timestamp: string }): SummaryRecord => ({ id: row.id, position: null, timestamp: row.timestamp });
    const roots: Array<SummaryRoot & { sequence: number }> = this.db.query<{ cwd: string; id: string; sequence: number; timestamp: string }, [string, string]>(
      `SELECT e.cwd, e.event_id AS id, e.sequence, e.timestamp FROM events e JOIN (
        SELECT cwd, min(sequence) AS first FROM events WHERE session_id=? AND cwd!='' GROUP BY cwd) f ON e.cwd=f.cwd AND e.sequence=f.first
      WHERE e.session_id=?`).all(id, id).map(row => ({ path: row.cwd, added: false, record: record(row), sequence: row.sequence }));
    // Claude Code records `/add-dir` as a user or system record and its outcome as a following local command output that
    // names the command as its parentUuid. Assistant text that quotes either is not the command. A recording without
    // parentUuid links can only pair a command with an output recorded directly after it. The copies an API request
    // stores of both are not the command either.
    const outputs = this.db.query<{ raw: string; sequence: number }, [string, number, number, string]>(
      "SELECT raw, sequence FROM events WHERE session_id=? AND sequence>? AND sequence<=? AND role IN ('user','system') AND type!=? AND instr(text,'<local-command-stdout>')>0 ORDER BY sequence");
    for (const row of this.db.query<{ id: string; sequence: number; timestamp: string; raw: string }, [string, string]>(
      "SELECT event_id AS id, sequence, timestamp, raw FROM events WHERE session_id=? AND role IN ('user','system') AND type!=? AND instr(text,'/add-dir')>0 ORDER BY sequence").all(id, requestMessageType)) {
      const command = object(JSON.parse(row.raw));
      if (!isAddDirCommand(recordText(command))) continue;
      const candidates = outputs.all(id, row.sequence, row.sequence + 5, requestMessageType).map(output => ({ sequence: output.sequence, raw: object(JSON.parse(output.raw)) }));
      const uuid = string(command.uuid);
      const output = (uuid ? candidates.find(entry => string(entry.raw.parentUuid) === uuid) : undefined)
        ?? candidates.find(entry => entry.sequence === row.sequence + 1 && !string(entry.raw.parentUuid));
      const path = output ? addedDirectory(recordText(output.raw)) : null;
      if (path) roots.push({ path, added: true, record: record(row), sequence: row.sequence });
    }
    roots.sort((left, right) => left.sequence - right.sequence);

    const tools = [...changeTools, "read"];
    const calls: SummaryCall[] = [];
    const source = this.db.query<{ raw: string }, [number]>("SELECT raw FROM events WHERE rowid=?");
    let parsed = null as { row: number; blocks: unknown[] } | null;
    for (const row of this.db.query<{ toolId: string; name: string; row: number; id: string; timestamp: string; cwd: string; flagged: string | null }, SQLQueryBindings[]>(
      `SELECT call.tool_id AS toolId, call.name, call.event_row AS row, e.event_id AS id, e.timestamp, e.cwd, CASE WHEN instr(result.raw,'"is_error":true')>0 THEN result.raw END AS flagged
        FROM tool_calls call JOIN events e ON e.rowid=call.event_row
        LEFT JOIN tool_results result ON result.session_id=call.session_id AND result.tool_id=call.tool_id
        WHERE call.session_id=? AND lower(call.name) IN (${tools.map(() => "?").join(",")}) ORDER BY e.sequence`).all(id, ...tools)) {
      if (parsed?.row !== row.row) parsed = { row: row.row, blocks: contentBlocks(JSON.parse(source.get(row.row)?.raw || "{}")) };
      const block = object(parsed.blocks.find(entry => object(entry).type === "tool_use" && object(entry).id === row.toolId));
      const input = object(block.input);
      const path = string(input.file_path) || string(input.notebook_path);
      if (!path) continue;
      const decision = row.flagged ? resultDecision(jsonRecord(row.flagged) as ContentBlock) : null;
      calls.push({ tool: row.name, path, cwd: row.cwd, error: row.flagged !== null && !decision, decision, record: record(row) });
    }
    return buildSummary(roots, calls);
  }

  // Positions are the same ordinals `events()` pages by, so a bucket's `first` is directly a page offset. Undated
  // records ride with the latest earlier timestamp, which also keeps every bucket a contiguous run of positions.
  // The whole recording sets the axis, so changing tabs or filters never slides activity sideways; `all` carries it.
  timeline(id: string, params: URLSearchParams): EventTimeline {
    const { filter, bindings } = this.eventFilter(id, params);
    const unfilteredTotal = this.db.query<{ total: number }, [string]>("SELECT count(*) AS total FROM events WHERE session_id=?").get(id)!.total;
    let unfiltered = this.replayTimelines.get(id);
    if (unfiltered?.total !== unfilteredTotal) {
      unfiltered = { total: unfilteredTotal, rows: this.timelineRows("e.session_id=?", [id]) };
      this.replayTimelines.delete(id);
      if (this.replayTimelines.size >= 32) this.replayTimelines.delete(this.replayTimelines.keys().next().value!);
      this.replayTimelines.set(id, unfiltered);
    }
    const rows = filter === "e.session_id=?" ? unfiltered.rows : this.timelineRows(filter, bindings, id);
    // Coarsen minute buckets to 10 minutes, hours, or days until the response stays small on very long recordings.
    const [width, bucketMs] = timelineGranularities.find(([length]) => new Set(unfiltered.rows.map(row => row.at?.slice(0, length))).size <= timelineBucketLimit) ?? timelineGranularities.at(-1)!;
    const key = (at: string | null) => at === null ? null : `${at.slice(0, width)}${"0000-00-00T00:00".slice(width)}:00.000Z`;
    const buckets = new Map<string | null, TimelineBucket>();
    const bucket = (at: string | null) => buckets.get(key(at)) ?? buckets.set(key(at), { at: key(at), all: 0, count: 0, first: null, last: null, errors: 0 }).get(key(at))!;
    for (const row of unfiltered.rows) bucket(row.at).all += row.count;
    for (const row of rows) {
      const target = bucket(row.at);
      target.count += row.count; target.errors += row.errors;
      target.first = Math.min(target.first ?? row.first, row.first);
      target.last = Math.max(target.last ?? row.last, row.last);
    }
    return {
      total: rows.reduce((sum, row) => sum + row.count, 0), unfilteredTotal, bucketMs,
      buckets: [...buckets.values()].sort((left, right) => left.at === right.at ? 0 : left.at === null ? -1 : right.at === null ? 1 : left.at < right.at ? -1 : 1),
    };
  }

  // Positions are the same ordinals `events()` pages by, so a bucket's `first` is directly a page offset. Each record's
  // time is the latest timestamp at or before it in the whole recording, so undated records and a clock that steps
  // backwards land in the same bucket whether or not a filter hides their neighbours.
  private timelineRows(filter: string, bindings: SQLQueryBindings[], id?: string): TimelineRow[] {
    const stamp = "max(nullif(e.timestamp,'')) OVER (ORDER BY e.sequence ROWS UNBOUNDED PRECEDING)";
    const source = id
      ? `SELECT row_number() OVER (ORDER BY sequence) - 1 AS position, error, stamp FROM (
          SELECT e.sequence, e.error, ${stamp} AS stamp, (${filter}) AS matched FROM events e WHERE e.session_id=?) WHERE matched`
      : `SELECT row_number() OVER (ORDER BY e.sequence) - 1 AS position, e.error, ${stamp} AS stamp FROM events e WHERE ${filter}`;
    return this.db.query<TimelineRow, SQLQueryBindings[]>(`WITH filtered AS (${source})
      SELECT substr(stamp,1,16) AS at, count(*) AS count, min(position) AS first, max(position) AS last, sum(error) AS errors
      FROM filtered GROUP BY at ORDER BY first`).all(...bindings, ...(id ? [id] : []));
  }

  private facetValues(kind: string, id?: string): { values: string[]; limited: boolean } {
    const rows = this.db.query<{ value: string }, SQLQueryBindings[]>(`SELECT DISTINCT value FROM session_facets
      WHERE kind=?${id ? " AND session_id=?" : ""} ORDER BY value LIMIT ?`).all(kind, ...(id ? [id] : []), facetLimit + 1);
    return { values: rows.slice(0, facetLimit).map(row => row.value), limited: rows.length > facetLimit };
  }

  results(id: string, toolIds: string[]): Record<string, ContentBlock> {
    const found: Record<string, ContentBlock> = Object.create(null);
    if (!toolIds.length) return found;
    const lookup = this.db.query<{ raw: string }, [string, string]>("SELECT raw FROM tool_results WHERE session_id=? AND tool_id=?");
    for (const toolId of new Set(toolIds)) {
      const row = lookup.get(id, toolId);
      if (row) found[toolId] = JSON.parse(row.raw);
    }
    return found;
  }

  // The calls behind tool results, so a result shown without its call can still name the tool and what it ran on. Only
  // what that header needs travels: the recorded name and the call's top-level text inputs, each capped, so a page of
  // results never ships a written file's contents a second time. The full call stays in its own event.
  calls(id: string, toolIds: string[]): Record<string, ContentBlock> {
    const found: Record<string, ContentBlock> = Object.create(null);
    if (!toolIds.length) return found;
    const lookup = this.db.query<{ name: string; raw: string }, [string, string]>(
      "SELECT call.name,e.raw FROM tool_calls call JOIN events e ON e.rowid=call.event_row WHERE call.session_id=? AND call.tool_id=?");
    for (const toolId of new Set(toolIds)) {
      const row = lookup.get(id, toolId);
      if (!row) continue;
      const block = normalize(JSON.parse(row.raw), id, 0, 0).blocks.find(block => block.type === "tool_use" && block.id === toolId);
      const input: Record<string, string> = {};
      for (const [key, value] of Object.entries(object(block?.input)).slice(0, callInputKeys)) {
        if (typeof value === "string") input[key] = value.length > callInputLength ? `${value.slice(0, callInputLength - 1)}…` : value;
      }
      found[toolId] = { type: "tool_use", id: toolId, name: row.name, input };
    }
    return found;
  }

  bookmark(id: string, value: boolean): void {
    if (!this.getSession(id)) throw new Error("Session not found");
    if (value) this.db.query("INSERT OR IGNORE INTO bookmarks VALUES (?)").run(id);
    else this.db.query("DELETE FROM bookmarks WHERE session_id=?").run(id);
    this.index.emit([id]);
  }

  groups(): WorkspaceGroup[] {
    return this.db.query<{ id: string; name: string }, []>("SELECT id,name FROM groups ORDER BY name").all().map(group => ({
      ...group, paths: this.db.query<{ path: string }, [string]>("SELECT path FROM group_paths WHERE group_id=? ORDER BY path").all(group.id).map(row => row.path),
    }));
  }

  saveGroup(input: unknown): WorkspaceGroup {
    const value = object(input);
    const name = string(value.name).trim();
    const paths = Array.isArray(value.paths) ? [...new Set(value.paths.filter((entry): entry is string => typeof entry === "string"))] : [];
    if (!name || name.length > 80 || paths.length < 2 || paths.length > 100) throw new Error("Choose a name and at least two source folders.");
    const id = string(value.id) || randomUUID();
    for (const path of paths) {
      if (!this.db.query("SELECT 1 FROM sessions WHERE cwd=?").get(path)) throw new Error("Unknown source folder.");
      const existing = this.db.query<{ group_id: string }, [string]>("SELECT group_id FROM group_paths WHERE path=?").get(path);
      if (existing && existing.group_id !== id) throw new Error("A source folder already belongs to another group. Ungroup it first.");
    }
    this.db.transaction(() => {
      this.db.query("INSERT INTO groups VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name").run(id, name);
      this.db.query("DELETE FROM group_paths WHERE group_id=?").run(id);
      for (const path of paths) this.db.query("INSERT INTO group_paths VALUES (?,?)").run(path, id);
    })();
    this.workspaceUsage = null;
    this.index.emit();
    return { id, name, paths };
  }

  deleteGroup(id: string): void {
    this.db.query("DELETE FROM groups WHERE id=?").run(id);
    this.workspaceUsage = null;
    this.index.emit();
  }

  async catalog(): Promise<Catalog> {
    if (!this.catalogFacets) {
      const models = this.facetValues("model"), tools = this.facetValues("tool");
      const efforts = this.db.query<{ effort: string }, [number]>("SELECT DISTINCT effort FROM usage_records WHERE effort IS NOT NULL ORDER BY effort LIMIT ?").all(facetLimit + 1);
      // Every distinct version is read before the limit applies, so the newest stay listed however many there are.
      const versions = newestVersions(this.db.query<{ value: string }, []>("SELECT DISTINCT value FROM session_facets WHERE kind='version'").all().map(row => row.value), facetLimit);
      this.catalogFacets = {
        models: models.values, toolsUsed: tools.values, efforts: efforts.slice(0, facetLimit).map(row => row.effort),
        versions: versions.values, unrecognizedKinds: this.facetValues("unrecognized").values,
        facetsLimited: models.limited || tools.limited || efforts.length > facetLimit || versions.limited,
      };
    }
    const totals = this.db.query<{ sessions: number; messages: number; tools: number; errors: number; warnings: number; unrecognizedRecords: number }, []>(
      "SELECT count(*) AS sessions,coalesce(sum(messages),0) AS messages,coalesce(sum(tools),0) AS tools,coalesce(sum(errors),0) AS errors,coalesce(sum(warnings),0) AS warnings,coalesce(sum(unrecognized),0) AS unrecognizedRecords FROM sessions").get()!;
    const sources = this.db.query<{ cwd: string; count: number; mainCount: number }, []>("SELECT cwd,count(*) AS count,sum(CASE WHEN agent=0 THEN 1 ELSE 0 END) AS mainCount FROM sessions GROUP BY cwd ORDER BY count(*) DESC").all();
    const groups = this.groups();
    if (!this.workspaceUsage) {
      const usageRows = this.db.query<UsageSummary & { workspace: string }, []>(`WITH ranked AS (
        SELECT usage.*, coalesce(gp.group_id,s.cwd) AS workspace,
          row_number() OVER (PARTITION BY coalesce(gp.group_id,s.cwd),request_key ORDER BY sidechain,
            input+output+cache_creation+cache_read DESC, recorded DESC, cost DESC, effort IS NULL, s.started, s.id) AS position
        FROM usage_records usage JOIN sessions s ON s.id=usage.session_id
        LEFT JOIN group_paths gp ON gp.path=s.cwd
      ) SELECT workspace,${usageColumns} FROM ranked WHERE position=1 GROUP BY workspace`).all();
      this.workspaceUsage = new Map(usageRows.map(({ workspace, ...usage }) => [workspace, usage]));
    }
    const usageByWorkspace = this.workspaceUsage;
    const workspaces = groups.map(group => ({ ...group, grouped: true, count: sources.filter(row => group.paths.includes(row.cwd)).reduce((sum, row) => sum + row.count, 0), mainCount: sources.filter(row => group.paths.includes(row.cwd)).reduce((sum, row) => sum + row.mainCount, 0), usage: usageByWorkspace.get(group.id) || emptyUsage() }));
    for (const source of sources) if (!groups.some(group => group.paths.includes(source.cwd))) {
      workspaces.push({ id: source.cwd || "unknown", name: pathName(source.cwd), paths: [source.cwd], count: source.count, mainCount: source.mainCount, grouped: false, usage: usageByWorkspace.get(source.cwd) || emptyUsage() });
    }
    return {
      ...totals, warnings: totals.warnings + this.index.scanWarnings, groups, workspaces: workspaces.sort((left, right) => right.count - left.count),
      mainSessions: sources.reduce((sum, row) => sum + row.mainCount, 0),
      mainBookmarked: this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM bookmarks b JOIN sessions s ON b.session_id=s.id WHERE s.agent=0").get()!.count,
      bookmarked: this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM bookmarks b JOIN sessions s ON b.session_id=s.id").get()!.count,
      ...this.catalogFacets,
      dataDir: this.dataDir, indexedAt: this.index.indexedAt, demo: await Bun.file(join(this.dataDir, ".blackbox-demo")).exists(),
    };
  }
}
