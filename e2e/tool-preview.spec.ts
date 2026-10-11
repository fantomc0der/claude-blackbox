import { expect, test } from "./harness";
import { longPreviewCommand, longPreviewPath } from "./server";

test("tool call previews use the width the viewport offers and keep file names visible", async ({ page }) => {
  await page.goto("/?q=Long+tool+preview+verification");
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: "Long tool preview verification" })).toBeVisible();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  const bash = page.locator(".tool-summary").filter({ hasText: "Bash" });
  const mcp = page.locator(".tool-summary").filter({ hasText: "playwright · browser_run_code" });
  const command = bash.locator(".tool-preview");
  const path = page.locator(".tool-preview-path");
  const dir = path.locator(".tool-preview-dir");
  const name = path.locator(".tool-preview-name");
  await expect(command).toHaveText(longPreviewCommand);
  await expect(command).toHaveAttribute("title", longPreviewCommand);
  await expect(path).toHaveText(longPreviewPath);
  await expect(path).toHaveAttribute("title", longPreviewPath);
  await expect(name).toHaveText("tool-preview-target.tsx");
  await expect(bash).toHaveAccessibleName(/^Tool pending Bash bun test tests\/synthetic-preview-suite-1/);

  const fits = (element: Element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width <= element.getBoundingClientRect().width + .01;
  };
  const size = (element: Element) => [element.getBoundingClientRect().width, element.getBoundingClientRect().height];
  await page.setViewportSize({ width: 2560, height: 1000 });
  expect(await command.evaluate(fits)).toBe(true);
  expect(await path.evaluate(fits)).toBe(true);

  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await command.evaluate(fits)).toBe(false);
    expect(await dir.evaluate(fits)).toBe(false);
    expect(await dir.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0);
    if (width > 320) expect(await name.evaluate(fits)).toBe(true);
    for (const row of [bash, mcp]) expect(await row.locator(".tool-status").evaluate(size)).toEqual([18, 18]);
    if (width > 320) expect(await mcp.evaluate(element => element.getBoundingClientRect().height)).toBe(await bash.evaluate(element => element.getBoundingClientRect().height));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
