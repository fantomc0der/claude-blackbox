import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openRecording(page: Page, title: string) {
  await page.goto(`/?q=${encodeURIComponent(title).replace(/%20/g, "+")}`);
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  return { rail, view: rail.getByLabel("Overview content"), prompts: rail.getByRole("navigation", { name: "Prompts in this recording" }) };
}

const wide = { viewport: { width: 2000, height: 1000 } };

test("the overview lists what was typed across the whole recording and opens each prompt in the transcript", async ({ page }) => {
  const { rail, view, prompts } = await openRecording(page, "Overview prompts verification");
  await expect(rail.getByRole("navigation", { name: "Events on this page" })).toBeVisible();
  await expect(view.locator('option[value="prompts"]')).toHaveText("Prompts · 6");
  await view.selectOption("prompts");

  await expect(prompts.getByText("Whole recording · 6 prompts")).toBeVisible();
  // Prose, slash commands, and shell commands are listed as typed; command output, IDE context, and the interruption
  // marker are not. Attached reminders are removed from the prompt's own words.
  await expect(prompts.locator(".overview-prompt-text")).toHaveText(["Overview prompts verification", "/compact", "/review PR 12", "! bun test", "Add retries to the upload client", "Ship it"]);
  await expect(prompts).not.toContainText("Compacted the conversation");
  await expect(prompts).not.toContainText("186 pass");
  await expect(prompts).not.toContainText("Follow CLAUDE.md");
  const rows = prompts.getByRole("listitem");
  await expect(rows.nth(0)).toContainText("1 error");
  await expect(rows.nth(0)).not.toContainText("stopped");
  await expect(rows.nth(4)).toContainText("1 stopped");
  await expect(rows.nth(4)).not.toContainText("error");
  // Each row carries its ordinal and clock time; the prompt typed on a later day names the day too.
  await expect(rows.nth(1).locator(".overview-prompt-index")).toHaveText("2");
  await expect(rows.nth(0).locator(".overview-when")).toHaveText(/^\d{1,2}:\d{2} [AP]M$/);
  await expect(rows.nth(5).locator(".overview-when")).toHaveText(/^Jan 6 · \d{1,2}:\d{2} [AP]M$/);
  await expect(prompts.getByRole("button", { name: /^Slash command 2, Jan 5, \d{1,2}:\d{2} [AP]M: \/compact\. Show it\.$/ })).toBeVisible();
  await expect(prompts.getByRole("button", { name: /^Prompt 1, Jan 5, \d{1,2}:\d{2} [AP]M, 1 error: Overview prompts verification\. Show it\.$/ })).toBeVisible();

  // A prompt on the second page turns to it and selects its card, keeping the rail's place.
  await prompts.getByRole("button", { name: /^Prompt 6, / }).click();
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toContainText("Ship it");
  await expect(selected).toBeInViewport();
  await expect(page.locator(".replay-range")).toContainText(/^\d+–\d+ of \d+/);
  await expect(prompts.locator(".overview-prompt.selected")).toContainText("Ship it");
  await expect(prompts.getByRole("button", { name: /^Prompt 6, / })).toHaveAttribute("aria-current", "true");
  await prompts.getByRole("button", { name: /^Shell command 4, / }).click();
  await expect(selected).toContainText("bun test");
  await expect(prompts.locator(".overview-prompt.selected")).toContainText("! bun test");

  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const audit = await new AxeBuilder({ page }).include("#recording-overview").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
  }

  await page.reload();
  await expect(view).toHaveValue("prompts");
  await expect(prompts.locator(".overview-prompt-text").first()).toHaveText("Overview prompts verification");
}, wide);

test("a prompt selected by a find match is marked and shown in the rail", async ({ page }) => {
  const { view, prompts } = await openRecording(page, "Overview prompts verification");
  await view.selectOption("prompts");
  await expect(prompts.getByText("Whole recording · 6 prompts")).toBeVisible();
  await expect(prompts.locator(".overview-prompt.selected")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("Ship it");
  await expect(page.locator(".replay-match-count")).toHaveText("1 match");
  await page.keyboard.press("Enter");
  await expect(page.locator(".replay-event-selected")).toContainText("Ship it");
  const selected = prompts.locator(".overview-prompt.selected");
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("Ship it");
  await expect(selected).toBeInViewport();
  await expect(prompts.getByRole("button", { name: /^Prompt 6, / })).toHaveAttribute("aria-current", "true");
}, wide);

test("a prompt the active view hides opens in All events", async ({ page }) => {
  const { view, prompts } = await openRecording(page, "Overview prompts verification");
  await view.selectOption("prompts");
  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("tool");
  await page.keyboard.press("Escape");
  const prompt = prompts.getByRole("button", { name: /^Prompt 5, .*Add retries to the upload client\. Show it\. Opens in All events/ });
  await expect(prompt).toBeVisible();
  await prompt.click();
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".replay-event-selected")).toContainText("Add retries to the upload client");
}, wide);

test("a prompt chosen while fresh positions are still loading opens once they arrive", async ({ page }) => {
  const { view, prompts } = await openRecording(page, "Overview prompts verification");
  await view.selectOption("prompts");
  await expect(prompts.getByText("Whole recording · 6 prompts")).toBeVisible();
  // Hold the refetch a view change starts, so the rail still shows the previous list while its positions are stale.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/summary?**", async route => { await held; await route.continue(); });
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tools", exact: true })).toHaveAttribute("aria-pressed", "true");
  await prompts.getByRole("button", { name: /^Prompt 5, / }).click();
  await expect(page.locator(".replay-event-selected")).toHaveCount(0);
  release();
  // Tools hides the prompt, so the fresh positions send it to All events with its context.
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".replay-event-selected")).toContainText("Add retries to the upload client");
  await expect(prompts.locator(".overview-prompt.selected")).toContainText("Add retries to the upload client");
}, wide);

test("a recording with one prompt lists it alone", async ({ page }) => {
  const { view, prompts } = await openRecording(page, "Hidden-only reasoning verification");
  await expect(view.locator('option[value="prompts"]')).toHaveText("Prompts · 1");
  await view.selectOption("prompts");
  await expect(prompts.locator(".overview-prompt-text")).toHaveText(["Hidden-only reasoning verification"]);
  await expect(prompts).toContainText("Tool results, command output, and interruptions aren’t listed.");
}, wide);
