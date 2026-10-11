import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openRecording(page: Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`);
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
}

const strip = (page: Page) => page.getByRole("slider", { name: "Position in recording" });
const firstCard = (page: Page) => page.locator(".replay-event").first();
const scrollTop = (page: Page) => page.locator(".replay-scroll").evaluate(element => element.scrollTop);

test("the activity strip jumps across an idle gap and Back returns to the earlier reading position", async ({ page }) => {
  await openRecording(page, "Timeline scrubber verification");
  await expect(strip(page)).toHaveAttribute("aria-busy", "false");
  await expect(strip(page)).toHaveAttribute("aria-valuetext", /^Records 1 to 60 of 200, /);
  await expect(page.locator(".timeline-gap text")).toHaveText("4h");
  await page.locator(".replay-scroll").evaluate(element => { element.scrollTop = 900; });
  await expect.poll(() => scrollTop(page)).toBe(900);
  const gap = (await page.locator(".timeline-gap").boundingBox())!;
  await page.mouse.click(gap.x + gap.width + 3, gap.y + gap.height / 2);
  await expect(page).toHaveURL(/replayOffset=100/);
  await expect(firstCard(page)).toContainText("Timeline event 100");
  await expect(page.locator(".replay-range")).toHaveText("101–160 of 200 records");
  expect(await scrollTop(page)).toBe(0);
  await page.goBack();
  await expect(firstCard(page)).toContainText("Timeline scrubber verification");
  await expect.poll(() => scrollTop(page)).toBe(900);
});

test("the strip and replay shortcuts page without scrolling to the end of a page", async ({ page }) => {
  await openRecording(page, "Timeline scrubber verification");
  await strip(page).focus();
  await page.keyboard.press("End");
  await expect(page).toHaveURL(/replayOffset=140/);
  await expect(page.locator(".replay-event").last()).toContainText("Timeline event 199");
  await page.keyboard.press("Home");
  await expect(firstCard(page)).toContainText("Timeline scrubber verification");
  await page.keyboard.press("PageDown");
  await expect(firstCard(page)).toContainText("Timeline event 60");
  await page.locator(".replay-event").nth(3).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("]");
  await expect(page.locator(".replay-range")).toHaveText("121–180 of 200 records");
  await expect(page.locator(".replay-footer [aria-live=polite]")).toHaveText("Records 121 to 180 of 200");
  await expect(page.locator(".replay-scroll")).toBeFocused();
  await page.keyboard.press("[");
  await expect(page.locator(".replay-range")).toHaveText("61–120 of 200 records");
  await page.getByRole("textbox", { name: "Find in this recording" }).focus();
  await page.keyboard.press("]");
  await expect(page.locator(".replay-range")).toHaveText("61–120 of 200 records");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator(".replay-range")).toHaveText("121–180 of 200 records");
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.locator(".replay-range")).toHaveText("61–120 of 200 records");
});

test("the strip near the end keeps a full page and brings the chosen record into view", async ({ page }) => {
  await openRecording(page, "Timeline scrubber verification");
  await expect(strip(page)).toHaveAttribute("aria-busy", "false");
  const box = (await strip(page).boundingBox())!;
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/replayOffset=140/);
  await expect(page.locator(".replay-event")).toHaveCount(60);
  // The last bin starts in the final minutes, so the card at the top of the transcript is one of those records.
  const topCard = () => page.locator(".replay-scroll").evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + 30)?.closest(".replay-event")?.textContent || "";
  });
  await expect.poll(topCard).toMatch(/Timeline event 19\d\b/);
});

test("recordings that fit on one page show no activity strip", async ({ page }) => {
  await openRecording(page, "Tail recording verification");
  await expect(page.locator(".replay-event")).toHaveCount(20);
  await expect(strip(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
});
