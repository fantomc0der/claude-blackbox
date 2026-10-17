import type { Database } from "bun:sqlite";
import { recordedVersion, unrecognizedKind } from "../shared/records";
import { isFacetValue } from "./facets";
import { decidedResults, explicitTitle, normalize, object, promptTitle, requestMessageType, syntheticModel } from "./normalize";

/**
 * The versioned upgrade steps of the derived index that run with the first scan, in the order `Recorder.reconcile()`
 * applies them, each gated on the stored `PRAGMA user_version` being below its own. `docs/sqlite-schema.md` describes
 * what every version changed and how to add one.
 *
 * An upgrade has two halves, and the rule for which half a step belongs to is cost. The constructor of `Recorder` runs
 * before `Recorder.open()` returns, which `src/server/cli.ts` awaits before it binds the HTTP port, so it holds only
 * work that is cheap at any index size because it reads no `events` rows: the idempotent shape convergence
 * (`CREATE ... IF NOT EXISTS`, and `ALTER TABLE ... ADD COLUMN` behind `PRAGMA table_info`), the full reset of an
 * index older than version 6, and the version 7 step that rewrites `sessions` values from values each row already
 * holds. A step that reads the `events` table, every event or the stored records of every recording, belongs in this
 * list instead, so a large index upgrades behind a server that is already answering instead of delaying the window.
 *
 * Two shapes of step exist here. A whole-index step `apply`s itself to the index at once, and `reconcile()` runs it and
 * the version advance in one transaction, so an interrupted upgrade leaves either the old version with its rows or the
 * new one with its: it marks the recordings whose stored rows an earlier build derived differently for re-reading
 * (`UPDATE sessions SET mtime=0, identity=''`, which the scan that follows acts on), or rewrites values the stored
 * records already hold. A per-recording step prepares its statements and returns the fill `Recorder.upgradeEach()` runs
 * for `each` recording not already marked for re-reading, in its own transaction, yielding to the event loop between
 * recordings so the bound server keeps answering; `reconcile()` advances the version only after the last recording,
 * and not at all when a shutdown stopped the step, so the fill's writes must be idempotent for the next scan to repeat
 * the step from the start.
 */

/** The version a fully upgraded index reports in `PRAGMA user_version`; the constructor refuses to open a newer one. */
export const indexVersion = 19;

/** The row a per-recording step fills: a recording's id and `sessions.named`, the rank of its explicit title. */
export interface UpgradeSession { readonly id: string; readonly named: number }

/** A step that marks or rewrites rows across the whole index at once, in one transaction with its version advance. */
export interface WholeIndexStep { readonly version: number; readonly apply: (db: Database) => void }

/** A step that fills one recording at a time; `each` returns the fill `upgradeEach()` runs for every recording. */
export interface PerRecordingStep { readonly version: number; readonly each: (db: Database) => (session: UpgradeSession) => void }

export type Migration = WholeIndexStep | PerRecordingStep;

// The record types version 10 first indexed as session state, and the ones version 16 adds to them as bookkeeping or
// state. Each step keeps its own list, so an index upgraded across both is re-read as each version decided.
const version10StateTypes = [
  "last-prompt", "atis-latch", "queue-operation", "cost-state", "mode", "permission-mode", "worktree-state",
  "isolation-latch", "dev-mods", "memory-mode", "agent-name", "agent-color", "agent-setting", "tag",
  "attribution-snapshot", "file-history-delta", "api-request-shape", "relocated", "continued-in", "fork-context-ref",
  "observer-ref", "history-suppression", "ended-by-model", "content-replacement",
];
const version16NoteTypes = [
  "file-history-snapshot", "frame-link", "artifact-comment-monitor", "summary", "custom-title", "ai-title", "pr-link",
  "artifact-autoreact-ledger", "bridge-session",
];
// Parts of the messages version 17 first reads as decisions, as a stored record serializes them. An earlier build
// flagged a result holding one as a failure.
const version17DecisionTexts = [
  "[Request interrupted by user]", "[Tool call did not complete:", "[Tool call interrupted:", "[Tool call result not in this copy:",
  "[Tool call skipped:", "[Tool call not completed:", "Hook PreToolUse", "Permission for this command was denied",
  "Permission for this action ", "auto mode's safety classifier", ", so auto mode cannot determine the safety of ", " was not reviewed",
];

