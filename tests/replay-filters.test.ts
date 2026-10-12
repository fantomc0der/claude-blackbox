import { expect, test } from "bun:test";
import { matchReplayKind, replayFilters } from "../src/client/lib/replay-filters";

test("search hits open on Conversation only when that view shows the matching record", () => {
  expect(matchReplayKind({ matchCategory: "message", matchRole: "user" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "message", matchRole: "assistant" })).toBe("conversation");
  expect(matchReplayKind({ matchCategory: "thinking", matchRole: "assistant" })).toBe("conversation");
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
