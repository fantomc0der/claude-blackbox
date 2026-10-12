import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./harness";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

const heroRow = (page: Page) => page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) });
const outline = (locator: Locator) => locator.evaluate(element => {
  const style = getComputedStyle(element);
  return { width: style.outlineWidth, style: style.outlineStyle, offset: style.outlineOffset, color: style.outlineColor, accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() };
});

test("Enter on a recording moves focus to its heading while a click leaves it on the row", async ({ page }) => {
  await page.goto("/?q=effortless");
  const row = heroRow(page);
  const heading = page.getByRole("heading", { level: 2, name: DEMO_HERO_TITLE });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
  expect(await heading.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  expect((await outline(heading)).width).toBe("2px");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close replay" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(heading).toHaveCount(0);
  await expect(row).toBeFocused();
  await row.click();
  await expect(heading).toBeVisible();
  await expect(row).toBeFocused();
  // In the split library, moving to another row and pressing Enter swaps the replay and focuses its heading.
  await page.goto("/");
  await page.getByRole("button", { name: /Make conversation search feel instant/ }).click();
  await heroRow(page).focus();
  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
});

test("Enter still reaches the heading when a narrow layout hides the recording list behind the replay", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto("/?q=effortless");
  const row = heroRow(page);
  const heading = page.getByRole("heading", { level: 2, name: DEMO_HERO_TITLE });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
  await expect(page.locator(".library")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Close replay" })).toBeFocused();
  // Focus already moved elsewhere before the recording loaded stays where the reader put it.
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.route("**/api/sessions/*", async route => { await new Promise(resolve => setTimeout(resolve, 600)); await route.continue(); });
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close replay" }).focus();
  await expect(heading).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("button", { name: "Close replay" })).toBeFocused();
});

test("document title names the current view and restores on close", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("claude-blackbox — Your session flight recorder");
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("effortless");
  await expect(page).toHaveTitle("Search: effortless · claude-blackbox");
  await heroRow(page).click();
  await expect(page).toHaveTitle(`${DEMO_HERO_TITLE} · claude-blackbox`);
  await page.getByRole("button", { name: "Close replay" }).click();
  await expect(page).toHaveTitle("Search: effortless · claude-blackbox");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page).toHaveTitle("claude-blackbox — Your session flight recorder");
  const workspace = page.locator(".workspace-nav-item").first();
  const name = (await workspace.locator("span").first().textContent())!.trim();
  await workspace.click();
  await expect(page).toHaveTitle(`${name} · claude-blackbox`);
  await page.goto("/?bookmarked=1");
  await expect(page).toHaveTitle("Bookmarked · claude-blackbox");
});

test("recording rows state errors and file changes in text, not only in the symbol's tint", async ({ page }) => {
  await page.goto("/");
  const row = heroRow(page);
  await expect(row).toHaveAccessibleName(new RegExp(`^${DEMO_HERO_TITLE}\\s*, file changes, 1 error `));
  const symbol = row.locator(".session-symbol");
  await expect(symbol).toHaveAttribute("title", "File changes · 1 error");
  // The error state also adds a corner mark, so it reads without relying on hue.
  expect(await symbol.evaluate(element => getComputedStyle(element, "::after").content)).not.toBe("none");
  const clean = page.locator(".session-row").filter({ hasNot: page.locator(".session-symbol.has-error") }).first();
  await expect(clean).not.toHaveAccessibleName(/\berrors?\b/);
  expect(await clean.locator(".session-symbol").evaluate(element => getComputedStyle(element, "::after").content)).toBe("none");
  // The hidden row text stays inside the recordings scroller rather than stretching the document on a short viewport.
  await page.setViewportSize({ width: 1440, height: 360 });
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight)).toBe(0);
});

test("search and find fields draw a 2px accent perimeter in both themes", async ({ page, context }) => {
  const expectPerimeter = async (locator: Locator) => {
    const focus = await outline(locator);
    expect(focus.width).toBe("2px");
    expect(focus.style).toBe("solid");
    expect(focus.offset).toBe("-1px");
    const accent = await page.evaluate(value => { const probe = document.createElement("div"); probe.style.color = value; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }, focus.accent);
    expect(focus.color).toBe(accent);
  };
  for (const theme of ["dark", "light"]) {
    await context.addInitScript(value => { try { localStorage.setItem("blackbox:theme", value); } catch {} }, theme);
    await page.goto("/");
    await page.getByRole("textbox", { name: "Search all recordings" }).focus();
    await expectPerimeter(page.locator(".search-box"));
    await heroRow(page).click();
    const find = page.getByRole("textbox", { name: "Find in this recording" });
    await find.focus();
    expect(await find.evaluate(element => element.matches(":focus-visible"))).toBe(true);
    await expectPerimeter(find);
  }
});

test("a skip link reaches the transcript while a replay is open", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Skip to transcript" })).toHaveCount(0);
  await heroRow(page).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  const url = page.url();
  await page.goto(url);
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to transcript" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".replay-scroll")).toBeFocused();
  expect(page.url()).toBe(url);
});
