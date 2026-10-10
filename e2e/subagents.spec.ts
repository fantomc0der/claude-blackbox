import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./harness";

test("subagent visibility is shared across workspaces, library filters and history", async ({ page }) => {
  await page.goto("/?q=Subagent");
  const sidebarToggle = page.locator(".sidebar").getByRole("button", { name: "Show subagents", exact: true });
  const libraryToggle = page.locator(".library").getByRole("button", { name: "Show subagents", exact: true });
  const worktree = page.locator(".workspace-nav-item").filter({ hasText: "delegated-worktree" });
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(worktree).toHaveCount(0);
  await expect(sidebarToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".sidebar-footer").getByRole("button", { name: "Show subagents", exact: true })).toBeVisible();
  await expect(sidebarToggle).toContainText("All workspaces & lists");
  await libraryToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".session-row")).toHaveCount(3);
  await expect(page.locator(".session-kind")).toHaveCount(2);
  await expect(page.locator(".session-row").filter({ hasText: "Subagent preview parent" }).locator(".session-kind")).toHaveCount(0);
  await worktree.click();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await expect(libraryToggle).toHaveAttribute("aria-pressed", "true");
  await sidebarToggle.click();
  await expect(worktree).toHaveCount(0);
  await expect(page.locator(".session-row")).toHaveCount(0);
  await page.goBack();
  await expect(worktree).toBeVisible();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.reload();
  await expect(libraryToggle).toHaveAttribute("aria-pressed", "true");
  await page.locator(".filter-popover > summary").click();
  await expect(page.getByLabel("Agent recordings")).toHaveValue("1");
  await page.getByLabel("Agent recordings").selectOption("only");
  await expect(page.getByRole("button", { name: "Subagents only", exact: true })).toBeVisible();
  await page.getByLabel("Agent recordings").selectOption("0");
  await expect(libraryToggle).toHaveAttribute("aria-pressed", "false");
});

test("subagent preview keeps the main replay, URL, scroll and keyboard focus in place", async ({ page }) => {
  await page.goto("/?q=Subagent+preview+parent");
  await page.locator(".session-row").click();
  const opener = page.getByRole("button", { name: "Subagents 2", exact: true });
  await expect(opener).toBeVisible();
  const main = page.locator(".replay-scroll");
  await expect(main.locator(".replay-event").first()).toBeVisible();
  const scroll = await main.evaluate(element => { element.scrollTop = 500; return element.scrollTop; });
  const url = page.url();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Subagent recordings", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/Recording/).selectOption({ label: "Subagent child first · agent-first.jsonl" });
  await expect(dialog.locator(".replay-event")).toHaveCount(40);
  await expect(dialog.locator(".replay-event-link[href]")).toHaveCount(0);
  await expect(dialog.getByText("Delegate first event 1", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Next subagent events" }).click();
  await expect(dialog.locator(".replay-event")).toHaveCount(5);
  await expect(dialog.getByText("Delegate first event 40", { exact: true })).toBeVisible();
  await dialog.getByLabel(/Recording/).selectOption({ label: "Subagent child second · agent-second.jsonl" });
  await expect(dialog.locator(".replay-event")).toHaveCount(40);
  await expect(dialog.getByText("Subagent child second", { exact: true })).toBeVisible();
  await dialog.locator(".subagent-transcript").focus();
  await page.keyboard.press("/");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  expect(page.url()).toBe(url);
  await page.screenshot({ path: "test-results/subagent-preview-desktop.png" });
  expect((await new AxeBuilder({ page }).include(".subagent-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await main.evaluate(element => element.scrollTop)).toBe(scroll);
  await opener.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await main.evaluate(element => element.scrollTop)).toBe(scroll);
  await page.screenshot({ path: "test-results/subagent-preview-backdrop-closed.png" });
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await opener.click();
  await expect(dialog.locator(".replay-event")).toHaveCount(40);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/subagent-preview-mobile-light.png" });
  expect((await new AxeBuilder({ page }).include(".subagent-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Close subagent recordings" }).click();
  expect(page.url()).toBe(url);
});

test("subagent labels stay visible in full, split and mobile session lists", async ({ page }) => {
  await page.goto("/?agents=1&q=Subagent");
  const rows = page.locator(".session-row").filter({ has: page.locator(".session-kind") });
  await expect(rows).toHaveCount(2);
  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const label of await rows.locator(".session-kind").all()) await expect(label).toBeVisible();
      expect(await rows.evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1))).toBe(true);
      expect(await rows.evaluateAll(rows => rows.every(row => row.querySelector(".session-kind")!.getBoundingClientRect().top >= row.querySelector(".session-title")!.getBoundingClientRect().bottom))).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await page.locator(".session-row").filter({ hasText: "Subagent preview parent" }).click();
  await expect(page.locator(".library-split")).toBeVisible();
  for (const label of await rows.locator(".session-kind").all()) await expect(label).toBeVisible();
  await page.getByLabel("Text size").selectOption("larger");
  expect(await rows.evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1))).toBe(true);
  await page.screenshot({ path: "test-results/subagent-list-labels.png" });
  await page.goto("/?agents=only&q=Subagent");
  await expect(rows).toHaveCount(2);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await rows.evaluateAll(rows => rows.every(row => row.querySelector(".session-kind")!.getBoundingClientRect().top >= row.querySelector(".session-title")!.getBoundingClientRect().bottom && row.scrollWidth <= row.clientWidth + 1))).toBe(true);
  }
  await page.screenshot({ path: "test-results/subagent-list-labels-mobile.png" });
});

