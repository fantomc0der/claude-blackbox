import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

async function openRecording(page: Page, title: string) {
  await page.goto(`/?q=${encodeURIComponent(title).replace(/%20/g, "+")}`);
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const rail = page.getByRole("complementary", { name: "Recording overview" });
  return { rail, view: rail.getByLabel("Overview content"), commands: rail.getByRole("navigation", { name: "Commands run in this recording" }) };
}

const wide = { viewport: { width: 2000, height: 1000 } };

test("the overview groups the commands run by program and opens each command's last run", async ({ page }) => {
  const { view, commands } = await openRecording(page, "Overview commands verification");
  await expect(view.locator('option[value="commands"]')).toHaveText("Commands run · 6");
  await view.selectOption("commands");

  await expect(commands.getByText("Whole recording · 8 runs of 6 commands")).toBeVisible();
  await expect(commands.getByRole("heading", { level: 3 })).toHaveText(["git", "rm"]);
  await commands.locator('details[aria-label="Language & build tools"] > summary').click();
  const other = commands.locator('details[aria-label="Other commands"]');
  await expect(other.locator("summary")).toContainText("2 runs · 1 error");
  await other.locator("summary").click();
  await expect(commands.getByRole("heading", { level: 3 })).toHaveText(["git", "rm", "bun", "cargo"]);
  const bun = commands.getByRole("region", { name: "Commands starting with bun" });
  await expect(bun.locator(".overview-provenance")).toHaveText("1 run");
  await expect(commands.getByRole("region", { name: "Commands starting with rm" }).locator(".overview-provenance")).toHaveText("1 run·1 stopped");
  const tests = other.getByRole("button", { name: "cd /synthetic/overview-app && bun test, 2 runs, 1 error. Last run succeeded. Show the last run." });
  await expect(tests).toHaveAttribute("title", "cd /synthetic/overview-app && bun test");
  await expect(tests.locator(".overview-file-dir")).toHaveCount(0);
  await expect(tests).toContainText("1 error");
  await expect(commands.getByRole("button", { name: "rm -rf node_modules, 1 run, 1 stopped. The run was stopped: permission denied. Show the run." })).toBeVisible();
  await expect(commands.getByRole("button", { name: "bun run dev --port 12005, 1 run. The run started in the background. Show the run." })).toBeVisible();
  await expect(commands.getByRole("button", { name: "cargo test --locked, 1 run. The run has no result. Show the run." })).toBeVisible();
  await expect(commands.getByRole("region", { name: "Commands starting with git" }).getByRole("button", { name: /^git status --short, 2 runs\. Last run succeeded\./ })).toBeVisible();

  const toggle = other.getByRole("button", { name: "Runs of cd /synthetic/overview-app && bun test" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const runs = other.getByRole("list", { name: "Runs of cd /synthetic/overview-app && bun test" });
  await expect(runs.getByRole("button")).toHaveText([/· error$/, /M$/]);

  // The command opens its last run, on the second page, and the rail marks the command.
  await tests.click();
  await expect(page.locator(".replay-range")).toContainText("26–85 of 85");
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toContainText("2 pass");
  await expect(selected).toBeInViewport();
  await expect(commands.locator(".overview-file.selected")).toContainText("bun test");
  await runs.getByRole("button", { name: / error$/ }).click();
  await expect(page.locator(".replay-range")).toContainText("2–61 of 85");
  await expect(selected).toContainText("1 fail");
  await expect(runs.getByRole("button", { name: / error$/ })).toHaveAttribute("aria-current", "true");

  await commands.locator('details[aria-label="Searches"] > summary').click();
  await expect(commands.getByRole("heading", { level: 3 })).toHaveText(["git", "rm", "bun", "cargo", "Grep", "Glob", "WebSearch"]);
  const grep = commands.getByRole("region", { name: "Grep searches" }).getByRole("button", { name: "backoffCeiling in src · *.ts, 1 search. The search succeeded. Show the search." });
  await expect(grep.locator(".overview-file-dir")).toHaveText("src · *.ts");
  await expect(commands.getByRole("region", { name: "WebSearch searches" })).toContainText("bun test timeout flag");
  await expect(commands).toContainText("Commands run by subagents aren’t listed.");

  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const audit = await new AxeBuilder({ page }).include("#recording-overview").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
  }

  await page.reload();
  await expect(view).toHaveValue("commands");
  await expect(commands.getByRole("heading", { level: 3 }).first()).toHaveText("git");
}, wide);

test("a run the active view hides opens in All events", async ({ page }) => {
  const { view, commands } = await openRecording(page, "Overview commands verification");
  await view.selectOption("commands");
  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("prompts");
  await page.keyboard.press("Escape");
  const log = commands.getByRole("button", { name: /^\/usr\/bin\/git log --oneline -3, 1 run\. The run succeeded\. Show the run\. Opens in All events/ });
  await expect(log).toBeVisible();
  await log.click();
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".replay-event-selected")).toContainText("/usr/bin/git log --oneline -3");
}, wide);

