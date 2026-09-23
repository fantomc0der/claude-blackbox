import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Workspace } from "../src/shared/types";
import { emptyUsage } from "../src/server/usage";
import { visibleWorkspaces } from "../src/client/lib/workspaces";
import { expect, test } from "./harness";

function workspace(name: string, count: number, costUSD: number): Workspace {
  return { id: `/synthetic/${name}`, name, paths: [`/synthetic/${name}`], count, grouped: false, usage: { ...emptyUsage(), requests: 1, costUSD } };
}

const entries: Workspace[] = [workspace("Zeta", 20, 0), workspace("orbit-10", 12, 4), workspace("Orbit-2", 3, 30), {
  ...workspace("Shared project", 2, 100), grouped: true, paths: ["C:\\work\\alpha", "/work/orbit-clone"],
}];
const rowNames = (page: Page) => page.locator(".workspace-nav-item > span:not(.nav-count)").evaluateAll(rows => rows.map(row => row.firstChild?.textContent));

async function mockWorkspaces(page: Page, workspaces = entries) {
  await page.route("**/api/catalog", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), workspaces } });
  });
}

test("workspace sorting preserves the selected session and persists across reloads", async ({ page }) => {
  await mockWorkspaces(page);
  await page.goto("/?workspace=/synthetic/orbit-10&q=unchanged&sort=oldest");
  const sort = page.getByRole("combobox", { name: "Sort workspaces" });
  await expect(sort).toHaveValue("sessions");
  await expect(page.locator(".workspace-nav-item")).toHaveCount(4);
  expect(await rowNames(page)).toEqual(["Zeta", "orbit-10", "Orbit-2", "Shared project"]);
  const url = page.url();
  await sort.selectOption("cost");
  await expect(page.locator(".workspace-nav-item .nav-count").first()).toHaveText("$100.00");
  expect(await rowNames(page)).toEqual(["Shared project", "Orbit-2", "orbit-10", "Zeta"]);
  await expect(page.locator('.workspace-nav-item[aria-current="page"]')).toContainText("orbit-10");
  expect(page.url()).toBe(url);
  await page.reload();
  await expect(sort).toHaveValue("cost");
  await expect(page.locator(".workspace-nav-item .nav-count").first()).toHaveText("$100.00");
  await sort.selectOption("name");
  await expect(page.locator(".workspace-nav-item").first()).toContainText("Orbit-2");
  expect(await rowNames(page)).toEqual(["Orbit-2", "orbit-10", "Shared project", "Zeta"]);
  await page.reload();
  await expect(sort).toHaveValue("name");
  await expect(page.locator(".workspace-nav-item").first()).toContainText("Orbit-2");
  expect(page.url()).toBe(url);
});

test("optional workspace filtering matches grouped paths, clears empty results and restores focus", async ({ page }) => {
  await mockWorkspaces(page);
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Filter workspaces", exact: true });
  const filter = page.getByRole("searchbox", { name: "Filter workspaces by name or path" });
  await expect(filter).toBeHidden();
  await toggle.click();
  await expect(filter).toBeFocused();
  await filter.fill(" ORBIT ");
  await expect(page.locator(".workspace-nav-item")).toHaveCount(3);
  await page.getByLabel("Sort workspaces").selectOption("name");
  expect(await rowNames(page)).toEqual(["Orbit-2", "orbit-10", "Shared project"]);
  await filter.fill("c:/WORK/alpha");
  await expect(page.locator(".workspace-nav-item")).toHaveCount(1);
  await expect(page.locator(".workspace-nav-item")).toContainText("Shared project");
  await filter.fill("nothing-matches");
  await expect(page.getByRole("status")).toHaveText("No matching workspaces.Clear filter");
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await expect(filter).toBeFocused();
  await expect(page.locator(".workspace-nav-item")).toHaveCount(4);
  await filter.fill("Zeta");
  await filter.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(filter).toBeHidden();
  await expect(page.locator(".workspace-nav-item")).toHaveCount(4);
  await toggle.click();
  await filter.fill("Zeta");
  await page.getByRole("button", { name: "Clear and close workspace filter", exact: true }).click();
  await expect(toggle).toBeFocused();
  await expect(filter).toBeHidden();
  await expect(page.locator(".workspace-nav-item")).toHaveCount(4);
});

test("workspace costs distinguish missing, unpriced and partial usage from free usage", async ({ page }) => {
  await mockWorkspaces(page, [
    { ...workspace("Missing", 1, 0), usage: emptyUsage() },
    { ...workspace("Unpriced", 1, 0), usage: { ...emptyUsage(), requests: 1, unpricedRequests: 1 } },
    workspace("Zero", 1, 0),
    { ...workspace("Partial", 1, 2), usage: { ...emptyUsage(), requests: 2, unpricedRequests: 1, costUSD: 2 } },
  ]);
  await page.goto("/");
  await page.getByLabel("Sort workspaces").selectOption("cost");
  await expect(page.locator(".workspace-nav-item .nav-count")).toHaveText(["$2.00+", "$0.00", "Not recorded", "Unavailable"]);
});