test("workspace rows and scroll position survive navigation and catalog refreshes", async ({ page }) => {
  let catalogs = 0;
  await page.route("**/api/catalog", async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    catalogs++;
    const template = catalog.workspaces[0];
    const workspaces = Array.from({ length: 60 }, (_, index) => ({ ...template, id: `/synthetic/scroll-${index}`, name: `Scroll workspace ${index}`, count: 1, mainCount: 1 }));
    await route.fulfill({ response, json: { ...catalog, workspaces } });
  });
  await page.goto("/?q=Pagination+fixture");
  await expect(page.locator(".workspace-nav-item")).toHaveCount(60);
  const nav = page.getByRole("navigation", { name: "Workspaces", exact: true });
  const before = await nav.evaluate(element => {
    element.querySelectorAll<HTMLElement>("button").forEach(row => row.dataset.original = "true");
    element.scrollTop = 900;
    return element.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await page.locator(".session-row").first().click();
  await expect(page.locator(".replay-panel")).toBeVisible();
  expect(await nav.evaluate(element => element.scrollTop)).toBe(before);
  const firstSession = new URL(page.url()).searchParams.get("session");
  await page.locator(".session-row").nth(1).click();
  expect(new URL(page.url()).searchParams.get("session")).not.toBe(firstSession);
  expect(await nav.evaluate(element => element.scrollTop)).toBe(before);
  const requests = catalogs;
  await page.getByRole("button", { name: "Rescan recordings", exact: true }).click();
  await expect.poll(() => catalogs).toBeGreaterThan(requests);
  await expect(page.getByRole("status").filter({ hasText: "Recordings are up to date" })).toBeVisible();
  expect(await nav.locator('[data-original="true"]').count()).toBe(60);
  expect(await nav.evaluate(element => element.scrollTop)).toBe(before);
  await page.getByRole("button", { name: "Close replay", exact: true }).click();
  expect(await nav.evaluate(element => element.scrollTop)).toBe(before);
  const visible = nav.locator("button").nth(23);
  await visible.click();
  await expect(visible).toHaveAttribute("aria-current", "page");
  expect(await nav.evaluate(element => element.scrollTop)).toBe(before);
});
