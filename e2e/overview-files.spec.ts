import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openRecording(page: Page, title: string) {
  await page.goto(`/?q=${encodeURIComponent(title).replace(/%20/g, "+")}`);
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  return { rail, view: rail.getByLabel("Overview content"), files: rail.getByRole("navigation", { name: "Files changed in this recording" }) };
}

const wide = { viewport: { width: 2000, height: 1000 } };

test("the overview lists changed files by folder and opens each change in the transcript", async ({ page }) => {
  const { rail, view, files } = await openRecording(page, "Overview files verification");
  await expect(rail.getByRole("navigation", { name: "Events on this page" })).toBeVisible();
  await expect(view.locator('option[value="files"]')).toHaveText("Files changed · 5");
  await view.selectOption("files");

  await expect(files.getByText("Whole recording · 3 folders")).toBeVisible();
  await expect(files.getByRole("heading", { level: 3 })).toHaveText(["overview-app", "overview-shared", "overview-archive", "Scratchpads", "Other locations"]);
  await expect(files.getByRole("region", { name: "Folder /synthetic/overview-app" }).getByRole("button", { name: "Working directory" })).toBeVisible();
  await expect(files.getByRole("region", { name: "Folder /synthetic/overview-archive" })).toContainText("No changes here");
  await expect(files.getByRole("region", { name: "Other locations" })).toContainText("/synthetic/elsewhere");
  // Claude Code's per-session scratchpad is its own group, with paths relative to it; the full path stays in the tooltip.
  const scratchpads = files.getByRole("region", { name: "Scratchpads" });
  await expect(scratchpads).toContainText("Claude Code’s per-session temporary files");
  await expect(scratchpads.getByRole("button", { name: "check.py, 1 change. Show the change." })).toHaveAttribute("title", "/tmp/claude-1000/-synthetic-overview-app/5d2c7f1e-8a4b-4c3d-9e6f-0a1b2c3d4e5f/scratchpad/check.py");
  await expect(scratchpads).not.toContainText("/tmp/claude-1000");
  await expect(files.getByRole("button", { name: /^defaults\.json in src\/config, 1 change, 1 error\. Show the change\.$/ })).toContainText("1 error");
  // The /add-dir that only named a folder inside the working one is not presented as an added folder.
  await expect(files.getByRole("heading", { name: "docs" })).toHaveCount(0);

  const toggle = files.getByRole("button", { name: "Changes to app.ts" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(files.getByRole("list", { name: "Changes to app.ts" }).getByRole("button")).toHaveText([/^Edit · .+/, /^MultiEdit · .+/]);
  await files.getByText("Read, not changed · 1").click();
  await expect(files.getByRole("button", { name: /^README\.md in overview-app, 1 read\./ })).toBeVisible();

  // A change on the second page turns to it and selects its card, keeping the rail's place.
  await files.getByRole("button", { name: /^format\.ts in lib, 1 change\./ }).click();
  await expect(page.locator(".replay-range")).toContainText("25–84 of 84");
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toContainText("/synthetic/overview-shared/lib/format.ts");
  await expect(selected).toBeInViewport();
  await expect(files.locator(".overview-file.selected")).toContainText("format.ts");
  await files.getByRole("list", { name: "Changes to app.ts" }).getByRole("button", { name: /^MultiEdit/ }).click();
  await expect(selected).toContainText("MultiEdit");
  await expect(files.getByRole("list", { name: "Changes to app.ts" }).getByRole("button", { name: /^MultiEdit/ })).toHaveAttribute("aria-current", "true");
  // Like a find step, opening a record on another page starts that page at the record.
  await files.getByRole("region", { name: "Folder /synthetic/overview-shared" }).getByRole("button", { name: /^Added with \/add-dir/ }).click();
  await expect(page.locator(".replay-range")).toContainText("8–67 of 84");
  await expect(selected).toContainText("overview-shared");

  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const audit = await new AxeBuilder({ page }).include("#recording-overview").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
  }

  await page.reload();
  await expect(view).toHaveValue("files");
  await expect(files.getByRole("heading", { level: 3 }).first()).toHaveText("overview-app");
  // A closed disclosure that holds the selected row marks its name with an accent dot.
  const read = files.locator("details.overview-reads");
  await read.locator("summary").click();
  await files.getByRole("button", { name: /^README\.md in overview-app, 1 read\./ }).click();
  await read.locator("summary").click();
  await expect(read).toHaveClass(/has-selected/);
  expect(await read.locator("summary > span:first-of-type").evaluate(label => getComputedStyle(label, "::after").content)).toBe('""');
}, wide);

test("a change the active view hides opens in All events", async ({ page }) => {
  const { view, files } = await openRecording(page, "Overview files verification");
  await view.selectOption("files");
  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("prompts");
  await page.keyboard.press("Escape");
  const edit = files.getByRole("button", { name: /^app\.ts in src, 2 changes\. Show the first change\. Opens in All events/ });
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".replay-event-selected")).toContainText("src/app.ts");
}, wide);

test("a record opened another way moves the rail's mark to its own row", async ({ page }) => {
  const { view, files } = await openRecording(page, "Overview files verification");
  await view.selectOption("files");
  await files.getByRole("button", { name: /^format\.ts in lib, 1 change\./ }).click();
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toContainText("/synthetic/overview-shared/lib/format.ts");
  await expect(files.locator(".overview-file.selected .overview-file-name")).toHaveText("format.ts");
  await page.locator(".replay-event").filter({ hasText: "/synthetic/elsewhere/notes.md" }).getByRole("button", { name: "Show surrounding context" }).click();
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("/synthetic/elsewhere/notes.md");
  await expect(files.locator(".overview-file.selected .overview-file-name")).toHaveText("notes.md");
  await expect(files.locator(".overview-file.selected")).toBeInViewport();
}, wide);

test("a summary that cannot refresh offers Retry and still opens files", async ({ page }) => {
  const { view, files } = await openRecording(page, "Overview files verification");
  await view.selectOption("files");
  await expect(files.getByRole("heading", { level: 3 }).first()).toHaveText("overview-app");
  await page.route("**/summary?**", route => route.abort());
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(files.getByText("Couldn’t refresh the files for this view.")).toBeVisible();
  // Without fresh positions the file opens in All events, where it is always shown.
  await files.getByRole("button", { name: /^format\.ts in lib/ }).click();
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".replay-event-selected")).toContainText("/synthetic/overview-shared/lib/format.ts");
  await page.unroute("**/summary?**");
  await files.getByRole("button", { name: "Retry" }).click();
  await expect(files.getByText("Couldn’t refresh the files for this view.")).toHaveCount(0);
}, wide);

test("a recording without file changes says so and still names its folders", async ({ page }) => {
  const { view, files } = await openRecording(page, "Terminal styling verification");
  await expect(view.locator('option[value="files"]')).toHaveText("Files changed · 0");
  await view.selectOption("files");
  await expect(files.getByText("No file changes recorded.")).toBeVisible();
  await expect(files.getByRole("heading", { level: 3 })).toHaveText(["browser-tests", "ingest-dealer-config"]);
  await expect(files.getByText("No changes here")).toHaveCount(0);
  await expect(files).toContainText("Changes made through shell commands or by subagents aren’t listed.");
}, wide);

test("the file summary is only requested while the overview rail shows", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/summary")) requests.push(request.url()); });
  await openRecording(page, "Overview files verification");
  await expect(page.getByRole("complementary", { name: "Recording overview" })).toBeHidden();
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Hide library" }).click();
  await expect(page.getByRole("complementary", { name: "Recording overview" })).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
});
