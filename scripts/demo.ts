import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
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
  const files = sessions.map((session) => {
    const cwd = workspaces[session.workspace];
    return join("projects", encodeWorkspace(cwd), `${session.id}.jsonl`);
  });
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

  for (const [sessionIndex, session] of sessions.entries()) {
    const cwd = workspaces[session.workspace];
    const relativeFile = join("projects", encodeWorkspace(cwd), `${session.id}.jsonl`);
    const target = join(demoDir, relativeFile);
    await mkdir(join(demoDir, "projects", encodeWorkspace(cwd)), { recursive: true });
    const contents = buildRecords(session, sessionIndex + 1).map((entry) => JSON.stringify(entry)).join("\n");
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
    console.log(`Created ${sessions.length} synthetic demo sessions in ${resolve(outputDir)}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
