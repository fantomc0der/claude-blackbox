import { expect, test } from "bun:test";
import { clearReplayFilters, matchReplayKind, replayFilters } from "../src/client/lib/replay-filters";

test("search hits open on Conversation only when that view shows the matching record", () => {
  expect(matchReplayKind({ matchCategory: "message", matchRole: "user" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "message", matchRole: "assistant" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "thinking", matchRole: "assistant" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "synthetic", matchRole: "assistant" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "tool", matchRole: "assistant" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "tool", matchRole: "user" })).toBe("all");
  expect(matchReplayKind({ matchCategory: "tool" })).toBe("all");
  expect(matchReplayKind({ matchCategory: "system", matchRole: "system" })).toBe("all");
  expect(matchReplayKind({ matchCategory: "hidden", matchRole: "assistant" })).toBe("all");
  expect(matchReplayKind({})).toBe("all");
});

test("an anchored replay keeps a requested view and otherwise shows all events", () => {
  expect(replayFilters(new URLSearchParams("session=a&event=e1&context=1&replayKind=conversation")).kind).toBe("conversation");
  expect(replayFilters(new URLSearchParams("session=a&event=e1&context=1")).kind).toBe("all");
  expect(replayFilters(new URLSearchParams("session=a")).kind).toBe("conversation");
  expect(replayFilters(new URLSearchParams("session=a&q=retry")).q).toBe("");
});

test("the find term narrows the replay only when the matching-records switch is on", () => {
  expect(replayFilters(new URLSearchParams("session=a&replayQ=retry"))).toMatchObject({ q: "retry", only: false });
  expect(replayFilters(new URLSearchParams("session=a&replayQ=retry&replayOnly=1"))).toMatchObject({ q: "retry", only: true });
  expect(replayFilters(new URLSearchParams("session=a&replayOnly=true")).only).toBe(false);
  expect(clearReplayFilters()).toHaveProperty("replayOnly", null);
});
