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

test("a call and its output that both match select the call's card once and the next step moves to another card", async ({ page }) => {
  await openRecording(page, "Kettlewing fold verification");
  await find(page).fill("Brambleworth");
  // Three matching records, but Conversation folds the output into its call's card, so only two cards show them.
  await expect(status(page)).toHaveText("3 matches");
  await expect(page.locator(".replay-event")).toHaveCount(3);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("1 of 3 matching records");
  await expect(selected(page)).toHaveCount(1);
  await expect(selected(page).locator(".tool-summary")).toContainText("grep -rn Brambleworth logs");
  const callCard = await selected(page).getAttribute("data-event-id");
  // The output is the second matching record, but it is on the card already selected, so Enter moves past it.
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("3 of 3 matching records");
  await expect(selected(page)).toContainText("The Brambleworth report is ready.");
  expect(await selected(page).getAttribute("data-event-id")).not.toBe(callCard);
  // Stepping back reaches the output's record and selects the call's card that shows it.
  await page.keyboard.press("Shift+Enter");
  await expect(status(page)).toHaveText("2 of 3 matching records");
  await expect(selected(page)).toHaveAttribute("data-event-id", callCard!);
  await expect(find(page)).toBeFocused();
});

test("when every match folds onto one card, stepping still advances the position on that card", async ({ page }) => {
  await openRecording(page, "Saltmarsh fold verification");
  await find(page).fill("Quarrystone");
  await expect(status(page)).toHaveText("2 matches");
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("1 of 2 matching records");
  await expect(selected(page).locator(".tool-summary")).toContainText("cat Quarrystone.log");
  const card = await selected(page).getAttribute("data-event-id");
  // No other card holds a match, so the step takes the output's record on the same card rather than appearing to do
  // nothing: the selection stays and the count says which record it now stands on.
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("2 of 2 matching records");
  await expect(selected(page)).toHaveCount(1);
  await expect(selected(page)).toHaveAttribute("data-event-id", card!);
  await page.keyboard.press("Enter");
  await expect(status(page)).toHaveText("1 of 2 matching records");
});

test("a failed match list says so, keeps the highlight, and the next step retries it", async ({ page }) => {
  let failing = true;
  await page.route(url => url.pathname.endsWith("/matches"), route => failing ? route.fulfill({ status: 500, json: { error: "Synthetic failure" } }) : route.continue());
  await openRecording(page, "Kettlewing fold verification");
  await find(page).fill("Brambleworth");
  await expect(status(page)).toHaveText("Matches unavailable");
  await expect(page.locator(".replay-event mark").first()).toHaveText("Brambleworth");
  await expect(page.getByRole("button", { name: "Next match" })).toBeEnabled();
  failing = false;
  await find(page).press("Enter");
  await expect(status(page)).toHaveText("1 of 3 matching records");
  await expect(selected(page).locator(".tool-summary")).toContainText("grep -rn Brambleworth logs");
});
