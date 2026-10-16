import { expect, test } from "./harness";

// The fixture's first API request has its two message copies on the same page. The second request's copy ends the first
// page, and the request itself opens the next one.
test("API request message copies fold into their request card instead of reading as untimed events", async ({ page }) => {
  await page.goto("/?q=Request+copy+verification");
  await page.getByRole("button", { name: /Request copy verification/ }).click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.locator(".tool-card")).toHaveCount(1);

  await page.getByRole("button", { name: "All events", exact: true }).click();
  const counts = page.locator(".replay-find > .replay-count");
  await expect(counts).toHaveText("61 records");
  await expect(counts).toHaveAttribute("aria-label", "61 records. Request messages appear inside their API requests.");
  await expect(page.locator(".replay-event")).toHaveCount(58);
  const request = page.locator(".replay-event", { has: page.locator("details.request-messages") });
  await expect(request).toHaveCount(1);
  await expect(request.locator(".replay-event-link time")).not.toHaveText("Unknown time");
  const messages = request.locator("details.request-messages");
  await expect(messages.locator("summary")).toHaveText("2 messages stored with this request");
  await expect(messages.locator(".tool-code")).toHaveCount(0);
  await messages.locator("summary").click();
  await expect(messages.locator(".tool-code header > span")).toHaveText(["Recorded assistant message", "Recorded user message"]);
  await expect(messages.locator(".tool-code").first()).toContainText("copy-hash-1");

  // The copy at the page edge stays a record of its own, labeled for the request that follows it on the next page.
  const edge = page.locator(".replay-event").last();
  await expect(edge.locator(".tool-hidden")).toHaveText("Message stored for the API request that follows");
  await expect(page.locator(".replay-event-link time", { hasText: "Unknown time" })).toHaveCount(1);
});
