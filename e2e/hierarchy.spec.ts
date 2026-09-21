import { expect, test } from "./harness";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

test("recordings lead the library on short screens in both themes", async ({ page }) => {
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: theme, exact: true }).click();
    for (const [width, height] of [[1280, 720], [390, 844], [320, 640]]) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const first = page.locator(".session-row").first();
      await expect(first).toBeVisible();
      const bounds = await first.boundingBox();
      expect(bounds!.y).toBeLessThan(width === 320 ? 400 : 350);
      expect(await page.locator(".recordings-scroll").evaluate(element => element.clientHeight)).toBeGreaterThan(200);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByLabel("Archive totals")).toBeVisible();
      await page.getByRole("textbox", { name: "Search all recordings" }).fill("authentication");
      await expect(page.getByLabel("Archive totals")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Session library", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(page.getByLabel("Archive totals")).toBeVisible();
    }
  }
});

test("wide libraries keep chronological rows and predictable keyboard movement", async ({ page }) => {
  for (const width of [1440, 1920, 3440]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto("/");
    const rows = page.locator(".session-row");
    await expect(rows.first()).toBeVisible();
    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height - 1);
    expect(second!.x).toBe(first!.x);
    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toBeFocused();
  }
});

test("replay shows directory transitions without losing per-event provenance", async ({ page }) => {
  await page.goto("/?q=Workspace%20transitions%20verification");
  await page.getByRole("button", { name: /Workspace transitions verification/ }).click();
  const directories = page.locator(".replay-event-header > code");
  const expected = ["/synthetic/browser-tests", "/synthetic/browser-tests-worktree", "/synthetic/browser-tests"];
  await expect(directories).toHaveText(expected);
  const repeated = page.locator(".replay-event").nth(1);
  await expect(repeated.locator(".replay-event-header > code")).toHaveCount(0);
  await repeated.locator(".replay-raw > summary").click();
  await expect(repeated.locator(".replay-raw pre")).toContainText('"cwd": "/synthetic/browser-tests"');
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await expect(directories).toHaveText(expected);
  await page.locator(".replay-find input").fill("Still in the worktree");
  await expect(directories).toHaveText(["/synthetic/browser-tests-worktree"]);
  await page.locator(".replay-find input").fill("");
  await expect(directories).toHaveText(expected);
});

test("replay utilities stay readable without claiming primary-action emphasis", async ({ page }) => {
  for (const theme of ["Dark", "Light"]) {
    await page.goto("/");
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
    const resume = page.getByRole("button", { name: "Copy resume command", exact: true });
    await expect(resume).toHaveClass(/secondary-button/);
    await expect(resume).not.toHaveClass(/primary-button/);
    const summary = page.locator(".replay-raw > summary").first();
    await expect(summary).toHaveCSS("color", await page.locator(".replay-footer").evaluate(element => getComputedStyle(element).color));
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".replay-raw").first()).toHaveAttribute("open", "");
  }
});

test("reading controls align and mobile navigation has generous hit areas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) {
      const open = page.getByRole("button", { name: "Open workspace navigation" });
      const bounds = await open.boundingBox();
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await open.click();
      const close = await page.getByRole("complementary", { name: "Workspace navigation" }).getByRole("button", { name: "Close navigation" }).boundingBox();
      expect(close!.width).toBeGreaterThanOrEqual(44);
      expect(close!.height).toBeGreaterThanOrEqual(44);
    }
    const labels = await page.locator(".sidebar-select > span").evaluateAll(elements => elements.map(element => ({ height: element.getBoundingClientRect().height, line: parseFloat(getComputedStyle(element).lineHeight) })));
    for (const label of labels) expect(label.height).toBeLessThanOrEqual(label.line + 1);
    const [size, reading] = await page.locator(".sidebar-select select").evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })));
    expect(size!.x).toBe(reading!.x);
    expect(size!.width).toBe(reading!.width);
    expect(reading!.width).toBeGreaterThanOrEqual(150);
  }
});
