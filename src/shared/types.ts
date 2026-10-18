import type { Decision } from "./decisions";

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  source?: { type?: string; media_type?: string; data?: string; url?: string };
  [key: string]: unknown;
}

export interface ReplayEvent {
  id: string;
  sequence: number;
  offset: number;
  type: string;
  role: "user" | "assistant" | "system";
  timestamp: string;
  blocks: ContentBlock[];
  text: string;
  /** `synthetic` marks a record Claude Code wrote itself: an assistant stand-in for a model turn, such as an API error,
   *  or the interruption marker it writes as a user record when a turn is interrupted. Neither is a message. */
  category: "message" | "tool" | "thinking" | "hidden" | "system" | "synthetic";
  toolNames: string[];
  /** A failure is recorded: a tool result marked `is_error` that is not a decision, a record marked `is_error` or
   *  `level: "error"`, or an API error turn. Only these count as errors. */
  error: boolean;
  /** The first decision among the record's tool results: a tool that never ran, or never finished, because the user, a
   *  permission rule, a hook, or the auto mode classifier stopped it, or because it was interrupted or cancelled. Shown
   *  with the errors, but never counted as one. */
  decision: Decision | null;
  parentId?: string;
  uuid?: string;
  cwd?: string;
  agentId?: string;
  raw: Record<string, unknown>;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number;
  requests: number;
  /** Requests without an estimate. The six counts below divide them by reason. */
  unpricedRequests: number;
  /** Requests naming a model without bundled rates. */
  unratedRequests: number;
  /** Requests whose advisor named no model or ran on a model without bundled rates, or whose fallback hop ran on a
   *  model without bundled rates. A hop that names no model is never charged, so it is no reason. */
  unratedIterationRequests: number;
  /** Requests that recorded no model. */
  unnamedRequests: number;
  /** Requests in fast mode on a model without a known fast rate. */
  fastRequests: number;
  /** Requests on a service tier other than standard, which has no bundled rates. */
  tierRequests: number;
  /** Requests that presented a fallback credit, whose billing the API decides. */
  creditRequests: number;
  recordedCostRequests: number;
}

/** One model's share of Claude Code's own running total, keyed by the requested model after `normalizeModel()`. */
export interface RecordedModelUsage {
  inputTokens: number;
  outputTokens: number;
  /** Claude Code's own schema describes this field as "Thinking tokens, already counted inside outputTokens", so it is
   *  never added to `outputTokens`. Absent, and so 0 here, for turns run by versions that did not record it. */
  thinkingTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  webSearchRequests: number;
  costUSD: number;
}

/**
 * Claude Code's own running total for a session, from the last `cost-state` record in the recording. It counts the
 * session's subagents and the requests Claude Code bills but never records (prompt suggestions, compaction, summaries,
 * memory extraction, hook evaluations), so it normally runs above the estimate from the recording's own requests.
 */
export interface RecordedCost {
  costUSD: number;
  /** The tracker's `startTime` as an ISO string, or empty when it is missing or unreadable. */
  startedAt: string;
  /** Claude Code's `hasUnknownModelCost`: it could not price every model itself. */
  unknownModelCost: boolean;
  models: Record<string, RecordedModelUsage>;
  /** The tracker's `totalAPIDuration`: milliseconds spent waiting on API requests, retries included. Null when the
   *  record carries no readable value. */
  apiDurationMs: number | null;
  /** The tracker's `totalToolDuration`: milliseconds spent running tools. Null when the record carries no readable value. */
  toolDurationMs: number | null;
}

/**
 * The time Claude Code measured itself working in a recording: the sum of the `durationMs` of its `turn_duration`
 * records, one per turn, as opposed to the span between the recording's first and last timestamps, which counts the
 * pauses between turns. Null on a session whose recording holds no such record.
 */
export interface ActiveTime {
  durationMs: number;
  turns: number;
}

/** The sum of Claude Code's running totals over the recordings in a selection that carry one. */
export interface RecordedCostTotal {
  costUSD: number;
  recordings: number;
}

export interface DirectoryUsage {
  cwd: string;
  sessions: number;
  usage: UsageSummary;
}

export interface ModelUsage {
  model: string;
  effort: string | null;
  usage: UsageSummary;
}