test("a recording without shell commands says so", async ({ page }) => {
  const { view, commands } = await openRecording(page, "Overview files verification");
  await expect(view.locator('option[value="commands"]')).toHaveText("Commands run · 0");
  await view.selectOption("commands");
  await expect(commands.getByText("Whole recording", { exact: true })).toBeVisible();
  await expect(commands.getByText("No shell commands recorded.")).toBeVisible();
  await expect(commands.getByRole("heading", { level: 3 })).toHaveCount(0);
}, wide);

test("Other commands explains and opens single-program overflow past the group limit", async ({ page }) => {
  const { view, commands } = await openRecording(page, "Overview command overflow verification");
  await view.selectOption("commands");
  await expect(commands.getByText("Whole recording · 31 runs of 31 commands")).toBeVisible();
  await expect(commands.getByText(/Counts marked “Listed”/)).toHaveCount(0);
  await expect(commands.getByRole("heading", { level: 3 })).toHaveCount(30);
  const other = commands.locator('details[aria-label="Other commands"]');
  await expect(other).not.toHaveAttribute("open", "");
  await expect(other.locator("summary")).toContainText("1 run");
  await other.locator("summary").click();
  await expect(other.locator(".overview-category-note")).toContainText("programs beyond the overview’s group limit");
  const overflow = other.getByRole("button", { name: /^overflow-tool-0 --version, 1 run\./ });
  await expect(overflow).toBeVisible();
  await overflow.click();
  await expect(page.locator(".replay-event-selected")).toContainText("overflow-tool-0 --version");
}, wide);

