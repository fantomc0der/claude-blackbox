import { expect, test } from "./harness";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

test("replay counts describe the cards on screen and the records behind them", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  const counts = page.locator(".replay-find > span");
  const cards = page.locator(".replay-event");
  await expect(counts).toHaveText(/^\d+ shown · \d+\/\d+ records$/);
  const [shown, records, total] = (await counts.textContent())!.match(/\d+/g)!.map(Number);
  expect(shown).toBeLessThan(records);
  await expect(cards).toHaveCount(shown);
  await expect(page.locator(".replay-footer")).toContainText(`of ${records} records`);
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await expect(counts).toHaveText(/^\d+ records$/);
  const everything = Number((await counts.textContent())!.match(/\d+/)![0]);
  expect(everything).toBeGreaterThan(records);
  expect(everything).toBe(total);
  await expect(cards).toHaveCount(everything);
  await expect(page.locator(".replay-footer")).toContainText(`1–${everything} of ${everything} records`);
});

test("recorded tool results are labelled as results rather than user turns", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await page.getByRole("button", { name: "All events", exact: true }).click();
  const result = page.locator(".replay-event-tool-result").first();
  await expect(result).toBeVisible();
  await expect(result.locator(".replay-role")).toHaveText("Tool result");
  expect(await result.evaluate(card => getComputedStyle(card).borderLeftWidth)).toBe("1px");
  const failed = page.locator(".replay-event-tool-result.replay-event-error").first();
  await expect(failed.locator(".replay-role")).toHaveText("Tool result");
  await expect(failed.locator(".replay-error-label")).toHaveText("Error");
  await expect(page.locator(".replay-event-user.replay-event-tool-result")).toHaveCount(0);
});

test("the event outline names each tool once and previews its argument", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  const outline = page.locator(".replay-outline button");
  await expect(outline.first()).toBeVisible();
  const entries = await outline.evaluateAll(buttons => buttons.map(button => {
    const body = button.querySelector("span:last-child")!;
    const label = body.querySelector("small")!.textContent ?? "";
    return { label: label.trim(), text: body.textContent!.slice(label.length).trim() };
  }));
  expect(entries.length).toBeGreaterThan(2);
  expect(entries.filter(entry => !entry.text || entry.text === entry.label)).toEqual([]);
  expect(entries.filter(entry => entry.text.startsWith("#"))).toEqual([]);
  expect(entries.some(entry => entry.label === "Bash" && entry.text.includes("bun test auth"))).toBe(true);
});

test("search snippets read as recorded content, not indexed field names", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("retryBudget");
  await expect(page.locator(".session-row")).toHaveCount(1);
  const snippet = page.locator(".session-snippet");
  await expect(snippet).toContainText("retryBudget");
  const text = (await snippet.textContent())!.trim();
  expect(text.startsWith("type:")).toBe(false);
  expect(text).not.toContain("tool_use_id");
  await expect(page.locator(".result-count")).toHaveText("1 result");
});

test("the bookmarked view offers a way back when nothing is bookmarked", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const listing = await fetch("/api/sessions?bookmarked=1&limit=100").then(response => response.json());
    for (const session of listing.items) {
      await fetch(`/api/sessions/${session.id}/bookmark`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookmarked: false }) });
    }
  });
  await page.goto("/?bookmarked=1");
  await expect(page.getByRole("heading", { name: "No bookmarks yet." })).toBeVisible();
  await expect(page.getByText("Bookmark a session from its replay to keep it here.")).toBeVisible();
  await page.getByRole("button", { name: "Browse all sessions" }).click();
  await expect(page.locator(".session-row")).toHaveCount(50);
  expect(page.url()).not.toContain("bookmarked");
});
