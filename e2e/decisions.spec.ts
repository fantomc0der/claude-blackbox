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
  return listing.items[0] as { id: string; errorCount: number };
}

test("the Errors tab labels each tool the user stopped and counts only the failure as an error", async ({ page }) => {
  const session = await openRecording(page, "Thornquill", stoppedTitle, "replayKind=all&replayErrors=1");
  expect(session.errorCount).toBe(1);
  const results = page.locator(".replay-event-tool-result");
  await expect(results).toHaveCount(5);
  await expect(results.locator(".replay-decision-label")).toHaveText(["Permission denied", "Stopped by hook", "Interrupted", "Permission denied"]);
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
  await expect(page.locator(".replay-find > .replay-count")).toHaveText(/^5 of 12 records$/);
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  await expect(rail.locator(".inspector-stats")).toContainText("1errors");
  await expect(rail.getByRole("navigation", { name: "Events on this page" }).getByRole("button")).toHaveText([/^Permission denied/, /^Stopped by hook/, /^Interrupted/, /^Permission denied/, /^Error/]);
}, wide);

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

test("a denied change is listed as denied, not as an error, in the files the recording changed", async ({ page }) => {
  await openRecording(page, "Thornquill", stoppedTitle, "replayKind=conversation");
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  await rail.getByLabel("Overview content").selectOption("files");
  const files = rail.getByRole("navigation", { name: "Files changed in this recording" });
  const row = files.getByRole("button", { name: /^config\.ts in src, 1 change, 1 denied\. Show the change\.$/ });
  await expect(row).toContainText("1 denied");
  await expect(row).not.toContainText("error");
}, wide);

test("a recording whose only error flag is a denial is not a recording with errors", async ({ page }) => {
  const listing = await (await page.request.get("/api/sessions?q=Marrowgate")).json();
  expect(listing.items.map((session: { title: string; errorCount: number }) => [session.title, session.errorCount])).toEqual([[deniedTitle, 0]]);
  const filtered = await (await page.request.get("/api/sessions?q=Marrowgate&errors=1")).json();
  expect(filtered.total).toBe(0);
  await page.goto("/?q=Marrowgate");
  const row = page.locator(".session-row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".session-symbol")).not.toHaveClass(/has-error/);
  await expect(row.locator(".session-symbol")).toHaveAttribute("title", "Conversation");
  await row.click();
  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-decision-label")).toHaveText("Permission denied");
  await expect(page.locator(".replay-error-label")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Recording overview" }).locator(".inspector-stats")).toContainText("0errors");
}, wide);
