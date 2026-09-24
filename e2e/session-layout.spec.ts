import { expect, test } from "./harness";
import { installSessionLayoutFixture } from "./session-layout-fixture";

type Box = { x: number; y: number; width: number; height: number };

const within = (outer: Box, inner: Box) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;

test("mixed recording rows keep shared tracks, visible bookmarks, and bounded responsive content", async ({ page }) => {
  await installSessionLayoutFixture(page);
  await page.goto("/");
  const rows = page.locator(".session-row");
  await expect(rows).toHaveCount(5);

  for (const width of [1440, 1920, 3440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await rows.evaluateAll(nodes => nodes.map(row => {
      const box = (selector: string) => { const element = selector === ":scope" ? row : row.querySelector<HTMLElement>(selector)!; const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
      const counts = Array.from(row.querySelectorAll(".session-activity > span")).map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
      return { row: box(":scope"), main: box(".session-main"), model: box(".session-model"), activity: box(".session-activity"), trailing: box(".session-trailing"), time: box(".session-time"), counts, overflow: row.scrollWidth > row.clientWidth + 1 };
    }));
    expect(geometry.every(entry => !entry.overflow)).toBe(true);
    for (const key of ["main", "model", "activity", "trailing"] as const) expect(new Set(geometry.map(entry => Math.round(entry[key].x))).size).toBe(1);
    expect(new Set(geometry.map(entry => Math.round(entry.counts[0].x))).size).toBe(1);
    expect(new Set(geometry.map(entry => Math.round(entry.counts[1].x))).size).toBe(1);
    expect(geometry.every(entry => entry.counts[0].x + entry.counts[0].width <= entry.counts[1].x + 1)).toBe(true);
    expect(geometry.every(entry => entry.activity.x + entry.activity.width <= entry.trailing.x)).toBe(true);
    expect(new Set(geometry.map(entry => Math.round(entry.time.y - entry.row.y))).size).toBe(1);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const bookmark = rows.first().locator(".session-title svg");
  const bookmarkBox = await bookmark.boundingBox();
  const mainBox = await rows.first().locator(".session-main").boundingBox();
  const title = rows.first().locator(".session-title-text");
  expect(bookmarkBox && mainBox && within(mainBox, bookmarkBox)).toBe(true);
  expect(await title.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(true);
  expect(await title.evaluate(element => getComputedStyle(element).textOverflow)).toBe("ellipsis");

  await page.getByLabel("Text size").selectOption("larger");
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await rows.evaluateAll(nodes => nodes.every(row => row.scrollWidth <= row.clientWidth + 1))).toBe(true);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await rows.evaluateAll(nodes => nodes.every(row => row.scrollWidth <= row.clientWidth + 1 && row.getClientRects().length > 0))).toBe(true);
    expect(await rows.first().locator(".session-title-text").evaluate(element => { const style = getComputedStyle(element); return style.overflow === "hidden" && Number(style.webkitLineClamp) === 2; })).toBe(true);
    expect(await bookmark.isVisible()).toBe(true);
  }
});

test("mixed rows stay bounded in the replay split pane", async ({ page }) => {
  await installSessionLayoutFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".session-row").first().click();
  await expect(page.locator(".replay-panel")).toBeVisible();
  const splitRows = page.locator(".library-split .session-row");
  for (const size of ["standard", "larger"]) {
    await page.getByLabel("Text size").selectOption(size);
    for (const width of [2048, 1600, 1599, 1440, 1024, 920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(splitRows).toHaveCount(5);
      await expect(splitRows.first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const geometry = await splitRows.evaluateAll(nodes => nodes.map(row => {
        const rect = (element: Element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, visible: getComputedStyle(element).display !== "none" && box.width > 0 && box.height > 0 }; };
        const usage = row.querySelector(".session-usage");
        return { row: rect(row), main: rect(row.querySelector(".session-main")!), model: rect(row.querySelector(".session-model")!), usage: usage ? rect(usage) : null, overflowX: row.scrollWidth > row.clientWidth + 1, overflowY: row.scrollHeight > row.clientHeight + 1 };
      }));
      expect(geometry.every(entry => !entry.overflowX && !entry.overflowY && entry.main.visible && entry.main.width >= 80 && entry.model.visible && within(entry.row, entry.main) && within(entry.row, entry.model))).toBe(true);
      expect(geometry.filter(entry => entry.usage).every(entry => entry.usage!.visible && within(entry.row, entry.usage!))).toBe(true);
      expect(geometry.filter(entry => !entry.usage).length).toBe(1);
      expect(geometry.every(entry => entry.model.y > entry.main.y + 18)).toBe(true);
    }
  }
  await expect(splitRows.first().locator(".model-dot")).toBeHidden();
});

test("neighboring selections preserve split layout choices and row containment", async ({ page }) => {
  await installSessionLayoutFixture(page);
  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto("/");
  const rows = page.locator(".session-row");
  await rows.first().click();
  await page.getByRole("button", { name: "Hide overview" }).click();
  const overview = page.getByRole("complementary", { name: "Recording overview" });
  await expect(overview).toBeHidden();

  for (const index of [1, 0]) {
    const splitRows = page.locator(".library-split .session-row");
    await splitRows.nth(index).click();
    await expect(splitRows.nth(index)).toHaveAttribute("aria-current", "true");
    await expect(overview).toBeHidden();
    await expect(page.getByRole("button", { name: "Show overview" })).toBeVisible();
    expect(await splitRows.evaluateAll(nodes => nodes.every(row => {
      const bounds = row.getBoundingClientRect();
      const model = row.querySelector(".session-model")!.getBoundingClientRect();
      return row.scrollHeight <= row.clientHeight + 1 && model.top >= bounds.top - 1 && model.bottom <= bounds.bottom + 1;
    }))).toBe(true);
  }
});