test("command categories disclose faithful previews, outcomes, and WebFetch navigation", async ({ page }) => {
  const { rail, view, commands } = await openRecording(page, "Overview command categories verification");
  await view.selectOption("commands");
  await expect(commands.getByText("Whole recording · 7 runs of 7 commands")).toBeVisible();
  await expect(commands.getByRole("heading", { level: 3 })).toHaveText(["ls"]);
  const language = commands.locator('details[aria-label="Language & build tools"]');
  const network = commands.locator('details[aria-label="Network"]');
  const other = commands.locator('details[aria-label="Other commands"]');
  await expect(language.locator("summary")).toContainText("2 runs");
  await expect(network.locator("summary")).toContainText("1 run · 2 fetches · 1 error");
  await expect(other.locator("summary")).toContainText("3 runs · 1 error · 1 stopped");
  const searches = commands.locator('details[aria-label="Searches"]');
  await expect(searches.locator("summary")).toContainText("2 distinct · 3 calls · 1 error · 1 stopped");
  for (const disclosure of [language, network, other, searches]) await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(commands.getByText(/Counts marked “Listed”/)).toHaveCount(0);

  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await rail.screenshot({ path: `test-results/command-categories-${theme.toLowerCase()}.png` });
  }
  await language.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(language.getByRole("heading", { level: 3 })).toHaveText(["python", "dotnet"]);
  await network.locator("summary").click();
  await other.locator("summary").click();
  await expect(network.getByRole("heading", { level: 3 })).toHaveText(["curl", "WebFetch"]);
  const chainText = 'cd "/synthetic/skills" && S="/tmp/scratch" && python "$S/check.py" 2>&1 | tail -8';
  const chain = other.getByRole("button", { name: /^cd "\/synthetic\/skills"/ });
  await expect(chain.locator(".overview-file-name")).toHaveText(chainText);
  await expect(chain.locator(".overview-file-dir")).toHaveCount(0);
  const multiline = other.getByRole("button", { name: /^F=\/tmp\/scratch,/ });
  await expect(multiline.locator(".overview-file-dir")).toHaveText("+2 lines");
  await expect(multiline).toHaveAttribute("title", 'F=/tmp/scratch\npython "$F/check.py"\nwc -l "$F/output.txt"');
  await multiline.click();
  await expect(page.locator(".replay-event-selected")).toContainText("Missing output.txt");
  await expect(other).toHaveAttribute("open", "");

  const fetches = network.getByRole("region", { name: "WebFetch fetches" });
  const fetch = fetches.getByRole("button", { name: /^https:\/\/example.test\/docs: Find setup instructions, 2 fetches, 1 error/ });
  await expect(fetch.locator(".overview-file-dir")).toHaveText("Find setup instructions");
  await fetches.getByRole("button", { name: "Fetches of https://example.test/docs" }).click();
  await expect(fetches.getByRole("list").last().getByRole("button")).toHaveCount(2);
  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("prompts");
  await page.keyboard.press("Escape");
  await expect(fetch).toHaveAttribute("aria-label", /Opens in All events/);
  await fetch.click();
  await expect(page.getByRole("button", { name: "All events", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".replay-event-selected")).toContainText("Find setup instructions");
  await page.locator(".replay-event-selected .replay-raw > summary").click();
  await expect(page.locator(".replay-event-selected .replay-raw")).toContainText("categories-fetch-2");

  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    const audit = await new AxeBuilder({ page }).include("#recording-overview").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Hide library" }).click();
  await expect(rail).toBeVisible();
  expect(await rail.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await rail.screenshot({ path: "test-results/command-categories-expanded.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rail).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}, wide);

test("truncated command, search, and fetch lists label partial group tallies", async ({ page }) => {
  await page.route("**/summary?**", async route => {
    const response = await route.fetch();
    const summary = await response.json();
    await route.fulfill({ json: { ...summary, limited: true, commandCount: summary.commandCount + 1, commandRuns: summary.commandRuns + 1, searchCount: summary.searchCount + 1, searchRuns: summary.searchRuns + 1, fetchCount: summary.fetchCount + 1, fetchRuns: summary.fetchRuns + 1 } });
  });
  const { view, commands } = await openRecording(page, "Overview command categories verification");
  await view.selectOption("commands");
  await expect(commands.getByText("Whole recording · 8 runs of 8 commands")).toBeVisible();
  await expect(commands.getByText(/Counts marked “Listed” exclude omitted/)).toBeVisible();
  await expect(commands.getByRole("region", { name: "Commands starting with ls" }).locator(".overview-provenance")).toHaveText("Listed:1 run");
  for (const category of ["Language & build tools", "Network", "Other commands", "Searches"]) {
    const disclosure = commands.locator(`details[aria-label="${category}"]`);
    await expect(disclosure.locator(".overview-category-tally")).toContainText("Listed:");
    await disclosure.locator("summary").click();
    for (const tally of await disclosure.locator(".overview-provenance").all()) await expect(tally).toContainText("Listed:");
  }
  const searches = commands.locator('details[aria-label="Searches"]');
  await expect(searches.locator(".overview-category-tally")).toHaveText("Listed: 2 distinct · 3 calls · 1 error · 1 stopped");
  await expect(searches.getByText("Whole recording: 3 distinct searches across 4 calls.")).toBeVisible();
}, wide);
