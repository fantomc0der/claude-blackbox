import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openSearchHit(page: Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`);
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
}

// How far the anchored card's header sits below the top of the transcript scroller, which starts under the replay tabs.
const headerOffset = (page: Page) => page.evaluate(() => {
  const scroller = document.querySelector(".replay-scroll")!.getBoundingClientRect();
  const header = document.querySelector(".replay-event-selected .replay-event-header")!.getBoundingClientRect();
  return header.top - scroller.top;
});

test("a prose search hit opens on Conversation with the term marked and the card header at the top", async ({ page }) => {
  await openSearchHit(page, "Lanternwick");
  await expect(page).toHaveURL(/replayKind=conversation/);
  await expect(page).not.toHaveURL(/replayQ=/);
  await expect(page.getByRole("button", { name: "Conversation", exact: true })).toHaveAttribute("aria-pressed", "true");
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toContainText("The Lanternwick decision keeps the retry budget unchanged.");
  await expect(selected.locator("mark")).toHaveText(["Lanternwick"]);
  await expect.poll(() => headerOffset(page)).toBeGreaterThanOrEqual(0);
  expect(await headerOffset(page)).toBeLessThan(40);
  await expect(page.locator(".replay-event").first()).toContainText("Handoff lead-in 7");
  // The library term highlights without narrowing: the find box stays empty and calls that do not contain it stay closed.
  await expect(page.getByRole("textbox", { name: "Find in this recording" })).toHaveValue("");
  await expect(page.locator(".replay-event").last()).toContainText("Handoff follow-up 14");
  await expect(page.locator(".tool-summary").filter({ hasText: "Bash" })).toHaveAttribute("aria-expanded", "false");
});

test("a tool-result search hit opens on All events with the result marked and its header at the top", async ({ page }) => {
  await openSearchHit(page, "Quillmoss");
  await expect(page).toHaveURL(/replayKind=all/);
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  const selected = page.locator(".replay-event-selected");
  await expect(selected.locator(".replay-role")).toHaveText("Tool result");
  await expect(selected.locator("mark")).toHaveText(["Quillmoss"]);
  await expect.poll(() => headerOffset(page)).toBeGreaterThanOrEqual(0);
  expect(await headerOffset(page)).toBeLessThan(40);
  // The call that produced the matching output opens to show it too.
  await expect(page.locator(".tool-summary").filter({ hasText: "Bash" })).toHaveAttribute("aria-expanded", "true");
});

test("the replay's own find term replaces the library highlight", async ({ page }) => {
  await openSearchHit(page, "Lanternwick");
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("retry budget");
  await expect(page).toHaveURL(/replayQ=retry\+budget/);
  await expect(page.locator(".replay-match-count")).toHaveText("1 match");
  await expect(page.locator(".replay-event mark")).toHaveText(["retry budget"]);
  expect(await page.locator(".replay-event").count()).toBeGreaterThan(1);
  await page.getByRole("checkbox", { name: "Only matching records" }).check();
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-event mark")).toHaveText(["retry budget"]);
});