test("invalid saved sorting falls back and blocked storage does not prevent sorting", async ({ page }) => {
  await mockWorkspaces(page);
  await page.addInitScript(() => {
    localStorage.setItem("blackbox:workspace-sort", "invalid");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "blackbox:workspace-sort") throw new DOMException("Storage blocked", "SecurityError");
      original.call(this, key, value);
    };
  });
  await page.goto("/");
  await expect(page.getByLabel("Sort workspaces")).toHaveValue("sessions");
  await page.getByLabel("Sort workspaces").selectOption("name");
  await expect(page.locator(".workspace-nav-item").first()).toContainText("Orbit-2");
});

test("workspace sorting is usable when reading local storage is blocked", async ({ page }) => {
  await mockWorkspaces(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) {
      if (key === "blackbox:workspace-sort") throw new DOMException("Storage blocked", "SecurityError");
      return original.call(this, key);
    };
  });
  await page.goto("/");
  await expect(page.getByLabel("Sort workspaces")).toHaveValue("sessions");
  await page.getByLabel("Sort workspaces").selectOption("cost");
  await expect(page.locator(".workspace-nav-item").first()).toContainText("Shared project");
});

test("workspace sort and filter remain usable in mobile navigation", async ({ page }) => {
  await mockWorkspaces(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace navigation", exact: true }).click();
  await page.getByLabel("Sort workspaces").selectOption("name");
  await page.getByRole("button", { name: "Filter workspaces", exact: true }).click();
  const filter = page.getByRole("searchbox", { name: "Filter workspaces by name or path" });
  await expect(filter).toBeFocused();
  await filter.fill("orbit-2");
  await expect(page.locator(".workspace-nav-item")).toHaveCount(1);
  await page.locator(".workspace-nav-item").click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/nav-open/);
  expect(new URL(page.url()).searchParams.get("workspace")).toBe("/synthetic/Orbit-2");
  await page.getByRole("button", { name: "Open workspace navigation", exact: true }).click();
  await expect(page.locator(".sidebar-mobile-close")).toBeFocused();
  await filter.press("Escape");
  await expect(page.locator(".app-shell")).toHaveClass(/nav-open/);
  await expect(page.locator(".workspace-nav-item")).toHaveCount(4);
});

test("an empty catalog keeps the onboarding message rather than a no-matches error", async ({ page }) => {
  await mockWorkspaces(page, []);
  await page.goto("/");
  await expect(page.getByText("Your projects will appear here once a session is recorded.")).toBeVisible();
  await page.getByLabel("Sort workspaces").selectOption("cost");
  await expect(page.getByText("No matching workspaces.")).toHaveCount(0);
});

test("cost sorting follows live grouping and ungrouping without resetting the preference", async ({ page }) => {
  await page.goto("/");
  const sort = page.getByLabel("Sort workspaces");
  await sort.selectOption("cost");
  const group = await page.evaluate(async () => {
    const response = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Sorting coverage", paths: ["/synthetic/workspaces/orbit", "/synthetic/workspaces/orbit-auth"] }) });
    return await response.json() as { id: string };
  });
  const groupRow = page.locator(".workspace-nav-item").filter({ hasText: "Sorting coverage" });
  try {
    await expect(groupRow).toBeVisible();
    await expect(groupRow).toContainText("2 folders, one history");
    await expect(sort).toHaveValue("cost");
    const catalog = await page.evaluate(() => fetch("/api/catalog").then(response => response.json())) as { workspaces: Workspace[] };
    const ordered = visibleWorkspaces(catalog.workspaces, "cost", "");
    expect(await rowNames(page)).toEqual(ordered.map(workspace => workspace.name));
  } finally {
    await page.evaluate(id => fetch(`/api/groups/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }), group.id);
  }
  await expect(groupRow).toHaveCount(0);
  await expect(sort).toHaveValue("cost");
});

test("workspace controls have accessible names, contrast and keyboard focus in both themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockWorkspaces(page);
  await page.goto("/");
  const sort = page.getByLabel("Sort workspaces");
  await sort.focus();
  await sort.selectOption("name");
  await sort.press("Tab");
  const toggle = page.getByRole("button", { name: "Filter workspaces", exact: true });
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  await expect(page.getByRole("searchbox", { name: "Filter workspaces by name or path" })).toBeFocused();
  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const result = await new AxeBuilder({ page }).include(".sidebar").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  }
});
