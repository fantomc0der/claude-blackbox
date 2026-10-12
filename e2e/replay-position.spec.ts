import type { Page } from "@playwright/test";
import { appendFile } from "node:fs/promises";
import { expect, test } from "./harness";

const fixtures = ".blackbox/e2e/projects/browser-regressions";
const record = (text: string) => JSON.stringify({ type: "assistant", uuid: `appended-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), cwd: "/synthetic/browser-tests", message: { role: "assistant", content: text, model: "claude-sonnet-4-5" } }) + "\n";

async function openRecording(page: Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`);
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await waitForReplay(page);
}

async function waitForReplay(page: Page) {
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

const replayScroll = (page: Page) => page.locator(".replay-scroll");
const scrollToEnd = (page: Page) => replayScroll(page).evaluate(async element => {
  element.scrollTop = element.scrollHeight;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  return element.scrollTop;
});
const distanceFromEnd = (page: Page) => replayScroll(page).evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight);

test("expanding a record at the end of a recording is not undone by unrelated refreshes", async ({ page }) => {
  await openRecording(page, "Tail recording verification");
  await expect(page.locator(".replay-event")).toHaveCount(20);
  await scrollToEnd(page);
  expect(await distanceFromEnd(page)).toBeLessThan(2);
  await page.locator(".replay-event").last().locator("details.replay-raw > summary").click();
  await expect(page.locator(".replay-event").last().locator("details.replay-raw")).toHaveAttribute("open", "");
  await expect.poll(() => distanceFromEnd(page)).toBeGreaterThan(80);
  const position = await replayScroll(page).evaluate(element => element.scrollTop);
  const refreshed = page.waitForResponse(response => response.url().includes("/events?"));
  await appendFile(`${fixtures}/tail-neighbor-recording.jsonl`, record("Neighbor activity that must not move another reader"));
  await refreshed;
  await page.waitForTimeout(400);
  expect(await replayScroll(page).evaluate(element => element.scrollTop)).toBe(position);
});

test("a full last page offers the latest records instead of moving the reader, then follows after Jump to latest", async ({ page }) => {
  await openRecording(page, "Full page verification");
  await expect(page.locator(".replay-event")).toHaveCount(60);
  await expect(page.locator(".timeline-end")).toContainText("You're all caught up.");
  await scrollToEnd(page);
  await appendFile(`${fixtures}/full-page-recording.jsonl`, record("Full page overflow one"));
  const updated = page.getByRole("button", { name: "Recording updated · Show latest", exact: true });
  await expect(updated).toBeVisible();
  await expect(page.locator(".timeline-marker")).toContainText("BEGINNING OF RECORDING");
  await expect(page).not.toHaveURL(/replayOffset=/);
  await expect(page.locator(".replay-event").first()).toContainText("Full page verification");
  await updated.click();
  await expect(page).toHaveURL(/replayOffset=1(&|$)/);
  await expect(page.locator(".timeline-marker")).toContainText("CONTINUED · EVENT 2");
  await expect(page.locator(".replay-event").last()).toContainText("Full page overflow one");
  await expect(page.locator(".timeline-end")).toContainText("You're all caught up.");
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(10);
  await appendFile(`${fixtures}/full-page-recording.jsonl`, record("Full page overflow two"));
  await expect(page.locator(".replay-event").last()).toContainText("Full page overflow two");
  await expect(page).toHaveURL(/replayOffset=2(&|$)/);
  await expect.poll(() => distanceFromEnd(page)).toBeLessThan(10);
  await expect(page.getByRole("button", { name: /Recording updated/ })).toHaveCount(0);
});

test("a library search result opens at its match with preceding records in view", async ({ page }) => {
  await openRecording(page, "Needleword");
  await expect(page).toHaveURL(/event=/);
  await expect(page).toHaveURL(/context=1/);
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toBeVisible();
  await expect(selected).toContainText("Needleword appears late in this recording");
  await expect(page.locator(".replay-event").first()).toContainText("Late match event 62");
  await expect(page.locator(".timeline-marker")).toContainText("CONTINUED · EVENT 63");
  await expect(page.getByRole("button", { name: "Previous events", exact: true })).toBeVisible();
});

test("the continued marker names the recorded event, not the filtered position", async ({ page }) => {
  await openRecording(page, "System interleaved verification");
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Conversation", exact: true })).toHaveClass(/active/);
  await waitForReplay(page);
  await page.getByRole("button", { name: "Next 5 events", exact: true }).click();
  await waitForReplay(page);
  await expect(page.locator(".replay-event").first()).toContainText("Interleaved event 65");
  await expect(page.locator(".timeline-marker")).toContainText("CONTINUED · EVENT 66");
});

test("reopening a recording starts at the beginning while browser Back restores the reading position", async ({ page }) => {
  await page.goto("/?q=Long+recording+event");
  await page.getByRole("button", { name: /Long recording event 0/ }).click();
  await waitForReplay(page);
  const position = await scrollToEnd(page);
  expect(position).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close replay", exact: true }).click();
  await page.getByRole("button", { name: /Long recording event 0/ }).click();
  await waitForReplay(page);
  await expect.poll(() => replayScroll(page).evaluate(element => element.scrollTop)).toBe(0);
  await page.goBack();
  await expect(page.locator(".replay-panel")).toHaveCount(0);
  await page.goBack();
  await waitForReplay(page);
  await expect.poll(() => replayScroll(page).evaluate(element => element.scrollTop)).toBe(position);
});

test("jumping to an outline entry scrolls the replay without moving the application shell", async ({ page }) => {
  // The hidden labels inside tool cards are absolutely positioned, so a card near the end of the page once extended the panel past the shell and scrollIntoView dragged the whole shell upward.
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?q=Session+family+root");
  await page.getByRole("button", { name: /Session family root/ }).click();
  await waitForReplay(page);
  const outline = page.locator(".replay-outline button");
  await expect(outline.last()).toBeVisible();
  await outline.last().click();
  await expect.poll(() => replayScroll(page).evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".app-shell").evaluate(element => [element.scrollTop, element.scrollHeight - element.clientHeight])).toEqual([0, 0]);
  expect(await page.locator(".replay-panel").evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0);
  expect(await page.locator(".topbar").evaluate(element => element.getBoundingClientRect().top)).toBe(0);
});
