import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  DEMO_AGENT_IDS,
  DEMO_MARKER_FILE,
  DEMO_SESSION_IDS,
  DEMO_TOOL_RESULT_KEYWORD,
} from "../tests/fixtures";

type ContentBlock = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

interface DemoSession {
  id: string;
  title: string;
  workspace: "orbit" | "orbit-auth" | "atlas-api" | "design-system" | "blackbox";
  branch: string;
  daysAgo: number;
  hour: number;
  prompt: string;
  finding: string;
  file: string;
  oldText: string;
  newText: string;
  command: string;
  commandOutput: string;
  finalNote: string;
  model: string;
  error?: boolean;
  hero?: boolean;
}

interface DemoMarker {
  kind: "claude-blackbox-demo";
  version: 1;
  ownedFiles: string[];
}

interface DemoRecording {
  file: string;
  agent: boolean;
  records: JsonRecord[];
}

const DEFAULT_DEMO_DIR = ".blackbox/demo";
const ROOT = "/synthetic/workspaces";

const workspaces = {
  orbit: `${ROOT}/orbit`,
  "orbit-auth": `${ROOT}/orbit-auth`,
  "atlas-api": `${ROOT}/atlas-api`,
  "design-system": `${ROOT}/design-system`,
  blackbox: `${ROOT}/blackbox`,
} as const;

