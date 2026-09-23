import type { Page } from "@playwright/test";
import packageJson from "../package.json";
import { expect, test } from "./harness";

const measure = (page: Page) => page.locator(".sidebar").evaluate(sidebar => ({
  list: (sidebar.querySelector(".workspace-nav") as HTMLElement).clientHeight,
  scrolls: sidebar.scrollHeight > sidebar.clientHeight,
  footer: Math.round((sidebar.querySelector(".sidebar-footer") as HTMLElement).getBoundingClientRect().height),
}));

test("the sidebar displays the current application version", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".version-label > span")).toHaveText(`V${packageJson.version}`);
});

test("the workspace list keeps a usable height on laptop displays", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const theme = page.getByRole("group", { name: "Theme", exact: true });
  const size = page.getByLabel("Text size");
  const reading = page.getByLabel("Reading width");
  await expect(page.locator(".workspace-nav-item").first()).toBeVisible();
  const wide = await measure(page);
  expect(wide.list).toBeGreaterThanOrEqual(240);
  expect(wide.scrolls).toBe(false);
  expect(wide.footer).toBeLessThanOrEqual(280);
  await expect(theme).toBeVisible();
  await expect(size).toBeVisible();
  await expect(reading).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  const short = await measure(page);
  expect(short.list).toBeGreaterThanOrEqual(160);
  await expect(theme).toBeVisible();
  await expect(size).toBeVisible();
  await expect(reading).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect((await measure(page)).list).toBeGreaterThan(wide.list);
});

test("every workspace row stays reachable once the list outgrows the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const list = page.locator(".workspace-nav");
  await expect(page.locator(".workspace-nav-item").first()).toBeVisible();
  const crowded = await list.evaluate(nav => {
    const row = nav.querySelector(".workspace-nav-item")!;
    for (let index = 0; index < 20; index++) nav.appendChild(row.cloneNode(true));
    const sidebar = nav.closest(".sidebar") as HTMLElement;
    return { rows: nav.querySelectorAll(".workspace-nav-item").length, listScrolls: nav.scrollHeight > nav.clientHeight, sidebarScrolls: sidebar.scrollHeight > sidebar.clientHeight, visible: Math.floor(nav.clientHeight / 41) };
  });
  expect(crowded.rows).toBeGreaterThan(20);
  expect(crowded.listScrolls).toBe(true);
  expect(crowded.sidebarScrolls).toBe(false);
  expect(crowded.visible).toBeGreaterThanOrEqual(5);
});

test("one canonical grouping action stays available before and after grouping", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const action = page.getByRole("button", { name: "Group workspaces", exact: true });
  await expect(action).toHaveCount(1);
  await expect(action).toBeVisible();
  await expect(page.getByRole("button", { name: "Group worktrees", exact: true })).toHaveCount(0);
  const group = await page.evaluate(async () => {
    const response = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Sidebar coverage", paths: ["/synthetic/workspaces/orbit", "/synthetic/workspaces/orbit-auth"] }) });
    return await response.json() as { id: string };
  });
  try {
    await expect(action).toHaveCount(1);
    await expect(action).toBeVisible();
    expect((await measure(page)).list).toBeGreaterThanOrEqual(240);
  } finally {
    const status = await page.evaluate(id => fetch(`/api/groups/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }).then(response => response.status), group.id);
    expect(status).toBe(200);
  }
  await expect(action).toBeVisible();
});
