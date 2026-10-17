import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

const wide = { viewport: { width: 2000, height: 1000 } };
const stoppedTitle = "Thornquill decision verification";
const deniedTitle = "Marrowgate denial verification";

// Opens a recording whose tools the user, a hook, or an interruption stopped, directly on a replay view.
async function openRecording(page: Page, term: string, title: string, view: string) {
  const listing = await (await page.request.get(`/api/sessions?q=${term}`)).json();
  expect(listing.items.map((session: { title: string }) => session.title)).toEqual([title]);
  await page.goto(`/?session=${listing.items[0].id}&${view}`);
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  return listing.items[0] as { id: string; errorCount: number; messageCount: number };
}

test("the Errors tab labels each tool the user stopped and counts only the failure as an error", async ({ page }) => {
  const session = await openRecording(page, "Thornquill", stoppedTitle, "replayKind=all&replayErrors=1");
  expect(session.errorCount).toBe(1);
  const results = page.locator(".replay-event-tool-result");
  await expect(results).toHaveCount(5);
  await expect(results.locator(".replay-decision-label")).toHaveText(["Permission denied", "Stopped by hook", "Interrupted", "Cancelled"]);
  await expect(results.locator(".replay-error-label")).toHaveText(["Error"]);
  await expect(page.locator(".replay-event-decision")).toHaveCount(4);
  await expect(page.locator(".replay-event-error")).toHaveCount(1);
  const denied = results.first();
  await expect(denied.locator(".tool-result-call .tool-preview")).toHaveText("rm -rf node_modules");
  await expect(denied.locator(".tool-status")).toHaveAttribute("aria-label", "Tool denied");
  await expect(denied.locator(".tool-content .tool-code header")).toContainText("Permission denied");
  await expect(denied.locator(".tool-content")).toContainText("Keep the install, just prune the cache.");
  await expect(results.nth(1).locator(".tool-status")).toHaveAttribute("aria-label", "Tool blocked");
  await expect(results.nth(2).locator(".tool-status")).toHaveAttribute("aria-label", "Tool interrupted");
  await expect(results.nth(4).locator(".tool-status")).toHaveAttribute("aria-label", "Tool error");
  await expect(results.nth(4).locator(".tool-content .tool-code header")).toContainText("Recorded tool error");
  await expect(page.locator(".replay-find > .replay-count")).toHaveText(/^5 of 13 records$/);
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  await expect(rail.locator(".inspector-stats")).toContainText("1errors");
  // The stopped tools never count as errors, but the count says how many there were.
  await expect(rail.locator(".inspector-stats > div").nth(2)).toHaveAttribute("title", "1 error · 4 tools stopped");
  await expect(rail.getByRole("navigation", { name: "Events on this page" }).getByRole("button")).toHaveText([/^Permission denied/, /^Stopped by hook/, /^Interrupted/, /^Cancelled/, /^Error/]);
  await page.locator(".session-details > summary").click();
  const details = page.getByRole("region", { name: "Session details" });
  await expect(details.locator("dt", { hasText: /^Errors$/ }).locator("+ dd")).toHaveText("1 error · 4 tools stopped");
}, wide);

test("the interruption marker Claude Code writes reads as its own card, never as a prompt", async ({ page }) => {
  const session = await openRecording(page, "Thornquill", stoppedTitle, "replayKind=conversation");
  // The prompt and the reply are the messages; the marker, the calls, and the results are not.
  expect(session.messageCount).toBe(2);
  const marker = page.locator(".replay-event-stand-in");
  await expect(marker).toHaveCount(1);
  await expect(marker.locator(".replay-role")).toHaveText("Claude Code");
  await expect(marker.locator(".replay-role")).toHaveAttribute("title", "Claude Code wrote this record itself when the turn was interrupted; the user did not type it.");
  await expect(marker).toContainText("[Request interrupted by user for tool use]");
  await expect(page.locator(".replay-event-user")).toHaveCount(1);
  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("prompts");
  await page.keyboard.press("Escape");
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-event")).toContainText(stoppedTitle);
  await expect(page.locator(".replay-event-stand-in")).toHaveCount(0);
});

