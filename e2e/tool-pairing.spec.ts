import type { Page } from "@playwright/test";
import { expect, test } from "./harness";

// Opens the demo's ledger recording, which has three failing Bash calls, directly on a replay view.
async function openLedger(page: Page, view: string) {
  const listing = await (await page.request.get("/api/sessions?q=large-export")).json();
  expect(listing.items.map((session: { title: string }) => session.title)).toEqual(["Stream ledger exports without timeouts"]);
  await page.goto(`/?session=${listing.items[0].id}&${view}`);
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
}

test("the Tools tab shows each call once, with its result inside the call's card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLedger(page, "replayKind=tool");
  const calls = page.locator(".tool-card:not(.tool-result)");
  await expect(calls.first()).toBeVisible();
  const count = await calls.count();
  expect(count).toBeGreaterThan(10);
  await expect(page.locator(".replay-event")).toHaveCount(count);
  await expect(page.locator(".replay-event-tool-result")).toHaveCount(0);
  // The recording runs this command twice: once failing, then again after the fix.
  await expect(page.locator("button.tool-summary", { hasText: "bun test ledger --filter large-export" })).toHaveCount(2);
  const failing = page.locator(".tool-card-error > button.tool-summary", { hasText: "bun test ledger --filter large-export" });
  await expect(failing).toHaveCount(1);
  await expect(failing).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tool-code", { hasText: "Timed out after 30000ms" })).toHaveCount(1);
  const counts = page.locator(".replay-find > .replay-count");
  await expect(counts).toHaveText(/^\d+ of \d+ records$/);
  const [records] = (await counts.textContent())!.match(/\d+/g)!.map(Number);
  expect(records).toBe(count * 2);
  await expect(page.locator(".replay-footer")).toContainText(`1–${records} of ${records} records`);
  await expect(counts).toHaveAttribute("aria-label", /Tool results appear inside their calls\.$/);
});

test("the Errors tab names the call that failed above each recorded error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLedger(page, "replayKind=all&replayErrors=1");
  const results = page.locator(".replay-event-tool-result");
  await expect(results).toHaveCount(3);
  const first = results.first();
  const call = first.locator(".tool-result-call");
  await expect(call).toContainText("Bash");
  await expect(call.locator(".tool-preview")).toHaveText("bun test ledger --filter large-export");
  await expect(call.locator(".tool-status")).toHaveAttribute("aria-label", "Tool error");
  await expect(first.locator(".tool-content .tool-code header")).toContainText("Recorded tool error");
  await expect(first.locator(".tool-content")).toContainText("Timed out after 30000ms");
  await expect(results.nth(1).locator(".tool-result-call .tool-preview")).toHaveText("bun run typecheck");
  await expect(page.locator(".replay-find > .replay-count")).toHaveText(/^3 of \d+ records$/);
  await expect(page.locator(".replay-footer")).toContainText("1–3 of 3 records");
});

test("a find match in a call's output selects the call's card on the Tools tab", async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent("Search handoff verification")}`);
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".replay-event")).toHaveCount(1);
  const find = page.getByRole("textbox", { name: "Find in this recording" });
  await find.fill("Quillmoss");
  await expect(page.locator(".replay-match-count")).toHaveText("1 match");
  await find.press("Enter");
  await expect(page.locator(".replay-match-count")).toHaveText("1 of 1 matching records");
  const selected = page.locator(".replay-event-selected");
  await expect(selected).toHaveCount(1);
  await expect(selected.locator(".tool-summary")).toContainText("bun test billing");
  await expect(selected).toContainText("Quillmoss check passed");
});