export interface Session {
  id: string;
  sessionId: string;
  title: string;
  cwd: string;
  workspace: string;
  groupId: string | null;
  branch: string;
  model: string;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  messageCount: number;
  toolCount: number;
  /** Records with a failure: tool failures, API error turns, and other flagged records. */
  errorCount: number;
  /** The API error turns among `errorCount`. */
  apiErrorCount: number;
  /** Tool results that record a decision, each counted once, which never count as errors. */
  decisionCount: number;
  hasEdits: boolean;
  bookmarked: boolean;
  active: boolean;
  isAgent: boolean;
  source: string;
  usage: UsageSummary;
  recordedCost: RecordedCost | null;
  activeTime: ActiveTime | null;
  /** The last Claude Code version named on the recording's records, such as `2.1.302`, or "" when none names one. */
  version: string;
  /** Records whose type, or `system` or `attachment` subtype, this build does not recognize. */
  unrecognizedCount: number;
  snippet?: string;
  matchEventId?: string;
  matchCategory?: ReplayEvent["category"];
  matchRole?: ReplayEvent["role"];
}

export interface Workspace {
  id: string;
  name: string;
  paths: string[];
  count: number;
  mainCount?: number;
  grouped: boolean;
  usage: UsageSummary;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  paths: string[];
}

export interface IndexProgress {
  phase: "discovering" | "indexing" | "idle" | "error";
  checked: number;
  total: number;
}

export interface Catalog {
  sessions: number;
  mainSessions?: number;
  mainBookmarked?: number;
  messages: number;
  tools: number;
  errors: number;
  bookmarked: number;
  workspaces: Workspace[];
  models: string[];
  toolsUsed: string[];
  efforts: string[];
  /** Every Claude Code version named on indexed records, newest first. */
  versions: string[];
  facetsLimited: boolean;
  /** Records across every recording whose kind this build does not recognize. */
  unrecognizedRecords: number;
  /** Those records' kinds, such as `type:foo` or `system:bar`, when the name has the shape of an identifier. */
  unrecognizedKinds: string[];
  groups: WorkspaceGroup[];
  dataDir: string;
  indexedAt: string;
  warnings: number;
  demo: boolean;
}

/**
 * One page of matching recordings. `usage`, `directories`, `modelUsage` and `sessionsWithUsage` cover every matching
 * recording across all pages plus the `hiddenAgents` subagent recordings that the agent filter leaves out of `items`
 * and `total`: their requests were spent on behalf of main sessions, so hiding them never lowers the totals.
 * `hiddenAgentUsage` is their share of `usage`, deduplicated the same way; it is empty while subagents are listed.
 * `recordedCost` sums Claude Code's own totals over the same recordings, counting the ones that carry one.
 */
export interface SessionPage {
  items: Session[];
  total: number;
  offset: number;
  limit: number;
  usage: UsageSummary;
  recordedCost: RecordedCostTotal;
  directories: DirectoryUsage[];
  modelUsage: ModelUsage[];
  sessionsWithUsage: number;
  hiddenAgents: number;
  hiddenAgentUsage: UsageSummary;
}

export interface SessionFamilyMember {
  session: Session;
  parentId: string | null;
  spawnEventId: string | null;
  spawnToolId: string | null;
  label: string;
  depth: number | null;
}

export interface SessionFamily {
  rootId: string | null;
  members: SessionFamilyMember[];
  launches: Record<string, string>;
  limited?: boolean;
}

export interface EventPage {
  items: ReplayEvent[];
  total: number;
  offset: number;
  limit: number;
  unfilteredTotal: number;
  hiddenTotal: number;
  facets: { tools: string[]; models: string[]; directories: string[]; limited: boolean };
}

/**
 * The records a replay find term matches, in recording order. `position` is the record's ordinal under the same event
 * filter that `events()` pages by, so it is directly a page offset. `total` counts every match even when `items` stops
 * at the response limit, which `limited` reports.
 */
export interface FindMatches {
  total: number;
  limited: boolean;
  items: Array<{ position: number; sequence: number; id: string }>;
}

/**
 * One time bucket of a recording. `all` counts every record, `count` only those matching the replay filters, whose
 * page offsets run from `first` to `last` (null when none match). `at` is null for records before any timestamp.
 */
