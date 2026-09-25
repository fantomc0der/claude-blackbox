import { expect, test } from "./harness";
import { recorder } from "./server";
import { compact, usageCost } from "../src/client/lib/format";

test("usage keeps its layout focus scroll and values through background refreshes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const variant of [{ width: 1440, theme: "Dark" }, { width: 390, theme: "Light" }]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: variant.theme, exact: true }).click();
    await page.setViewportSize({ width: variant.width, height: 844 });
    const panel = page.locator(".usage-panel");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await page.getByLabel("Usage and estimated cost").click();
    for (const view of ["Folders", "Model & effort"]) {
      await panel.getByRole("button", { name: view, exact: true }).click();
      const table = panel.locator(view === "Folders" ? ".usage-directories" : ".usage-matrix");
      const button = table.locator("tbody button").first();
      await button.focus();
      const focused = await button.elementHandle();
      const body = panel.locator(".usage-body");
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const beforeScroll = await body.evaluate(element => element.scrollTop);
      const beforeHeight = (await panel.boundingBox())!.height;
      const beforeControls = (await page.locator(".discovery-controls").boundingBox())!.y;
      const listing = recorder.list(new URLSearchParams());
      let updates = 0;
      await page.route("**/api/sessions?*", async route => {
        const data = structuredClone(listing);
        data.usage.totalTokens += ++updates * 1_000_000;
        await Bun.sleep(300);
        await route.fulfill({ json: data });
      });
      for (let cycle = 0; cycle < 2; cycle++) {
        recorder.emit([]);
        await expect(panel).toHaveAttribute("aria-busy", "true");
        await expect(panel.locator(".usage-refresh")).toBeVisible();
        await expect(table).toBeVisible();
        await expect(panel.locator(".usage-total-cost")).toContainText(usageCost(listing.usage));
        expect((await panel.boundingBox())!.height).toBe(beforeHeight);
        expect((await page.locator(".discovery-controls").boundingBox())!.y).toBe(beforeControls);
        await expect(panel).toHaveAttribute("aria-busy", "false");
        expect(await focused!.evaluate(element => document.activeElement === element)).toBe(true);
        expect(await body.evaluate(element => element.scrollTop)).toBe(beforeScroll);
        await expect(panel.locator(".usage-total").first()).toContainText(compact(listing.usage.totalTokens + updates * 1_000_000));
        expect((await panel.boundingBox())!.height).toBe(beforeHeight);
      }
      await page.unroute("**/api/sessions?*");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("slow usage refreshes finish during sustained live changes without request cancellation", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator(".usage-panel");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  let completed = 0;
  let requests = 0;
  let aborted = 0;
  page.on("requestfailed", request => { if (request.url().includes("/api/sessions?")) aborted++; });
  const listing = recorder.list(new URLSearchParams());
  await page.route("**/api/sessions?*", async route => {
    requests++;
    await Bun.sleep(450);
    await route.fulfill({ json: listing });
    completed++;
  });
  for (let cycle = 0; cycle < 6; cycle++) {
    recorder.emit([]);
    await Bun.sleep(150);
  }
  expect(completed).toBeGreaterThan(0);
  await expect(panel).toHaveAttribute("aria-busy", "false");
  expect(requests).toBeLessThan(6);
  expect(aborted).toBe(0);
  await expect(panel.locator(".usage-total-cost")).toBeVisible();
});

test("a new filter never labels the previous selection's usage as current", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator(".usage-panel");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.route("**/api/sessions?*", async route => {
    await Bun.sleep(600);
    await route.continue();
  });
  await page.getByLabel("Search all recordings").fill("no-matching-usage-selection");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("no-matching-usage-selection");
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await expect(panel.locator(".usage-total-cost")).toHaveCount(0);
  await expect(panel).toContainText("No matching recordings");
});

test("failed background refreshes retain usage and can be retried", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator(".usage-panel");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  const previous = await panel.locator(".usage-total-cost").textContent();
  let fail = true;
  await page.route("**/api/sessions?*", route => fail
    ? route.fulfill({ status: 503, json: { error: "Test refresh unavailable" } })
    : route.continue());
  recorder.emit([]);
  await expect(page.getByRole("alert")).toContainText("Test refresh unavailable");
  await expect(panel.locator(".usage-total-cost")).toHaveText(previous!);
  await expect(panel).toHaveAttribute("aria-busy", "false");
  fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(panel).toHaveAttribute("aria-busy", "false");
});

test("pagination and sorting keep usage for the same selection mounted", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator(".usage-panel");
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByLabel("Usage and estimated cost").click();
  const table = await panel.locator("table").elementHandle();
  const cost = await panel.locator(".usage-total-cost").textContent();
  await page.route("**/api/sessions?*", async route => {
    await Bun.sleep(300);
    await route.continue();
  });
  await page.getByRole("button", { name: "Next recordings" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  expect(await table!.evaluate(element => element.isConnected)).toBe(true);
  await expect(panel.locator(".usage-total-cost")).toHaveText(cost!);
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await page.getByLabel("Sort recordings", { exact: true }).selectOption("tokens");
  await expect(panel).toHaveAttribute("aria-busy", "true");
  expect(await table!.evaluate(element => element.isConnected)).toBe(true);
  await expect(panel.locator(".usage-total-cost")).toHaveText(cost!);
  await expect(panel).toHaveAttribute("aria-busy", "false");
});
