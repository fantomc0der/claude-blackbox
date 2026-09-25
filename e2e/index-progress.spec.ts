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
    await expect(status).toContainText("123,456 / 987,654");
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
      if (width === 390) await page.getByLabel("Open workspace navigation").click();
      await expect(status).toBeVisible();
      await expect(status.getByRole("progressbar")).toBeVisible();
      await status.scrollIntoViewIfNeeded();
      const box = (await status.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(width === 1280 ? 720 : 844);
      expect(await status.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
