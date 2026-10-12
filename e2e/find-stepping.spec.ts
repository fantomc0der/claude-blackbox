import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openRecording(page: Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`);
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
}

const find = (page: Page) => page.getByRole("textbox", { name: "Find in this recording" });
const status = (page: Page) => page.locator(".replay-match-count");
const selected = (page: Page) => page.locator(".replay-event-selected");
// How far the selected card's header sits below the top of the transcript scroller.
const selectedOffset = (page: Page) => page.evaluate(() => {
  const scroller = document.querySelector(".replay-scroll")!.getBoundingClientRect();
  const header = document.querySelector(".replay-event-selected .replay-event-header")!.getBoundingClientRect();
  return header.top - scroller.top;
});

test("Enter and Shift+Enter step through matching records on the loaded page without narrowing it", async ({ page }) => {
  await openRecording(page, "Timeline scrubber verification");
  await find(page).fill("Timeline event 5");
  // Events 5 and 50 to 59 contain the term; every record stays on screen with the matches highlighted.
  await expect(status(page)).toHaveText("11 matches");
  await expect(page).toHaveURL(/replayQ=Timeline\+event\+5/);
  await expect(page).not.toHaveURL(/replayOnly=/);
  await expect(page.locator(".replay-event")).toHaveCount(60);
  await expect(page.getByRole("checkbox", { name: "Only matching records" })).not.toBeChecked();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("1 of 11 matching records");
  await expect(selected(page)).toHaveCount(1);
  await expect(selected(page)).toContainText("Timeline event 5");
  await expect(selected(page).locator("mark").first()).toHaveText("Timeline event 5");
  await expect(find(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("2 of 11 matching records");
  await expect(selected(page)).toContainText("Timeline event 50");
  await expect.poll(() => selectedOffset(page)).toBeLessThan(40);
  expect(await selectedOffset(page)).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Shift+Enter");
  await expect(status(page)).toHaveText("1 of 11 matching records");
  await expect(selected(page)).toContainText("Timeline event 5");
  // Stepping back past the first match wraps to the last.
  await page.keyboard.press("Shift+Enter");
  await expect(status(page)).toHaveText("11 of 11 matching records");
  await expect(selected(page)).toContainText("Timeline event 59");
  await expect(find(page)).toBeFocused();
  await page.getByRole("button", { name: "Next match" }).click();
  await expect(status(page)).toHaveText("1 of 11 matching records");
  await find(page).fill("not recorded anywhere");
  await expect(status(page)).toHaveText("No matches");
  await expect(page.getByRole("button", { name: "Next match" })).toBeDisabled();
  await expect(page.locator(".replay-event")).toHaveCount(60);
});

test("stepping jumps across pages and the matching-records switch narrows through reload and history", async ({ page }) => {
  await openRecording(page, "Timeline scrubber verification");
  // Enter before the find term settles still steps once its matches arrive.
  await find(page).fill("Timeline event 15");
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("1 of 11 matching records");
  await expect(selected(page)).toContainText("Timeline event 15");
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("2 of 11 matching records");
  await expect(page.locator(".replay-range")).toHaveText("141–200 of 200 records");
  await expect(selected(page)).toContainText("Timeline event 150");
  await expect.poll(() => selectedOffset(page)).toBeLessThan(40);
  await expect(find(page)).toBeFocused();
  // Like a seek on the activity strip, a jump starts the page at the matching record.
  await page.keyboard.press("Shift+Enter");
  await expect(status(page)).toHaveText("1 of 11 matching records");
  await expect(page.locator(".replay-range")).toHaveText("16–75 of 200 records");
  await expect(selected(page)).toContainText("Timeline event 15");

  const only = page.getByRole("checkbox", { name: "Only matching records" });
  await only.check();
  await expect(page).toHaveURL(/replayOnly=1/);
  await expect(page.locator(".replay-event")).toHaveCount(11);
  await expect(page.locator(".replay-range")).toHaveText("1–11 of 11 records");
  await expect(status(page)).toHaveText("1 of 11 matching records");
  await expect(page.locator("details.replay-filters .filter-count")).toHaveText("1");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Only matching records" })).toBeChecked();
  await expect(page.locator(".replay-event")).toHaveCount(11);
  await expect(status(page)).toHaveText("11 matches");
  await page.goBack();
  await expect(page).not.toHaveURL(/replayOnly=/);
  await expect(page.getByRole("checkbox", { name: "Only matching records" })).not.toBeChecked();
  await expect(page.locator(".replay-event")).toHaveCount(60);
});
