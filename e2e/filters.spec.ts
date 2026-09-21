import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openFilters(page: Page) {
  await expect(page.locator(".session-row").first()).toBeVisible();
  await page.locator("details.filter-popover > summary").click();
  const menu = page.locator(".filter-menu");
  await expect(menu).toBeVisible();
  return menu;
}

test("the filters sheet stays inside a phone viewport and closes from its header", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = await openFilters(page);
  await expect.poll(async () => { const box = await menu.boundingBox(); return box && box.x >= 0 && box.x + box.width <= 390; }).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const close = page.getByRole("button", { name: "Close filters" });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator("details.filter-popover")).toHaveJSProperty("open", false);
  await expect(page.locator("details.filter-popover > summary")).toBeFocused();
});

test("the filters menu is never clipped by the shell and reaches its reset action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?errors=1");
  const menu = await openFilters(page);
  await expect.poll(async () => { const box = await menu.boundingBox(); return box && Math.round(box.y + box.height) <= 900; }).toBe(true);
  const reset = page.getByRole("button", { name: "Reset all filters" });
  await reset.scrollIntoViewIfNeeded();
  await reset.click();
  await expect(page).not.toHaveURL(/errors=1/);
  await expect(page.locator(".filter-count")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("details.filter-popover")).toHaveJSProperty("open", false);
  await expect(page.locator("details.filter-popover > summary")).toBeFocused();
});

test("the filters menu keeps its right edge on screen at 1920 wide", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const menu = await openFilters(page);
  await expect.poll(async () => { const box = await menu.boundingBox(); return box && box.x + box.width <= 1920; }).toBe(true);
  await expect.poll(async () => { const box = await menu.boundingBox(); return box && Math.round(box.y + box.height) <= 1080; }).toBe(true);
});
