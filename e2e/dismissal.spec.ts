import { expect, test } from "./harness";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

test("filters close on Escape and outside clicks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".session-row").first()).toBeVisible();
  const filters = page.locator("details.filter-popover");
  const summary = filters.locator("summary");
  await summary.click();
  await expect(filters).toHaveJSProperty("open", true);
  await page.keyboard.press("Escape");
  await expect(filters).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
  await summary.click();
  await expect(filters).toHaveJSProperty("open", true);
  await page.locator(".library-heading h1").click();
  await expect(filters).toHaveJSProperty("open", false);
  await summary.click();
  await expect(filters).toHaveJSProperty("open", true);
  await page.getByRole("button", { name: "With errors" }).click();
  await expect(filters).toHaveJSProperty("open", false);
  await expect(page).toHaveURL(/errors=1/);
});

test("session actions close when a click lands outside the menu", async ({ page }) => {
  await page.goto("/?q=effortless");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  const details = page.locator("details.session-details");
  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", true);
  await page.locator(".replay-panel-heading h2").click();
  await expect(details).toHaveJSProperty("open", false);
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
});

test("the shortcuts popover takes focus and hands it back", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Keyboard shortcuts" });
  const popover = page.locator(".shortcut-popover");
  await opener.click();
  await expect(page.getByRole("button", { name: "Close shortcuts" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(page.getByRole("button", { name: "Close shortcuts" })).toBeFocused();
  const tab = page.getByRole("button", { name: "All sessions", exact: true });
  await tab.click();
  await expect(popover).toHaveCount(0);
  await expect(tab).toBeFocused();
  await opener.click();
  await expect(popover).toHaveCount(1);
  await opener.click();
  await expect(popover).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("closing the grouping dialog returns focus to the button that opened it", async ({ page }) => {
  await page.goto("/");
  const group = page.getByRole("button", { name: "Group workspaces", exact: true });
  const dialog = page.locator("dialog.workspace-dialog");
  await group.click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Close workspace settings" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(group).toBeFocused();
  await group.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(group).toBeFocused();
});

test("closing the replay returns focus to the selected recording", async ({ page }) => {
  await page.goto("/?q=effortless");
  const row = page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) });
  const replay = page.getByRole("region", { name: "Session replay" });
  await row.click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await page.getByRole("button", { name: "Close replay" }).click();
  await expect(replay).toHaveCount(0);
  await expect(row).toBeFocused();
  await row.click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(replay).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("switching replay tabs never announces a recording update", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-tab.active")).toHaveText("Conversation");
  const events = page.locator(".replay-event");
  const pill = page.locator(".new-events");
  await expect(events.first()).toBeVisible();
  const conversation = await events.count();
  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(events).not.toHaveCount(conversation);
  await expect(pill).toHaveCount(0);
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(events).toHaveCount(conversation);
  await expect(pill).toHaveCount(0);
});
