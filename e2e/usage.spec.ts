import { expect, test } from "./harness";
import { recorder } from "./server";
import { compact, tokenCount, usageCost } from "../src/client/lib/format";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

test("usage totals cover every matching page and expose a keyboard accessible breakdown", async ({ page }) => {
  const listing = recorder.list(new URLSearchParams());
  await page.goto("/");
  const summary = page.getByLabel("Usage and estimated cost");
  await expect(summary).toContainText(usageCost(listing.usage));
  await expect(summary).toContainText(compact(listing.usage.totalTokens));
  await summary.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator(".usage-panel");
  await expect(panel.locator(".usage-scope").first()).toContainText(`All ${listing.total} matching recordings`);
  await expect(panel.locator(".token-breakdown")).toContainText(tokenCount(listing.usage.cacheReadTokens));
  await expect(panel).toContainText("not your Claude subscription bill");
  await page.getByRole("button", { name: "Next recordings" }).click();
  await expect(summary).toContainText(usageCost(listing.usage));
  await expect(summary).toContainText(compact(listing.usage.totalTokens));
});

test("workspace groups aggregate usage and folder drilldown narrows the same filters", async ({ page }) => {
  const catalog = await recorder.catalog();
  const paths = [catalog.workspaces.find(workspace => workspace.name === "orbit")!.paths[0], catalog.workspaces.find(workspace => workspace.name === "orbit-auth")!.paths[0]];
  const group = recorder.saveGroup({ name: "Usage verification group", paths });
  try {
    const listing = recorder.list(new URLSearchParams({ workspace: group.id }));
    await page.goto(`/?workspace=${group.id}`);
    await expect(page.getByLabel("Usage and estimated cost")).toContainText(usageCost(listing.usage));
    await page.getByLabel("Usage and estimated cost").click();
    await expect(page.locator(".usage-directories tbody tr")).toHaveCount(2);
    await page.locator(".usage-directories").getByRole("button", { name: paths[0], exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("cwd")).toBe(paths[0]);
    expect(new URL(page.url()).searchParams.get("workspace")).toBe(group.id);
    const folder = recorder.list(new URLSearchParams({ workspace: group.id, cwd: paths[0] }));
    await expect(page.getByLabel("Usage and estimated cost")).toContainText(usageCost(folder.usage));
    await expect(page.locator(".session-row")).toHaveCount(folder.total);
  } finally { recorder.deleteGroup(group.id); }
});

test("session replay shows its own tokens and cost with full cache details", async ({ page }) => {
  const session = recorder.list(new URLSearchParams({ q: DEMO_HERO_TITLE })).items[0];
  await page.goto(`/?session=${session.id}`);
  await expect(page.getByLabel("Session usage")).toContainText(usageCost(session.usage));
  await expect(page.getByLabel("Session usage")).toContainText(compact(session.usage.totalTokens));
  await page.locator(".session-details > summary").click();
  await expect(page.locator(".session-details-menu .token-breakdown")).toContainText(tokenCount(session.usage.inputTokens));
  await expect(page.locator(".session-details-menu")).toContainText("Cache write");
});

test("missing usage is distinct from a free recording or an empty filter", async ({ page }) => {
  await page.goto("/?q=Pagination%20fixture");
  await expect(page.getByLabel("Usage and estimated cost")).toContainText("No usage recorded");
  await page.getByLabel("Usage and estimated cost").click();
  await expect(page.locator(".usage-body")).toContainText("Missing usage is not counted as zero spend");
  await page.goto("/?q=no-recording-matches-this-usage-query");
  await expect(page.getByLabel("Usage and estimated cost")).toContainText("No matching recordings");
});

test("usage breakdown works on narrow screens in both themes without page overflow", async ({ page }) => {
  for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: theme === "dark" ? "Dark" : "Light", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Usage and estimated cost").click();
    await expect(page.locator(".usage-directories")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const folder = page.locator(".usage-directories button").first();
    await folder.click();
    await expect.poll(() => new URL(page.url()).searchParams.has("cwd")).toBe(true);
    await expect(page.locator(".session-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
