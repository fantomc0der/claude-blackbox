import { expect, test } from "./harness";
import { recorder } from "./server";
import { compact, pricingGap, tokenCount, usageCost } from "../src/client/lib/format";
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
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "Usage breakdown" });
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

test("usage totals keep hidden subagents, state their share and match the sidebar", async ({ page }) => {
  const hidden = recorder.list(new URLSearchParams());
  const shown = recorder.list(new URLSearchParams({ agents: "1" }));
  expect(hidden.hiddenAgents).toBeGreaterThan(0);
  expect(hidden.hiddenAgentUsage.costUSD).toBeGreaterThan(0);
  expect(hidden.usage).toEqual(shown.usage);
  await page.goto("/");
  const summary = page.getByLabel("Usage and estimated cost");
  await expect(summary).toContainText(usageCost(hidden.usage));
  await expect(summary.locator(".usage-total-cost")).toHaveAttribute("title", `Includes ${usageCost(hidden.hiddenAgentUsage)} est. from ${hidden.hiddenAgents} subagent recordings hidden from the list`);
  await summary.click();
  const scope = page.getByRole("region", { name: "Usage breakdown" }).locator(".usage-scope").first();
  await expect(scope).toContainText(`All ${hidden.total} matching recordings, across every page, plus ${hidden.hiddenAgents} subagent recordings hidden from the list. ${hidden.sessionsWithUsage} of ${hidden.total + hidden.hiddenAgents} report usage. This total includes ${usageCost(hidden.hiddenAgentUsage)} est. from ${hidden.hiddenAgents} subagent recordings hidden from the list. Each row shows only its own recording's cost, so the visible rows add up to less.`);
  await page.locator(".library").getByRole("button", { name: "Show subagents", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("agents")).toBe("1");
  await expect(summary).toContainText(usageCost(shown.usage));
  await expect(scope).toContainText(`All ${shown.total} matching recordings, across every page. ${shown.sessionsWithUsage} report usage.`);
  await expect(scope).not.toContainText("hidden from the list");
  await expect(summary.locator(".usage-total-cost")).not.toHaveAttribute("title", /./);
  const catalog = await recorder.catalog();
  const worktree = catalog.workspaces.find(workspace => workspace.name === "delegated-worktree")!;
  expect(worktree.usage).toEqual(recorder.list(new URLSearchParams({ workspace: worktree.id })).usage);
  await page.goto(`/?workspace=${encodeURIComponent(worktree.id)}`);
  await expect(page.locator(".breadcrumbs")).toContainText("delegated-worktree");
  await expect(summary).toContainText(usageCost(worktree.usage));
  await expect(page.locator(".session-row")).toHaveCount(0);
  await summary.click();
  await expect(scope).toContainText(`All 0 matching recordings, across every page, plus ${worktree.count} subagent recordings hidden from the list. ${worktree.count} of ${worktree.count} report usage.`);
  await page.locator(".library").getByRole("button", { name: "Show subagents", exact: true }).click();
  await expect(page.locator(".session-row")).toHaveCount(worktree.count);
  await expect(summary).toContainText(usageCost(worktree.usage));
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
  const usage = { ...listing.usage, costUSD: 0, unpricedRequests: listing.usage.requests, unratedRequests: listing.usage.requests };
  await page.route(/\/api\/sessions(?:\?|$)/, route => route.fulfill({ json: {
    ...listing, usage, modelUsage: [{ model: "future-claude-model-with-a-long-unfamiliar-identifier", effort: null, usage }],
  } }));
  await page.goto(`/?q=${encodeURIComponent(DEMO_HERO_TITLE)}`);
  await page.getByLabel("Usage and estimated cost").click();
  const matrix = page.locator(".usage-matrix");
  await expect(matrix).toContainText("Not recorded");
  await expect(matrix.locator("tbody")).toContainText("Unavailable");
  await expect(matrix.locator("tbody")).toContainText("Model not recognized");
  await expect(matrix).not.toContainText("$0.00");
  await expect(page.locator(".usage-body")).toContainText("Cost is incomplete");
  await expect(page.locator(".usage-body")).toContainText("this version of Claude Blackbox has no rates for yet: future-claude-model-with-a-long-unfamiliar-identifier.");
  await expect(page.locator(".usage-summary .usage-unrated")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await matrix.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("the usage note states why requests on another service tier or with a fallback credit have no estimate", async ({ page }) => {
  const listing = recorder.list(new URLSearchParams({ q: DEMO_HERO_TITLE }));
  const usage = { ...listing.usage, requests: listing.usage.requests + 3, unpricedRequests: 3, unratedRequests: 0, unratedIterationRequests: 0, unnamedRequests: 0, fastRequests: 0, tierRequests: 2, creditRequests: 1 };
  await page.route(/\/api\/sessions(?:\?|$)/, route => route.fulfill({ json: { ...listing, usage } }));
  await page.goto(`/?q=${encodeURIComponent(DEMO_HERO_TITLE)}`);
  const summary = page.getByLabel("Usage and estimated cost");
  await expect(summary).toContainText(`${usageCost(usage)} est.`);
  await summary.click();
  const note = page.locator(".usage-note p.usage-warning");
  await expect(note).toHaveText(pricingGap(usage, []));
  await expect(note).toContainText("2 used a service tier other than standard, which this version of Claude Blackbox has no rates for. 1 presented a fallback credit, so the API decides what it is billed.");
});

test("model expense matrix stays accessible and fits narrow screens in both themes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.getByLabel("Usage and estimated cost").click();
    await page.getByRole("button", { name: "Model & effort", exact: true }).click();
    const footer = page.locator(".usage-matrix tfoot tr > *");
    await expect(footer).toHaveCount(3);
    const [effortHeading, tokens, cost] = await Promise.all([page.locator(".usage-matrix thead th").nth(1).boundingBox(), footer.nth(1).boundingBox(), footer.nth(2).boundingBox()]);
    expect(await footer.nth(1).evaluate(cell => getComputedStyle(cell).textAlign)).toBe("right");
    expect(tokens!.x).toBeGreaterThanOrEqual(effortHeading!.x + effortHeading!.width - 1);
    expect(tokens!.x + tokens!.width).toBeLessThanOrEqual(cost!.x + 1);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(page.locator(".usage-matrix")).toBeVisible();
      expect(await page.locator(".usage-matrix").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const audit = await new AxeBuilder({ page }).include(".usage-panel").include(".usage-body").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
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

test("the expanded breakdown scrolls with the recordings and leaves the list its full height", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const theme of ["Dark", "Light"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.setViewportSize({ width: 1100, height: 700 });
    for (const replay of [false, true]) {
      if (replay) {
        await page.locator(".session-row").first().click();
        await expect(page.locator(".library-split")).toBeVisible();
      }
      const list = page.locator(".recordings-scroll");
      const summary = page.getByLabel("Usage and estimated cost");
      const breakdown = page.getByRole("region", { name: "Usage breakdown" });
      await expect(summary).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#usage-breakdown")).toBeHidden();
      await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const closed = await list.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
      await summary.click();
      await expect(summary).toHaveAttribute("aria-expanded", "true");
      await expect(summary).toHaveAttribute("aria-controls", "usage-breakdown");
      await expect(page.locator(".recordings-scroll > #usage-breakdown")).toBeVisible();
      // The breakdown is the list's first item, so opening it returns the list to the top.
      expect(await list.evaluate(element => element.scrollTop)).toBe(0);
      const opened = await list.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
      const size = (await breakdown.boundingBox())!;
      expect(opened.height).toBe(closed.height);
      expect(opened.content).toBeGreaterThanOrEqual(closed.content + size.height);
      expect(await breakdown.evaluate(element => getComputedStyle(element).overflowY === "visible" && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await breakdown.getByRole("button", { name: "Model & effort", exact: true }).click();
      const header = breakdown.locator(".usage-matrix thead th").first();
      // In the narrow split library the header starts below the fold; scrolling the list brings it fully into view.
      await header.scrollIntoViewIfNeeded();
      const listBox = (await list.boundingBox())!;
      const listTop = listBox.y;
      const headerBox = (await header.boundingBox())!;
      expect(headerBox.y).toBeGreaterThanOrEqual(listTop);
      expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
      expect(await header.evaluate(cell => { const box = cell.getBoundingClientRect(); return cell.contains(document.elementFromPoint(box.left + 4, box.top + box.height / 2)); })).toBe(true);
      await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const scrolled = (await breakdown.boundingBox())!;
      expect(scrolled.y + scrolled.height).toBeLessThanOrEqual(listTop);
      await expect(page.locator(".session-row").last()).toBeInViewport();
      await breakdown.getByRole("button", { name: "Folders", exact: true }).click();
      await summary.click();
      await expect(summary).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#usage-breakdown")).toBeHidden();
      expect(await list.evaluate(element => element.scrollHeight)).toBe(closed.content);
    }
  }
});
