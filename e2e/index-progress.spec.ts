import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./harness";
import type { IndexProgress } from "../src/shared/types";

async function mockProgress(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "EventSource", { value: class extends EventTarget {
      onopen: ((event: Event) => void) | null = null;
      listener = (event: Event) => this.dispatchEvent(new MessageEvent("indexing", { data: (event as CustomEvent).detail }));
      constructor() {
        super();
        window.addEventListener("fixture-indexing", this.listener);
        setTimeout(() => this.onopen?.(new Event("open")), 0);
      }
      close() { window.removeEventListener("fixture-indexing", this.listener); }
    } });
  });
}

async function progress(page: Page, value: IndexProgress) {
  await page.evaluate(state => window.dispatchEvent(new CustomEvent("fixture-indexing", { detail: JSON.stringify(state) })), value);
}

test("sidebar shows meaningful indexing progress without refreshing usage or shifting its frame", async ({ page }) => {
  await mockProgress(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".usage-panel")).toHaveAttribute("aria-busy", "false");
  const status = page.locator(".index-status");
  await progress(page, { phase: "idle", checked: 77, total: 77 });
  await expect(status).toContainText("Recordings indexed");
  const height = (await status.boundingBox())!.height;
  const before = await page.locator(".usage-total-cost").textContent();
  let requests = 0;
  page.on("request", request => { if (request.url().includes("/api/sessions?") || request.url().endsWith("/api/catalog")) requests++; });
  await progress(page, { phase: "discovering", checked: 0, total: 0 });
  await expect(status).toContainText("Finding recordings");
  await expect(status).toContainText("Total not yet known");
  await expect(status.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  await progress(page, { phase: "indexing", checked: 1234, total: 8400 });
  await expect(status).toContainText("Checking files");
  await expect(status).toContainText("1,234 / 8,400");
  await expect(status.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1234");
  await expect(status.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "8400");
  await expect(status.getByLabel("Rescan recordings")).toBeDisabled();
  await expect(status.getByLabel("Rescan recordings")).toHaveAccessibleDescription(/recording files, not individual messages/);
  await expect(page.locator(".index-announcement")).toBeEmpty();
  expect((await status.boundingBox())!.height).toBe(height);
  await progress(page, { phase: "indexing", checked: 8399, total: 8400 });
  await expect(status).toContainText("8,399 / 8,400");
  expect(await status.locator(".index-refresh").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(requests).toBe(0);
  await expect(page.locator(".usage-total-cost")).toHaveText(before!);
  const audit = await new AxeBuilder({ page }).include(".sidebar-footer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  expect(audit.incomplete.filter(result => result.id === "aria-prohibited-attr")).toEqual([]);
  await progress(page, { phase: "idle", checked: 8400, total: 8400 });
  await expect(status).toContainText("Recordings indexed");
  await expect(status.getByLabel("Rescan recordings")).toBeEnabled();
  expect((await status.boundingBox())!.height).toBe(height);
});

test("long index counts fall back to a percentage or truncate without clipping the activity indicator or hiding full values", async ({ page }) => {
  await mockProgress(page);
  await page.route("**/api/catalog", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), sessions: Number.MAX_SAFE_INTEGER } });
  });
  await page.goto("/");
  const status = page.locator(".index-status");
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: theme, exact: true }).click();
    for (const size of ["standard", "larger"]) {
      await page.getByLabel("Text size").selectOption(size);
      for (const width of [1440, 1000, 390]) {
        await page.setViewportSize({ width, height: 900 });
        if (width === 390) await page.getByLabel("Open workspace navigation").click();
        await progress(page, { phase: "idle", checked: 0, total: 0 });
        await expect(status.locator(".index-count-value")).toHaveText("9,007,199,254,740,991");
        await expect(status.locator(".index-progress")).toHaveAttribute("title", /9,007,199,254,740,991/);
        expect(await status.locator(".index-count").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await progress(page, { phase: "indexing", checked: 123456789, total: Number.MAX_SAFE_INTEGER });
        const progressbar = status.getByRole("progressbar");
        await expect(progressbar).toHaveAttribute("aria-valuetext", "Checking files: 123,456,789 / 9,007,199,254,740,991 recording files");
        await expect(status.locator(".index-progress")).toHaveAttribute("title", /Checking files: 123,456,789 \/ 9,007,199,254,740,991 \(<1%\)/);
        await expect(status.locator(".index-count-value")).toHaveText("<1%");
        await expect(status.locator(".index-count-toggle")).toHaveCount(0);
        const count = await status.locator(".index-progress").evaluate(element => {
          const label = element.querySelector(".index-label")!.getBoundingClientRect();
          const count = element.querySelector(".index-count")!;
          const indicator = count.querySelector(".index-refresh")!.getBoundingClientRect();
          return {
            overflowing: element.scrollWidth > element.clientWidth || count.scrollWidth > count.clientWidth,
            oneLine: Math.abs(label.top - count.getBoundingClientRect().top) < 1,
            indicatorFits: indicator.width > 0 && indicator.right <= element.getBoundingClientRect().right + 1,
          };
        });
        // The 190px sidebar at larger text is the one place the label and a percentage do not share a line; the row reserves the second line.
        expect(count).toEqual({ overflowing: false, oneLine: size === "standard" || width !== 1000, indicatorFits: true });
        if (width === 390) await page.locator(".sidebar-mobile-close").click();
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
});

test("larger index text keeps the footer frame stable across scan phases", async ({ page }) => {
  await mockProgress(page);
  await page.goto("/");
  await page.getByLabel("Text size").selectOption("larger");
  const status = page.locator(".index-status");
  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.getByLabel("Open workspace navigation").click();
    await progress(page, { phase: "idle", checked: 77, total: 77 });
    await expect(status).toContainText("Recordings indexed");
    const height = (await status.boundingBox())!.height;
    const footerHeight = (await page.locator(".sidebar-footer").boundingBox())!.height;
    for (const [phase, label] of [["discovering", "Finding recordings"], ["indexing", "Checking files"], ["error", "Scan failed"], ["idle", "Recordings indexed"]] as const) {
      await progress(page, { phase, checked: 20, total: 77 });
      await expect(status).toContainText(label);
      expect((await status.boundingBox())!.height).toBe(height);
      expect((await page.locator(".sidebar-footer").boundingBox())!.height).toBe(footerHeight);
    }
    if (width === 390) await page.locator(".sidebar-mobile-close").click();
  }
});

