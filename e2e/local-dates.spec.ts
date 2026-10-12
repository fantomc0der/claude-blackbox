import type { Page, Request } from "@playwright/test";
import { expect, test } from "./harness";

// The fixture's pagination recordings sit at 00:00 UTC on 1 January, which is the evening of 31 December in New York.
// The timeline recording runs from 18:00 on 2 January to 01:19 on 3 January in Tokyo, reaching midnight at event 120,
// and all of it is 2 January in UTC.
const bound = (path: string, key: string, offset: string) => (request: Request) => {
  const url = new URL(request.url());
  return url.pathname.endsWith(path) && url.searchParams.get(key) === offset;
};

async function openRecording(page: Page, query: string) {
  await page.goto(`/?q=${encodeURIComponent(query)}`);
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
}

test("library dates select the reader's local days while chips and the address keep plain dates", async ({ page }) => {
  const list = page.waitForRequest(bound("/api/sessions", "afterTz", "540"));
  await page.goto("/?after=2026-01-03&before=2026-01-03");
  const params = new URL((await list).url()).searchParams;
  expect([params.get("after"), params.get("before"), params.get("beforeTz")]).toEqual(["2026-01-03", "2026-01-03", "540"]);
  await expect(page.locator(".session-row", { hasText: "Timeline scrubber verification" })).toHaveCount(1);
  await expect(page.locator(".session-row", { hasText: "Pagination fixture" })).toHaveCount(0);
  await expect(page.locator(".filter-chip")).toHaveText(["From 2026-01-03", "To 2026-01-03"]);
  expect(new URL(page.url()).search).toBe("?after=2026-01-03&before=2026-01-03");
  await page.locator(".filter-popover > summary").click();
  await expect(page.getByRole("combobox", { name: "Last activity", exact: true })).toBeVisible();
  await expect(page.getByText("UTC")).toHaveCount(0);
  await expect(page.getByLabel("From", { exact: true }).first()).toHaveValue("2026-01-03");
  await expect(page.locator(".filter-popover .search-help").first()).toContainText("dates use last activity in local time.");
}, { timezoneId: "Asia/Tokyo" });

test("library dates west of UTC reach back to the reader's previous local day", async ({ page }) => {
  const list = page.waitForRequest(bound("/api/sessions", "afterTz", "-300"));
  await page.goto("/?after=2025-12-31&before=2025-12-31");
  expect(new URL((await list).url()).searchParams.get("beforeTz")).toBe("-300");
  await expect(page.locator(".session-row", { hasText: "Pagination fixture" }).first()).toBeVisible();
}, { timezoneId: "America/New_York" });

test("replay date bounds send the local offset with records, the activity strip, and find matches", async ({ page }) => {
  await openRecording(page, "Timeline scrubber verification");
  await page.locator("details.replay-filters > summary").click();
  await expect(page.getByText("After UTC")).toHaveCount(0);
  const events = page.waitForRequest(bound("/events", "afterTz", "540"));
  const timeline = page.waitForRequest(bound("/timeline", "afterTz", "540"));
  await page.getByLabel("After", { exact: true }).fill("2026-01-03");
  expect(new URL((await events).url()).searchParams.get("after")).toBe("2026-01-03");
  await timeline;
  await expect(page).toHaveURL(/replayAfter=2026-01-03/);
  await expect(page).not.toHaveURL(/Tz=/);
  await expect(page.getByLabel("Before", { exact: true })).toHaveValue("");
  await expect(page.locator(".replay-event").first()).toContainText("Timeline event 120");
  await page.keyboard.press("Escape");
  const matches = page.waitForRequest(bound("/matches", "afterTz", "540"));
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("Timeline event 15");
  await matches;
  // Events 150 to 159 fall on 3 January in Tokyo; event 15 falls on 2 January.
  await expect(page.locator(".replay-match-count")).toHaveText("10 matches");
}, { timezoneId: "Asia/Tokyo" });
