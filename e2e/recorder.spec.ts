import { expect, test } from "./harness";
import AxeBuilder from "@axe-core/playwright";
import { appendFile } from "node:fs/promises";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

test("full-record search finds tool output and survives URL reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("retryBudget");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".session-snippet")).toContainText("retryBudget");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toHaveValue("retryBudget");
  await page.locator(".session-row").click();
  await expect(page.getByRole("region", { name: "Session replay" })).toContainText("retryBudget");
  await page.getByRole("button", { name: "Close replay" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toBeFocused();
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("no-recording-has-this-phrase");
  await expect(page.getByText("No trails match this search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search & filters" }).click();
  await expect(page.locator(".session-row")).toHaveCount(50);
  expect(errors).toEqual([]);
});

test("structured tools, bookmarks, resume clipboard and JSONL export work", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?q=effortless");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.getByRole("heading", { name: DEMO_HERO_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "Copy resume command" }).click();
  await expect(page.getByRole("status")).toContainText("Resume command copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("cd -- '/synthetic/workspaces/orbit-auth' && claude --resume");
  await page.getByRole("button", { name: "Bookmark session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove bookmark" })).toBeVisible();
  const tools = page.locator('.tool-summary[aria-expanded="false"]');
  while (await tools.count()) await tools.first().click();
  await expect(page.locator(".tool-diff-added").first()).toBeVisible();
  await expect(page.locator(".tool-terminal").first()).toBeVisible();
  await expect(page.locator(".tool-checklist")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export recording" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^blackbox-.*\.jsonl$/);
  await page.getByRole("button", { name: "Close replay" }).click();
  await page.getByRole("button", { name: /^Bookmarked/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(1);
});

test("output expansion controls align with the code panel in both states", async ({ page }) => {
  await page.goto("/?q=Long+recording");
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await page.locator(".replay-raw > summary").first().click();
  const toggle = page.locator(".tool-output-toggle").first();
  const assertSpacing = async () => {
    const spacing = await toggle.evaluate(button => {
      const output = button.parentElement!.querySelector("pre")!;
      const buttonStyle = getComputedStyle(button);
      const outputStyle = getComputedStyle(output);
      return {
        inset: parseFloat(buttonStyle.paddingLeft),
        alignment: Math.abs(button.getBoundingClientRect().left + parseFloat(buttonStyle.paddingLeft) - output.getBoundingClientRect().left - parseFloat(outputStyle.paddingLeft)),
        height: button.getBoundingClientRect().height,
      };
    });
    expect(spacing.inset).toBe(10);
    expect(spacing.alignment).toBeLessThan(1);
    expect(spacing.height).toBeGreaterThanOrEqual(36);
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toHaveText("Show full output");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await assertSpacing();
    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await assertSpacing();
    await toggle.click();
  }
});

test("workspace groups persist and retain the original source filter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await page.getByRole("textbox", { name: "New group name" }).fill("Orbit unified");
  await page.getByRole("checkbox", { name: "/synthetic/workspaces/orbit", exact: true }).check();
  await page.getByRole("checkbox", { name: "/synthetic/workspaces/orbit-auth", exact: true }).check();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.locator(".existing-group")).toContainText("Orbit unified");
  await page.getByRole("button", { name: "Close workspace settings" }).click();
  await page.getByRole("button", { name: /Orbit unified 2 folders/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(4);
  await page.reload();
  await expect(page.locator(".session-row")).toHaveCount(4);
  await page.locator(".filter-popover > summary").click();
  await page.getByRole("combobox", { name: "Original source" }).selectOption("/synthetic/workspaces/orbit-auth");
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.locator(".filter-popover > summary").click();
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".source-path")).toHaveText("/synthetic/workspaces/orbit-auth");
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await expect(page.locator(".existing-group")).toHaveCount(0);
});

test("session and event pagination remain bounded and navigable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".session-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Next recordings" }).click();
  await expect(page).toHaveURL(/offset=50/);
  await expect(page.locator(".session-row")).toHaveCount(23);
  await page.reload();
  await expect(page.locator(".session-row")).toHaveCount(23);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/offset=50/);
  await page.getByRole("button", { name: "Previous recordings" }).click();
  await expect(page.locator(".session-row")).toHaveCount(50);
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("Long recording");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event")).toHaveCount(60);
  await page.getByRole("button", { name: "Next 60 events" }).click();
  await expect(page.locator(".replay-event").first()).toContainText("Long recording event 60");
  await page.getByRole("button", { name: "Previous events" }).click();
  await expect(page.locator(".replay-event").first()).toContainText("Long recording event 0");
  await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
  await expect(page.locator(".replay-event").last()).toContainText("Long recording event 174");
  await expect.poll(() => page.locator(".replay-scroll").evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(10);
});