/** The title `promptTitle()` gives a recording's stored user records, read in order until one titles it; empty when none does. */
function firstPrompt(db: Database, id: string): string {
  const page = db.query<{ raw: string; sequence: number }, [string, number]>(
    "SELECT raw, sequence FROM events WHERE session_id=? AND role='user' AND sequence>? ORDER BY sequence LIMIT 50");
  for (let after = -1; ;) {
    const rows = page.all(id, after);
    for (const row of rows) {
      let title = "";
      try { title = promptTitle(normalize(JSON.parse(row.raw) as Record<string, unknown>, id, 0, row.sequence)); }
      catch { continue; }
      if (title) return title;
    }
    if (rows.length < 50) return "";
    after = rows[rows.length - 1].sequence;
  }
}

export const migrations: readonly Migration[] = [
  // Version 8 re-indexes only the recordings whose `api-request-blob` message copies an earlier build read as
  // conversation content. Finding them reads every event, so it runs with the first scan, after the server has bound
  // its port, and before the recordings are compared with what was indexed; the later steps follow it in order for the
  // same reason.
  {
    version: 8,
    apply: db => {
      db.query("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE type=?)").run(requestMessageType);
    },
  },
  // Version 9 titles a recording by Claude Code's own first-prompt rules, which skip the slash command, local command,
  // hook, interruption, and IDE context records an earlier build read as the first prompt. The stored records hold every
  // prompt, so a recording without an explicit title is retitled from them where it is instead of being re-read; one
  // already marked for re-reading gets its title from that read.
  {
    version: 9,
    apply: db => {
      const update = db.query("UPDATE sessions SET title=? WHERE id=?");
      for (const row of db.query<{ id: string; session_id: string; title: string }, []>("SELECT id, session_id, title FROM sessions WHERE named=0 AND mtime!=0").all()) {
        const title = firstPrompt(db, row.id) || `Session ${row.session_id.slice(0, 8)}`;
        if (title !== row.title) update.run(title, row.id);
      }
    },
  },
  // Version 10 re-indexes only the recordings holding Claude Code's session state records, which an earlier build read
  // as content with their prompt copies searchable; finding them reads every event, like version 8.
  {
    version: 10,
    apply: db => {
      db.query("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE type IN (SELECT value FROM json_each(?)))").run(JSON.stringify(version10StateTypes));
    },
  },
  // Version 11 re-indexes only the recordings that hold Claude Code's own stand-ins for a model turn, which earlier
  // builds counted as replies and never as errors. Finding them reads every event, so like version 8 it runs with the
  // first scan. The stored model column is the key: Claude Code's own API-error check requires `message.model` to be
  // `<synthetic>` alongside `isApiErrorMessage`, so this assumes every recorded API error carries that model. A
  // recording read afresh does not depend on it, because `normalize()` reads `isApiErrorMessage` on its own.
  {
    version: 11,
    apply: db => {
      db.query("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE type='assistant' AND model=?)").run(syntheticModel);
    },
  },
  // Version 12 tells the tool results that record a user's decision apart from failures. Every result an earlier build
  // flagged is in a recording with an error, so only those recordings are re-read; finding them reads every event, like
  // version 8. API error turns already count as errors since version 11.
  {
    version: 12,
    apply: db => {
      db.exec("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE error=1)");
    },
  },
  // Version 13 keeps Claude Code's own running total from the last `cost-state` record of a recording in
  // `session_costs`, which earlier builds never filled. Only the recordings holding such a record are re-read; finding
  // them reads every event, like version 8.
  {
    version: 13,
    apply: db => {
      db.exec("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE type='cost-state')");
    },
  },
  // Version 14 sums Claude Code's `turn_duration` records into `sessions.turns` and `sessions.active_ms` and keeps the
  // API and tool time of the last `cost-state` record in `session_costs`, none of which earlier builds filled. Only
  // the recordings holding either record are re-read; finding them reads every event, like version 8. The stored raw
  // record is `JSON.stringify` of the parsed record, so the subtype is matched as it is serialized there.
  {
    version: 14,
    apply: db => {
      db.exec(`UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events
        WHERE type='cost-state' OR (type='system' AND instr(raw,'"subtype":"turn_duration"')>0))`);
    },
  },
  // Version 15 reads the `relocatedCwd` of Claude Code's `relocated` record as the record's working directory, so the
  // replay marks the move to the worktree and back where earlier builds stored no `cwd` for it. Only the recordings
  // holding such a record are re-read; finding them reads every event, like version 8.
  {
    version: 15,
    apply: db => {
      db.exec("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE type='relocated')");
    },
  },
  // Version 16 keeps the Claude Code version a recording's records name and counts the records this build does not
  // recognize. The stored records hold both, so each recording is filled where it is instead of being re-read: one
  // statement reads its events' `version` and another their type and subtype, which reads every event like version 8.
  // The second also finds a record of a type version 16 first reads as a note but an earlier build read as content,
  // which kept the content in its searchable text, and marks only those recordings for re-reading. So is a recording
  // holding a record these statements need but SQLite's JSON parser rejects, which `JSON.parse` accepts, such as one
  // nested more than 1000 levels deep.
  {
    version: 16,
    each: db => {
      const insertFacet = db.query("INSERT OR IGNORE INTO session_facets(session_id,kind,value) VALUES (?,?,?)");
      const versions = db.query<{ version: unknown; sequence: number; invalid: number }, [string]>(`SELECT
        CASE WHEN json_valid(raw) THEN json_extract(raw,'$.version') END AS version, max(sequence) AS sequence, max(NOT json_valid(raw)) AS invalid
        FROM events WHERE session_id=? AND instr(raw,'"version":')>0 GROUP BY 1`);
      const kinds = db.query<{ type: string; subtype: unknown; records: number; invalid: number; stale: number }, [string, string]>(`SELECT type,
        CASE WHEN type='system' AND json_valid(raw) THEN json_extract(raw,'$.subtype')
          WHEN type='attachment' AND json_valid(raw) THEN json_extract(raw,'$.attachment.type') END AS subtype, count(*) AS records,
        max(CASE WHEN type IN ('system','attachment') OR type IN (SELECT value FROM json_each(?1)) THEN NOT json_valid(raw) ELSE 0 END) AS invalid,
        max(CASE WHEN type IN (SELECT value FROM json_each(?1)) AND json_valid(raw) THEN json_type(raw,'$.message.content') IN ('text','array')
          OR json_type(raw,'$.content') IN ('text','array') OR json_type(raw,'$.summary')='text' ELSE 0 END) AS stale
        FROM events WHERE session_id=?2 GROUP BY type, 2`);
      const notes = JSON.stringify(version16NoteTypes);
      const update = db.query("UPDATE sessions SET version=?, unrecognized=? WHERE id=?");
      const reset = db.query("UPDATE sessions SET mtime=0, identity='' WHERE id=?");
      return ({ id }) => {
        let latest = { version: "", sequence: -1 }, unrecognized = 0, reread = false;
        for (const row of versions.all(id)) {
          reread ||= Boolean(row.invalid);
          const recorded = recordedVersion(row.version);
          if (!isFacetValue(recorded)) continue;
          insertFacet.run(id, "version", recorded);
          if (latest.sequence < row.sequence) latest = { version: recorded, sequence: row.sequence };
        }
        for (const row of kinds.all(notes, id)) {
          reread ||= Boolean(row.invalid || row.stale);
          const kind = unrecognizedKind(row.type, row.subtype);
          if (kind !== null) unrecognized += row.records;
          if (kind) insertFacet.run(id, "unrecognized", kind);
        }
        update.run(latest.version, unrecognized, id);
        if (reread) reset.run(id);
      };
    },
  },
  // Version 17 reads Claude Code's `toolDenialKind` before a result's message, tells its interruptions and
  // cancellations apart from its denials, never counts its API retry banner as an error, counts a recording's API error
  // turns and decided records apart from its errors, and titles a recording by Claude Code's own precedence, agent name
  // first and summary before the first prompt, keeping the rank of the title's kind in `named`, where an earlier build
  // kept 1 for any explicit title. The counts come from the records an earlier build flagged or decided, like version
  // 12, each decided record parsed to count the results in it that record a decision, so every recording is filled
  // where it is. A recording holding a title record, or titled explicitly by a field
  // on another record, is retitled where it is from those stored records, like version 9. Finding a title field reads the
  // explicitly titled recordings' events, and finding an `agentName` reads every recording's events, because Claude Code's
  // transcript writer stamps a teammate's name on every record of its session and no earlier build read the field, so a
  // `named` of 0 does not rule it out. One already marked for re-reading gets its title from that read. A
  // decision an earlier build recognized stays a decision, and its label is read from the stored record whenever it is
  // shown, so only three groups of recordings are re-read: those holding a flagged or decided record with a
  // `toolDenialKind`, whose stored results lack the kind `normalize()` now copies onto them; those holding a failure
  // whose record carries part of a message version 17 first reads as a decision; and those holding a flagged `system`
  // record of subtype `api_error`, which no 2.1.302 recording holds. A recording holding an API error record SQLite's
  // JSON parser rejects is re-read too, as in version 16.
  {
    version: 17,
    each: db => {
      const counts = db.query<{ apiErrors: number | null; invalid: number | null }, [string]>(`SELECT
        sum(CASE WHEN error=1 AND instr(raw,'"isApiErrorMessage":true')>0 AND json_valid(raw) THEN json_type(raw,'$.isApiErrorMessage')='true' ELSE 0 END) AS apiErrors,
        max(CASE WHEN error=1 AND instr(raw,'"isApiErrorMessage":true')>0 THEN NOT json_valid(raw) ELSE 0 END) AS invalid
        FROM events WHERE session_id=? AND error=1`);
      const decidedRecords = db.query<{ raw: string }, [string]>("SELECT raw FROM events WHERE session_id=? AND decision=1");
      const titleRecords = db.query<{ type: string; raw: string }, [string, number]>(`SELECT type, raw FROM events WHERE session_id=?1
        AND (type IN ('agent-name','custom-title','ai-title','summary') OR instr(raw,'"agentName":')>0 OR (?2 AND (instr(raw,'"customTitle":')>0 OR instr(raw,'"aiTitle":')>0)))
        ORDER BY sequence`);
      const decided = db.query<{ found: number }, [string, string]>(`SELECT EXISTS (SELECT 1 FROM events WHERE session_id=?1 AND (error=1 OR decision=1)
        AND (instr(raw,'"toolDenialKind":')>0 OR (error=1 AND EXISTS (SELECT 1 FROM json_each(?2) WHERE instr(events.raw,value)>0))
          OR (error=1 AND type='system' AND instr(raw,'"subtype":"api_error"')>0))) AS found`);
      const fill = db.query("UPDATE sessions SET api_errors=?, decisions=? WHERE id=?");
      const retitle = db.query("UPDATE sessions SET title=?, named=? WHERE id=?");
      const reset = db.query("UPDATE sessions SET mtime=0, identity='' WHERE id=?");
      const texts = JSON.stringify(version17DecisionTexts);
      return ({ id, named }) => {
        const count = counts.get(id)!;
        if (count.invalid) { reset.run(id); return; }
        let decisions = 0;
        for (const row of decidedRecords.all(id)) {
          try { decisions += decidedResults(normalize(object(JSON.parse(row.raw)), id, 0, 0).blocks); }
          catch { reset.run(id); return; }
        }
        fill.run(count.apiErrors ?? 0, decisions, id);
        let title: ReturnType<typeof explicitTitle> = null;
        for (const row of titleRecords.all(id, Number(named > 0))) {
          let explicit: ReturnType<typeof explicitTitle> = null;
          try { explicit = explicitTitle(row.type, object(JSON.parse(row.raw))); } catch { continue; }
          if (explicit && explicit.rank >= (title?.rank ?? 0)) title = explicit;
        }
        if (title) retitle.run(title.title, title.rank, id);
        if (decided.get(id, texts)!.found) reset.run(id);
      };
    },
  },
  // Version 18 reads Claude Code's interruption marker, the `user` record it writes itself when a turn is interrupted,
  // as a stand-in like an assistant record it writes in place of a model turn, where earlier builds read it as a prompt
  // and counted it as a message. Only the recordings holding such a record are re-read; finding them reads every
  // event, like version 8. A user record's searchable text holds its text blocks, so the marker is matched there, on
  // the records an earlier build read as messages; a prompt that quotes the marker is re-read too and stays a prompt.
  {
    version: 18,
    apply: db => {
      db.exec(`UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events
        WHERE role='user' AND category='message' AND instr(text,'[Request interrupted by user')>0)`);
    },
  },
  // Version 19 leaves out of an `api-request-blob` copy's searchable text the text an earlier user or attachment
  // record holds, such as the prompt a copy repeats. Only the recordings holding a copy with searchable text are
  // re-read; finding them reads every event, like version 8.
  {
    version: 19,
    apply: db => {
      db.query("UPDATE sessions SET mtime=0, identity='' WHERE id IN (SELECT DISTINCT session_id FROM events WHERE type=? AND text!='')").run(requestMessageType);
    },
  },
];

/** The step that writes `version`, for a test that applies one step on its own; throws when no step in the list does. */
export function migrationTo(version: number): Migration {
  const step = migrations.find(step => step.version === version);
  if (!step) throw new Error(`No index upgrade step writes version ${version}.`);
  return step;
}
