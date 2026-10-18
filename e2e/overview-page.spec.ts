import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openRecording(page: Page, title: string) {
  await page.goto(`/?q=${encodeURIComponent(title).replace(/%20/g, "+")}`);
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  return { rail, view: rail.getByLabel("Overview content"), scope: rail.locator(".overview-scope"), outline: rail.getByRole("navigation", { name: "Events on this page" }) };
}

const wide = { viewport: { width: 2000, height: 1000 } };

test("the event outline identifies its current page and counts the entries it shows", async ({ page }) => {
  const { rail, view, scope, outline } = await openRecording(page, "Long recording event 0");
  await expect(view).toHaveValue("page");
  await expect(view.locator('option[value="page"]')).toHaveText("Event outline · 24");
  await expect(outline.getByRole("button")).toHaveCount(24);
  await expect(scope).toHaveText("Current page · records 1–60");

  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(scope).toHaveText("Current page · records 61–120");
  await expect(outline.getByRole("button").first()).toContainText("Long recording event 60");
  await outline.getByRole("button").nth(12).click();
  await expect(page.locator(".replay-event").filter({ hasText: "Long recording event 72" })).toBeInViewport();

  await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
  await expect(scope).toHaveText("Current page · records 116–175");
  await expect(view.locator('option[value="page"]')).toHaveText("Event outline · 24");

  await view.selectOption("prompts");
  await expect(scope).toHaveText("Whole recording · 175 prompts");
  await view.selectOption("page");
  await expect(scope).toHaveText("Current page · records 116–175");
  await page.reload();
  await expect(view).toHaveValue("page");
  await expect(scope).toHaveText("Current page · records 116–175");

  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const audit = await new AxeBuilder({ page }).include("#recording-overview").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await expect(rail).toBeVisible();
  }
}, wide);

test("the event outline scope follows filtered and empty pages", async ({ page }) => {
  const { view, scope, outline } = await openRecording(page, "Long recording event 0");
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("Long recording event 174");
  await page.getByRole("checkbox", { name: "Only matching records" }).check();
  await expect(scope).toHaveText("Current page · record 1");
  await expect(view.locator('option[value="page"]')).toHaveText("Event outline · 1");
  await expect(outline.getByRole("button")).toHaveCount(1);
  await expect(outline.getByRole("button")).toContainText("Long recording event 174");

  await page.getByRole("textbox", { name: "Find in this recording" }).fill("no-such-overview-event");
  await expect(scope).toHaveText("Current page · 0 records");
  await expect(view.locator('option[value="page"]')).toHaveText("Event outline · 0");
  await expect(outline.getByRole("button")).toHaveCount(0);

  await page.getByRole("button", { name: "Reset replay filters", exact: true }).click();
  await expect(scope).toHaveText("Current page · records 1–60");
  await expect(view.locator('option[value="page"]')).toHaveText("Event outline · 24");
}, wide);
