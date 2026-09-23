import { Database, type SQLQueryBindings } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, stat, open } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Catalog, DirectoryUsage, EventPage, ModelUsage, ReplayEvent, Session, SessionPage, UsageSummary, WorkspaceGroup } from "../shared/types";
import { readJsonLines } from "./jsonl";
import { displaySnippet, normalize, object, pathName, promptTitle, string } from "./normalize";
import { ftsPhrase, pageNumber, parseSearch } from "./search";
import { emptyUsage, readUsage, usageColumns } from "./usage";

interface SourceRow {
  id: string; session_id: string; source: string; cwd: string; title: string; branch: string; model: string;
  started: string; updated: string; events: number; messages: number; tools: number; errors: number;
  edits: number; agent: number; size: number; mtime: number; cursor: number; fingerprint: string;
  warnings: number; named: number; identity: string; tailprint: string; group_id?: string; group_name?: string; bookmarked?: number;
}

interface StoredEvent { raw: string; event_id: string; sequence: number; offset: number; text: string }

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source TEXT NOT NULL UNIQUE,
    cwd TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '', started TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '',
    events INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0, tools INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0, edits INTEGER NOT NULL DEFAULT 0, agent INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0, mtime REAL NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT NOT NULL DEFAULT '', warnings INTEGER NOT NULL DEFAULT 0, named INTEGER NOT NULL DEFAULT 0,
    identity TEXT NOT NULL DEFAULT '', tailprint TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS events (
    rowid INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, offset INTEGER NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
    error INTEGER NOT NULL, tools TEXT NOT NULL, raw TEXT NOT NULL, text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_session ON events(session_id, sequence);
  CREATE TABLE IF NOT EXISTS usage_records (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL,
    cache_creation INTEGER NOT NULL, cache_read INTEGER NOT NULL, cost REAL,
    recorded INTEGER NOT NULL, sidechain INTEGER NOT NULL,
    model TEXT NOT NULL DEFAULT '', effort TEXT,
    PRIMARY KEY(session_id, request_key)
  );
  CREATE TABLE IF NOT EXISTS tool_results (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_id TEXT NOT NULL, raw TEXT NOT NULL,
    event_row INTEGER NOT NULL REFERENCES events(rowid) ON DELETE CASCADE,
    PRIMARY KEY(session_id, tool_id)
  );
  CREATE INDEX IF NOT EXISTS tool_results_event ON tool_results(event_row);
  CREATE INDEX IF NOT EXISTS sessions_cwd ON sessions(cwd);
  CREATE INDEX IF NOT EXISTS sessions_updated ON sessions(updated DESC);
  CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(text, content='events', content_rowid='rowid', tokenize='unicode61');
  CREATE TRIGGER IF NOT EXISTS event_insert AFTER INSERT ON events BEGIN
    INSERT INTO event_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS event_delete AFTER DELETE ON events BEGIN
    INSERT INTO event_fts(event_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TABLE IF NOT EXISTS bookmarks (session_id TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS group_paths (path TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE);
`;

const joins = `FROM sessions s LEFT JOIN group_paths gp ON gp.path = s.cwd
  LEFT JOIN groups g ON g.id = gp.group_id LEFT JOIN bookmarks b ON b.session_id = s.id`;
const columns = `s.*, g.id AS group_id, g.name AS group_name, (b.session_id IS NOT NULL) AS bookmarked`;
const snippetLimit = 262_144;

async function physicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (object(error).code !== "ENOENT") throw error;
    const parent = dirname(path);
    return parent === path ? path : join(await physicalPath(parent), basename(path));
  }
}

export class Recorder {
  readonly db: Database;
  readonly dataDir: string;
  readonly stateDir: string;
  readonly listeners = new Set<(ids: string[]) => void>();
  indexedAt = "";
  private scanning: Promise<string[]> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private scanWarnings = 0;
  private workspaceUsage: Map<string, UsageSummary> | null = null;

  private constructor(dataDir: string, stateDir: string, db: Database) {
    this.dataDir = resolve(dataDir);
    this.stateDir = resolve(stateDir);
    this.db = db;
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    if (version > 4) throw new Error("This index was created by a newer version. Choose a different state directory.");
    const hasResults = db.query("SELECT name FROM sqlite_master WHERE name='tool_results'").get();
    db.exec(schema);
    const fields = new Set(db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().map(row => row.name));
    if (!fields.has("identity")) db.exec("ALTER TABLE sessions ADD COLUMN identity TEXT NOT NULL DEFAULT ''");
    if (!fields.has("tailprint")) db.exec("ALTER TABLE sessions ADD COLUMN tailprint TEXT NOT NULL DEFAULT ''");
    const usageFields = new Set(db.query<{ name: string }, []>("PRAGMA table_info(usage_records)").all().map(row => row.name));
    if (!usageFields.has("model")) db.exec("ALTER TABLE usage_records ADD COLUMN model TEXT NOT NULL DEFAULT ''");
    if (!usageFields.has("effort")) db.exec("ALTER TABLE usage_records ADD COLUMN effort TEXT");
    if (!hasResults || version < 4) db.exec("UPDATE sessions SET mtime=0, identity=''; PRAGMA user_version=4;");
    const interrupted = db.query<{ id: string }, []>("SELECT id FROM sessions WHERE events != (SELECT count(*) FROM events WHERE session_id=sessions.id)").all();
    for (const row of interrupted) db.query("UPDATE sessions SET mtime=0, identity='' WHERE id=?").run(row.id);
  }

  static async open(dataDir: string, stateDir: string): Promise<Recorder> {
    const [root, state] = await Promise.all([physicalPath(resolve(dataDir)), physicalPath(resolve(stateDir))]);
    const compareRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const compareState = process.platform === "win32" ? state.toLowerCase() : state;
    if (compareState === compareRoot || compareState.startsWith(compareRoot + sep)) throw new Error("The state directory must be outside the Claude data directory.");
    await mkdir(state, { recursive: true, mode: 0o700 });
    const database = new Database(join(state, "index.sqlite"), { create: true });
    try {
      const recorder = new Recorder(root, state, database);
      await recorder.scan();
      return recorder;
    } catch (error) { database.close(); throw error; }
  }

  watch(interval = 2500): void {
    this.timer = setInterval(() => { void this.scan().catch(error => console.error("Index refresh failed:", error.message)); }, interval);
    this.timer.unref();
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.scanning;
    this.listeners.clear();
    this.db.close();
  }

  scan(): Promise<string[]> {
    if (this.stopped) return Promise.resolve([]);
    if (this.scanning) return this.scanning;
    this.scanning = this.reconcile().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  private async discover(directory: string, files: string[], depth = 0): Promise<boolean> {
    if (depth > 6) return true;
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      let complete = true;
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) complete = await this.discover(path, files, depth + 1) && complete;
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
      }
      return complete;
    } catch (error) {
      if (object(error).code === "ENOENT") return true;
      this.scanWarnings++;
      return false;
    }
  }

  private async fingerprint(path: string, size: number, tail = false): Promise<string> {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(Math.min(size, 256));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, tail ? Math.max(0, size - buffer.length) : 0);
      return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
    } finally { await file.close(); }
  }

  private async reconcile(): Promise<string[]> {
    this.scanWarnings = 0;
    const files: string[] = [];
    const complete = await this.discover(join(this.dataDir, "projects"), files);
    const known = new Map(this.db.query<SourceRow, []>("SELECT * FROM sessions").all().map(row => [row.source, row]));
    const changed: string[] = [];
    for (const path of files) {
      const previous = known.get(path);
      known.delete(path);
      try {
        const info = await stat(path);
        const identity = `${info.dev}:${info.ino}`;
        if (previous && previous.size === info.size && previous.mtime === info.mtimeMs && previous.identity === identity) continue;
        const id = previous?.id || createHash("sha256").update(relative(this.dataDir, path)).digest("hex").slice(0, 24);
        const reset = previous && (info.size <= previous.size || previous.identity !== identity ||
          previous.fingerprint !== await this.fingerprint(path, previous.size) || previous.tailprint !== await this.fingerprint(path, previous.size, true));
        if (!previous) this.db.query("INSERT INTO sessions(id, session_id, source, agent) VALUES (?, ?, ?, ?)")
          .run(id, basename(path, ".jsonl"), path, Number(path.includes(`${sep}subagents${sep}`) || basename(path).startsWith("agent-")));
        if (reset) this.db.transaction(() => {
          this.db.query("DELETE FROM events WHERE session_id = ?").run(id);
          this.db.query("DELETE FROM usage_records WHERE session_id = ?").run(id);
          this.db.query(`UPDATE sessions SET title='',cwd='',branch='',model='',started='',updated='',events=0,
            messages=0,tools=0,errors=0,edits=0,cursor=0,warnings=0,named=0 WHERE id=?`).run(id);
        })();
        const row = this.db.query<SourceRow, [string]>("SELECT * FROM sessions WHERE id=?").get(id)!;
        let batch: ReplayEvent[] = [];
        const write = this.db.transaction((events: ReplayEvent[]) => {
          const insert = this.db.query(`INSERT OR IGNORE INTO events(event_id,session_id,sequence,offset,category,type,error,tools,raw,text)
            VALUES (?,?,?,?,?,?,?,?,?,?)`);
          const insertResult = this.db.query("INSERT OR REPLACE INTO tool_results(session_id,tool_id,raw,event_row) VALUES (?,?,?,?)");
          const insertUsage = this.db.query(`INSERT INTO usage_records(session_id,request_key,input,output,cache_creation,cache_read,cost,recorded,sidechain,model,effort) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id,request_key) DO UPDATE SET input=excluded.input, output=excluded.output,
              cache_creation=excluded.cache_creation, cache_read=excluded.cache_read, cost=excluded.cost,
              recorded=excluded.recorded, sidechain=excluded.sidechain,
              model=CASE WHEN excluded.model='' THEN usage_records.model ELSE excluded.model END,
              effort=coalesce(excluded.effort,usage_records.effort)
            WHERE excluded.sidechain < usage_records.sidechain OR (excluded.sidechain = usage_records.sidechain AND
              (excluded.input+excluded.output+excluded.cache_creation+excluded.cache_read > usage_records.input+usage_records.output+usage_records.cache_creation+usage_records.cache_read
              OR (excluded.input+excluded.output+excluded.cache_creation+excluded.cache_read = usage_records.input+usage_records.output+usage_records.cache_creation+usage_records.cache_read
                AND (excluded.recorded > usage_records.recorded OR (excluded.recorded = usage_records.recorded AND coalesce(excluded.cost,-1) > coalesce(usage_records.cost,-1))))))`);
          const enrichEffort = this.db.query("UPDATE usage_records SET effort=? WHERE session_id=? AND request_key=? AND effort IS NULL");
          for (const event of events) {
            const inserted = insert.run(event.id, id, event.sequence, event.offset, event.category, event.type,
              Number(event.error), event.toolNames.join("\n"), JSON.stringify(event.raw), event.text);
            const usage = readUsage(event.raw, id, event.id);
            if (usage) {
              insertUsage.run(id, usage.key, usage.input, usage.output, usage.cacheCreation, usage.cacheRead, usage.cost, Number(usage.recorded), Number(usage.sidechain), usage.model, usage.effort);
              if (usage.effort) enrichEffort.run(usage.effort, id, usage.key);
            }
            if (inserted.changes) for (const block of event.blocks) {
              if (block.type === "tool_result" && typeof block.tool_use_id === "string") insertResult.run(id, block.tool_use_id, JSON.stringify(block), inserted.lastInsertRowid);
            }
          }
        });
        for await (const line of readJsonLines(path, row.cursor, info.size)) {
          row.cursor = line.nextOffset;
          if (!line.value) { row.warnings += Number(line.malformed); continue; }
          const event = normalize(line.value, id, line.offset, row.events);
          row.events++;
          row.messages += Number(event.category === "message");
          row.tools += event.toolNames.length;
          row.errors += Number(event.error);
          row.edits ||= Number(event.toolNames.some(name => /^(edit|write|multiedit|notebookedit)$/i.test(name)));
          row.cwd ||= event.cwd || "";
          row.session_id = string(line.value.sessionId) || string(line.value.session_id) || row.session_id;
          row.branch = string(line.value.gitBranch) || row.branch;
          const model = string(object(line.value.message).model);
          if (model && model !== "<synthetic>") row.model = model;
          const explicit = string(line.value.customTitle) || string(line.value.aiTitle) || ((event.type === "ai-title" || event.type === "custom-title") ? string(line.value.title) : "");
          if (explicit) { row.title = explicit.slice(0, 240); row.named = 1; }
          else if (!row.title || (!row.named && row.title.startsWith("Session "))) row.title = promptTitle(event) || row.title;
          if (event.timestamp) {
            if (!row.started || event.timestamp < row.started) row.started = event.timestamp;
            if (!row.updated || event.timestamp > row.updated) row.updated = event.timestamp;
          }
          batch.push(event);
          if (batch.length >= 250) { write(batch); batch = []; await Bun.sleep(0); }
        }
        write(batch);
        const stamp = new Date(info.mtimeMs).toISOString();
        this.db.query(`UPDATE sessions SET cwd=?,title=?,branch=?,model=?,started=?,updated=?,events=?,messages=?,tools=?,errors=?,
          edits=?,size=?,mtime=?,cursor=?,fingerprint=?,warnings=?,named=?,session_id=?,identity=?,tailprint=? WHERE id=?`).run(
          row.cwd, row.title || `Session ${row.session_id.slice(0, 8)}`, row.branch, row.model, row.started || stamp, row.updated || stamp,
          row.events, row.messages, row.tools, row.errors, row.edits, info.size, info.mtimeMs, row.cursor,
          await this.fingerprint(path, info.size), row.warnings, row.named, row.session_id, identity, await this.fingerprint(path, info.size, true), id);
        changed.push(id);
      } catch (error) {
        this.scanWarnings++;
        console.warn(`Could not index ${basename(path)}: ${error instanceof Error ? error.message : "read error"}`);
      }
    }
    if (complete) for (const row of known.values()) {
      this.db.query("DELETE FROM sessions WHERE id=?").run(row.id);
      changed.push(row.id);
    }
    this.indexedAt = new Date().toISOString();
    if (changed.length) this.emit(changed);
    return changed;
  }

  emit(ids: string[] = []): void {
    this.workspaceUsage = null;
    for (const listener of this.listeners) listener(ids);
  }

  private session(row: SourceRow): Session {
    return {
      id: row.id, sessionId: row.session_id, title: row.title, cwd: row.cwd,
      workspace: row.group_name || pathName(row.cwd), groupId: row.group_id || null,
      branch: row.branch, model: row.model, startedAt: row.started, updatedAt: row.updated,
      eventCount: row.events, messageCount: row.messages, toolCount: row.tools, errorCount: row.errors,
      hasEdits: Boolean(row.edits), bookmarked: Boolean(row.bookmarked), isAgent: Boolean(row.agent),
      active: Date.now() - Date.parse(row.updated) < 120_000 && Date.now() - row.mtime < 120_000,
      source: relative(this.dataDir, row.source),
      usage: this.db.query<UsageSummary, [string]>(`SELECT ${usageColumns} FROM usage_records WHERE session_id=?`).get(row.id)!,
    };
  }

  getSession(id: string): Session | null {
    const row = this.db.query<SourceRow, [string]>(`SELECT ${columns} ${joins} WHERE s.id=?`).get(id);
    return row ? this.session(row) : null;
  }

  list(params: URLSearchParams): SessionPage {
    const conditions: string[] = [];
    const bindings: SQLQueryBindings[] = [];
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
    for (const [key, column] of [["cwd", "s.cwd"], ["model", "s.model"], ["branch", "s.branch"]]) {
      if (params.get(key)) { conditions.push(`${column}=?`); bindings.push(params.get(key)!); }
    }
    if (params.get("bookmarked") === "1") conditions.push("b.session_id IS NOT NULL");
    if (params.get("errors") === "1") conditions.push("s.errors>0");
    if (params.get("edits") === "1") conditions.push("s.edits>0");
    if (params.get("agents") === "0") conditions.push("s.agent=0");
    if (params.get("active") === "1") {
      conditions.push("s.updated>=? AND s.mtime>=?");
      bindings.push(new Date(Date.now() - 120_000).toISOString(), Date.now() - 120_000);
    }
    if (params.get("days")) {
      const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 3650);
      conditions.push("s.updated>=?"); bindings.push(new Date(Date.now() - days * 86400000).toISOString());
    }
    for (const [key, comparison] of [["after", ">="], ["before", "<="]]) {
      const date = params.get(key);
      if (date && Number.isFinite(Date.parse(date))) {
        conditions.push(`s.updated ${comparison} ?`);
        bindings.push(new Date(Date.parse(date) + (key === "before" && date.length === 10 ? 86399999 : 0)).toISOString());
      }
    }
    if (params.get("tool")) {
      conditions.push("EXISTS (SELECT 1 FROM events e WHERE e.session_id=s.id AND instr(lower(e.tools),lower(?))>0)");
      bindings.push(params.get("tool")!);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = this.db.query<{ total: number }, SQLQueryBindings[]>(`SELECT count(*) AS total ${joins} ${where}`).get(...bindings)!.total;
    const limit = Math.max(1, pageNumber(params.get("limit"), 50, 100));
    const offset = Math.min(pageNumber(params.get("offset"), 0, 1_000_000), Math.floor(Math.max(0, total - 1) / limit) * limit);
    const order = params.get("sort") === "oldest" ? "s.updated ASC" : params.get("sort") === "activity" ? "s.events DESC, s.updated DESC" : "s.updated DESC";
    const rows = this.db.query<SourceRow, SQLQueryBindings[]>(`SELECT ${columns} ${joins} ${where} ORDER BY ${order},s.id LIMIT ? OFFSET ?`).all(...bindings, limit, offset);
    const positive = terms.find(term => !term.exclude && /[\p{L}\p{N}]/u.test(term.value));
    const items = rows.map(row => {
      const session = this.session(row);
      if (positive) {
        const match = this.db.query<{ snippet: string; event_id: string; raw: string }, [string, string]>(`SELECT snippet(event_fts,0,'','', ' … ',28) AS snippet,e.event_id,e.raw
          FROM event_fts JOIN events e ON e.rowid=event_fts.rowid WHERE event_fts MATCH ? AND e.session_id=? ORDER BY rank LIMIT 1`)
          .get(ftsPhrase(positive.value), row.id);
        if (match) { session.snippet = (match.raw.length > snippetLimit ? "" : displaySnippet(match.raw, positive.value)) || match.snippet; session.matchEventId = match.event_id; }
      }
      return session;
    });
    const usageRows = this.db.query<UsageSummary & { dimension: "directory" | "model"; cwd: string; model: string; effort: string | null }, SQLQueryBindings[]>(`WITH ranked AS (
      SELECT usage.*, s.cwd, row_number() OVER (PARTITION BY request_key ORDER BY sidechain,
        input+output+cache_creation+cache_read DESC, recorded DESC, cost DESC, effort IS NULL, s.started, s.id) AS position
      FROM usage_records usage JOIN sessions s ON s.id=usage.session_id
      LEFT JOIN group_paths gp ON gp.path=s.cwd LEFT JOIN groups g ON g.id=gp.group_id
      LEFT JOIN bookmarks b ON b.session_id=s.id ${where}
    ), selected AS (SELECT * FROM ranked WHERE position=1)
      SELECT 'directory' AS dimension,cwd,'' AS model,NULL AS effort,${usageColumns} FROM selected GROUP BY cwd
      UNION ALL SELECT 'model' AS dimension,'' AS cwd,model,effort,${usageColumns} FROM selected GROUP BY model,effort`).all(...bindings);
    const directoryCounts = this.db.query<{ cwd: string; sessions: number; withUsage: number }, SQLQueryBindings[]>(
      `SELECT s.cwd, count(*) AS sessions, sum(EXISTS(SELECT 1 FROM usage_records WHERE session_id=s.id)) AS withUsage ${joins} ${where} GROUP BY s.cwd`).all(...bindings);
    const byDirectory = new Map<string, UsageSummary>();
    const modelUsage: ModelUsage[] = [];
    for (const { dimension, cwd, model, effort, ...usage } of usageRows) {
      if (dimension === "directory") byDirectory.set(cwd, usage);
      else modelUsage.push({ model, effort, usage });
    }
    modelUsage.sort((left, right) => right.usage.costUSD - left.usage.costUSD || right.usage.totalTokens - left.usage.totalTokens
      || left.model.localeCompare(right.model) || (left.effort || "").localeCompare(right.effort || ""));
    const directories: DirectoryUsage[] = directoryCounts.map(directory => ({ ...directory, usage: byDirectory.get(directory.cwd) || emptyUsage() }))
      .sort((left, right) => right.usage.costUSD - left.usage.costUSD || right.usage.totalTokens - left.usage.totalTokens || left.cwd.localeCompare(right.cwd));
    const usage = emptyUsage();
    for (const directory of directories) for (const key of Object.keys(usage) as (keyof UsageSummary)[]) usage[key] += directory.usage[key];
    return { items, total, offset, limit, usage, directories, modelUsage, sessionsWithUsage: directoryCounts.reduce((sum, directory) => sum + directory.withUsage, 0) };
  }

  events(id: string, params: URLSearchParams): EventPage {
    const bindings: SQLQueryBindings[] = [id];
    let filter = "session_id=?";
    const kind = params.get("kind");
    if (kind === "conversation") filter += " AND category!='system'";
    else if (["message", "tool", "thinking", "system"].includes(kind || "")) { filter += " AND category=?"; bindings.push(kind!); }
    if (params.get("errors") === "1") filter += " AND error=1";
    if (params.get("q")) { filter += " AND instr(lower(text),lower(?))>0"; bindings.push(params.get("q")!); }
    const total = this.db.query<{ total: number }, SQLQueryBindings[]>(`SELECT count(*) AS total FROM events WHERE ${filter}`).get(...bindings)!.total;
    const limit = Math.max(1, pageNumber(params.get("limit"), 80, 200));
    let offset = pageNumber(params.get("offset"), 0, 1_000_000);
    if (params.get("anchor")) {
      const anchor = this.db.query<{ sequence: number }, [string, string]>("SELECT sequence FROM events WHERE session_id=? AND event_id=?").get(id, params.get("anchor")!);
      if (anchor) offset = this.db.query<{ count: number }, SQLQueryBindings[]>(`SELECT count(*) AS count FROM events WHERE ${filter} AND sequence<?`).get(...bindings, anchor.sequence)!.count;
    }
    offset = Math.min(offset, Math.max(0, total - 1));
    const items = this.db.query<StoredEvent, SQLQueryBindings[]>(`SELECT raw,event_id,sequence,offset,text FROM events WHERE ${filter} ORDER BY sequence LIMIT ? OFFSET ?`)
      .all(...bindings, limit, offset).map(row => normalize(JSON.parse(row.raw), id, row.offset, row.sequence));
    return { items, total, offset, limit };
  }

  results(id: string, toolIds: string[]): Record<string, import("../shared/types").ContentBlock> {
    const found: Record<string, import("../shared/types").ContentBlock> = Object.create(null);
    if (!toolIds.length) return found;
    const lookup = this.db.query<{ raw: string }, [string, string]>("SELECT raw FROM tool_results WHERE session_id=? AND tool_id=?");
    for (const toolId of new Set(toolIds)) {
      const row = lookup.get(id, toolId);
      if (row) found[toolId] = JSON.parse(row.raw);
    }
    return found;
  }

  bookmark(id: string, value: boolean): void {
    if (!this.getSession(id)) throw new Error("Session not found");
    if (value) this.db.query("INSERT OR IGNORE INTO bookmarks VALUES (?)").run(id);
    else this.db.query("DELETE FROM bookmarks WHERE session_id=?").run(id);
    this.emit([id]);
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
    this.emit();
    return { id, name, paths };
  }

  deleteGroup(id: string): void {
    this.db.query("DELETE FROM groups WHERE id=?").run(id);
    this.emit();
  }

  async catalog(): Promise<Catalog> {
    const totals = this.db.query<{ sessions: number; messages: number; tools: number; errors: number; warnings: number }, []>(
      "SELECT count(*) AS sessions,coalesce(sum(messages),0) AS messages,coalesce(sum(tools),0) AS tools,coalesce(sum(errors),0) AS errors,coalesce(sum(warnings),0) AS warnings FROM sessions").get()!;
    const sources = this.db.query<{ cwd: string; count: number }, []>("SELECT cwd,count(*) AS count FROM sessions GROUP BY cwd ORDER BY count(*) DESC").all();
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
    const workspaces = groups.map(group => ({ ...group, grouped: true, count: sources.filter(row => group.paths.includes(row.cwd)).reduce((sum, row) => sum + row.count, 0), usage: usageByWorkspace.get(group.id) || emptyUsage() }));
    for (const source of sources) if (!groups.some(group => group.paths.includes(source.cwd))) {
      workspaces.push({ id: source.cwd || "unknown", name: pathName(source.cwd), paths: [source.cwd], count: source.count, grouped: false, usage: usageByWorkspace.get(source.cwd) || emptyUsage() });
    }
    return {
      ...totals, warnings: totals.warnings + this.scanWarnings, groups, workspaces: workspaces.sort((left, right) => right.count - left.count),
      bookmarked: this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM bookmarks b JOIN sessions s ON b.session_id=s.id").get()!.count,
      models: this.db.query<{ model: string }, []>("SELECT DISTINCT model FROM sessions WHERE model!='' ORDER BY model").all().map(row => row.model),
      dataDir: this.dataDir, indexedAt: this.indexedAt, demo: await Bun.file(join(this.dataDir, ".blackbox-demo")).exists(),
    };
  }
}
