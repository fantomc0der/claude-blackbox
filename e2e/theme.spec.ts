import { expect, test } from "./harness";
import AxeBuilder from "@axe-core/playwright";

test("theme defaults to dark regardless of system appearance and persists both choices", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const control = page.getByRole("group", { name: "Theme", exact: true });
  const dark = control.getByRole("button", { name: "Dark", exact: true });
  const light = control.getByRole("button", { name: "Light", exact: true });
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(16, 18, 20)");
  await light.focus();
  await page.keyboard.press("Enter");
  await expect(light).toBeFocused();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(dark).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(239, 239, 237)");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#efefed");
  await page.reload();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Text size")).toHaveValue("standard");
  await page.getByLabel("Text size").selectOption("larger");
  await dark.focus();
  await page.keyboard.press("Space");
  await page.reload();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(16, 18, 20)");
  await expect(page.getByLabel("Text size")).toHaveValue("larger");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#101214");
  expect(await page.evaluate(() => localStorage.getItem("blackbox:theme"))).toBe("dark");
});

test("saved light theme applies before the application bundle loads", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("blackbox:theme", "light"));
  await page.route("**/assets/*.js", route => route.abort());
  await page.goto("/");
  await expect(page.locator("#app")).toBeEmpty();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(239, 239, 237)");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#efefed");
});

test("theme ignores invalid preferences and works when browser storage is unavailable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("blackbox:theme", "unexpected"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Storage is blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Storage is full", "QuotaExceededError"); };
  });
  await page.reload();
  const control = page.getByRole("group", { name: "Theme", exact: true });
  await control.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await control.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("theme follows preference changes and removal in another tab", async ({ page, context }) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Light", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await other.evaluate(() => localStorage.removeItem("blackbox:theme"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await other.evaluate(() => localStorage.setItem("blackbox:theme", "light"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await other.close();
});

test("theme changes preserve the current replay and expanded tools", async ({ page }) => {
  await page.goto("/?q=effortless");
  await page.locator(".session-row").click();
  await page.locator('.tool-summary[aria-expanded="false"]').first().click();
  const url = page.url();
  const expanded = await page.locator('.tool-summary[aria-expanded="true"]').count();
  await page.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Light", exact: true }).click();
  await expect(page).toHaveURL(url);
  await expect(page.locator('.tool-summary[aria-expanded="true"]')).toHaveCount(expanded);
  await expect(page.locator(".replay-event").first()).toHaveCSS("background-color", "rgb(246, 246, 244)");
  await expect(page.locator(".md-content").first()).toHaveCSS("color", "rgb(38, 40, 37)");
  await page.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator(".replay-event").first()).toHaveCSS("background-color", "rgb(25, 28, 30)");
  await expect(page.locator(".md-content").first()).toHaveCSS("color", "rgb(233, 234, 229)");
});

test("light theme has accessible library, filters, replay tools and dialogs", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => localStorage.setItem("blackbox:theme", "light"));
  await page.goto("/");
  await expect(page.locator(".session-row").first()).toBeVisible();
  const audit = async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  };
  await audit();
  await page.locator(".filter-popover > summary").click();
  await audit();
  await page.locator(".filter-popover > summary").click();
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("effortless");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  const tools = page.locator('.tool-summary[aria-expanded="false"]');
  while (await tools.count()) await tools.first().click();
  await expect(page.locator(".tool-diff-added").first()).toBeVisible();
  await audit();
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await audit();
});

test("theme is keyboard accessible in the mobile drawer with larger text", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page.getByLabel("Text size").selectOption("larger");
  const light = page.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Light", exact: true });
  await light.focus();
  await page.keyboard.press("Space");
  await expect(light).toBeFocused();
  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(light).toBeInViewport();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open workspace navigation" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
