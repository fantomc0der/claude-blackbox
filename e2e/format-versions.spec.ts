import { expect, test } from "./harness";

// The fixture's records name Claude Code 2.1.296 and then 2.1.302, and its last record is of a type this build does not
// know. The demo recordings name 1.0.0, and each holds a system record of a subtype no Claude Code writes.
test("the library filters by Claude Code version and the index status counts unrecognized records", async ({ page }) => {
  const catalog = await (await page.request.get("/api/catalog")).json();
  expect(catalog.unrecognizedKinds).toEqual(expect.arrayContaining(["system:synthetic-demo-observation", "type:future-record"]));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const unrecognized = page.locator(".index-unrecognized");
  await expect(unrecognized).toBeVisible();
  await expect(unrecognized).toContainText(`${catalog.unrecognizedRecords} unrecognized records`);
  await expect(unrecognized).toHaveAttribute("title", /^\d+ unrecognized records\. Records of kinds this build does not recognize\. A newer Claude Code may have changed its recording format\. .*Raw event.* Kinds: .*type:future-record/);

  await page.locator(".filter-popover > summary").click();
  const versions = page.getByRole("combobox", { name: "Claude Code version" });
  await expect(versions.locator("option")).toHaveText(["Any version", "2.1.302", "2.1.296", "1.0.0"]);
  await versions.selectOption("2.1.296");
  await expect(page).toHaveURL(/[?&]version=2\.1\.296/);
  await expect(page.locator(".filter-chip")).toHaveText("Claude Code 2.1.296");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".session-row")).toContainText("Quillmere format verification");
  await page.keyboard.press("Escape");

  // A wide header names the last version the records name, and a narrow one leaves it to Session details; the
  // unrecognized record keeps its system card under All events.
  await page.locator(".session-row").click();
  const version = page.locator(".provenance-version");
  await expect(version).toHaveText("Claude Code 2.1.302");
  await expect(version).toHaveAttribute("title", /^The Claude Code version that wrote this recording/);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(version).toBeHidden();
  await page.locator(".session-details > summary").click();
  await expect(page.getByRole("region", { name: "Session details" }).locator("xpath=.//dt[normalize-space()='Claude Code version']/following-sibling::dd[1]")).toHaveText("2.1.302");
  await page.locator(".session-details > summary").click();
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await expect(page.locator(".replay-event")).toHaveCount(3);
  await expect(page.locator(".replay-event").last().locator(".replay-role")).toHaveText("system");
  await expect(page.locator(".replay-event").last()).toContainText("future-record record");

  await page.locator(".filter-chip").click();
  await expect(page).not.toHaveURL(/[?&]version=/);
  await expect(page.locator(".session-row").first()).toBeVisible();
  expect(await page.locator(".session-row").count()).toBeGreaterThan(1);
});
