import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./harness";
import { copyCommand, copyReadPath } from "./server";

async function openCopyRecording(page: Page, view = "") {
  const listing = await (await page.request.get("/api/sessions?q=Hazelbrook")).json();
  expect(listing.items.map((session: { title: string }) => session.title)).toEqual(["Hazelbrook copy verification"]);
  await page.goto(`/?session=${listing.items[0].id}${view ? `&${view}` : ""}`);
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
}
// The call card whose summary names the tool, as "Read"; a tool called twice needs a narrower filter.
const card = (page: Page, tool: string) => page.locator(".tool-card").filter({ has: page.locator(".tool-summary").getByText(tool, { exact: true }) });
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText()).then(text => text.replace(/\r\n/g, "\n"));

test("a tool row copies its path or command whole without opening the call", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCopyRecording(page);
  const read = card(page, "Read");
  const summary = read.locator(".tool-summary");
  const copy = read.getByRole("button", { name: "Copy path", exact: true });
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(copy).toHaveAccessibleDescription(copyReadPath);
  await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
  const box = (await read.boundingBox())!;
  await copy.click();
  await expect(read.locator(".tool-head [role='status']")).toHaveText("Path copied");
  expect(await clipboard(page)).toBe(copyReadPath);
  await expect(copy).toHaveAttribute("data-state", "copied");
  await expect(copy).toHaveAccessibleName("Copy path");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(read.locator(".tool-content")).toHaveCount(0);
  expect(await read.boundingBox()).toEqual(box);
  // The row still shows the complete path on hover; nothing sits over the preview.
  await expect(read.locator(".tool-preview")).toHaveAttribute("title", copyReadPath);
  expect(await read.locator(".tool-preview").evaluate(preview => {
    const rect = preview.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest(".tool-preview") === preview;
  })).toBe(true);

  // A multi-line command copies with its line structure, without the escape codes the recording carried.
  const bash = page.locator(".tool-card:not(.tool-card-error)").filter({ hasText: "bun run build" });
  await expect(bash.locator(".tool-preview")).toHaveText("bun run build && bun test tests \\ --timeout 30000 # quiet");
  await bash.getByRole("button", { name: "Copy command", exact: true }).click();
  await expect(bash.locator(".tool-head [role='status']")).toHaveText("Command copied");
  expect(await clipboard(page)).toBe(copyCommand);

  // Every argument kind is named for what it copies; a delegated task's description is not one.
  await expect(card(page, "Write").getByRole("button", { name: "Copy path", exact: true })).toHaveCount(1);
  await expect(card(page, "NotebookEdit").getByRole("button", { name: "Copy path", exact: true })).toHaveCount(1);
  await expect(card(page, "NotebookEdit").locator(".tool-preview")).toHaveText("/synthetic/copy/analysis.ipynb");
  await expect(card(page, "Grep").getByRole("button", { name: "Copy path", exact: true })).toHaveCount(1);
  await expect(card(page, "WebSearch").getByRole("button", { name: "Copy query", exact: true })).toHaveCount(1);
  await expect(card(page, "Agent").locator(".tool-copy")).toHaveCount(0);
  await expect(card(page, "Agent").locator(".tool-summary")).toHaveAttribute("aria-expanded", "true");

  // The disclosure glyph beside the copy button and the empty end of the row still open the call.
  await read.locator(".tool-disclosure").click();
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await expect(read.locator(".tool-content")).toHaveCount(1);
  await expect(copy).toBeVisible();
  const head = (await read.locator(".tool-head").boundingBox())!;
  await page.mouse.click(head.x + head.width - 3, head.y + head.height / 2);
  await expect(summary).toHaveAttribute("aria-expanded", "false");

  // Keyboard: the copy button follows the summary in the Tab order and copies on Enter.
  await summary.focus();
  await page.keyboard.press("Tab");
  await expect(copy).toBeFocused();
  await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
  await page.keyboard.press("Enter");
  await expect(copy).toHaveAttribute("data-state", "copied");
  expect(await clipboard(page)).toBe(copyReadPath);
  await expect(summary).toHaveAttribute("aria-expanded", "false");

  const audit = await new AxeBuilder({ page }).include(".tool-card").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
});

test("a result shown apart from its call copies the command that failed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCopyRecording(page, "replayKind=all&replayErrors=1");
  const result = page.locator(".tool-result.tool-card-error");
  await expect(result).toHaveCount(1);
  await expect(result.locator(".tool-result-call .tool-preview")).toHaveText("bun test tests/flaky.test.ts");
  await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
  await result.getByRole("button", { name: "Copy command", exact: true }).click();
  await expect(result.locator(".tool-head [role='status']")).toHaveText("Command copied");
  expect(await clipboard(page)).toBe("bun test tests/flaky.test.ts");
});

test("a refused clipboard is reported in place and leaves the call closed", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Clipboard blocked")) } });
  });
  await openCopyRecording(page);
  const read = card(page, "Read");
  const copy = read.getByRole("button", { name: "Copy path", exact: true });
  await copy.click();
  await expect(read.locator(".tool-head [role='status']")).toHaveText("Copy failed");
  await expect(copy).toHaveAttribute("data-state", "failed");
  await expect(copy).toHaveAccessibleName("Copy path");
  await expect(read.locator(".tool-summary")).toHaveAttribute("aria-expanded", "false");
});

test("phones keep the file name visible and give the copy button a 44px target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCopyRecording(page);
  const read = card(page, "Read");
  const copy = read.locator(".tool-copy");
  await expect(read.locator(".tool-preview-name")).toHaveText("register.test.ts");
  expect(await read.locator(".tool-preview-name").evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width <= element.getBoundingClientRect().width + .01;
  })).toBe(true);
  expect((await read.locator(".tool-head").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const box = (await copy.boundingBox())!;
  expect([box.width, box.height]).toEqual([32, 32]);
  // The hit area reaches 6px past the icon button on every side.
  for (const [x, y] of [[box.x - 4, box.y + box.height / 2], [box.x + box.width + 4, box.y + box.height / 2], [box.x + box.width / 2, box.y - 4], [box.x + box.width / 2, box.y + box.height + 4]]) {
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest(".tool-copy") !== null, [x, y])).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
