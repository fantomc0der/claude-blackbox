import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { DEMO_HERO_TITLE } from "../tests/fixtures";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

async function openReplay(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
}

async function openFilters(page: Page) {
  await page.locator("details.replay-filters > summary").click();
  await expect(page.locator(".replay-filter-menu")).toBeVisible();
}

test("default conversation retains its beginning and live-update end copy", async ({ page }) => {
  await openReplay(page);
  await expect(page.locator(".timeline-marker")).toContainText("BEGINNING OF RECORDING");
  await expect(page.locator(".timeline-end")).toContainText("You're all caught up.");
  await expect(page.locator(".timeline-end")).toContainText("New activity appears here automatically.");
  await expect(page.locator(".replay-context-button").first()).toBeVisible();
});

test("replay filters persist through reload and browser history on desktop", async ({ page }) => {
  await openReplay(page);
  await openFilters(page);
  await page.getByRole("combobox", { name: "Focused replay view" }).selectOption("thinking");
  await expect(page).toHaveURL(/replayKind=thinking/);
  await page.reload();
  await openFilters(page);
  await expect(page.getByRole("combobox", { name: "Focused replay view" })).toHaveValue("thinking");
  await page.goBack();
  await expect(page).not.toHaveURL(/replayKind=thinking/);
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
});

test("replay advanced filters stay usable on mobile and reset the empty state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReplay(page);
  await openFilters(page);
  const menu = page.locator(".replay-filter-menu");
  await expect.poll(async () => { const box = await menu.boundingBox(); return box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844; }).toBe(true);
  await page.getByRole("button", { name: "Close replay filters" }).click();
  await expect(page.locator("details.replay-filters")).toHaveJSProperty("open", false);
  await expect(page.locator("details.replay-filters > summary")).toBeFocused();
  await openFilters(page);
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("definitely-not-recorded");
  await expect(page.locator(".empty-state")).toContainText("No events match these filters");
  await page.locator(".replay-filter-menu").getByRole("button", { name: "Reset replay filters" }).click();
  await expect(page).not.toHaveURL(/replayQ/);
  await expect(page.locator(".replay-event").first()).toBeVisible();
});

test("replay filters remain bounded and dismissable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 360 });
  await openReplay(page);
  await openFilters(page);
  const menu = page.locator(".replay-filter-menu");
  await expect.poll(async () => { const box = await menu.boundingBox(); return box && box.x >= 0 && box.x + box.width <= 1440 && box.y >= 0 && box.y + box.height <= 360; }).toBe(true);
  const reset = menu.getByRole("button", { name: "Reset replay filters" });
  await reset.scrollIntoViewIfNeeded();
  await expect(reset).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("details.replay-filters")).toHaveJSProperty("open", false);
  await expect(page.locator("details.replay-filters > summary")).toBeFocused();
});

test("compound tool and error filters remain represented in the URL", async ({ page }) => {
  await openReplay(page);
  await openFilters(page);
  await page.getByRole("combobox", { name: "Focused replay view" }).selectOption("thinking");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(page).toHaveURL(/replayErrors=1/);
  await expect(page).toHaveURL(/replayKind=all/);
  await openFilters(page);
  const tools = page.getByRole("combobox", { name: "Observed tool" });
  await expect(tools.getByRole("option", { name: "WebFetch" })).toHaveCount(1);
  await tools.selectOption("WebFetch");
  await expect(page).toHaveURL(/replayErrors=1.*replayTool=WebFetch|replayTool=WebFetch.*replayErrors=1/);
  await expect(page.locator(".replay-event-error")).not.toHaveCount(0);
});

test("context reveal and chronological navigation clear replay scope", async ({ page }) => {
  await openReplay(page);
  await expect(page.locator(".replay-context-button").first()).toBeVisible();
  await page.locator(".replay-context-button").first().click();
  await expect(page).toHaveURL(/event=/);
  await expect(page).toHaveURL(/context=1/);
  await expect(page).toHaveURL(/replayKind=all/);
  await page.getByRole("button", { name: "Beginning", exact: true }).last().click();
  await expect(page.locator(".timeline-marker")).toContainText("BEGINNING OF RECORDING");
  await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
  await expect(page.locator(".replay-scroll")).toBeVisible();
});

test("a library result clears conflicting replay filters even for the selected recording", async ({ page }) => {
  await openReplay(page);
  await openFilters(page);
  await page.getByRole("combobox", { name: "Focused replay view" }).selectOption("thinking");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("effortless");
  await expect(page).toHaveURL(/q=effortless/);
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page).not.toHaveURL(/replayKind=thinking/);
  await expect(page).toHaveURL(/event=/);
  await expect(page.locator(".replay-event-selected")).toBeVisible();
});

test("an anchored recording does not pull a reader back on metadata refresh", async ({ page }) => {
  const list = await (await page.request.get("/api/sessions?q=Long+recording")).json();
  const session = list.items[0];
  const events = await (await page.request.get(`/api/sessions/${session.id}/events?limit=100`)).json();
  await page.goto(`/?session=${session.id}&event=${events.items[20].id}&context=1`);
  await expect(page.locator(".replay-event-selected")).toBeVisible();
  const transcript = page.locator(".replay-scroll");
  await transcript.evaluate(element => { element.scrollTop = 2200; });
  const position = await transcript.evaluate(element => element.scrollTop);
  try {
    const refreshed = page.waitForResponse(response => response.url().includes(`/api/sessions/${session.id}/events`));
    const response = await page.request.put(`/api/sessions/${session.id}/bookmark`, { data: { bookmarked: true }, headers: { origin: "http://127.0.0.1:12003" } });
    expect(response.ok()).toBe(true);
    await refreshed;
    await expect.poll(async () => Math.abs(await transcript.evaluate(element => element.scrollTop) - position)).toBeLessThan(2);
  } finally {
    await page.request.put(`/api/sessions/${session.id}/bookmark`, { data: { bookmarked: false }, headers: { origin: "http://127.0.0.1:12003" } });
  }
});

test("filtered live updates explicitly open the latest unfiltered records", async ({ page }) => {
  await page.goto("/?q=Filtered+live+verification");
  await page.locator(".session-row").click();
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("not-a-matching-record");
  await expect(page.locator(".replay-event")).toHaveCount(0);
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  const text = `Filtered update ${crypto.randomUUID()}`;
  await appendFile(resolve(".blackbox/e2e/projects/browser-regressions/filtered-live-recording.jsonl"), JSON.stringify({ type: "user", timestamp: new Date().toISOString(), message: { content: text } }) + "\n");
  await page.getByRole("button", { name: "Recording updated · Show latest unfiltered" }).click();
  await expect(page).not.toHaveURL(/replayQ=/);
  await expect(page).toHaveURL(/replayKind=all/);
  await expect(page.locator(".replay-event").last()).toContainText(text);
});
