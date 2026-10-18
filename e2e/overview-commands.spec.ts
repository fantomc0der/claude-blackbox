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
  // The programs run most come first; the same command run from Bash and PowerShell is one command, and a program
  // named by its path joins its group. Searches wait in their closed disclosure.
  await expect(commands.getByRole("heading", { level: 3 })).toHaveText(["bun", "git", "rm", "cargo"]);
  const bun = commands.getByRole("region", { name: "Commands starting with bun" });
  await expect(bun.locator(".overview-provenance")).toHaveText("3 runs·1 error");
  await expect(commands.getByRole("region", { name: "Commands starting with rm" }).locator(".overview-provenance")).toHaveText("1 run·1 stopped");
  const tests = bun.getByRole("button", { name: "bun test, 2 runs, 1 error. Last run succeeded. Show the last run." });
  await expect(tests).toHaveAttribute("title", "cd /synthetic/overview-app && bun test");
  await expect(tests.locator(".overview-file-dir")).toHaveText("cd /synthetic/overview-app &&");
  await expect(tests).toContainText("1 error");
  await expect(commands.getByRole("button", { name: "rm -rf node_modules, 1 run, 1 stopped. The run was stopped: permission denied. Show the run." })).toBeVisible();
  await expect(commands.getByRole("button", { name: "bun run dev --port 12005, 1 run. The run started in the background. Show the run." })).toBeVisible();
  await expect(commands.getByRole("button", { name: "cargo test --locked, 1 run. The run has no result. Show the run." })).toBeVisible();
  await expect(commands.getByRole("region", { name: "Commands starting with git" }).getByRole("button", { name: /^git status --short, 2 runs\. Last run succeeded\./ })).toBeVisible();

  const toggle = bun.getByRole("button", { name: "Runs of bun test" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(bun.getByRole("list", { name: "Runs of bun test" }).getByRole("button")).toHaveText([/· error$/, /M$/]);

  // The command opens its last run, on the second page, and the rail marks the command.
  await tests.click();
  await expect(page.locator(".replay-range")).toContainText("26–85 of 85");
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toContainText("2 pass");
  await expect(selected).toBeInViewport();
  await expect(commands.locator(".overview-file.selected")).toContainText("bun test");
  await bun.getByRole("list", { name: "Runs of bun test" }).getByRole("button", { name: /· error$/ }).click();
  await expect(page.locator(".replay-range")).toContainText("2–61 of 85");
  await expect(selected).toContainText("1 fail");
  await expect(bun.getByRole("list", { name: "Runs of bun test" }).getByRole("button", { name: /· error$/ })).toHaveAttribute("aria-current", "true");

  await commands.getByText("Searches · 3").click();
  await expect(commands.getByRole("heading", { level: 3 })).toHaveText(["bun", "git", "rm", "cargo", "Grep", "Glob", "WebSearch"]);
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
  await expect(commands.getByRole("heading", { level: 3 }).first()).toHaveText("bun");
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
