import { expect, test } from "./harness";
import { terminalProse } from "./server";

test("recorded escape sequences style terminal output and leave prose without boxes", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?q=Terminal+styling+verification");
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: "Terminal styling verification" })).toBeVisible();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const prose = page.locator(".replay-event-user .md-content").filter({ hasText: "working directory" });
  await expect(prose).toHaveText(terminalProse);
  expect(await prose.evaluate(element => element.querySelectorAll("*").length)).toBe(1);

  const tools = page.locator('.tool-summary[aria-expanded="false"]');
  while (await tools.count()) await tools.first().click();
  const output = page.locator(".tool-terminal").filter({ hasText: "Command output" }).locator("pre");
  await expect(output).toHaveText("✓ renders styled output\nwarning and truecolor inverse\nplain tail");
  await expect(output.locator(".ansi-bold.ansi-underline")).toHaveText("styled");
  const check = output.locator(".ansi-fg").first();
  await expect(check).toHaveText("✓");
  const palette = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ansi-2").trim());
  expect(palette).toMatch(/^#[0-9a-f]{6}$/i);
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;
  expect(await check.evaluate(element => getComputedStyle(element).color)).toBe(rgb(palette));
  expect(await output.getByText("warning").evaluate(element => getComputedStyle(element).color)).toBe("rgb(255, 135, 0)");
  expect(await output.getByText("truecolor").evaluate(element => getComputedStyle(element).color)).toBe("rgb(200, 100, 50)");
  const inverse = output.locator(".ansi-inverse");
  const [preColor, preBackground] = await output.evaluate(element => [getComputedStyle(element).color, getComputedStyle(element.closest(".tool-code")!).backgroundColor]);
  expect(await inverse.evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor])).toEqual([preBackground, preColor]);
  await page.getByRole("button", { name: "Hide library" }).click();
  const outline = page.locator(".replay-outline button").filter({ hasText: "working directory" });
  await expect(outline).toContainText("Added C:\\code\\csii\\ingest-dealer-config as a working directory for this session");
  expect(await page.locator(".replay-event, .replay-outline").evaluateAll(nodes => nodes.some(node => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(node.textContent ?? "")))).toBe(false);

  await page.getByRole("button", { name: "Copy", exact: true }).nth(1).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("✓ renders styled output\nwarning and truecolor inverse\nplain tail");
});
