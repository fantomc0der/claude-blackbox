import { expect, test } from "bun:test";
import { recalledReplayPosition, rememberReplayPosition, replayPositionKey, sessionDestination, sessionHref } from "../src/client/lib/session-navigation";

test("family navigation preserves archive filters but clears previous replay state", () => {
  const params = new URLSearchParams("q=review&workspace=project&agents=0&session=parent&event=old&context=1&replayKind=tool&replayQ=needle&replayOffset=60");
  const next = new URL(sessionHref(params, "child"), "http://localhost").searchParams;
  expect(next.get("session")).toBe("child");
  expect(next.get("q")).toBe("review");
  expect(next.get("workspace")).toBe("project");
  expect(next.get("agents")).toBe("0");
  expect([...next.keys()].some(key => key.startsWith("replay"))).toBe(false);
  expect(next.has("event")).toBe(false);
  expect(next.has("context")).toBe(false);
  expect(params.get("event")).toBe("old");
});

test("originating-call links select the parent event without stale filters", () => {
  const next = new URL(sessionHref(new URLSearchParams("agents=only&replayErrors=1"), "parent", "launch"), "http://localhost").searchParams;
  expect(next.get("event")).toBe("launch");
  expect(next.get("agents")).toBe("only");
  expect(next.has("replayErrors")).toBe(false);
  expect(sessionDestination("parent", "launch").context).toBeNull();
});

test("review positions are isolated by session and replay scope, not archive filters", () => {
  const key = replayPositionKey("parent", new URLSearchParams("replayKind=tool&replayOffset=60&q=archive"));
  rememberReplayPosition(key, 540);
  expect(recalledReplayPosition(replayPositionKey("parent", new URLSearchParams("replayOffset=60&replayKind=tool&q=other")))).toBe(540);
  expect(recalledReplayPosition(replayPositionKey("child", new URLSearchParams("replayKind=tool&replayOffset=60")))).toBeUndefined();
  expect(recalledReplayPosition(replayPositionKey("parent", new URLSearchParams("replayKind=conversation")))).toBeUndefined();
});
