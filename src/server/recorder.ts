import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readdir, realpath, stat, open } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { IndexProgress, RecordedCost, ReplayEvent } from "../shared/types";
import { stripAnsi } from "../shared/ansi";
import { recordedVersion, recordSubtype, turnDuration, unrecognizedKind } from "../shared/records";
import { readJsonLines } from "./jsonl";
import { decidedResults, explicitTitle, hasReadableThinking, isApiError, normalize, object, promptTitle, requestMessageType, string, syntheticModel, TranscriptTexts } from "./normalize";
import { currentRates, hasRates, readCostState, readUsage } from "./usage";
import { isFacetValue } from "./facets";
import { indexVersion, migrations } from "./migrations";
import { RecordingQueries, type SourceRow } from "./queries";

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source TEXT NOT NULL UNIQUE,
    cwd TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '', started TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '',
    events INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0, tools INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0, edits INTEGER NOT NULL DEFAULT 0, agent INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0, mtime REAL NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT NOT NULL DEFAULT '', warnings INTEGER NOT NULL DEFAULT 0, named INTEGER NOT NULL DEFAULT 0,
    identity TEXT NOT NULL DEFAULT '', tailprint TEXT NOT NULL DEFAULT '',
    turns INTEGER NOT NULL DEFAULT 0, active_ms INTEGER NOT NULL DEFAULT 0,
    version TEXT NOT NULL DEFAULT '', unrecognized INTEGER NOT NULL DEFAULT 0,
    api_errors INTEGER NOT NULL DEFAULT 0, decisions INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    rowid INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, offset INTEGER NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL,
    error INTEGER NOT NULL, tools TEXT NOT NULL, raw TEXT NOT NULL, text TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '', timestamp TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '',
    has_thinking INTEGER NOT NULL DEFAULT 0, has_tools INTEGER NOT NULL DEFAULT 0, decision INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS events_session ON events(session_id, sequence);
  CREATE TABLE IF NOT EXISTS usage_records (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    request_key TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL,
    cache_creation INTEGER NOT NULL, cache_read INTEGER NOT NULL, cost REAL,
    recorded INTEGER NOT NULL, sidechain INTEGER NOT NULL,
    model TEXT NOT NULL DEFAULT '', effort TEXT, rates TEXT NOT NULL DEFAULT '', unrated INTEGER NOT NULL DEFAULT 0, reason TEXT,
    PRIMARY KEY(session_id, request_key)
  );
  CREATE TABLE IF NOT EXISTS session_costs (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    cost REAL NOT NULL, started TEXT NOT NULL DEFAULT '', unknown_models INTEGER NOT NULL DEFAULT 0,
    model_usage TEXT NOT NULL DEFAULT '{}', api_ms REAL, tool_ms REAL
  );
  CREATE TABLE IF NOT EXISTS tool_results (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_id TEXT NOT NULL, raw TEXT NOT NULL,
    event_row INTEGER NOT NULL REFERENCES events(rowid) ON DELETE CASCADE,
    PRIMARY KEY(session_id, tool_id)
  );
  CREATE INDEX IF NOT EXISTS tool_results_event ON tool_results(event_row);
  CREATE TABLE IF NOT EXISTS tool_calls (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool_id TEXT NOT NULL, name TEXT NOT NULL,
    event_row INTEGER NOT NULL REFERENCES events(rowid) ON DELETE CASCADE,
    PRIMARY KEY(session_id,tool_id)
  );
  CREATE INDEX IF NOT EXISTS tool_calls_event ON tool_calls(event_row);
  CREATE TABLE IF NOT EXISTS session_facets (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(session_id,kind,value)
  );
  CREATE INDEX IF NOT EXISTS facet_values ON session_facets(kind,value);
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

async function physicalPath(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (object(error).code !== "ENOENT") throw error;
    const parent = dirname(path);
    return parent === path ? path : join(await physicalPath(parent), basename(path));
  }
}

/**
 * Maintains the derived index of the recordings under `dataDir`: walks the projects directory, tells a moved recording
 * from a new one, reads what each appended since its last read, runs the versioned upgrade steps, and publishes each
 * change to live clients. Everything the HTTP routes read is served by `queries`, over the same connection.
 */