const sessions: DemoSession[] = [
  {
    id: DEMO_SESSION_IDS.orbitAuthHero,
    title: "Make the authentication flow feel effortless",
    workspace: "orbit-auth",
    branch: "feat/auth-delight",
    daysAgo: 0,
    hour: 15,
    prompt: "Make sign-in feel calm and inevitable: preserve the intended destination, explain session recovery, and remove the awkward retry loop.",
    finding: "The redirect is already available in the callback, but the retry state is reset before the recovery screen can use it.",
    file: "apps/web/src/auth/recover-session.ts",
    oldText: "return redirect('/sign-in')",
    newText: "return redirect(buildSignInUrl({ returnTo, reason: 'expired-session' }))",
    command: "bun test auth --filter recovery",
    commandOutput: "12 pass\n0 fail\nrecovery path keeps returnTo and displays a friendly explanation",
    finalNote: "The recovery path now keeps context, names the next step, and gives people one clear way forward.",
    model: "claude-sonnet-4-5",
    error: true,
    hero: true,
  },
  {
    id: DEMO_SESSION_IDS.orbitRefresh,
    title: "Keep token refresh handoffs invisible",
    workspace: "orbit",
    branch: "main",
    daysAgo: 0,
    hour: 11,
    prompt: "Review the token refresh handoff and make it resilient without adding more UI states.",
    finding: "Refresh completion already emits a single event; the listener only needs to coalesce concurrent requests.",
    file: "packages/auth/src/refresh-coordinator.ts",
    oldText: "await refreshSession()",
    newText: "await refreshCoordinator.run(refreshSession)",
    command: "bun test packages/auth --filter refresh",
    commandOutput: "8 pass\n0 fail\nconcurrent refresh callers share one in-flight request",
    finalNote: "Concurrent refreshes now feel like one uninterrupted session instead of a race.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.orbitQueue,
    title: "Clarify offline queue recovery",
    workspace: "orbit-auth",
    branch: "feat/auth-delight",
    daysAgo: 1,
    hour: 16,
    prompt: "Make the offline queue recovery message precise, reassuring, and easy to dismiss.",
    finding: "Queued actions have stable labels, so the recovery screen can say what will resume instead of showing a generic warning.",
    file: "apps/web/src/offline/recovery-copy.ts",
    oldText: "Your changes will sync later.",
    newText: "Your saved work will resume when you are back online.",
    command: "bun test offline --filter recovery-copy",
    commandOutput: "6 pass\n0 fail\ncopy remains visible until the queued action completes",
    finalNote: "The message now explains what is safe, what happens next, and nothing more.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.orbitOnboarding,
    title: "Tighten the onboarding checkpoint",
    workspace: "orbit",
    branch: "main",
    daysAgo: 3,
    hour: 10,
    prompt: "Reduce the onboarding checkpoint to one confident decision without hiding important context.",
    finding: "The checkpoint repeats information from the previous screen, so a compact summary can replace the duplicate field list.",
    file: "apps/web/src/onboarding/checkpoint.tsx",
    oldText: "Review every detail before continuing",
    newText: "Everything looks ready. You can change these details later.",
    command: "bun test onboarding --filter checkpoint",
    commandOutput: "10 pass\n0 fail\ncheckpoint preserves keyboard focus after continue",
    finalNote: "The checkpoint now reassures people without making them reread the form.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.atlasBilling,
    title: "Add idempotent billing retries",
    workspace: "atlas-api",
    branch: "feat/billing-retries",
    daysAgo: 1,
    hour: 13,
    prompt: "Add safe retries to billing writes while keeping duplicate charges impossible.",
    finding: "The request identifier is already persisted; retry behavior only needs to reuse it through the gateway boundary.",
    file: "src/billing/create-charge.ts",
    oldText: "gateway.createCharge(payload)",
    newText: "gateway.createCharge(payload, { idempotencyKey: requestId })",
    command: "bun test billing --filter idempotency",
    commandOutput: "14 pass\n0 fail\nreplayed requests return the original charge receipt",
    finalNote: "Retries now reuse a durable request identity and leave the billing ledger clean.",
    model: "claude-opus-4-5",
  },
  {
    id: DEMO_SESSION_IDS.atlasWebhooks,
    title: "Trace intermittent webhook 502s",
    workspace: "atlas-api",
    branch: "main",
    daysAgo: 2,
    hour: 9,
    prompt: "Trace the intermittent webhook 502s and propose the smallest reliable fix.",
    finding: "The proxy timeout is shorter than the downstream verification budget, so valid requests are abandoned at the edge.",
    file: "src/webhooks/verify-signature.ts",
    oldText: "timeout: 2_000",
    newText: "timeout: 5_000",
    command: "bun test webhooks --filter signature",
    commandOutput: "11 pass\n0 fail\nslow verification returns a controlled retry response",
    finalNote: "The edge now waits for the verified response instead of converting it into a misleading 502.",
    model: "claude-opus-4-5",
    error: true,
  },
  {
    id: DEMO_SESSION_IDS.atlasRateLimits,
    title: "Make rate limit headers actionable",
    workspace: "atlas-api",
    branch: "feat/rate-limit-guidance",
    daysAgo: 4,
    hour: 14,
    prompt: "Make API rate limit headers easier for client developers to understand and use.",
    finding: "The server computes reset timing already; the response omits the human-readable policy header.",
    file: "src/http/rate-limit-headers.ts",
    oldText: "headers.set('RateLimit-Reset', resetAt)",
    newText: "headers.set('RateLimit-Policy', `${limit};w=${windowSeconds}`)",
    command: "bun test http --filter rate-limit",
    commandOutput: "9 pass\n0 fail\nheaders document both remaining capacity and reset window",
    finalNote: "Clients can now tell what happened and when they can safely try again.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.atlasChangelog,
    title: "Prepare the API changelog",
    workspace: "atlas-api",
    branch: "release/september",
    daysAgo: 6,
    hour: 11,
    prompt: "Prepare a concise API changelog that calls out migrations and developer-visible behavior.",
    finding: "Only two changes require action: the new rate limit policy header and a deprecated pagination alias.",
    file: "docs/changelog/2026-09.md",
    oldText: "## Changed",
    newText: "## Changed\n\n- Added actionable rate limit policy headers.",
    command: "bun test docs --filter changelog",
    commandOutput: "4 pass\n0 fail\nall linked migration anchors resolve",
    finalNote: "The release notes now separate migration work from useful but non-breaking improvements.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.designCommandPalette,
    title: "Polish command palette focus states",
    workspace: "design-system",
    branch: "feat/palette-focus",
    daysAgo: 2,
    hour: 15,
    prompt: "Polish command palette focus states so keyboard navigation feels deliberate and visible.",
    finding: "The active row has a color change but no focus ring, which makes fast keyboard scanning feel uncertain.",
    file: "packages/ui/src/command-palette.css",
    oldText: "background: var(--surface-selected);",
    newText: "background: var(--surface-selected); outline: 2px solid var(--focus-ring);",
    command: "bun test ui --filter command-palette",
    commandOutput: "7 pass\n0 fail\nfocus ring is visible in light, dark, and high contrast themes",
    finalNote: "Keyboard focus now has a clear, consistent home in every theme.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.designTokens,
    title: "Audit accessible color tokens",
    workspace: "design-system",
    branch: "main",
    daysAgo: 5,
    hour: 10,
    prompt: "Audit the status color tokens and improve contrast without losing their semantic meaning.",
    finding: "Muted warning text misses the contrast target on the elevated surface, while the border token is already compliant.",
    file: "packages/tokens/src/status.ts",
    oldText: "warningText: '#9a6700'",
    newText: "warningText: '#7a5200'",
    command: "bun test tokens --filter contrast",
    commandOutput: "18 pass\n0 fail\nall status text tokens meet the documented contrast threshold",
    finalNote: "Status colors now keep their meaning and remain readable in the places people need them.",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.designEmptyStates,
    title: "Give empty states a useful next step",
    workspace: "design-system",
    branch: "feat/empty-state-guidance",
    daysAgo: 9,
    hour: 14,
    prompt: "Make empty states practical: explain why the space is empty and offer one useful next action.",
    finding: "The component supports an action slot already; the documentation only needs a stronger default example.",
    file: "packages/ui/src/empty-state.stories.tsx",
    oldText: "No items yet.",
    newText: "No saved views yet. Create one to keep your frequent searches close.",
    command: "bun test ui --filter empty-state",
    commandOutput: "5 pass\n0 fail\nstory snapshots include an accessible action label",
    finalNote: "Empty states now answer both questions people have: why is this empty, and what can I do next?",
    model: "claude-sonnet-4-5",
  },
  {
    id: DEMO_SESSION_IDS.blackboxSearch,
    title: "Make conversation search feel instant",
    workspace: "blackbox",
    branch: "feat/search-ranked-results",
    daysAgo: 0,
    hour: 17,
    prompt: "Make full-text conversation search feel instant while keeping snippets precise and useful.",
    finding: "The result model already has event offsets, so snippets can link directly to the matching event instead of only the session.",
    file: "src/server/search.ts",
    oldText: "return sessions",
    newText: "return rankedEvents.map(toSessionResult)",
    command: "bun test search --filter snippets",
    commandOutput: "16 pass\n0 fail\nquoted phrases jump to the matching transcript event",
    finalNote: "Search now feels like a shortcut to the exact moment, not a list of possible places to look.",
    model: "claude-opus-4-5",
  },
  {
    id: DEMO_SESSION_IDS.blackboxProvenance,
    title: "Preserve worktree provenance in groups",
    workspace: "blackbox",
    branch: "feat/worktree-provenance",
    daysAgo: 3,
    hour: 12,
    prompt: "Group related worktrees without hiding which checkout produced each transcript.",
    finding: "A repository group can hold multiple source paths if each event retains its original cwd and branch.",
    file: "src/server/workspaces.ts",
    oldText: "group.paths = [workspace.path]",
    newText: "group.paths = unique([...group.paths, workspace.path])",
    command: "bun test workspaces --filter provenance",
    commandOutput: "13 pass\n0 fail\nmerged groups retain distinct source paths and branches",
    finalNote: "Related worktrees now travel together without losing the evidence of where each session began.",
    model: "claude-opus-4-5",
  },
  {
    id: DEMO_SESSION_IDS.blackboxLiveReplay,
    title: "Harden live transcript replay",
    workspace: "blackbox",
    branch: "feat/live-cursor",
    daysAgo: 7,
    hour: 16,
    prompt: "Harden live transcript replay so reconnects cannot skip partial JSONL writes or duplicate events.",
    finding: "The reconnect cursor must advance by acknowledged byte offset, not rendered message count.",
    file: "src/server/live-cursor.ts",
    oldText: "cursor += messages.length",
    newText: "cursor = batch.nextOffset",
    command: "bun test live --filter cursor",
    commandOutput: "15 pass\n0 fail\npartial lines wait for completion and reconnects replay each event once",
    finalNote: "Live replay now treats the transcript as an append-only recording instead of a chat-shaped guess.",
    model: "claude-opus-4-5",
  },
  {
    id: DEMO_SESSION_IDS.blackboxDemoCatalog,
    title: "Ship a local demo catalog",
    workspace: "blackbox",
    branch: "main",
    daysAgo: 18,
    hour: 10,
    prompt: "Create a polished local demo catalog that exercises search, replay, filters, and worktree grouping.",
    finding: "A synthetic catalog needs realistic relationships, varied event types, and stable IDs more than a large volume of filler text.",
    file: "scripts/demo.ts",
    oldText: "const sessions = []",
    newText: "const sessions = buildCuratedDemoSessions()",
    command: "bun test tests --filter demo",
    commandOutput: "9 pass\n0 fail\ndemo sessions remain deterministic and isolated from user logs",
    finalNote: "The demo catalog now tells coherent engineering stories while remaining safely fictional.",
    model: "claude-sonnet-4-5",
  },
];

function encodeWorkspace(cwd: string): string {
  return cwd.replace(/[\\/:.]/g, "-");
}

function eventUuid(sessionIndex: number, eventIndex: number): string {
  return `d3000000-${sessionIndex.toString(16).padStart(4, "0")}-4000-8000-${eventIndex
    .toString(16)
    .padStart(12, "0")}`;
}