test("quick index checks stay quiet and scan errors allow retry", async ({ page }) => {
  await mockProgress(page);
  await page.goto("/");
  await expect(page.locator(".usage-panel")).toHaveAttribute("aria-busy", "false");
  await progress(page, { phase: "idle", checked: 77, total: 77 });
  const status = page.locator(".index-status");
  await progress(page, { phase: "indexing", checked: 0, total: 77 });
  await Bun.sleep(80);
  await expect(status).toContainText("Recordings indexed");
  await progress(page, { phase: "idle", checked: 77, total: 77 });
  await Bun.sleep(350);
  await expect(status.locator(".index-refresh")).not.toBeVisible();
  await progress(page, { phase: "error", checked: 20, total: 77 });
  await expect(status).toContainText("Scan failed");
  await expect(status).toContainText("Index incomplete");
  await expect(page.locator(".index-announcement")).toContainText("results may be incomplete or out of date");
  await expect(status.getByLabel("Rescan recordings")).toBeEnabled();
  await status.getByLabel("Rescan recordings").click();
  await expect(page.locator(".toast")).toContainText("Recordings are up to date");
});

test("scan errors remain accessible outside a closed mobile drawer without moving usage", async ({ page }) => {
  await mockProgress(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["dark", "light"]) {
    await page.addInitScript(value => localStorage.setItem("blackbox:theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const panel = page.locator(".usage-panel");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await progress(page, { phase: "idle", checked: 77, total: 77 });
    await page.getByLabel("Usage and estimated cost").click();
    const before = await panel.boundingBox();
    const cost = await panel.locator(".usage-total-cost").textContent();
    await progress(page, { phase: "error", checked: 20, total: 77 });
    const announcement = page.locator(".index-announcement");
    await expect(announcement).toHaveAttribute("role", "status");
    await expect(announcement).toHaveAttribute("aria-live", "polite");
    await expect(announcement).toContainText("Indexed recordings remain available");
    expect(await announcement.evaluate(element => Boolean(element.closest("[inert]")))).toBe(false);
    expect(await panel.boundingBox()).toEqual(before);
    await expect(panel.locator(".usage-total-cost")).toHaveText(cost!);
    await page.getByLabel("Open workspace navigation").click();
    const status = page.locator(".index-status");
    await status.scrollIntoViewIfNeeded();
    const height = (await status.boundingBox())!.height;
    await expect(status).toHaveClass(/index-failed/);
    expect(await status.locator(".index-refresh").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
    const retry = status.getByLabel("Rescan recordings");
    await retry.focus();
    await expect(retry).toBeFocused();
    await expect(retry).toBeEnabled();
    await expect(retry).toHaveAccessibleDescription(/index may be incomplete or out of date/);
    const audit = await new AxeBuilder({ page }).include(".index-status").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    await progress(page, { phase: "idle", checked: 77, total: 77 });
    await expect(announcement).toBeEmpty();
    await expect(status).not.toHaveClass(/index-failed/);
    expect((await status.boundingBox())!.height).toBe(height);
  }
});

test("index progress fits compact and mobile navigation in both themes", async ({ page }) => {
  await mockProgress(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByRole("button", { name: theme, exact: true }).click();
    await progress(page, { phase: "indexing", checked: 123456, total: 987654 });
    const status = page.locator(".index-status");
    await expect(status.locator(".index-count-value")).toHaveText("12%");
    await expect(status.locator(".index-progress")).toHaveAttribute("title", /123,456 \/ 987,654 \(12%\)/);
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
      if (width === 390) await page.getByLabel("Open workspace navigation").click();
      await expect(status).toBeVisible();
      await expect(status.getByRole("progressbar")).toBeVisible();
      await status.scrollIntoViewIfNeeded();
      const box = (await status.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(width === 1280 ? 720 : 844);
      expect(await status.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test("the checking count shares the label's line, switches to a percentage on click, and falls back to one when the fraction will not fit", async ({ page }) => {
  await mockProgress(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".usage-panel")).toHaveAttribute("aria-busy", "false");
  const status = page.locator(".index-status");
  const value = status.locator(".index-count-value");
  const geometry = () => status.evaluate(element => {
    const row = element.getBoundingClientRect();
    const line = element.querySelector(".index-progress")!.getBoundingClientRect();
    const label = element.querySelector(".index-label")!.getBoundingClientRect();
    const count = element.querySelector(".index-count")!.getBoundingClientRect();
    return { oneLine: Math.abs(label.top - count.top) < 1, centered: Math.abs((line.top - row.top) - (row.bottom - line.bottom)) <= 1, height: row.height };
  });
  await progress(page, { phase: "idle", checked: 195, total: 195 });
  await expect(status).toContainText("Recordings indexed");
  const idle = await geometry();
  await progress(page, { phase: "indexing", checked: 115, total: 195 });
  await expect(value).toHaveText("115 / 195");
  expect(await geometry()).toEqual({ oneLine: true, centered: true, height: idle.height });
  const toggle = status.getByRole("button", { name: "115 / 195. Show as percentage" });
  await expect(toggle).toHaveAttribute("title", "Show as percentage");
  await expect(status.locator(".index-progress")).toHaveAttribute("title", /^Checking files: 115 \/ 195 \(58%\)\./);
  await toggle.click();
  await expect(value).toHaveText("58%");
  await expect(status.getByRole("button", { name: "58%. Show as count" })).toHaveAttribute("title", "Show as count");
  await expect(status.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Checking files: 115 / 195 recording files");
  await expect(status.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "115");
  expect(await page.evaluate(() => localStorage.getItem("blackbox:index-count"))).toBe("percent");
  const audit = await new AxeBuilder({ page }).include(".sidebar-footer").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);
  await page.reload();
  await expect(page.locator(".usage-panel")).toHaveAttribute("aria-busy", "false");
  await progress(page, { phase: "indexing", checked: 150, total: 195 });
  await expect(value).toHaveText("76%");
  await status.getByRole("button", { name: "76%. Show as count" }).click();
  await expect(value).toHaveText("150 / 195");
  expect(await page.evaluate(() => localStorage.getItem("blackbox:index-count"))).toBe("count");
  await progress(page, { phase: "indexing", checked: 123456, total: 987654 });
  await expect(value).toHaveText("12%");
  await expect(status.locator(".index-count-toggle")).toHaveCount(0);
  await expect(status.locator(".index-progress")).toHaveAttribute("title", /123,456 \/ 987,654 \(12%\)/);
  expect(await geometry()).toEqual({ oneLine: true, centered: true, height: idle.height });
  await progress(page, { phase: "indexing", checked: 1000, total: 987654321 });
  await expect(value).toHaveText("<1%");
  await progress(page, { phase: "indexing", checked: 987653, total: 987654 });
  await expect(value).toHaveText("99%");
});
