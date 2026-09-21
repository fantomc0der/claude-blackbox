import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

const measure = (page: Page) => page.locator(".md-content p").first().evaluate(paragraph => {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;inline-size:80ch";
  paragraph.appendChild(probe);
  const measured = probe.getBoundingClientRect().width;
  probe.remove();
  const content = paragraph.closest(".md-content") as HTMLElement;
  return { prose: paragraph.getBoundingClientRect().width, limit: measured, content: content.getBoundingClientRect().width, indent: paragraph.getBoundingClientRect().left - content.getBoundingClientRect().left };
});

const openHero = async (page: Page) => {
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
};

test("comfortable reading width measures prose while code and tables keep the pane", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto("/");
  await openHero(page);
  const selector = page.getByRole("combobox", { name: "Reading width" });
  await expect(selector).toHaveValue("full");
  const full = await measure(page);
  expect(full.prose).toBeCloseTo(full.content, 0);
  await selector.selectOption("comfortable");
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "comfortable");
  const comfortable = await measure(page);
  expect(comfortable.prose).toBeLessThanOrEqual(comfortable.limit + 1);
  expect(comfortable.prose).toBeGreaterThan(comfortable.limit - 2);
  expect(comfortable.indent).toBe(0);
  expect(comfortable.content).toBeCloseTo(full.content, 0);
  for (const wide of [".md-content pre", ".md-content table"]) {
    expect(await page.locator(wide).first().evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(comfortable.prose);
  }
  await page.reload();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await expect(selector).toHaveValue("comfortable");
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "comfortable");
  expect((await measure(page)).prose).toBeLessThanOrEqual(comfortable.limit + 1);
  await selector.selectOption("full");
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "full");
  expect((await measure(page)).prose).toBeCloseTo(full.content, 0);
});

test("saved reading width applies before the application bundle loads", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("blackbox:reading-width", "comfortable"));
  await page.route("**/assets/*.js", route => route.abort());
  await page.goto("/");
  await expect(page.locator("#app")).toBeEmpty();
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "comfortable");
});

test("reading width follows preference changes and removal in another tab", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("combobox", { name: "Reading width" }).selectOption("comfortable");
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "comfortable");
  await expect(page.getByRole("combobox", { name: "Reading width" })).toHaveValue("comfortable");
  await other.evaluate(() => localStorage.removeItem("blackbox:reading-width"));
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "full");
  await other.evaluate(() => localStorage.setItem("blackbox:reading-width", "comfortable"));
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "comfortable");
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "full");
  await other.close();
});

test("reading width ignores invalid preferences and works when storage is unavailable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("blackbox:reading-width", "unexpected"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "full");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await page.reload();
  const selector = page.getByRole("combobox", { name: "Reading width" });
  await expect(selector).toHaveValue("full");
  await selector.selectOption("comfortable");
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "comfortable");
  await selector.selectOption("full");
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "full");
});
