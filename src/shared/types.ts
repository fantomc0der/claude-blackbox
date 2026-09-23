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
  category: "message" | "tool" | "thinking" | "system";
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
}

export interface Workspace {
  id: string;
  name: string;
  paths: string[];
  count: number;
  grouped: boolean;
}

export interface WorkspaceGroup {
  id: string;
  name: string;
  paths: string[];
}

export interface Catalog {
  sessions: number;
  messages: number;
  tools: number;
  errors: number;
  bookmarked: number;
  workspaces: Workspace[];
  models: string[];
  groups: WorkspaceGroup[];
  dataDir: string;
  indexedAt: string;
  warnings: number;
  demo: boolean;
}

export interface SessionPage {
  items: Session[];
  total: number;
  offset: number;
  limit: number;
  usage: UsageSummary;
  directories: DirectoryUsage[];
  modelUsage: ModelUsage[];
  sessionsWithUsage: number;
}

export interface EventPage {
  items: ReplayEvent[];
  total: number;
  offset: number;
  limit: number;
}