export class Recorder {
  readonly db: Database;
  readonly dataDir: string;
  readonly stateDir: string;
  /** The read side of the index, whose caches `publish()` drops as recordings change. */
  readonly queries: RecordingQueries;
  readonly listeners = new Set<(ids: string[]) => void>();
  readonly progressListeners = new Set<(progress: IndexProgress) => void>();
  indexing: IndexProgress = { phase: "idle", checked: 0, total: 0 };
  indexedAt = "";
  /** The directories the last scan could not read and the recordings it could not index, which the catalog reports. */
  scanWarnings = 0;
  private scanning: Promise<string[]> | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private transcripts = new Map<string, { cursor: number; texts: TranscriptTexts }>();

  private constructor(dataDir: string, stateDir: string, db: Database) {
    this.dataDir = resolve(dataDir);
    this.stateDir = resolve(stateDir);
    this.db = db;
    this.queries = new RecordingQueries(this);
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    if (version > indexVersion) throw new Error("This index was created by a newer version. Choose a different state directory.");
    const hasResults = db.query("SELECT name FROM sqlite_master WHERE name='tool_results'").get();
    const hasFacets = db.query("SELECT name FROM sqlite_master WHERE name='session_facets'").get();
    db.exec(schema);
    const fields = new Set(db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().map(row => row.name));
    if (!fields.has("identity")) db.exec("ALTER TABLE sessions ADD COLUMN identity TEXT NOT NULL DEFAULT ''");
    if (!fields.has("tailprint")) db.exec("ALTER TABLE sessions ADD COLUMN tailprint TEXT NOT NULL DEFAULT ''");
    if (!fields.has("turns")) db.exec("ALTER TABLE sessions ADD COLUMN turns INTEGER NOT NULL DEFAULT 0");
    if (!fields.has("active_ms")) db.exec("ALTER TABLE sessions ADD COLUMN active_ms INTEGER NOT NULL DEFAULT 0");
    if (!fields.has("version")) db.exec("ALTER TABLE sessions ADD COLUMN version TEXT NOT NULL DEFAULT ''");
    if (!fields.has("unrecognized")) db.exec("ALTER TABLE sessions ADD COLUMN unrecognized INTEGER NOT NULL DEFAULT 0");
    if (!fields.has("api_errors")) db.exec("ALTER TABLE sessions ADD COLUMN api_errors INTEGER NOT NULL DEFAULT 0");
    if (!fields.has("decisions")) db.exec("ALTER TABLE sessions ADD COLUMN decisions INTEGER NOT NULL DEFAULT 0");
    const costFields = new Set(db.query<{ name: string }, []>("PRAGMA table_info(session_costs)").all().map(row => row.name));
    if (!costFields.has("api_ms")) db.exec("ALTER TABLE session_costs ADD COLUMN api_ms REAL");
    if (!costFields.has("tool_ms")) db.exec("ALTER TABLE session_costs ADD COLUMN tool_ms REAL");
    const usageFields = new Set(db.query<{ name: string }, []>("PRAGMA table_info(usage_records)").all().map(row => row.name));
    if (!usageFields.has("model")) db.exec("ALTER TABLE usage_records ADD COLUMN model TEXT NOT NULL DEFAULT ''");
    if (!usageFields.has("effort")) db.exec("ALTER TABLE usage_records ADD COLUMN effort TEXT");
    if (!usageFields.has("rates")) db.exec("ALTER TABLE usage_records ADD COLUMN rates TEXT NOT NULL DEFAULT ''");
    if (!usageFields.has("unrated")) db.exec("ALTER TABLE usage_records ADD COLUMN unrated INTEGER NOT NULL DEFAULT 0");
    if (!usageFields.has("reason")) db.exec("ALTER TABLE usage_records ADD COLUMN reason TEXT");
    // An unpriced row an earlier build wrote without a reason gets the one its rules gave: no model, a model without
    // rates, or else fast mode. A build before `rates` never marked a model without rates, so the current table decides
    // for its rows. Each keeps that reason until the re-read that the rate-stamp check below schedules.
    const unexplained = db.query<{ model: string; rates: string; unrated: number }, []>(
      "SELECT DISTINCT model, rates, unrated FROM usage_records WHERE cost IS NULL AND reason IS NULL").all();
    const explain = db.query("UPDATE usage_records SET reason=?, unrated=? WHERE cost IS NULL AND reason IS NULL AND model=? AND rates=? AND unrated=?");
    for (const row of unexplained) {
      const reason = !row.model ? "unnamed" : row.unrated || (!row.rates && !hasRates(row.model)) ? "model" : "fast";
      explain.run(reason, Number(reason === "model"), row.model, row.rates, row.unrated);
    }
    const eventFields = new Set(db.query<{ name: string }, []>("PRAGMA table_info(events)").all().map(row => row.name));
    for (const field of ["role", "timestamp", "model", "cwd"]) {
      if (!eventFields.has(field)) db.exec(`ALTER TABLE events ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
    }
    for (const field of ["has_thinking", "has_tools", "decision"]) {
      if (!eventFields.has(field)) db.exec(`ALTER TABLE events ADD COLUMN ${field} INTEGER NOT NULL DEFAULT 0`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS events_model ON events(session_id,model);
      CREATE INDEX IF NOT EXISTS events_timestamp ON events(session_id,timestamp);
      CREATE INDEX IF NOT EXISTS events_cwd ON events(session_id,cwd);
      CREATE INDEX IF NOT EXISTS events_tools ON events(session_id,tools);
      CREATE INDEX IF NOT EXISTS usage_efforts ON usage_records(effort);`);
    // The steps up to version 7 complete here, before the port binds, because none reads the events table; the ones that
    // do are listed in `./migrations`, whose header states the rule, and run with the first scan.
    if (!hasResults || !hasFacets || version < 6) db.exec("UPDATE sessions SET mtime=0, identity=''; PRAGMA user_version=6;");
    // Version 7 keeps terminal escape sequences out of titles. Unchanged recordings are never rescanned, so titles
    // derived earlier are cleaned where they are instead of re-indexing every recording for a few bytes of styling.
    if (version < 7) db.transaction(() => {
      const update = db.query("UPDATE sessions SET title=? WHERE id=?");
      for (const row of db.query<{ id: string; title: string }, []>("SELECT id, title FROM sessions").all()) {
        if (stripAnsi(row.title) !== row.title) update.run(stripAnsi(row.title).replace(/\s+/g, " ").trim(), row.id);
      }
      db.exec("PRAGMA user_version=7");
    })();
    const interrupted = db.query<{ id: string }, []>("SELECT id FROM sessions WHERE events != (SELECT count(*) FROM events WHERE session_id=sessions.id)").all();
    for (const row of interrupted) db.query("UPDATE sessions SET mtime=0, identity='' WHERE id=?").run(row.id);
    // Unchanged recordings are never rescanned, so requests indexed with other rates or rules (or by a build that did
    // not stamp them) are re-indexed to keep every total on the bundled rates.
    const stale = db.query<{ model: string; rates: string }, []>("SELECT DISTINCT model, rates FROM usage_records").all()
      .filter(row => !currentRates(row.model, row.rates));
    if (stale.length) db.query(`UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT session_id FROM usage_records
      WHERE (model, rates) IN (VALUES ${stale.map(() => "(?,?)").join(",")}))`).run(...stale.flatMap(row => [row.model, row.rates]));
  }

  /**
   * Opens or creates the derived index. The initial scan runs before this
   * resolves unless `scan` is false, which lets the HTTP server bind first and
   * index in the background while listeners watch the recordings arrive.
   */
  static async open(dataDir: string, stateDir: string, options: { scan?: boolean } = {}): Promise<Recorder> {
    const [root, state] = await Promise.all([physicalPath(resolve(dataDir)), physicalPath(resolve(stateDir))]);
    const compareRoot = process.platform === "win32" ? root.toLowerCase() : root;
    const compareState = process.platform === "win32" ? state.toLowerCase() : state;
    if (compareState === compareRoot || compareState.startsWith(compareRoot + sep)) throw new Error("The state directory must be outside the Claude data directory.");
    await mkdir(state, { recursive: true, mode: 0o700 });
    const database = new Database(join(state, "index.sqlite"), { create: true });
    try {
      const recorder = new Recorder(root, state, database);
      if (options.scan !== false) await recorder.scan();
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
    this.progressListeners.clear();
    this.db.close();
  }

  scan(): Promise<string[]> {
    if (this.stopped) return Promise.resolve([]);
    if (this.scanning) return this.scanning;
    this.scanning = this.reconcile().then(ids => {
      this.reportProgress({ ...this.indexing, phase: "idle" });
      return ids;
    }, error => {
      this.reportProgress({ ...this.indexing, phase: "error" });
      throw error;
    }).finally(() => { this.scanning = null; });
    return this.scanning;
  }

  private reportProgress(progress: IndexProgress): void {
    this.indexing = progress;
    for (const listener of this.progressListeners) listener(progress);
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

  /**
   * A recording's path inside its project folder, `<session id>.jsonl` or `<session id>/subagents/agent-<id>.jsonl`,
   * which is what a relocation to another project folder keeps; empty for a file outside any project folder.
   */
  private projectPath(path: string): string {
    const parts = relative(join(this.dataDir, "projects"), path).split(sep);
    return parts.length > 1 ? parts.slice(1).join(sep) : "";
  }

  /**
   * The row of a known recording whose file is gone and whose path inside its project folder is this new file's, moved
   * to the new path, or undefined when no such row exists. A candidate's file is confirmed gone with `stat()`, so a walk
   * that could not read every directory still tells a move from a file it did not reach. With several, only the one
   * whose prefix checkpoint the new file still passes is taken, and none when no checkpoint passes, so two copies of one
   * session id in cloned folders cannot claim each other's row and an unrelated file cannot claim either. The new
   * `identity` is stored with the path because a move across volumes changes it without changing a byte.
   */
  private async relocated(path: string, size: number, identity: string, displaced: Map<string, SourceRow[]>, known: Map<string, SourceRow>): Promise<SourceRow | undefined> {
    const candidates: SourceRow[] = [];
    for (const candidate of displaced.get(this.projectPath(path)) ?? []) {
      if (known.has(candidate.source) && await stat(candidate.source).then(() => false, error => object(error).code === "ENOENT")) candidates.push(candidate);
    }
    if (!candidates.length) return undefined;
    let row: SourceRow | undefined = candidates.length === 1 ? candidates[0] : undefined;
    if (!row) for (const candidate of candidates) {
      if (candidate.size <= size && candidate.fingerprint === await this.fingerprint(path, candidate.size)) { row = candidate; break; }
    }
    if (!row) return undefined;
    known.delete(row.source);
    // An empty identity marks the row for re-reading and must stay empty.
    const stored = row.identity ? identity : row.identity;
    this.db.query("UPDATE sessions SET source=?, identity=? WHERE id=?").run(path, stored, row.id);
    return { ...row, source: path, identity: stored };
  }

  // The transcript text a recording's indexed user and attachment records hold, and the message copies whose searchable
  // text keeps some text, for a read that resumes at the cursor.
  private indexedTranscript(id: string, texts: TranscriptTexts): void {
    for (const row of this.db.query<{ raw: string }, [string]>("SELECT raw FROM events WHERE session_id=? AND ((type='user' AND has_tools=0) OR type='attachment')").all(id)) {
      texts.note(object(JSON.parse(row.raw)));
    }
    for (const row of this.db.query<{ raw: string; sequence: number }, [string, string]>("SELECT raw, sequence FROM events WHERE session_id=? AND type=? AND text!=''").all(id, requestMessageType)) {
      normalize(object(JSON.parse(row.raw)), id, 0, row.sequence, texts);
    }
  }

  // The full-text index reads `events.text` only through the insert and delete triggers, so a rewrite replaces its row.
  private reviseText(rowid: number, before: string, after: string): void {
    this.db.transaction(() => {
      this.db.query("INSERT INTO event_fts(event_fts, rowid, text) VALUES ('delete', ?, ?)").run(rowid, before);
      this.db.query("UPDATE events SET text=? WHERE rowid=?").run(after, rowid);
      this.db.query("INSERT INTO event_fts(rowid, text) VALUES (?, ?)").run(rowid, after);
    })();
  }

  /**
   * Runs one upgrade step's `fill` for every recording not already marked for re-reading, whose next read derives the
   * same values afresh, each recording in its own transaction through `events_session`. The scan runs after the server
   * has bound its port, so the step yields to the event loop after every 20 ms of work to keep the server answering;
   * yielding after every recording would add over a millisecond each on Windows. `steps` counts this step and the
   * per-recording steps after it, none of which fills more recordings than this one, so the progress it reports never
   * runs backwards. False when a shutdown stopped it; its writes are idempotent, so the next scan repeats the step from
   * the start.
   */
  private async upgradeEach(fill: (session: { id: string; named: number }) => void, steps: number): Promise<boolean> {
    const step = this.db.transaction(fill);
    const sessions = this.db.query<{ id: string; named: number }, []>("SELECT id, named FROM sessions WHERE mtime!=0").all();
    this.reportProgress({ phase: "upgrading", checked: this.indexing.checked, total: this.indexing.checked + steps * sessions.length });
    let slice = performance.now();
    let progressAt = slice;
    for (const session of sessions) {
      if (this.stopped) return false;
      step(session);
      this.indexing = { ...this.indexing, checked: this.indexing.checked + 1 };
      if (performance.now() - slice >= 20) {
        if (performance.now() - progressAt >= 250) { this.reportProgress(this.indexing); progressAt = performance.now(); }
        await Bun.sleep(0);
        slice = performance.now();
      }
    }
    return true;
  }

  private async reconcile(): Promise<string[]> {
    // The versioned upgrade steps that read the events table run here, with the first scan after the server has bound
    // its port, and before the recordings are compared with what was indexed; `./migrations` lists them in order and
    // states which steps belong there and which in the constructor. A whole-index step and its version advance are one
    // transaction. A per-recording step advances the version only after its last recording, and a shutdown that stops
    // it leaves the version where it was, so the next scan repeats the step. Live clients see the upgrade as its own
    // phase, so a long one reads as progress rather than as a library that stopped changing.
    const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    const pending = migrations.filter(migration => version < migration.version);
    if (pending.length) this.reportProgress({ phase: "upgrading", checked: 0, total: 0 });
    for (const [index, migration] of pending.entries()) {
      const advance = () => this.db.exec(`PRAGMA user_version=${migration.version}`);
      if ("each" in migration) {
        if (!await this.upgradeEach(migration.each(this.db), pending.slice(index).filter(step => "each" in step).length)) return [];
        advance();
      } else this.db.transaction(() => { migration.apply(this.db); advance(); })();
    }
    this.scanWarnings = 0;
    this.reportProgress({ phase: "discovering", checked: 0, total: 0 });
    const files: string[] = [];
    const complete = await this.discover(join(this.dataDir, "projects"), files);
    this.reportProgress({ phase: "indexing", checked: 0, total: files.length });
    let progressAt = performance.now();
    const known = new Map(this.db.query<SourceRow, []>("SELECT * FROM sessions").all().map(row => [row.source, row]));
    // Claude Code 2.1.30x moves a session's recording, with its subagent directory, to the project folder of a new
    // working directory (EnterWorktree and ExitWorktree do this) and appends a `relocated` record. The path inside the
    // project folder is unchanged, so a known recording whose file the walk did not find and a new file at that path in
    // another project folder are one recording, which keeps its row: its id, and with it its bookmark and replay URLs,
    // and its cursor, so only the records appended since are read.
    const present = new Set(files);
    const displaced = new Map<string, SourceRow[]>();
    for (const row of known.values()) {
      const key = this.projectPath(row.source);
      if (key && !present.has(row.source)) displaced.set(key, [...displaced.get(key) ?? [], row]);
    }
    const changed: string[] = [];
    let published = 0;
    let publishedAt = performance.now();
    let interrupted = false;
    for (const path of files) {
      // A shutdown must not wait for a long first index to finish; the rows an
      // aborted file leaves behind are detected and re-indexed on the next open.
      if (this.stopped) { interrupted = true; break; }
      const indexed = known.get(path);
      known.delete(path);
      try {
        const info = await stat(path);
        const identity = `${info.dev}:${info.ino}`;
        const moved = indexed ? undefined : await this.relocated(path, info.size, identity, displaced, known);
        const previous = indexed ?? moved;
        if (previous && previous.size === info.size && previous.mtime === info.mtimeMs && previous.identity === identity) continue;
        const id = previous?.id || createHash("sha256").update(relative(this.dataDir, path)).digest("hex").slice(0, 24);
        // A move keeps the file's bytes, so a moved recording of the same size is intact where a rewrite is suspected
        // otherwise; its checkpoints still decide.
        const reset = previous && ((moved ? info.size < previous.size : info.size <= previous.size) || previous.identity !== identity ||
          previous.fingerprint !== await this.fingerprint(path, previous.size) || previous.tailprint !== await this.fingerprint(path, previous.size, true));
        if (!previous) this.db.query("INSERT INTO sessions(id, session_id, source, agent) VALUES (?, ?, ?, ?)")
          .run(id, basename(path, ".jsonl"), path, Number(path.includes(`${sep}subagents${sep}`) || basename(path).startsWith("agent-")));
        if (reset) this.db.transaction(() => {
          this.db.query("DELETE FROM events WHERE session_id = ?").run(id);
          this.db.query("DELETE FROM usage_records WHERE session_id = ?").run(id);
          this.db.query("DELETE FROM session_costs WHERE session_id = ?").run(id);
          this.db.query("DELETE FROM session_facets WHERE session_id = ?").run(id);
          this.db.query(`UPDATE sessions SET title='',cwd='',branch='',model='',started='',updated='',events=0,
            messages=0,tools=0,errors=0,edits=0,cursor=0,warnings=0,named=0,turns=0,active_ms=0,version='',unrecognized=0,
            api_errors=0,decisions=0 WHERE id=?`).run(id);
        })();
        const row = this.db.query<SourceRow, [string]>("SELECT * FROM sessions WHERE id=?").get(id)!;
        // Claude Code files `cost-state` as last-wins, so the last one read replaces the stored total; a read that
        // appends no new one keeps the total already stored.
        let recordedCost: RecordedCost | null = null;
        // A read that resumes at the cursor continues the transcript text the previous read of this recording collected,
        // or else reads what is already indexed once a record or message copy asks.
        const cached = this.transcripts.get(id);
        this.transcripts.delete(id);
        const transcript = row.cursor && cached?.cursor === row.cursor ? cached.texts : new TranscriptTexts(row.cursor ? texts => this.indexedTranscript(id, texts) : undefined);
        let batch: ReplayEvent[] = [];
        // A record holding text a message copy before it kept rewrites the copy's searchable text, in the batch or in
        // the index, where the full-text row follows it.
        const revise = (sequence: number) => {
          const pending = batch.find(event => event.sequence === sequence);
          if (pending) { pending.text = normalize(pending.raw, id, pending.offset, sequence, transcript).text; return; }
          const stored = this.db.query<{ rowid: number; raw: string; text: string }, [string, number]>("SELECT rowid, raw, text FROM events WHERE session_id=? AND sequence=?").get(id, sequence);
          if (!stored) return;
          const text = normalize(object(JSON.parse(stored.raw)), id, 0, sequence, transcript).text;
          if (text !== stored.text) this.reviseText(stored.rowid, stored.text, text);
        };
        const write = this.db.transaction((events: ReplayEvent[]) => {
          const insert = this.db.query(`INSERT OR IGNORE INTO events(event_id,session_id,sequence,offset,category,type,error,tools,raw,text,role,timestamp,model,cwd,has_thinking,has_tools,decision)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          const insertResult = this.db.query("INSERT OR REPLACE INTO tool_results(session_id,tool_id,raw,event_row) VALUES (?,?,?,?)");
          const insertCall = this.db.query("INSERT OR REPLACE INTO tool_calls(session_id,tool_id,name,event_row) VALUES (?,?,?,?)");
          const insertFacet = this.db.query("INSERT OR IGNORE INTO session_facets(session_id,kind,value) VALUES (?,?,?)");
          const insertUsage = this.db.query(`INSERT INTO usage_records(session_id,request_key,input,output,cache_creation,cache_read,cost,recorded,sidechain,model,effort,rates,unrated,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id,request_key) DO UPDATE SET input=excluded.input, output=excluded.output,
              cache_creation=excluded.cache_creation, cache_read=excluded.cache_read, cost=excluded.cost,
              recorded=excluded.recorded, sidechain=excluded.sidechain,
              model=CASE WHEN excluded.model='' THEN usage_records.model ELSE excluded.model END,
              rates=CASE WHEN excluded.model='' THEN usage_records.rates ELSE excluded.rates END,
              unrated=excluded.unrated, reason=excluded.reason,
              effort=coalesce(excluded.effort,usage_records.effort)
            WHERE excluded.sidechain < usage_records.sidechain OR (excluded.sidechain = usage_records.sidechain AND
              (excluded.input+excluded.output+excluded.cache_creation+excluded.cache_read > usage_records.input+usage_records.output+usage_records.cache_creation+usage_records.cache_read
              OR (excluded.input+excluded.output+excluded.cache_creation+excluded.cache_read = usage_records.input+usage_records.output+usage_records.cache_creation+usage_records.cache_read
                AND (excluded.recorded > usage_records.recorded OR (excluded.recorded = usage_records.recorded AND coalesce(excluded.cost,-1) > coalesce(usage_records.cost,-1))))))`);
          const enrichEffort = this.db.query("UPDATE usage_records SET effort=? WHERE session_id=? AND request_key=? AND effort IS NULL");
          const storedModel = this.db.query<{ model: string }, [string, string]>("SELECT model FROM usage_records WHERE session_id=? AND request_key=?");
          for (const event of events) {
            const toolNames = event.toolNames.filter(name => isFacetValue(name));
            const inserted = insert.run(event.id, id, event.sequence, event.offset, event.category, event.type,
              Number(event.error), toolNames.join("\n"), JSON.stringify(event.raw), event.text, event.role, event.timestamp,
              string(object(event.raw.message).model), event.cwd || "", Number(hasReadableThinking(event.blocks)),
              Number(event.blocks.some(block => block.type === "tool_use" || block.type === "tool_result")), Number(event.decision !== null));
            let usage = readUsage(event.raw, id, event.id);
            // A copy of a request that names no model is read as the model an earlier copy in this recording named.
            if (usage && !usage.model) usage = readUsage(event.raw, id, event.id, storedModel.get(id, usage.key)?.model);
            if (usage) {
              insertUsage.run(id, usage.key, usage.input, usage.output, usage.cacheCreation, usage.cacheRead, usage.cost, Number(usage.recorded), Number(usage.sidechain), usage.model, usage.effort, usage.rates, Number(usage.reason === "model"), usage.reason);
              if (usage.effort) enrichEffort.run(usage.effort, id, usage.key);
            }
            if (inserted.changes) {
              const model = string(object(event.raw.message).model);
              if (model !== syntheticModel && isFacetValue(model)) insertFacet.run(id, "model", model);
              if (isFacetValue(event.cwd, 2048)) insertFacet.run(id, "cwd", event.cwd);
              for (const name of toolNames) insertFacet.run(id, "tool", name);
              const version = recordedVersion(event.raw.version);
              if (isFacetValue(version)) insertFacet.run(id, "version", version);
              const unrecognized = unrecognizedKind(event.type, recordSubtype(event.type, event.raw));
              if (unrecognized) insertFacet.run(id, "unrecognized", unrecognized);
              for (const block of event.blocks) {
                if (block.type === "tool_result" && typeof block.tool_use_id === "string") insertResult.run(id, block.tool_use_id, JSON.stringify(block), inserted.lastInsertRowid);
                if (block.type === "tool_use" && typeof block.id === "string" && isFacetValue(block.name || "Unknown tool")) insertCall.run(id, block.id, block.name || "Unknown tool", inserted.lastInsertRowid);
              }
            }
          }
        });
        for await (const line of readJsonLines(path, row.cursor, info.size)) {
          row.cursor = line.nextOffset;
          if (!line.value) { row.warnings += Number(line.malformed); continue; }
          const event = normalize(line.value, id, line.offset, row.events, transcript);
          for (const sequence of transcript.note(line.value)) revise(sequence);
          recordedCost = readCostState(line.value) ?? recordedCost;
          const turn = turnDuration(line.value);
          if (turn !== null) { row.turns++; row.active_ms += turn; }
          row.events++;
          row.messages += Number(event.category === "message");
          row.tools += event.toolNames.length;
          row.errors += Number(event.error);
          row.api_errors += Number(isApiError(line.value));
          row.decisions += decidedResults(event.blocks);
          row.edits ||= Number(event.toolNames.some(name => /^(edit|write|multiedit|notebookedit)$/i.test(name)));
          row.cwd ||= event.cwd || "";
          row.session_id = string(line.value.sessionId) || string(line.value.session_id) || row.session_id;
          row.branch = string(line.value.gitBranch) || row.branch;
          const model = string(object(line.value.message).model);
          if (model && model !== syntheticModel) row.model = model;
          row.version = recordedVersion(line.value.version) || row.version;
          row.unrecognized += Number(unrecognizedKind(event.type, recordSubtype(event.type, line.value)) !== null);
          // `named` keeps the rank of the explicit title the row holds, so the latest title of a kind replaces it and a
          // title of a lower kind never does.
          const explicit = explicitTitle(event.type, line.value);
          if (explicit && explicit.rank >= row.named) { row.title = explicit.title; row.named = explicit.rank; }
          else if (!row.title || (!row.named && row.title.startsWith("Session "))) row.title = promptTitle(event) || row.title;
          if (event.timestamp) {
            if (!row.started || event.timestamp < row.started) row.started = event.timestamp;
            if (!row.updated || event.timestamp > row.updated) row.updated = event.timestamp;
          }
          batch.push(event);
          if (batch.length >= 250) { write(batch); batch = []; await Bun.sleep(0); }
        }
        write(batch);
        if (recordedCost) this.db.query("INSERT OR REPLACE INTO session_costs(session_id,cost,started,unknown_models,model_usage,api_ms,tool_ms) VALUES (?,?,?,?,?,?,?)")
          .run(id, recordedCost.costUSD, recordedCost.startedAt, Number(recordedCost.unknownModelCost), JSON.stringify(recordedCost.models), recordedCost.apiDurationMs, recordedCost.toolDurationMs);
        const stamp = new Date(info.mtimeMs).toISOString();
        this.db.query(`UPDATE sessions SET cwd=?,title=?,branch=?,model=?,started=?,updated=?,events=?,messages=?,tools=?,errors=?,
          edits=?,size=?,mtime=?,cursor=?,fingerprint=?,warnings=?,named=?,session_id=?,identity=?,tailprint=?,turns=?,active_ms=?,
          version=?,unrecognized=?,api_errors=?,decisions=? WHERE id=?`).run(
          row.cwd, row.title || `Session ${row.session_id.slice(0, 8)}`, row.branch, row.model, row.started || stamp, row.updated || stamp,
          row.events, row.messages, row.tools, row.errors, row.edits, info.size, info.mtimeMs, row.cursor,
          await this.fingerprint(path, info.size), row.warnings, row.named, row.session_id, identity, await this.fingerprint(path, info.size, true),
          row.turns, row.active_ms, row.version, row.unrecognized, row.api_errors, row.decisions, id);
        // The recordings read most recently are the ones a live session keeps appending to.
        if (this.transcripts.size >= 32) this.transcripts.delete(this.transcripts.keys().next().value!);
        this.transcripts.set(id, { cursor: row.cursor, texts: transcript });
        changed.push(id);
        // Let live clients see a long first index fill in instead of an empty library.
        if (performance.now() - publishedAt >= 1000) {
          this.publish(changed.slice(published));
          published = changed.length;
          publishedAt = performance.now();
        }
      } catch (error) {
        this.scanWarnings++;
        console.warn(`Could not index ${basename(path)}: ${error instanceof Error ? error.message : "read error"}`);
      } finally {
        this.indexing = { ...this.indexing, checked: this.indexing.checked + 1 };
        if (performance.now() - progressAt >= 250) {
          this.reportProgress(this.indexing);
          progressAt = performance.now();
        }
      }
    }
    if (complete && !interrupted) for (const row of known.values()) {
      this.db.query("DELETE FROM sessions WHERE id=?").run(row.id);
      changed.push(row.id);
    }
    const firstIndex = !this.indexedAt;
    if (!interrupted) this.indexedAt = new Date().toISOString();
    if (changed.length > published) this.publish(changed.slice(published));
    else if (!interrupted && (firstIndex || changed.length)) this.emit();
    return changed;
  }

  private publish(ids: string[]): void {
    this.queries.forget(ids);
    this.emit(ids);
  }

  /** Tells live clients that the recordings in `ids` changed, or with none that the library as a whole did. */
  emit(ids: string[] = []): void {
    for (const listener of this.listeners) listener(ids);
  }
}