test("new records arrive exactly once without interrupting history", async ({ page }) => {
  await page.goto("/?q=Live+update+verification");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event")).toHaveCount(1);
  const record = { type: "assistant", uuid: "live-added", timestamp: new Date().toISOString(), message: { role: "assistant", content: "Freshly recorded browser-test response" } };
  await appendFile(".blackbox/e2e/projects/browser-regressions/live-recording.jsonl", JSON.stringify(record) + "\n");
  await expect(page.locator(".replay-event")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Recording updated/ })).toBeVisible();
  await page.reload();
  await expect(page.locator(".replay-event")).toHaveCount(2);
});

test("transcript HTML cannot execute scripts, spoof app styles, or load remote images", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("blocked.invalid")) remoteRequests.push(request.url()); });
  await page.goto("/?q=Unsafe+markdown+verification");
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: "Safe content" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).blackboxXss)).toBeUndefined();
  await expect(page.locator('.md-content script, .md-content img, .md-content [href^="javascript:"], .md-content .nav-scrim')).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
});

test("mobile navigation and replay avoid horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page.getByRole("button", { name: "orbit-auth 2", exact: true }).click();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.locator(".session-row").first().click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Close replay" }).click();
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toBeVisible();
});

test("library, replay and grouping have no serious accessibility violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".session-row").first()).toBeVisible();
  const audit = async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
  };
  await audit();
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await audit();
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await audit();
});

test("event permalinks and open tool disclosures survive metadata refresh", async ({ page }) => {
  await page.goto("/?q=effortless");
  await page.locator(".session-row").click();
  const tool = page.locator('.tool-summary[aria-expanded="false"]').first();
  await tool.click();
  const expanded = await page.locator('.tool-summary[aria-expanded="true"]').count();
  await page.getByRole("button", { name: /^(Bookmark session|Remove bookmark)$/ }).click();
  await expect(page.locator('.tool-summary[aria-expanded="true"]')).toHaveCount(expanded);
  const link = page.locator(".replay-event-link").nth(1);
  const href = await link.getAttribute("href");
  const eventId = new URL(href!, "http://127.0.0.1:12003").searchParams.get("event");
  await page.goto(href!);
  await expect(page.locator(".replay-event").first()).toHaveAttribute("data-event-id", eventId!);
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("retryBudget");
  await expect(page.locator(".tool-code mark")).toHaveText("retryBudget");
});

test("mobile navigation removes hidden controls from keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation", exact: true }).last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open workspace navigation" })).toBeFocused();
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
});

test("desktop layouts adapt from compact laptops through 4K and ultrawide monitors", async ({ page }) => {
  const sizes = [
    { width: 1280, height: 720, columns: 1 },
    { width: 1366, height: 768, columns: 1 },
    { width: 1920, height: 1080, columns: 2 },
    { width: 2560, height: 1440, columns: 2 },
    { width: 3440, height: 1440, columns: 3 },
    { width: 3840, height: 2160, columns: 3 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator(".session-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const columns = await page.locator(".recordings-scroll").evaluate(element => {
      const style = getComputedStyle(element);
      return style.display === "grid" ? style.gridTemplateColumns.split(" ").length : 1;
    });
    expect(columns).toBe(size.columns);
    expect(await page.locator(".recordings-scroll").evaluate(element => element.clientHeight)).toBeGreaterThan(180);
    await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
    await expect(page.locator(".replay-event").first()).toBeVisible();
    expect(await page.locator(".replay-timeline").evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(961);
    expect(await page.locator(".replay-scroll").evaluate(element => element.clientHeight)).toBeGreaterThan(180);
    if (size.width >= 2000) await expect(page.getByRole("complementary", { name: "Recording overview" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
