import { expect, test } from "./harness";

// Claude Code records a failed API request as an assistant turn it wrote itself, marked `isApiErrorMessage` with the
// `<synthetic>` model, and writes `No response requested.` the same way. Neither is model output.
test("API error turns read as Claude Code's own error cards and never as Claude responses", async ({ page }) => {
  const label = "API error · rate limit · usage limit reached · HTTP 429";
  await page.goto("/?errors=1&q=API+error+verification");
  const row = page.getByRole("button", { name: /API error verification/ });
  await expect(row).toBeVisible();
  await expect(row.locator(".session-symbol")).toHaveAttribute("title", "Conversation · 1 API error");
  await expect(row.getByLabel("2 messages")).toBeVisible();
  await row.click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
  await expect(page.locator(".replay-event")).toHaveCount(4);
  await expect(page.locator(".replay-event-stand-in .replay-role")).toHaveText(["Claude Code", "Claude Code"]);
  await expect(page.locator(".replay-event-assistant")).toHaveCount(1);
  const failure = page.locator(".replay-event-error");
  await expect(failure).toHaveCount(1);
  await expect(failure.locator(".replay-error-label")).toHaveText(label);
  await expect(failure).toContainText("API Error: 429");
  await expect(failure.locator(".replay-recorded-model")).toHaveCount(0);

  await page.getByRole("button", { name: "Errors", exact: true }).click();
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-event .replay-error-label")).toHaveText(label);

  await page.locator(".replay-filters > summary").click();
  await page.locator("#replay-focused-view").selectOption("responses");
  await page.keyboard.press("Escape");
  await expect(page.locator(".replay-event")).toHaveCount(1);
  await expect(page.locator(".replay-event")).toContainText("The login test passes after the retry.");
});

test("an API retry reads as a note with its attempt, not as an error", async ({ page }) => {
  const listing = await (await page.request.get("/api/sessions?q=API+error+verification")).json();
  const session = listing.items.find((item: { title: string }) => item.title === "API error verification");
  await page.goto(`/?session=${session.id}&replayKind=all`);
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  const retry = page.locator(".replay-event").nth(1);
  await expect(retry.locator(".tool-hidden")).toHaveText("API retry · attempt 2 of 10 · retry after 4s");
  await expect(retry.locator(".tool-hidden")).toHaveAttribute("title", /the index does not count a retry as an error/);
  await expect(retry.locator(".replay-error-label")).toHaveCount(0);
  await expect(retry).not.toHaveClass(/replay-event-error/);
  await expect(page.locator(".replay-event-error")).toHaveCount(1);
});
