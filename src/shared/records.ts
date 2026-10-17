// Claude Code 2.1.30x keeps its own session state in the recording file next to the transcript. Its writer files these
// record types as state ("last-wins" or "boundary-cleared"), not as transcript records: none carries a message, most
// carry no timestamp, and two repeat a prompt that a user record already holds (`last-prompt.lastPrompt`, written after
// every turn, and `queue-operation.content`). The index gives them no blocks, and the replay shows each as a note.
export const sessionStateTypes: ReadonlySet<string> = new Set([
  "last-prompt", "atis-latch", "queue-operation", "cost-state", "mode", "permission-mode", "worktree-state",
  "isolation-latch", "dev-mods", "memory-mode", "agent-name", "agent-color", "agent-setting", "tag",
  "attribution-snapshot", "file-history-delta", "api-request-shape", "relocated", "continued-in", "fork-context-ref",
  "observer-ref", "history-suppression", "ended-by-model", "content-replacement",
]);

export function isSessionState(type: string): boolean {
  return sessionStateTypes.has(type);
}