function timestampFor(daysAgo: number, hour: number, minute: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function record(
  session: DemoSession,
  sessionIndex: number,
  eventIndex: number,
  type: string,
  body: JsonRecord = {},
): JsonRecord {
  const cwd = workspaces[session.workspace];
  return {
    type,
    uuid: eventUuid(sessionIndex, eventIndex),
    timestamp: timestampFor(session.daysAgo, session.hour, eventIndex * 2),
    sessionId: session.id,
    cwd,
    gitBranch: session.branch,
    version: "1.0.0",
    ...body,
  };
}

function userMessage(blocks: ContentBlock[], model: string): JsonRecord {
  return { message: { role: "user", content: blocks, model } };
}

function assistantMessage(blocks: ContentBlock[], model: string): JsonRecord {
  const effort = model.startsWith("claude-opus") ? blocks.some(block => block.type === "thinking") ? "high" : "low" : undefined;
  return { message: { role: "assistant", content: blocks, model, effort, usage: {
    input_tokens: 2400, output_tokens: 850, cache_creation_input_tokens: 1200, cache_read_input_tokens: 16000,
  } } };
}

function analysisMarkdown(session: DemoSession): string {
  if (session.hero) {
    return `## A calmer recovery path

The quickest win is to preserve intent and make recovery feel like a continuation, not a failure.

| Moment | Current feeling | Better behavior |
| --- | --- | --- |
| Session expires | “What just happened?” | Explain the expired session plainly |
| Sign-in resumes | “Will I lose my place?” | Carry the original destination forward |
| Retry succeeds | “Did it work?” | Return directly to the intended screen |

### Proposed flow

1. Capture the requested destination before redirecting.
2. Show one short recovery explanation on sign-in.
3. Resume the destination after successful authentication.

\`\`\`ts
const returnTo = sanitizeReturnTo(requestedPath)
return redirect(buildSignInUrl({ returnTo, reason: "expired-session" }))
\`\`\`

This keeps the interface warm without hiding what changed.`;
  }

  return `## What I found

${session.finding}

| Area | Signal | Decision |
| --- | --- | --- |
| Scope | One focused change | Keep the patch small |
| Safety | Existing test coverage | Add one behavior assertion |
| Follow-up | Documentation or copy | Capture it in the task list |

### Smallest useful change

1. Update the narrow boundary in \`${session.file}\`.
2. Verify the visible behavior with the focused test suite.
3. Leave a concise note for the next maintainer.

\`\`\`ts
const result = await applyFocusedChange()
assert(result.ok)
\`\`\`

This keeps the improvement easy to review and easy to trust.`;
}

function readResult(session: DemoSession): string {
  return `export function recoverContext() {
  ${session.oldText}
}
`;
}

function buildRecords(session: DemoSession, sessionIndex: number): JsonRecord[] {
  const model = session.model;
  const readToolId = `toolu_read_${sessionIndex}`;
  const bashToolId = `toolu_bash_${sessionIndex}`;
  const editToolId = `toolu_edit_${sessionIndex}`;
  const todoToolId = `toolu_todos_${sessionIndex}`;
  const records: JsonRecord[] = [
    record(session, sessionIndex, 1, "custom-title", { customTitle: session.title }),
    record(session, sessionIndex, 2, "ai-title", { aiTitle: session.title }),
    record(
      session,
      sessionIndex,
      3,
      "user",
      userMessage([{ type: "text", text: session.prompt }], model),
    ),
    record(
      session,
      sessionIndex,
      4,
      "assistant",
      assistantMessage(
        [
          {
            type: "thinking",
            thinking: "I will follow the existing boundary, verify the behavior, and keep the result understandable for a future replay.",
          },
          { type: "text", text: analysisMarkdown(session) },
          {
            type: "tool_use",
            id: readToolId,
            name: "Read",
            input: { file_path: session.file },
          },
        ],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      5,
      "user",
      userMessage(
        [{ type: "tool_result", tool_use_id: readToolId, content: readResult(session) }],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      6,
      "assistant",
      assistantMessage(
        [
          {
            type: "tool_use",
            id: bashToolId,
            name: "Bash",
            input: { command: session.command, description: "Run the focused behavior check" },
          },
        ],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      7,
      "user",
      userMessage(
        [
          {
            type: "tool_result",
            tool_use_id: bashToolId,
            content:
              session.hero
                ? `${session.commandOutput}\n${DEMO_TOOL_RESULT_KEYWORD}=3\nDEMO_ONLY_FAKE_TOKEN=not-a-real-token-000000000000`
                : session.commandOutput,
          },
        ],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      8,
      "assistant",
      assistantMessage(
        [
          {
            type: "tool_use",
            id: editToolId,
            name: "Edit",
            input: {
              file_path: session.file,
              old_string: session.oldText,
              new_string: session.newText,
            },
          },
        ],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      9,
      "user",
      userMessage(
        [
          {
            type: "tool_result",
            tool_use_id: editToolId,
            content: `Updated ${session.file}\n1 replacement applied`,
          },
        ],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      10,
      "assistant",
      assistantMessage(
        [
          {
            type: "tool_use",
            id: todoToolId,
            name: "TodoWrite",
            input: {
              todos: [
                { content: "Confirm the focused behavior", status: "completed", activeForm: "Confirming focused behavior" },
                { content: "Document the user-visible change", status: "in_progress", activeForm: "Documenting the user-visible change" },
              ],
            },
          },
        ],
        model,
      ),
    ),
    record(
      session,
      sessionIndex,
      11,
      "user",
      userMessage(
        [{ type: "tool_result", tool_use_id: todoToolId, content: "Todo list updated" }],
        model,
      ),
    ),
  ];

  if (session.hero) {
    const taskToolId = `toolu_task_${sessionIndex}`;
    const questionToolId = `toolu_question_${sessionIndex}`;
    const fetchToolId = `toolu_fetch_${sessionIndex}`;
    records.push(
      record(
        session,
        sessionIndex,
        12,
        "assistant",
        assistantMessage(
          [
            {
              type: "tool_use",
              id: taskToolId,
              name: "TaskCreate",
              input: { subject: "Verify recovery copy", description: "Check the recovery message in the sign-in flow.", activeForm: "Verifying recovery copy" },
            },
            {
              type: "tool_use",
              id: questionToolId,
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    question: "Should the recovery screen name the destination?",
                    header: "Recovery copy",
                    options: [
                      { label: "Keep it general", description: "Avoid exposing a destination label." },
                      { label: "Name the destination", description: "Give people more context before sign-in." },
                    ],
                    multiSelect: false,
                  },
                ],
              },
            },
          ],
          model,
        ),
      ),
      record(
        session,
        sessionIndex,
        13,
        "user",
        userMessage(
          [
            { type: "tool_result", tool_use_id: taskToolId, content: "Created task #42: Verify recovery copy" },
            { type: "tool_result", tool_use_id: questionToolId, content: "User selected: Keep it general" },
          ],
          model,
        ),
      ),
      record(
        session,
        sessionIndex,
        14,
        "assistant",
        assistantMessage(
          [
            {
              type: "tool_use",
              id: fetchToolId,
              name: "WebFetch",
              input: { url: "https://example.invalid/synthetic-auth-guidance", prompt: "Read the synthetic guidance page" },
            },
          ],
          model,
        ),
      ),
      record(
        session,
        sessionIndex,
        15,
        "user",
        userMessage(
          [
            {
              type: "tool_result",
              tool_use_id: fetchToolId,
              is_error: true,
              content: "Network access disabled for this synthetic fixture. Continue with local evidence.",
            },
          ],
          model,
        ),
      ),
      record(session, sessionIndex, 16, "file-history-snapshot", {
        snapshot: { trackedFiles: [session.file], reason: "before-auth-recovery-edit" },
      }),
    );
  } else if (session.error) {
    const failedToolId = `toolu_probe_${sessionIndex}`;
    records.push(
      record(
        session,
        sessionIndex,
        12,
        "assistant",
        assistantMessage(
          [
            {
              type: "tool_use",
              id: failedToolId,
              name: "Bash",
              input: { command: "bun run probe --synthetic", description: "Check the synthetic failure path" },
            },
          ],
          model,
        ),
      ),
      record(
        session,
        sessionIndex,
        13,
        "user",
        userMessage(
          [
            {
              type: "tool_result",
              tool_use_id: failedToolId,
              is_error: true,
              content: "Synthetic probe timed out after 5000ms; focused tests remain green.",
            },
          ],
          model,
        ),
      ),
    );
  }

  records.push(
    record(
      session,
      sessionIndex,
      20,
      "assistant",
      assistantMessage(
        [
          {
            type: "text",
            text: `## Result\n\n${session.finalNote}\n\n- Focused tests pass.\n- The patch stays within the existing boundary.\n- The next reviewer has a clear summary of the trade-off.`,
          },
        ],
        model,
      ),
    ),
    record(session, sessionIndex, 21, "system", {
      subtype: "synthetic-demo-observation",
      detail: "This intentionally unknown system event exercises generic transcript rendering.",
      message: { role: "system", content: "Synthetic demo event: preserve this record even when its subtype is unfamiliar." },
    }),
  );

  return records;
}

/**
 * `buildRecords` numbers its event UUIDs by position in `sessions` (1 to `sessions.length`), so story recordings
 * continue from the next free series to keep every UUID unique across the catalog.
 */
const STORY_SERIES_START = sessions.length + 1;

interface StoryOptions {
  sessionId: string;
  workspace: keyof typeof workspaces;
  branch: string;
  model: string;
  series: number;
  agentId?: string;
}

interface ToolStep {
  error?: boolean;
  note?: string;
  minutes?: number;
}

interface AgentLaunch {
  agentId: string;
  description: string;
  prompt: string;
}

/**
 * Writes one recording against an explicit clock, so a story can span several days, sit idle between working
 * stretches, and launch agents whose own recordings run alongside it. Each record advances the clock by `minutes`.
 */
function story(options: StoryOptions) {
  const records: JsonRecord[] = [];
  const model = options.model;
  let clock = 0;
  let tools = 0;
  const add = (type: string, body: JsonRecord, minutes: number) => {
    records.push({
      type,
      uuid: eventUuid(options.series, records.length + 1),
      timestamp: new Date(clock).toISOString(),
      sessionId: options.sessionId,
      ...(options.agentId ? { agentId: options.agentId, isSidechain: true } : {}),
      cwd: workspaces[options.workspace],
      gitBranch: options.branch,
      version: "1.0.0",
      ...body,
    });
    clock += minutes * 60_000;
  };
  const toolId = () => `toolu_demo_${options.series}_${++tools}`;
  const result = (id: string, content: unknown, minutes: number, error = false, extra: JsonRecord = {}) =>
    add("user", { ...userMessage([{ type: "tool_result", tool_use_id: id, content, ...(error ? { is_error: true } : {}) }], model), ...extra }, minutes);

  return {
    records,
    at(daysAgo: number, hour: number, minute = 0) {
      clock = Date.parse(timestampFor(daysAgo, hour, minute));
    },
    wait(minutes: number) {
      clock += minutes * 60_000;
    },
    title(title: string) {
      add("custom-title", { customTitle: title }, 0);
      add("ai-title", { aiTitle: title }, 0);
    },
    prompt(text: string, minutes = 1) {
      add("user", userMessage([{ type: "text", text }], model), minutes);
    },
    say(text: string, thinking?: string, minutes = 1) {
      const blocks: ContentBlock[] = thinking ? [{ type: "thinking", thinking }] : [];
      add("assistant", assistantMessage([...blocks, { type: "text", text }], model), minutes);
    },
    tool(name: string, input: JsonRecord, output: string, step: ToolStep = {}) {
      const id = toolId();
      const blocks: ContentBlock[] = step.note ? [{ type: "text", text: step.note }] : [];
      add("assistant", assistantMessage([...blocks, { type: "tool_use", id, name, input }], model), 1);
      result(id, output, step.minutes ?? 2, step.error);
    },
    /** Starts agents in parallel from one assistant turn and returns the tool IDs their reports answer. */
    launch(note: string, agents: AgentLaunch[]): string[] {
      const ids = agents.map(toolId);
      add("assistant", assistantMessage([
        { type: "text", text: note },
        ...agents.map((agent, index) => ({
          type: "tool_use",
          id: ids[index],
          name: "Agent",
          input: { description: agent.description, prompt: agent.prompt },
        })),
      ], model), 1);
      return ids;
    },
    report(id: string, agent: AgentLaunch, text: string, toolUses: number, minutes = 1) {
      result(id, [{ type: "text", text }, { type: "text", text: `agentId: ${agent.agentId}` }], minutes, false, {
        toolUseResult: { status: "completed", agentId: agent.agentId, totalToolUseCount: toolUses },
      });
    },
  };
}

function sessionFile(workspace: keyof typeof workspaces, sessionId: string): string {
  return join("projects", encodeWorkspace(workspaces[workspace]), `${sessionId}.jsonl`);
}

function agentFile(workspace: keyof typeof workspaces, parentId: string, agentId: string): string {
  return join("projects", encodeWorkspace(workspaces[workspace]), parentId, "subagents", `agent-${agentId}.jsonl`);
}

/**
 * A two-day investigation with more than one replay page of records. The overnight pause and the lunch break both
 * exceed the activity strip's idle threshold, and each working stretch hits one failing tool result.
 */
function ledgerExportRecording(): DemoRecording {
  const workspace = "atlas-api";
  const ledger = story({
    sessionId: DEMO_SESSION_IDS.atlasLedgerExports,
    workspace,
    branch: "feat/streaming-ledger-exports",
    model: "claude-opus-4-5",
    series: STORY_SERIES_START,
  });
  const exporter = "src/ledger/export-ledger.ts";
  const route = "src/routes/ledger-export.ts";
  const pages = "src/db/ledger-entries.ts";

  ledger.at(2, 14, 6);
  ledger.title("Stream ledger exports without timeouts");
  ledger.prompt("Large merchants hit the 30 second gateway timeout when they export a month of ledger entries. Find out why, and plan a fix that keeps the CSV byte-for-byte identical for every client that already parses it.");
  ledger.say(
    "I'll trace the export from the route to the CSV writer, reproduce the timeout with the large merchant fixture, and only then propose a change.",
    "Measure before changing anything. The export format is a public contract, so the fix has to be invisible in the output.",
  );
  ledger.tool("Grep", { pattern: "exportLedger", path: "src" }, `${route}:14\n${exporter}:8\nsrc/ledger/export-ledger.test.ts:3`);
  ledger.tool("Read", { file_path: route }, `export async function handleLedgerExport(request: Request) {\n  const { merchantId, month } = parseExportQuery(request)\n  const csv = await exportLedger(merchantId, month)\n  return new Response(csv, { headers: csvHeaders(merchantId, month) })\n}\n`);
  ledger.tool("Read", { file_path: exporter }, `export async function exportLedger(merchantId: string, month: string) {\n  const where = { merchantId, month }\n  const rows = await db.ledgerEntries.findMany({ where, orderBy: { id: "asc" } })\n  return [CSV_HEADER, ...rows.map(toCsvRow)].join("\\n")\n}\n`, { minutes: 3 });
  ledger.tool("Bash", { command: "bun test ledger --filter export", description: "Run the existing export tests" }, "5 pass\n0 fail\nsmall merchant exports match the golden CSV files");
  ledger.tool("Bash", { command: "bun run fixtures:ledger --merchant m_large_demo --months 1", description: "Generate a synthetic large merchant month" }, "Generated 412,880 synthetic ledger entries for m_large_demo (2026-09)", { minutes: 4 });
  ledger.tool("Bash", { command: "bun test ledger --filter large-export", description: "Reproduce the timeout with the large fixture" }, "0 pass\n1 fail\nexport-ledger.test.ts > large merchant export\n  Timed out after 30000ms\n  heap used before abort: 1.9 GB", { error: true, minutes: 3 });
  ledger.say(`## Why large exports time out

The export reads the whole month into memory, then builds one string before the first byte leaves the server.

| Stage | Large merchant | Notes |
| --- | --- | --- |
| Query | 18.2 s | One unbounded \`findMany\` |
| CSV join | 9.6 s | Builds a single 310 MB string |
| First byte | after 27.8 s | The gateway gives up at 30 s |

Nothing is slow per row. The problem is that every row has to exist before any row is sent.`, undefined, 3);
  ledger.tool("Read", { file_path: pages }, `export async function* pageLedgerEntries(where: LedgerWhere, { limit }: { limit: number }) {\n  let after: string | undefined\n  while (true) {\n    const page = await db.ledgerEntries.findMany({ where: { ...where, id: { gt: after } }, orderBy: { id: "asc" }, take: limit })\n    if (!page.length) return\n    yield page\n    after = page.at(-1)!.id\n  }\n}\n`);
  ledger.tool("Grep", { pattern: "pageLedgerEntries", path: "src" }, `${pages}:1\nsrc/jobs/reconcile-ledger.ts:22`);
  ledger.tool("Read", { file_path: "src/csv/writer.ts" }, `export const CSV_HEADER = "id,posted_at,amount_minor,currency,description,balance_minor"\n\nexport function toCsvRow(entry: LedgerEntry): string {\n  return [entry.id, entry.postedAt.toISOString(), entry.amountMinor, entry.currency, quote(entry.description), entry.balanceMinor].join(",")\n}\n`, { minutes: 4 });
  ledger.tool("TodoWrite", {
    todos: [
      { content: "Read ledger entries through the existing keyset pager", status: "pending", activeForm: "Reading through the keyset pager" },
      { content: "Stream CSV rows from the export route", status: "pending", activeForm: "Streaming CSV rows" },
      { content: "Prove the streamed CSV matches the buffered CSV", status: "pending", activeForm: "Comparing streamed and buffered CSV" },
      { content: "Release the database cursor when a client disconnects", status: "pending", activeForm: "Releasing the cursor on disconnect" },
    ],
  }, "Todo list updated");
  ledger.say(`## Plan

1. Reuse \`pageLedgerEntries\`, which the reconciliation job already trusts, instead of one unbounded query.
2. Yield the header and each page of rows as they arrive, so the first byte leaves in milliseconds.
3. Compare the streamed file with today's buffered output for the large fixture before anything ships.

The CSV writer stays exactly as it is, which keeps the format identical by construction. I'll pick this up in the morning.`);

  ledger.at(1, 9, 12);
  ledger.prompt("Morning. Go ahead with the streaming plan from yesterday.");
  ledger.say("Picking up from the plan: paged reads first, then the streaming response, then the format check.");
  ledger.tool("Read", { file_path: exporter }, `export async function exportLedger(merchantId: string, month: string) {\n  const where = { merchantId, month }\n  const rows = await db.ledgerEntries.findMany({ where, orderBy: { id: "asc" } })\n  return [CSV_HEADER, ...rows.map(toCsvRow)].join("\\n")\n}\n`);
  ledger.tool("Edit", {
    file_path: exporter,
    old_string: "export async function exportLedger(merchantId: string, month: string) {\n  const where = { merchantId, month }\n  const rows = await db.ledgerEntries.findMany({ where, orderBy: { id: \"asc\" } })\n  return [CSV_HEADER, ...rows.map(toCsvRow)].join(\"\\n\")\n}",
    new_string: "export async function* exportLedgerRows(merchantId: string, month: string) {\n  yield CSV_HEADER\n  for await (const page of pageLedgerEntries({ merchantId, month }, { limit: 5_000 })) {\n    yield \"\\n\" + page.map(toCsvRow).join(\"\\n\")\n  }\n}",
  }, `Updated ${exporter}\n1 replacement applied`, { minutes: 4 });
  ledger.tool("Edit", {
    file_path: route,
    old_string: "const csv = await exportLedger(merchantId, month)\n  return new Response(csv, { headers: csvHeaders(merchantId, month) })",
    new_string: "return new Response(exportLedgerRows(merchantId, month), { headers: csvHeaders(merchantId, month) })",
  }, `Updated ${route}\n1 replacement applied`);
  ledger.tool("Bash", { command: "bun run typecheck", description: "Type check the streaming change" }, `${route}:16:23 - error TS2345: Argument of type 'AsyncGenerator<string, void, unknown>' is not assignable to parameter of type 'BodyInit | null'.\n\nFound 1 error in ${route}`, { error: true, minutes: 1 });
  ledger.say(
    "The response needs a `ReadableStream`, not the generator itself. Wrapping it with `ReadableStream.from` keeps backpressure: the next page is only read when the client has taken the previous one.",
    "The runtime would accept an async iterable, but the declared body type does not. ReadableStream.from is the typed and still lazy way to hand it over.",
  );
  ledger.tool("Edit", {
    file_path: route,
    old_string: "return new Response(exportLedgerRows(merchantId, month), { headers: csvHeaders(merchantId, month) })",
    new_string: "return new Response(ReadableStream.from(exportLedgerRows(merchantId, month)), { headers: csvHeaders(merchantId, month) })",
  }, `Updated ${route}\n1 replacement applied`);
  ledger.tool("Bash", { command: "bun run typecheck", description: "Type check again" }, "No type errors found");
  ledger.tool("Bash", { command: "bun test ledger --filter export", description: "Run the existing export tests" }, "5 pass\n0 fail\nsmall merchant exports match the golden CSV files");
  ledger.tool("Bash", { command: "bun test ledger --filter large-export", description: "Retry the large fixture" }, "1 pass\n0 fail\nlarge merchant export streamed 412,880 rows in 6.4s\nfirst byte after 38ms · peak heap 96 MB", { minutes: 5 });
  ledger.tool("Grep", { pattern: "exportLedger\\(", path: "src" }, "No matches found");
  ledger.tool("TodoWrite", {
    todos: [
      { content: "Read ledger entries through the existing keyset pager", status: "completed", activeForm: "Reading through the keyset pager" },
      { content: "Stream CSV rows from the export route", status: "completed", activeForm: "Streaming CSV rows" },
      { content: "Prove the streamed CSV matches the buffered CSV", status: "pending", activeForm: "Comparing streamed and buffered CSV" },
      { content: "Release the database cursor when a client disconnects", status: "pending", activeForm: "Releasing the cursor on disconnect" },
    ],
  }, "Todo list updated");
  ledger.say(`## Progress

- The large merchant export now finishes in 6.4 s, with the first byte after 38 ms.
- Peak memory dropped from 1.9 GB to 96 MB.
- No callers of the buffered \`exportLedger\` remain.

Still open: a byte-level comparison against the old output, and the contract tests for client disconnects.`);

  ledger.at(1, 13, 31);
  ledger.prompt("Back. Before this ships, prove the CSV is identical and run the contract tests.");
  ledger.tool("Bash", { command: "bun run export:diff --merchant m_large_demo --month 2026-09", description: "Compare buffered and streamed exports" }, "Compared buffered and streamed exports for m_large_demo (2026-09)\n412,880 rows · header identical · sha256 match\n3f1c9a0e7b2d…c84e (both files)", { minutes: 4 });
  ledger.tool("Bash", { command: "bun test contract --filter ledger", description: "Run the ledger export contract tests" }, "8 pass\n1 fail\nledger export contract > releases the database cursor when the client disconnects\n  Expected 0 open cursors, received 1", { error: true, minutes: 1 });
  ledger.say(
    "A disconnected client cancels the stream, but the pager never learns about it, so its cursor stays open until the pool reaps it. A `finally` block in the pager covers cancellation as well as normal completion.",
    "Cancelling a ReadableStream.from stream calls return() on the generator, which runs finally blocks all the way down. Closing the cursor there handles every exit path.",
  );
  ledger.tool("Read", { file_path: pages }, `export async function* pageLedgerEntries(where: LedgerWhere, { limit }: { limit: number }) {\n  const cursor = await db.openCursor("ledger_entries", where)\n  let after: string | undefined\n  while (true) {\n    const page = await cursor.next({ after, limit })\n    if (!page.length) return\n    yield page\n    after = page.at(-1)!.id\n  }\n}\n`);
  ledger.tool("Edit", {
    file_path: pages,
    old_string: "  let after: string | undefined\n  while (true) {\n    const page = await cursor.next({ after, limit })\n    if (!page.length) return\n    yield page\n    after = page.at(-1)!.id\n  }",
    new_string: "  let after: string | undefined\n  try {\n    while (true) {\n      const page = await cursor.next({ after, limit })\n      if (!page.length) return\n      yield page\n      after = page.at(-1)!.id\n    }\n  } finally {\n    await cursor.close()\n  }",
  }, `Updated ${pages}\n1 replacement applied`, { minutes: 3 });
  ledger.tool("Bash", { command: "bun test contract --filter ledger", description: "Run the contract tests again" }, "9 pass\n0 fail\ndisconnects release the cursor within one page");
  ledger.tool("Bash", { command: "bun test src/jobs --filter reconcile", description: "Check the reconciliation job that shares the pager" }, "7 pass\n0 fail");
  ledger.tool("Bash", { command: "bun test", description: "Run the full suite" }, "214 pass\n0 fail\nRan 214 tests across 38 files. [41.7s]", { minutes: 3 });
  ledger.tool("Edit", {
    file_path: "docs/changelog/2026-10.md",
    old_string: "## Changed",
    new_string: "## Changed\n\n- Ledger exports now stream, so large months download without timeouts. The CSV format is identical.",
  }, "Updated docs/changelog/2026-10.md\n1 replacement applied");
  ledger.tool("Bash", { command: "git diff --stat", description: "Summarize the change" }, ` ${pages}        | 14 +++++++++-----\n ${exporter}     | 11 ++++++-----\n ${route}    |  3 +--\n docs/changelog/2026-10.md |  2 ++\n 4 files changed, 19 insertions(+), 11 deletions(-)`);
  ledger.say(`## Result

Ledger exports now stream page by page. The CSV is byte-for-byte identical, and nothing about the format changed for clients.

| Large merchant month | Before | After |
| --- | --- | --- |
| First byte | 27.8 s | 38 ms |
| Total time | Timed out at 30 s | 6.4 s |
| Peak memory | 1.9 GB | 96 MB |

- The pager closes its database cursor on completion, error, and client disconnect.
- The reconciliation job shares the pager and still passes.
- The changelog notes the faster exports without announcing a format change, because there is none.`);

  return { file: sessionFile(workspace, DEMO_SESSION_IDS.atlasLedgerExports), agent: false, records: ledger.records };
}

/**
 * A parent session that splits an audit across three agents running in parallel. Their recordings live in the
 * parent's `subagents` folder and each report's `agentId` line links it back to the launch that started it.
 */
function keyboardAuditRecordings(): DemoRecording[] {
  const workspace = "design-system";
  const parentId = DEMO_SESSION_IDS.designKeyboardAudit;
  const branch = "feat/keyboard-audit";
  const agents: AgentLaunch[] = [
    {
      agentId: DEMO_AGENT_IDS.dialogFocus,
      description: "Map dialog focus order",
      prompt: "Review keyboard focus in the packages/ui dialogs: where focus lands when they open, whether Tab stays inside, and where focus returns when they close. Report file and line evidence for each problem, most severe first.",
    },
    {
      agentId: DEMO_AGENT_IDS.menuFocus,
      description: "Check menu roving focus",
      prompt: "Check roving focus in menus, listboxes, and the command palette: arrow keys, Home and End, typeahead, and Escape. Report what works and what breaks, with file and line evidence.",
    },
    {
      agentId: DEMO_AGENT_IDS.landmarks,
      description: "Review skip links and landmarks",
      prompt: "Review skip links and landmarks in the documentation site layout. Confirm one main landmark per page, a skip link that reaches it, and labelled navigation regions.",
    },
  ];
  const model = "claude-sonnet-4-5";
  const parent = story({ sessionId: parentId, workspace, branch, model, series: STORY_SERIES_START + 1 });
  const worker = (agent: AgentLaunch, index: number) => {
    const recording = story({ sessionId: parentId, workspace, branch, model, series: STORY_SERIES_START + 2 + index, agentId: agent.agentId });
    recording.at(1, 15, 4 + index);
    recording.prompt(agent.prompt);
    return recording;
  };

  parent.at(1, 15, 0);
  parent.title("Audit keyboard paths across the component library");
  parent.prompt("Audit keyboard navigation across the component library. Check dialogs, menus, and page landmarks in parallel, then give me one prioritized list of fixes.");
  parent.say(
    "I'll run three focused reviews at once, one per area, and merge their findings into a single list ordered by how often people reach each path.",
    "Dialogs, menus, and the docs layout share almost no files, so separate reviews will not step on each other, and each report stays short enough to compare.",
  );
  const launches = parent.launch("Starting the three reviews now.", agents);

  const dialogs = worker(agents[0]!, 0);
  dialogs.tool("Grep", { pattern: "showModal|role=\"dialog\"", path: "packages/ui/src" }, "packages/ui/src/dialog.tsx:41\npackages/ui/src/sheet.tsx:58\npackages/ui/src/confirm-dialog.tsx:22");
  dialogs.tool("Read", { file_path: "packages/ui/src/dialog.tsx" }, `export function Dialog({ open, onOpenChange, children }: DialogProps) {\n  const dialog = useRef<HTMLDialogElement>(null)\n  useEffect(() => { if (open) dialog.current?.showModal() }, [open])\n  return <dialog ref={dialog} onClose={() => onOpenChange(false)}>{children}</dialog>\n}\n`);
  dialogs.tool("Read", { file_path: "packages/ui/src/sheet.tsx" }, `export function Sheet({ side = "right", children }: SheetProps) {\n  return <div role="dialog" aria-modal="true" tabIndex={-1} className={sheet({ side })}>{children}</div>\n}\n`);
  dialogs.tool("Read", { file_path: "packages/ui/src/confirm-dialog.tsx" }, `<Dialog open={open} onOpenChange={onOpenChange}>\n  <p>{message}</p>\n  <Button variant="danger" autoFocus onClick={onConfirm}>{confirmLabel}</Button>\n  <Button onClick={() => onOpenChange(false)}>Cancel</Button>\n</Dialog>\n`);
  dialogs.tool("Grep", { pattern: "restoreFocus|returnFocus", path: "packages/ui/src" }, "packages/ui/src/popover.tsx:73:    restoreFocus(trigger)\npackages/ui/src/focus.ts:12:export function restoreFocus(target: HTMLElement | null) {");
  const dialogReport = `## Dialog focus findings

| Severity | Component | Problem | Evidence |
| --- | --- | --- | --- |
| High | Sheet | Tab leaves the sheet and reaches the page behind it | \`sheet.tsx:58\` is a plain \`div\` with no focus trap |
| Medium | Dialog | Focus is not returned to the trigger on close | \`dialog.tsx:44\` closes without restoring focus |
| Medium | Confirm dialog | Initial focus lands on the destructive action | \`confirm-dialog.tsx:31\` puts \`autoFocus\` on the danger button |

The native \`dialog\` element already traps Tab, so only the sheet needs a trap. \`focus.ts\` has a \`restoreFocus\` helper that popovers use and dialogs can reuse.`;
  dialogs.say(dialogReport);

  const menus = worker(agents[1]!, 1);
  menus.tool("Grep", { pattern: "useRovingFocus", path: "packages/ui/src" }, "packages/ui/src/menu.tsx:12\npackages/ui/src/listbox.tsx:9\npackages/ui/src/command-palette.tsx:27\npackages/ui/src/use-roving-focus.ts:4");
  menus.tool("Read", { file_path: "packages/ui/src/use-roving-focus.ts" }, `export function useRovingFocus(items: HTMLElement[]) {\n  const onKeyDown = (event: KeyboardEvent) => {\n    if (event.key === "Home") return focus(items[0])\n    if (event.key === "End") return focus(items.at(-1))\n    if (event.key.length === 1) return focus(items.find(item => item.textContent?.toLowerCase().startsWith(event.key)))\n  }\n  return { onKeyDown }\n}\n`);
  menus.tool("Bash", { command: "bun test ui --filter keyboard", description: "Run the keyboard interaction tests" }, "22 pass\n2 fail\nmenu > Home moves to the first enabled item\n  Expected \"Rename\", received \"Duplicate\" (aria-disabled)\nlistbox > typeahead skips disabled options\n  Expected \"Archive\", received \"Archived drafts\" (aria-disabled)", { error: true });
  menus.tool("Read", { file_path: "packages/ui/src/command-palette.tsx" }, `const { onKeyDown } = useRovingFocus(visibleCommands)\n// Escape closes the palette and returns focus to the input\n`);
  const menuReport = `## Roving focus findings

Arrow keys and Escape behave correctly in the menu, the listbox, and the command palette.

Home, End, and typeahead can land on disabled items. All three components share \`use-roving-focus.ts\`, which picks \`items[0]\`, \`items.at(-1)\`, and the first text match without checking \`aria-disabled\` (lines 3 to 5). The two failing keyboard tests reproduce it.

One fix in the shared hook covers all three components.`;
  menus.say(menuReport);

  const landmarks = worker(agents[2]!, 2);
  landmarks.tool("Grep", { pattern: "<main|role=\"main\"", path: "apps/docs/src" }, "apps/docs/src/layouts/docs-layout.tsx:34\napps/docs/src/components/example-frame.tsx:18");
  landmarks.tool("Read", { file_path: "apps/docs/src/layouts/docs-layout.tsx" }, `<SkipLink />\n<header><nav>{primaryLinks}</nav></header>\n<aside><nav aria-label="Documentation">{sidebar}</nav></aside>\n<main id="content">{children}</main>\n`);
  landmarks.tool("Read", { file_path: "packages/ui/src/skip-link.tsx" }, `export function SkipLink() {\n  return <a className="skip-link" href="#main">Skip to content</a>\n}\n`);
  landmarks.tool("Read", { file_path: "apps/docs/src/components/example-frame.tsx" }, `export function ExampleFrame({ children }: { children: ReactNode }) {\n  return <main className="example-frame">{children}</main>\n}\n`);
  const landmarkReport = `## Landmark findings

- The skip link targets \`#main\`, but the layout's main region is \`id="content"\` (\`skip-link.tsx:2\`, \`docs-layout.tsx:34\`). Activating it does nothing.
- Pages with live examples render a second \`main\` from \`example-frame.tsx:18\`.
- The sidebar navigation is labelled; the header navigation is not.`;
  landmarks.say(landmarkReport);

  parent.wait(9);
  parent.report(launches[1]!, agents[1]!, menuReport, 3, 3);
  parent.report(launches[0]!, agents[0]!, dialogReport, 5, 2);
  parent.report(launches[2]!, agents[2]!, landmarkReport, 4);
  parent.say(`## Prioritized keyboard fixes

| Priority | Fix | Reaches | Evidence |
| --- | --- | --- | --- |
| 1 | Skip disabled items in the shared roving focus hook | Menu, listbox, command palette | \`use-roving-focus.ts:3\` |
| 2 | Trap focus inside sheets | Every sheet | \`sheet.tsx:58\` |
| 3 | Point the skip link at the real main region | Every docs page | \`skip-link.tsx:2\` |
| 4 | Return focus to the trigger when dialogs close | Dialog, confirm dialog | \`dialog.tsx:44\` |
| 5 | Start confirm dialogs on Cancel | Confirm dialog | \`confirm-dialog.tsx:31\` |
| 6 | Render example frames as \`div\` and label the header navigation | Docs pages | \`example-frame.tsx:18\` |

The first fix is one change in one hook and already has failing tests that prove it, so I'll start there.`, undefined, 2);
  parent.tool("Edit", {
    file_path: "packages/ui/src/use-roving-focus.ts",
    old_string: "if (event.key === \"Home\") return focus(items[0])\n    if (event.key === \"End\") return focus(items.at(-1))\n    if (event.key.length === 1) return focus(items.find(item => item.textContent?.toLowerCase().startsWith(event.key)))",
    new_string: "const enabled = items.filter(item => item.getAttribute(\"aria-disabled\") !== \"true\")\n    if (event.key === \"Home\") return focus(enabled[0])\n    if (event.key === \"End\") return focus(enabled.at(-1))\n    if (event.key.length === 1) return focus(enabled.find(item => item.textContent?.toLowerCase().startsWith(event.key)))",
  }, "Updated packages/ui/src/use-roving-focus.ts\n1 replacement applied", { minutes: 3 });
  parent.tool("Bash", { command: "bun test ui --filter keyboard", description: "Run the keyboard interaction tests" }, "24 pass\n0 fail");
  parent.tool("TodoWrite", {
    todos: [
      { content: "Skip disabled items in the shared roving focus hook", status: "completed", activeForm: "Skipping disabled items" },
      { content: "Trap focus inside sheets", status: "pending", activeForm: "Trapping focus inside sheets" },
      { content: "Point the skip link at the real main region", status: "pending", activeForm: "Fixing the skip link target" },
      { content: "Return focus to the trigger when dialogs close", status: "pending", activeForm: "Restoring dialog focus" },
      { content: "Start confirm dialogs on Cancel", status: "pending", activeForm: "Moving confirm dialog focus" },
      { content: "Render example frames as div and label the header navigation", status: "pending", activeForm: "Fixing docs landmarks" },
    ],
  }, "Todo list updated");
  parent.say("## Result\n\nThe roving focus fix is in and the keyboard tests pass. The other five fixes are on the task list, each with the evidence from its review, so they can land as small independent changes.");

  return [
    { file: sessionFile(workspace, parentId), agent: false, records: parent.records },
    ...[dialogs, menus, landmarks].map((recording, index) => ({
      file: agentFile(workspace, parentId, agents[index]!.agentId),
      agent: true,
      records: recording.records,
    })),
  ];
}

function demoRecordings(): DemoRecording[] {
  return [
    ...sessions.map((session, index) => ({ file: sessionFile(session.workspace, session.id), agent: false, records: buildRecords(session, index + 1) })),
    ledgerExportRecording(),
    ...keyboardAuditRecordings(),
  ];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readMarker(markerPath: string): Promise<DemoMarker | null> {
  if (!(await pathExists(markerPath))) {
    return null;
  }

  try {
    const parsed = JSON.parse(await readFile(markerPath, "utf8")) as Partial<DemoMarker>;
    if (
      parsed.kind === "claude-blackbox-demo" &&
      parsed.version === 1 &&
      Array.isArray(parsed.ownedFiles) &&
      parsed.ownedFiles.every((file) => typeof file === "string")
    ) {
      return parsed as DemoMarker;
    }
  } catch {
    throw new Error(`Refusing to replace an unreadable ${DEMO_MARKER_FILE} marker at ${markerPath}.`);
  }

  throw new Error(`Refusing to replace a marker not owned by the demo generator at ${markerPath}.`);
}

export async function createDemo(dir: string): Promise<void> {
  const demoDir = resolve(dir);
  const recordings = demoRecordings();
  const files = recordings.map((recording) => recording.file);
  const markerPath = join(demoDir, DEMO_MARKER_FILE);

  await mkdir(demoDir, { recursive: true });
  const marker = await readMarker(markerPath);
  const ownedFiles = new Set(marker?.ownedFiles ?? []);

  for (const file of files) {
    const target = join(demoDir, file);
    if ((await pathExists(target)) && !ownedFiles.has(file)) {
      throw new Error(`Refusing to overwrite non-demo file ${target}.`);
    }
  }

  const nextMarker: DemoMarker = {
    kind: "claude-blackbox-demo",
    version: 1,
    ownedFiles: files,
  };

  await writeFile(markerPath, `${JSON.stringify(nextMarker, null, 2)}\n`, "utf8");

  for (const recording of recordings) {
    const target = join(demoDir, recording.file);
    await mkdir(dirname(target), { recursive: true });
    const contents = recording.records.map((entry) => JSON.stringify(entry)).join("\n");
    await writeFile(target, `${contents}\n`, "utf8");
  }

  const outsideDemoDir = relative(demoDir, resolve(demoDir, "projects")).startsWith("..");
  if (outsideDemoDir) {
    throw new Error(`Demo output escaped its requested directory: ${demoDir}.`);
  }
}

if (import.meta.main) {
  const outputDir = Bun.argv[2] ?? DEFAULT_DEMO_DIR;
  try {
    await createDemo(outputDir);
    const recordings = demoRecordings();
    const agents = recordings.filter((recording) => recording.agent).length;
    console.log(`Created ${recordings.length - agents} synthetic demo sessions and ${agents} agent recordings in ${resolve(outputDir)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
