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
  expect(wide.list).toBeGreaterThanOrEqual(360);
  expect(wide.scrolls).toBe(false);
  expect(wide.footer).toBeLessThanOrEqual(210);
  await expect(page.locator(".sidebar-footer").getByRole("button", { name: /subagents/i })).toHaveCount(0);
  await expect(theme).toBeVisible();
  await expect(size).toBeVisible();
  await expect(reading).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  const short = await measure(page);
  expect(short.list).toBeGreaterThanOrEqual(160);
  await expect(theme).toBeVisible();
  await expect(size).toBeVisible();
  await expect(reading).toBeVisible();
  for (const width of [1100, 1000]) {
    await page.setViewportSize({ width, height: 700 });
    const compact = await measure(page);
    expect(compact.scrolls).toBe(false);
    expect(compact.list).toBeGreaterThanOrEqual(168);
    expect(compact.footer).toBeLessThanOrEqual(260);
    for (const control of [theme, size, reading, page.locator(".index-status"), page.locator(".version-label")]) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect((await measure(page)).list).toBeGreaterThan(wide.list);
});

test("appearance controls share aligned edges and stack together when they do not fit", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".workspace-nav-item").first()).toBeVisible();
  const layout = () => page.locator(".sidebar-footer").evaluate(footer => {
    const row = (label: Element, control: Element) => {
      const labelBox = label.getBoundingClientRect(), controlBox = control.getBoundingClientRect();
      return { inline: controlBox.left >= labelBox.right && controlBox.top < labelBox.bottom && controlBox.bottom > labelBox.top, stacked: controlBox.top >= labelBox.bottom - 1, labelHeight: labelBox.height, line: parseFloat(getComputedStyle(label).lineHeight), left: controlBox.left, width: controlBox.width, height: controlBox.height };
    };
    const selects = [...footer.querySelectorAll(".sidebar-select")].map(field => row(field.querySelector("span")!, field.querySelector("select")!));
    return { theme: row(footer.querySelector(".theme-control legend")!, footer.querySelector(".theme-options")!), selects, status: footer.querySelector(".index-status")!.getBoundingClientRect().height, rescan: footer.querySelector(".index-status button")!.getBoundingClientRect().height };
  });
  for (const [width, height, inline] of [[1440, 900, true], [1100, 700, false], [1000, 700, false]] as const) {
    await page.setViewportSize({ width, height });
    const footer = await layout();
    expect(inline ? footer.theme.inline : footer.theme.stacked).toBe(true);
    for (const select of footer.selects) {
      expect(inline ? select.inline : select.stacked).toBe(true);
      expect(select.labelHeight).toBeLessThanOrEqual(select.line + 1);
      expect(select.width).toBeGreaterThanOrEqual(100);
      expect(select.left).toBeCloseTo(footer.theme.left, 0);
      expect(select.width).toBeCloseTo(footer.theme.width, 0);
      expect(select.height).toBe(footer.theme.height);
    }
    expect(footer.status).toBe(36);
    expect(footer.rescan).toBe(36);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  const drawer = await layout();
  for (const select of drawer.selects) expect(select.height).toBeGreaterThanOrEqual(44);
  for (const button of await page.getByRole("group", { name: "Theme", exact: true }).getByRole("button").all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(drawer.rescan).toBeGreaterThanOrEqual(44);
});

test("sidebar footer alignment holds across themes, text sizes, and navigation widths", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".index-status")).toHaveClass(/index-idle/);
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: theme, exact: true }).click();
    for (const size of ["standard", "larger"]) {
      await page.getByLabel("Text size").selectOption(size);
      for (const width of [1920, 1440, 1100, 1000, 390]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390) await page.getByRole("button", { name: "Open workspace navigation" }).click();
        const layout = await page.locator(".sidebar-footer").evaluate(footer => {
          const themeBox = footer.querySelector(".theme-options")!.getBoundingClientRect();
          const labelBox = footer.querySelector(".theme-control legend")!.getBoundingClientRect();
          const indexLabel = footer.querySelector(".index-label")!.getBoundingClientRect();
          const indexCount = footer.querySelector(".index-count")!.getBoundingClientRect();
          return {
            aligned: [...footer.querySelectorAll(".sidebar-select select")].every(select => Math.abs(select.getBoundingClientRect().left - themeBox.left) < 1 && Math.abs(select.getBoundingClientRect().width - themeBox.width) < 1),
            statusAligned: indexLabel.left === labelBox.left,
            countInline: Math.abs(indexLabel.top - indexCount.top) < 1,
            overflows: [...footer.querySelectorAll<HTMLElement>(".theme-options, .index-progress, .index-count")].some(element => element.scrollWidth > element.clientWidth),
            separated: getComputedStyle(footer.querySelector(".sidebar-status")!).borderTopStyle === "solid",
          };
        });
        expect(layout.aligned).toBe(true);
        expect(layout.statusAligned).toBe(true);
        expect(layout.overflows).toBe(false);
        expect(layout.separated).toBe(true);
        if (size === "standard" && (width >= 1280 || width === 390)) expect(layout.countInline).toBe(true);
        if (width === 390) await page.locator(".sidebar-mobile-close").click();
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
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
