import { expect, test } from "./harness";

const openRecord = async (page: import("@playwright/test").Page) => {
  await page.goto("/?q=JSON+highlighting");
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await page.getByRole("button", { name: "All events", exact: true }).click();
  const record = page.locator(".replay-event-system").filter({ hasText: "attachment record" });
  await expect(record).toHaveCount(1);
  return record;
};

test("complete JSON payloads inside recorded text are syntax highlighted", async ({ page }) => {
  const record = await openRecord(page);
  const panel = record.locator(".tool-code").first();
  await expect(panel.locator("pre")).toContainText("hookName: PreToolUse:Bash");
  await expect(panel.locator("pre")).toContainText('stdout: {');
  await expect(panel.locator(".json-key")).toHaveText(['"continue"', '"hookSpecificOutput"', '"hookEventName"', '"additionalContext"']);
  await expect(panel.locator(".json-boolean")).toHaveText(["true"]);
  await expect(panel.locator(".json-string")).toHaveText(['"PreToolUse"', '"Use parallel execution for independent tasks."']);
  await expect(panel.locator(".json-punctuation").first()).toHaveText("{");
  await expect(panel.locator(".json-punctuation").last()).toHaveText("}");
  expect(await panel.locator("code").evaluate(element => element.firstChild?.textContent ?? "")).toMatch(/hookName: PreToolUse:Bash[\s\S]*stdout: $/);
  expect(await panel.locator("code").evaluate(element => element.lastChild?.textContent ?? "")).toMatch(/^\n\nstderr: \nexitCode: 0$/);
  const keyColor = await panel.locator(".json-key").first().evaluate(element => getComputedStyle(element).color);
  const stringColor = await panel.locator(".json-string").first().evaluate(element => getComputedStyle(element).color);
  const plainColor = await panel.locator("pre").evaluate(element => getComputedStyle(element).color);
  expect(new Set([keyColor, stringColor, plainColor]).size).toBe(3);
});

test("raw event JSON is highlighted and keeps search marks, in both themes", async ({ page }) => {
  const record = await openRecord(page);
  await record.locator(".replay-raw > summary").click();
  const raw = record.locator(".replay-raw .tool-code");
  await expect(raw.locator("pre")).toContainText('"hookName": "PreToolUse:Bash"');
  await expect(raw.locator(".json-key").first()).toHaveText('"uuid"');
  await expect(raw.locator(".json-boolean")).toHaveText(["false"]);
  await expect(raw.locator(".json-number")).toHaveText(["0"]);
  await expect(raw.locator(".json-null")).toHaveCount(0);
  const darkKey = await raw.locator(".json-key").first().evaluate(element => getComputedStyle(element).color);
  await page.getByRole("group", { name: "Theme", exact: true }).getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const lightKey = await raw.locator(".json-key").first().evaluate(element => getComputedStyle(element).color);
  expect(lightKey).not.toBe(darkKey);
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("continue");
  const found = page.locator(".replay-event-system").filter({ hasText: "attachment record" }).locator(".tool-code").first();
  await expect(found.locator("mark .json-key").first()).toHaveText("continue");
  expect((await found.locator(".json-key").allTextContents()).slice(0, 3).join("")).toBe('"continue"');
});
