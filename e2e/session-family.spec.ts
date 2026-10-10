import type { Page } from "@playwright/test";
import type { SessionFamily } from "../src/shared/types";
import { expect, test } from "./harness";

const rootTitle = "Session family root";
const childTitle = "Implementation worker";
const nestedTitle = "Nested implementation worker";

async function openRoot(page: Page) {
  await page.goto(`/?q=${encodeURIComponent(rootTitle)}`);
  await page.getByRole("button", { name: new RegExp(rootTitle) }).click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
}

async function waitForReplay(page: Page) {
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test("session family identifies hidden agents and exposes only exact Agent and Task launches", async ({ page }) => {
  await openRoot(page);
  await expect(page.getByRole("button", { name: "Subagents 3", exact: true })).toBeVisible();
  const family = page.getByRole("navigation", { name: "Session family", exact: true });
  await expect(family.getByText("Main session", { exact: true })).toBeVisible();
  const relatedOptions = await family.getByLabel("Jump to related session").locator("option").allTextContents();
  for (const option of ["Main · Session family root", "Subagent · Implementation worker", "Subagent · Review worker", "Nested subagent · Nested implementation worker"]) {
    expect(relatedOptions).toContain(option);
  }
  const implementationCall = page.locator(".tool-card").filter({ hasText: "Implementation worker" });
  const reviewCall = page.locator(".tool-card").filter({ hasText: "Review worker" });
  const missingCall = page.locator(".tool-card").filter({ hasText: "Unavailable worker" });
  await expect(implementationCall.getByRole("button", { name: "Preview conversation", exact: true })).toBeVisible();
  await expect(implementationCall.getByRole("link", { name: "Open session", exact: true })).toHaveAttribute("href", /session=/);
  await expect(reviewCall.getByRole("link", { name: "Open session", exact: true })).toHaveAttribute("href", /session=/);
  await expect(missingCall.getByText("No linked recording available.", { exact: true })).toBeVisible();
  await expect(missingCall.getByRole("link", { name: "Open session", exact: true })).toHaveCount(0);
});

test("family preview uses conversation records and opens the selected child in full replay", async ({ page }) => {
  await openRoot(page);
  await page.locator(".tool-card").filter({ hasText: childTitle }).getByRole("button", { name: "Preview conversation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Subagent recordings", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/^Recording/)).toHaveValue(/.+/);
  await expect(dialog.getByText("System-only family row", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(`${childTitle} conversation result`, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open full session", exact: true })).toBeVisible();
  await dialog.getByRole("link", { name: "Open full session", exact: true }).click();
  await expect(page.getByRole("heading", { name: childTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy main session resume command", exact: true })).toBeVisible();
  const childFamily = page.getByRole("navigation", { name: "Session family", exact: true });
  await expect(childFamily).toContainText(`Main session: ${rootTitle}`);
  await expect(page.getByRole("navigation", { name: "Session family", exact: true })).toContainText("Originating tool call");
  await expect(childFamily.getByLabel("Jump to related session")).toHaveValue(new URL(page.url()).searchParams.get("session")!);
});

test("partial family responses keep exact tool targets previewable without asserting parentage", async ({ page }) => {
  await page.route("**/api/sessions/*/family", async route => {
    const response = await route.fetch();
    const family = await response.json() as SessionFamily;
    await route.fulfill({ response, json: { ...family, limited: true, members: family.members.map(member => ({
      ...member, parentId: null, spawnEventId: null, spawnToolId: null, depth: member.session.isAgent ? null : 0,
    })) } });
  });
  await openRoot(page);
  await expect(page.getByRole("navigation", { name: "Session family", exact: true })).toContainText("this list is partial");
  const call = page.locator(".tool-card").filter({ hasText: childTitle });
  await expect(call.getByRole("link", { name: "Open session", exact: true })).toBeVisible();
  await call.getByRole("button", { name: "Preview conversation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Subagent recordings", exact: true });
  await expect(dialog.getByText(`${childTitle} conversation result`, { exact: true })).toBeVisible();
  await dialog.getByRole("link", { name: "Open full session", exact: true }).click();
  await expect(page.getByRole("heading", { name: childTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Session family", exact: true })).toContainText("this list is partial");
  await expect(page.getByRole("link", { name: "Originating tool call", exact: true })).toHaveCount(0);
});

test("family members preserve source context through nested navigation and browser Back", async ({ page }) => {
  await openRoot(page);
  await waitForReplay(page);
  const replay = page.locator(".replay-scroll");
  await replay.evaluate(async element => {
    element.scrollTop = 320;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return element.scrollTop;
  });
  const childLink = page.locator(".tool-card").filter({ hasText: childTitle }).getByRole("link", { name: "Open session", exact: true });
  await childLink.scrollIntoViewIfNeeded();
  const originalScroll = await replay.evaluate(element => element.scrollTop);
  expect(originalScroll).toBeGreaterThan(0);
  await childLink.click();
  await expect(page.getByRole("heading", { name: childTitle, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session family 4", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Session family", exact: true }).getByLabel("Jump to related session")
    .selectOption({ label: "Nested subagent · Nested implementation worker" });
  await expect(page.getByRole("heading", { name: nestedTitle, exact: true })).toBeVisible();
  const nestedFamily = page.getByRole("navigation", { name: "Session family", exact: true });
  await expect(nestedFamily).toContainText(`Parent: ${childTitle}`);
  await expect(nestedFamily.getByLabel("Jump to related session")).toHaveValue(new URL(page.url()).searchParams.get("session")!);
  await page.goBack();
  await expect(page.getByRole("heading", { name: childTitle, exact: true })).toBeVisible();
  await waitForReplay(page);
  await page.goBack();
  await expect(page.getByRole("heading", { name: rootTitle, exact: true })).toBeVisible();
  await waitForReplay(page);
  await expect.poll(() => replay.evaluate(element => element.scrollTop)).toBe(originalScroll);
});

test("family controls retain focus, survive unresolved relationships, and do not overflow in compact variants", async ({ page }) => {
  await page.goto("/?agents=1&q=Orphan+worker");
  await page.getByRole("button", { name: /Orphan worker/ }).click();
  await expect(page.getByRole("button", { name: "Copy resume command", exact: true })).toHaveCount(0);
  await page.goto(`/?q=${encodeURIComponent(rootTitle)}`);
  await page.getByRole("button", { name: new RegExp(rootTitle) }).click();
  const opener = page.getByRole("button", { name: "Subagents 3", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Subagent recordings", exact: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  for (const theme of ["Light", "Dark"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.getByRole("combobox", { name: "Text size" }).selectOption("larger");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("navigation", { name: "Session family", exact: true })).toBeVisible();
    expect(await page.locator(".replay-panel").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByRole("combobox", { name: "Text size" }).selectOption("larger");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/session-family-mobile-light.png" });
});

test("browser Back restores replay filter and scroll within a recording", async ({ page }) => {
  await page.goto("/?q=Long+recording+event");
  await page.getByRole("button", { name: /Long recording event 0/ }).click();
  const replay = page.locator(".replay-scroll");
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Conversation", exact: true })).toHaveClass(/active/);
  await waitForReplay(page);
  const originalScroll = await replay.evaluate(async element => {
    element.scrollTop = 700;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return element.scrollTop;
  });
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveClass(/active/);
  await waitForReplay(page);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Conversation", exact: true })).toHaveClass(/active/);
  await waitForReplay(page);
  await expect.poll(() => replay.evaluate(element => element.scrollTop)).toBe(originalScroll);
});