test("the Tools tab tints a stopped call apart from a failed one and names what stopped it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRecording(page, "Thornquill", stoppedTitle, "replayKind=tool");
  const stopped = page.locator(".tool-card-decision");
  await expect(stopped).toHaveCount(4);
  await expect(page.locator(".tool-card-error")).toHaveCount(1);
  const hook = stopped.filter({ hasText: "git push --force origin main" });
  await expect(hook.locator("button.tool-summary")).toHaveAttribute("aria-expanded", "true");
  await expect(hook.locator(".tool-status")).toHaveAttribute("aria-label", "Tool blocked");
  await expect(hook.locator(".tool-code header").first()).toContainText("Command");
  await expect(hook.locator(".tool-code header").nth(1)).toContainText("Stopped by hook");
  await expect(page.locator(".tool-card-error .tool-code header").nth(1)).toContainText("Command error");
});

test("a cancelled change is counted as stopped, not as an error, in the files the recording changed", async ({ page }) => {
  await openRecording(page, "Thornquill", stoppedTitle, "replayKind=conversation");
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  await rail.getByLabel("Overview content").selectOption("files");
  const files = rail.getByRole("navigation", { name: "Files changed in this recording" });
  const row = files.getByRole("button", { name: /^config\.ts in src, 1 change, 1 stopped\. Show the change\.$/ });
  await expect(row).toContainText("1 stopped");
  await expect(row).not.toContainText("error");
}, wide);

test("a recording whose only error flag is a cancellation is not a recording with errors", async ({ page }) => {
  const listing = await (await page.request.get("/api/sessions?q=Marrowgate")).json();
  expect(listing.items.map((session: { title: string; errorCount: number }) => [session.title, session.errorCount])).toEqual([[deniedTitle, 0]]);
  const filtered = await (await page.request.get("/api/sessions?q=Marrowgate&errors=1")).json();
  expect(filtered.total).toBe(0);
  await page.goto("/?q=Marrowgate");
  const row = page.locator(".session-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".session-symbol")).not.toHaveClass(/has-error/);
  await expect(row.locator(".session-symbol")).toHaveAttribute("title", "Conversation · 1 tool stopped");
  await row.click();
  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".replay-event")).toHaveCount(1);
  // Claude Code files its "doesn't want to take this action right now" message as a cancellation, not a denial.
  await expect(page.locator(".replay-decision-label")).toHaveText("Cancelled");
  await expect(page.locator(".replay-event .tool-status")).toHaveAttribute("aria-label", "Tool cancelled");
  await expect(page.locator(".replay-error-label")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Recording overview" }).locator(".inspector-stats")).toContainText("0errors");
}, wide);

test("the kind Claude Code filed names each stopped tool, on its own and inside its call", async ({ page }) => {
  const labels = ["Blocked by auto mode", "Not reviewed by auto mode", "Permission denied", "Stopped by hook", "Interrupted", "Cancelled"];
  const names = ["Tool denied by auto mode", "Tool not reviewed by auto mode", "Tool denied", "Tool blocked", "Tool interrupted", "Tool cancelled"];
  const session = await openRecording(page, "Galeharrow", "Galeharrow decision kinds verification", "replayKind=all&replayErrors=1");
  expect(session.errorCount).toBe(0);
  const results = page.locator(".replay-event-tool-result");
  await expect(results.locator(".replay-decision-label")).toHaveText(labels);
  await expect(page.locator(".replay-error-label")).toHaveCount(0);
  for (const [index, name] of names.entries()) await expect(results.nth(index).locator(".tool-status")).toHaveAttribute("aria-label", name);
  await expect(results.nth(2).locator(".tool-content .tool-code header")).toContainText("Permission denied");
  // Tools folds each result into its call's card from the stored result, which keeps the kind its record filed.
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  const cards = page.locator(".tool-card");
  await expect(cards).toHaveCount(6);
  await expect(page.locator(".tool-card-decision")).toHaveCount(6);
  await expect(page.locator(".tool-card-error")).toHaveCount(0);
  for (const [index, name] of names.entries()) await expect(cards.nth(index).locator(".tool-status")).toHaveAttribute("aria-label", name);
  await expect(cards.nth(2).locator(".tool-code header").nth(1)).toContainText("Permission denied");
}, wide);