export interface TimelineBucket { at: string | null; all: number; count: number; first: number | null; last: number | null; errors: number }

export interface EventTimeline {
  total: number;
  unfilteredTotal: number;
  bucketMs: number;
  buckets: TimelineBucket[];
}

/**
 * A record a recording summary points at. `position` is its ordinal under the replay filters the summary was requested
 * with, so it is directly a page offset as in `FindMatches`; it is null when those filters hide the record.
 */
export interface SummaryRecord { id: string; position: number | null; timestamp: string }

/**
 * One Edit, Write, MultiEdit, or NotebookEdit call. `error` means its recorded result was a failure; `decision` means
 * the call never ran, or never finished, because of a decision the user, a permission rule, a hook, or the auto mode
 * classifier made, or because it was interrupted or cancelled.
 */
export interface SummaryChange extends SummaryRecord { tool: string; error: boolean; decision: Decision | null }

/**
 * A changed file. `display` is the path relative to its folder, or the whole path when no folder contains it. `count`,
 * `errors`, and `stopped`, the changes a decision stopped, cover every recorded change, even when `changes` stops at its
 * limit.
 */
export interface SummaryFile { path: string; display: string; count: number; errors: number; stopped: number; changes: SummaryChange[] }

/**
 * A file the recording read but never changed, pointing at its first read. `folder` is its containing folder or
 * scratchpad directory, or "".
 */
export interface SummaryRead extends SummaryRecord { path: string; display: string; folder: string; reads: number }

/**
 * A folder the recording worked in: `working` is the first record whose working directory it was, and `added` the
 * `/add-dir` command whose recorded output says it was added. Either can be null, never both.
 */
export interface SummaryFolder { path: string; working: SummaryRecord | null; added: SummaryRecord | null; files: SummaryFile[] }

/**
 * A scratchpad directory Claude Code keeps for a session's temporary files, with the files the recording changed in it.
 * `path` is the scratchpad directory itself, and each file's `display` is relative to it.
 */
export interface SummaryScratchpad { path: string; files: SummaryFile[] }

/**
 * One run of a shell command or one search, as `SummaryChange` is one change to a file. `error` and `decision` read
 * its result the same way; `background` means the command was started in the background, so its result only says it
 * started, and `pending` that the recording holds no result for it.
 */
export interface SummaryRun extends SummaryRecord { tool: string; error: boolean; decision: Decision | null; background: boolean; pending: boolean }

/**
 * A distinct command or search, with its latest runs in recording order. `text` is the recorded command, pattern, or
 * query, trimmed and capped; `head` is its first line from the program on, and `lead` the `cd` steps and environment
 * settings before the program, each on one line, and `lines` how many non-empty lines the command has from the program
 * on; `detail` is the path
 * and glob a search was scoped to, or "". `count`,
 * `errors`, and `stopped` cover every run, even when `runs` keeps only the last of them.
 */
export interface SummaryCommand { text: string; head: string; lead: string; lines: number; detail: string; count: number; errors: number; stopped: number; runs: SummaryRun[] }

/**
 * Commands that start with one program, named by `name`, or the searches one tool made, named by the tool. The counts
 * cover every run of every command in the group.
 */
export interface SummaryCommandGroup { name: string; count: number; errors: number; stopped: number; commands: SummaryCommand[] }

/**
 * The files a recording changed and read, grouped under the folders it worked in, and the commands it ran. `scratchpads`
 * holds the changed files inside Claude Code's per-session scratchpad directories, and `other` the changed files outside
 * every folder and scratchpad. `commands` groups the Bash and PowerShell commands by the program they start with, and
 * `searches` the Grep, Glob, and WebSearch calls by tool; `commandCount` and `searchCount` are the distinct commands and
 * searches, `commandRuns` and `searchRuns` every run of them. The totals count every file, command, and run even when a
 * list stops at its limit, which `limited` reports.
 */
export interface SessionSummary {
  folders: SummaryFolder[];
  scratchpads: SummaryScratchpad[];
  other: SummaryFile[];
  read: SummaryRead[];
  commands: SummaryCommandGroup[];
  searches: SummaryCommandGroup[];
  changedFiles: number;
  readFiles: number;
  commandCount: number;
  commandRuns: number;
  searchCount: number;
  searchRuns: number;
  limited: boolean;
}
