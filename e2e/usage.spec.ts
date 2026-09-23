import { expect, test } from "./harness";
import { recorder } from "./server";
import { compact, tokenCount, usageCost } from "../src/client/lib/format";
import { DEMO_HERO_TITLE } from "../tests/fixtures";
import AxeBuilder from "@axe-core/playwright";

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
  await page.getByRole("button", { name: "Model & effort", exact: true }).click();
  await expect(panel.locator(".usage-matrix tfoot")).toContainText(usageCost(listing.usage));
  await page.getByRole("button", { name: "Next recordings" }).click();
  await expect(summary).toContainText(usageCost(listing.usage));
  await expect(summary).toContainText(compact(listing.usage.totalTokens));
  await expect(panel.locator(".usage-matrix tfoot")).toContainText(usageCost(listing.usage));
});

test("group expense matrix switches between folders and per-request model effort totals", async ({ page }) => {
  const catalog = await recorder.catalog();
  const paths = ["atlas-api", "blackbox"].map(name => catalog.workspaces.find(workspace => workspace.name === name)!.paths[0]);
  const group = recorder.saveGroup({ name: "Model expense verification", paths });
  try {
    const listing = recorder.list(new URLSearchParams({ workspace: group.id }));
    await page.goto(`/?workspace=${group.id}`);
    await page.getByLabel("Usage and estimated cost").click();
    const toggle = page.getByRole("button", { name: "Model & effort", exact: true });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const matrix = page.getByRole("table", { name: "By model & effort", exact: true });
    await expect(matrix.locator("tbody tr")).toHaveCount(listing.modelUsage.length);
    await expect(matrix.getByRole("cell", { name: "High", exact: true })).toBeVisible();
    await expect(matrix.getByRole("cell", { name: "Low", exact: true })).toBeVisible();
    await expect(matrix.getByRole("cell", { name: "Not recorded", exact: true })).toBeVisible();
    await expect(matrix.locator("tfoot")).toContainText(usageCost(listing.usage));
    await expect(matrix.locator("tfoot")).toContainText(compact(listing.usage.totalTokens));
    await page.getByRole("button", { name: "Folders", exact: true }).click();
    await expect(matrix).toHaveCount(0);
    await page.locator(".usage-directories").getByRole("button", { name: paths[0], exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("cwd")).toBe(paths[0]);
    const folder = recorder.list(new URLSearchParams({ workspace: group.id, cwd: paths[0] }));
    await expect(page.locator(".usage-matrix tfoot")).toContainText(usageCost(folder.usage));
    await expect(page.getByRole("group", { name: "Expense breakdown" })).toHaveCount(0);
  } finally { recorder.deleteGroup(group.id); }
});

test("model matrix preserves unknown prices and missing effort instead of presenting them as free", async ({ page }) => {
  const listing = recorder.list(new URLSearchParams({ q: DEMO_HERO_TITLE }));
  const usage = { ...listing.usage, costUSD: 0, unpricedRequests: listing.usage.requests };
  await page.route(/\/api\/sessions(?:\?|$)/, route => route.fulfill({ json: {
    ...listing, usage, modelUsage: [{ model: "future-claude-model-with-a-long-unfamiliar-identifier", effort: null, usage }],
  } }));
  await page.goto(`/?q=${encodeURIComponent(DEMO_HERO_TITLE)}`);
  await page.getByLabel("Usage and estimated cost").click();
  const matrix = page.locator(".usage-matrix");
  await expect(matrix).toContainText("Not recorded");
  await expect(matrix.locator("tbody")).toContainText("Unavailable");
  await expect(matrix).not.toContainText("$0.00");
  await expect(page.locator(".usage-body")).toContainText("Cost is incomplete");
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await matrix.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("model expense matrix stays accessible and fits narrow screens in both themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.getByLabel("Usage and estimated cost").click();
    await page.getByRole("button", { name: "Model & effort", exact: true }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator(".usage-matrix")).toBeVisible();
      expect(await page.locator(".usage-matrix").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const audit = await new AxeBuilder({ page }).include(".usage-panel").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
  }
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
