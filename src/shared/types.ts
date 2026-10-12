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
  category: "message" | "tool" | "thinking" | "hidden" | "system";
  toolNames: string[];
  error: boolean;
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
  unpricedRequests: number;
  recordedCostRequests: number;
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
  errorCount: number;
  hasEdits: boolean;
  bookmarked: boolean;
  active: boolean;
  isAgent: boolean;
  source: string;
  usage: UsageSummary;
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
  facetsLimited: boolean;
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
 */
export interface SessionPage {
  items: Session[];
  total: number;
  offset: number;
  limit: number;
  usage: UsageSummary;
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
