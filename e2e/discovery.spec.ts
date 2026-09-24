import { expect, test } from "./harness";

test("archive filters expose the usage contract and reset cleanly", async ({ page }) => {
  await page.goto("/?after=2026-09-01&before=2026-09-22&minTokens=12&pricing=partial&agents=only");
  await page.locator(".filter-popover > summary").click();
  await expect(page.getByLabel("Last activity (UTC dates)")).toBeVisible();
  await expect(page.getByLabel("Effort")).toBeVisible();
  await expect(page.getByLabel("Pricing")).toHaveValue("partial");
  await expect(page.getByText("Usage & record ranges", { exact: true })).toBeVisible();
  await page.getByText("Usage & record ranges", { exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "From" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Reset all filters" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("recording sort options include cost, tokens, errors, tools, and span", async ({ page }) => {
  await page.goto("/");
  const sort = page.getByLabel("Sort recordings");
  await expect(sort).toHaveValue("recent");
  for (const value of ["cost", "cost-asc", "tokens", "tokens-asc", "errors", "tools", "duration", "title"]) {
    await sort.selectOption(value);
    await expect(sort).toHaveValue(value);
  }
});

test("cost bounds expose empty recovery and preserve the chosen order", async ({ page }) => {
  await page.goto("/?sort=cost");
  await expect(page.locator(".session-row").first()).toBeVisible();
  await page.locator(".filter-popover > summary").click();
  await page.getByText("Usage & record ranges", { exact: true }).click();
  const maximum = page.getByRole("spinbutton", { name: "Maximum estimated cost (USD)" });
  await maximum.fill("0");
  await maximum.press("Tab");
  await expect(page).toHaveURL(/maxCost=0/);
  await page.getByRole("button", { name: "Reset all filters" }).click();
  await expect(page).not.toHaveURL(/maxCost/);
  await expect(page.getByLabel("Sort recordings")).toHaveValue("cost");
  await page.keyboard.press("Escape");
  await expect(page.locator(".session-row").first()).toBeVisible();
});

test("usage sorting and model effort drilldown retain truthful selected scope", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".session-row").first()).toBeVisible();
  await page.getByLabel("Usage and estimated cost").click();
  await page.getByLabel("Sort usage breakdown").selectOption("name");
  await page.getByRole("button", { name: "Model & effort", exact: true }).click();
  await expect(page.getByLabel("Sort usage breakdown")).toHaveValue("name");
  const firstModel = page.getByRole("button", { name: /^Show recordings using/ }).first();
  await firstModel.click();
  await expect(page).toHaveURL(/model=/);
  await expect(page).toHaveURL(/effort=/);
  const model = new URL(page.url()).searchParams.get("model")!;
  await page.locator(".filter-popover > summary").click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(model);
  await expect(page.getByLabel("Effort", { exact: true })).not.toHaveValue("");
});

test("last activity presets replace custom dates and mobile navigation includes select controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?after=2026-01-01&before=2026-01-02");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page.getByRole("button", { name: "Last 7 days", exact: true }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page).not.toHaveURL(/after=|before=/);
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await expect(page.locator(".sidebar-mobile-close")).toBeFocused();
  const sort = page.getByLabel("Sort workspaces");
  await sort.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Filter workspaces", exact: true })).toBeFocused();
});
