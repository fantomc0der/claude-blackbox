import { expect, test } from "./harness";

// Claude Code records a failed API request as an assistant turn it wrote itself, marked `isApiErrorMessage` with the
// `<synthetic>` model, and writes `No response requested.` the same way. Neither is model output.
test("API error turns read as Claude Code's own error cards and never as Claude responses", async ({ page }) => {
  await page.goto("/?errors=1&q=API+error+verification");
  const row = page.getByRole("button", { name: /API error verification/ });
  await expect(row).toBeVisible();
  await expect(row.locator(".session-symbol")).toHaveAttribute("title", "Conversation · 1 error");
  await expect(row.getByLabel("2 messages")).toBeVisible();
  await row.click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
  await expect(page.locator(".replay-event")).toHaveCount(4);
  await expect(page.locator(".replay-event-stand-in .replay-role")).toHaveText(["Claude Code", "Claude Code"]);
  await expect(page.locator(".replay-event-assistant")).toHaveCount(1);
  const failure = page.locator(".replay-event-error");
  await expect(failure).toHaveCount(1);
  await expect(failure.locator(".replay-error-label")).toHaveText("API error · rate limit · HTTP 529");
  await expect(failure).toContainText("API Error: 529");
  await expect(failure.locator(".replay-recorded-model")).toHaveCount(0);

  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-event .replay-error-label")).toHaveText("API error · rate limit · HTTP 529");

  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("responses");
  await page.keyboard.press("Escape");
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-event")).toContainText("The login test passes after the retry.");
});
