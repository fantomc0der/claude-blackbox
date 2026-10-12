import { expect, test } from "./harness";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { appendFile } from "node:fs/promises";
import { DEMO_HERO_TITLE } from "../tests/fixtures";

test("full-record search finds tool output and survives URL reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("retryBudget");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".session-snippet")).toContainText("retryBudget");
  // A search hit keeps its folder and branch line beneath the snippet at every width, including the replay split.
  const searchRowContext = () => page.locator(".session-row").first().evaluate(row => {
    const snippet = row.querySelector(".session-snippet")!.getBoundingClientRect();
    const path = row.querySelector<HTMLElement>(".session-path")!;
    const bounds = path.getBoundingClientRect();
    return { below: bounds.top >= snippet.bottom - 1, visible: bounds.width > 0 && bounds.height > 0, inside: bounds.bottom <= row.getBoundingClientRect().bottom + 1, text: path.textContent };
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await searchRowContext()).toEqual({ below: true, visible: true, inside: true, text: expect.stringMatching(/\S/) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toHaveValue("retryBudget");
  await page.locator(".session-row").click();
  await expect(page.getByRole("region", { name: "Session replay" })).toContainText("retryBudget");
  await expect(page.locator(".library-split .session-snippet")).toBeVisible();
  expect(await searchRowContext()).toEqual({ below: true, visible: true, inside: true, text: expect.stringMatching(/\S/) });
  await page.getByRole("button", { name: "Close replay" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toBeFocused();
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("no-recording-has-this-phrase");
  await expect(page.getByText("No trails match this search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search & filters" }).click();
  await expect(page.locator(".session-row")).toHaveCount(50);
  expect(errors).toEqual([]);
});

test("structured tools, bookmarks, resume clipboard and JSONL export work", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?q=effortless");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.getByRole("heading", { name: DEMO_HERO_TITLE })).toBeVisible();
  await page.getByRole("button", { name: "Copy resume command" }).click();
  await expect(page.locator(".toast")).toContainText("Resume command copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("cd -- '/synthetic/workspaces/orbit-auth' && claude --resume");
  await expect(page.locator(".session-details > summary")).toHaveText("Session details", { useInnerText: true });
  await expect(page.locator(".session-details-menu")).toBeHidden();
  const bookmark = page.getByRole("button", { name: "Bookmark this recording", exact: true });
  await expect(bookmark).toHaveAttribute("aria-pressed", "false");
  await bookmark.click();
  await expect(bookmark).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".session-row.selected .session-title svg")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export recording" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^blackbox-.*\.jsonl$/);
  const tools = page.locator('.tool-summary[aria-expanded="false"]');
  while (await tools.count()) await tools.first().click();
  await expect(page.locator(".tool-diff-added").first()).toBeVisible();
  await expect(page.locator(".tool-terminal").first()).toBeVisible();
  await expect(page.locator(".tool-checklist")).toBeVisible();
  await page.getByRole("button", { name: "Close replay" }).click();
  await page.getByRole("button", { name: /^Bookmarked/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(1);
});

test("secondary session actions adapt to pane width while the bookmark toggle stays beside the title", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?q=effortless");
  await page.locator(".session-row").click();
  const bookmark = page.getByRole("button", { name: "Bookmark this recording", exact: true });
  const title = page.locator(".replay-panel-heading h2");
  const exportRecording = page.getByRole("link", { name: "Export recording" });
  const pressed = async () => (await bookmark.getAttribute("aria-pressed")) === "true";
  // Beside the title and outside its two-line clamp, never inside the actions row or menu.
  const besideTitle = () => bookmark.evaluate(button => {
    const heading = button.parentElement!.querySelector("h2")!;
    return button.parentElement!.classList.contains("replay-title-line") && !heading.contains(button) && !button.closest(".replay-actions") && button.getBoundingClientRect().left >= heading.getBoundingClientRect().right - 1;
  });
  await expect(bookmark).toBeVisible();
  expect(await besideTitle()).toBe(true);
  await expect(exportRecording).toBeVisible();
  await page.locator(".session-details > summary").click();
  await expect(page.getByRole("heading", { name: "Session details", exact: true })).toBeVisible();
  await expect(page.locator(".session-details-menu").getByRole("button", { name: /bookmark/i })).toHaveCount(0);
  await expect(exportRecording).toHaveCount(1);
  await page.locator(".session-details > summary").press("Escape");

  // The pressed state belongs to the recording, so collapsing and restoring the library leaves it alone.
  const initial = await pressed();
  await bookmark.click();
  await expect(bookmark).toHaveAttribute("aria-pressed", String(!initial));
  await page.getByRole("button", { name: "Hide library" }).click();
  await expect(bookmark).toHaveAttribute("aria-pressed", String(!initial));
  expect(await besideTitle()).toBe(true);
  await page.getByRole("button", { name: "Show library" }).click();
  await expect(bookmark).toHaveAttribute("aria-pressed", String(!initial));
  await page.reload();
  await expect(bookmark).toHaveAttribute("aria-pressed", String(!initial));

  await page.setViewportSize({ width: 1600, height: 900 });
  const divider = page.getByRole("separator", { name: "Resize session library" });
  await divider.press("End");
  await expect(page.locator(".session-details > summary")).toHaveText("Session actions", { useInnerText: true });
  await expect(bookmark).toBeVisible();
  await expect(exportRecording).toHaveCount(0);
  await divider.press("Home");
  await expect(page.locator(".session-details > summary")).toHaveText("Session details", { useInnerText: true });
  await expect(exportRecording).toBeVisible();

  for (const [width, height] of [[1440, 900], [390, 844], [320, 640], [960, 540]]) {
    await page.setViewportSize({ width, height });
    await expect(bookmark).toBeVisible();
    expect(await besideTitle()).toBe(true);
    expect(await title.evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBe(true);
    const target = await bookmark.boundingBox();
    expect(Math.min(target!.width, target!.height)).toBeGreaterThanOrEqual(width <= 680 ? 44 : 36);
    await bookmark.focus();
    expect(await bookmark.evaluate(element => element.matches(":focus-visible") && getComputedStyle(element).outlineWidth === "2px")).toBe(true);
    const before = await pressed();
    await page.keyboard.press("Enter");
    await expect(bookmark).toHaveAttribute("aria-pressed", String(!before));
    const actions = page.locator(".session-details > summary");
    await expect(actions).toHaveText("Session actions", { useInnerText: true });
    await expect(exportRecording).toHaveCount(0);
    await actions.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(exportRecording).toBeFocused();
    const download = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    expect((await download).suggestedFilename()).toMatch(/^blackbox-.*\.jsonl$/);
    await expect(page.getByRole("heading", { name: "Session details", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    await expect(page.locator(".session-details-menu")).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy resume command" })).toBeVisible();
    expect(await page.locator(".replay-actions").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
});

test("output expansion controls align with the code panel in both states", async ({ page }) => {
  await page.goto("/?q=Long+recording");
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await page.locator(".replay-raw > summary").first().click();
  const toggle = page.locator(".tool-output-toggle").first();
  const assertSpacing = async () => {
    const spacing = await toggle.evaluate(button => {
      const output = button.parentElement!.querySelector("pre")!;
      const buttonStyle = getComputedStyle(button);
      const outputStyle = getComputedStyle(output);
      return {
        inset: parseFloat(buttonStyle.paddingLeft),
        alignment: Math.abs(button.getBoundingClientRect().left + parseFloat(buttonStyle.paddingLeft) - output.getBoundingClientRect().left - parseFloat(outputStyle.paddingLeft)),
        height: button.getBoundingClientRect().height,
      };
    });
    expect(spacing.inset).toBe(10);
    expect(spacing.alignment).toBeLessThan(1);
    expect(spacing.height).toBeGreaterThanOrEqual(36);
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(toggle).toHaveText("Show full output");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await assertSpacing();
    await toggle.click();
    await expect(toggle).toHaveText("Show less");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await assertSpacing();
    await toggle.click();
  }
});

test("workspace groups persist and retain the original source filter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await page.getByRole("textbox", { name: "New group name" }).fill("Orbit unified");
  await page.getByRole("checkbox", { name: "/synthetic/workspaces/orbit", exact: true }).check();
  await page.getByRole("checkbox", { name: "/synthetic/workspaces/orbit-auth", exact: true }).check();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.locator(".existing-group")).toContainText("Orbit unified");
  await page.getByRole("button", { name: "Close workspace settings" }).click();
  await page.getByRole("button", { name: /Orbit unified 2 folders/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(4);
  await page.reload();
  await expect(page.locator(".session-row")).toHaveCount(4);
  // Each grouped row names its group and then the folder it was recorded in, so worktrees stay distinguishable.
  await expect(page.locator(".session-row .session-group-name")).toHaveText(Array(4).fill("Orbit unified"));
  expect((await page.locator(".session-row .session-folder").allTextContents()).sort()).toEqual(["orbit", "orbit", "orbit-auth", "orbit-auth"]);
  await expect(page.getByRole("button", { name: new RegExp(`${DEMO_HERO_TITLE}.*Orbit unified\\s*,\\s*folder\\s*orbit-auth`) })).toHaveCount(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const leaf = await page.locator(".session-row").first().locator(".session-folder").evaluate(element => ({ visible: element.getBoundingClientRect().width > 0, clipped: element.scrollWidth > element.clientWidth + 1 }));
    expect(leaf).toEqual({ visible: true, clipped: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".filter-popover > summary").click();
  await page.getByRole("combobox", { name: "Original source" }).selectOption("/synthetic/workspaces/orbit-auth");
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.locator(".filter-popover > summary").click();
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".source-path")).toHaveText("/synthetic/workspaces/orbit-auth");
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await expect(page.locator(".existing-group")).toHaveCount(0);
});

type Group = { id: string; name: string; paths: string[] };
const createGroup = (page: Page, name: string, paths: string[]) => page.evaluate(async ([name, paths]) => {
  const response = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, paths }) });
  return await response.json() as Group;
}, [name, paths] as const);
const groupsNamed = async (page: Page, names: string[]) => ((await (await page.request.get("/api/catalog")).json()).groups as Group[]).filter(group => names.includes(group.name));
const removeGroups = async (page: Page, names: string[]) => {
  for (const group of await groupsNamed(page, names)) await page.evaluate(id => fetch(`/api/groups/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }), group.id);
};

test("ungrouping offers an Undo toast that restores the same group and its selection", async ({ page }) => {
  await page.goto("/");
  const group = await createGroup(page, "Undo coverage", ["/synthetic/workspaces/orbit", "/synthetic/workspaces/orbit-auth"]);
  try {
    await page.getByRole("button", { name: /Undo coverage 2 folders/ }).click();
    await expect(page).toHaveURL(new RegExp(`workspace=${group.id}`));
    await page.getByRole("button", { name: "Group workspaces", exact: true }).click();
    const dialog = page.locator("dialog.workspace-dialog");
    await dialog.getByRole("button", { name: "Ungroup", exact: true }).click();
    const toast = dialog.locator(".toast");
    const undo = toast.getByRole("button", { name: "Undo", exact: true });
    await expect(toast).toContainText("Ungrouped Undo coverage");
    await expect(dialog.getByRole("status").filter({ hasText: "Ungrouped" })).toHaveText("Ungrouped Undo coverage. Undo is available.");
    await expect(undo).toBeFocused();
    await expect(dialog.locator(".existing-group")).toHaveCount(0);
    await expect(page).not.toHaveURL(/workspace=/);
    expect(await groupsNamed(page, ["Undo coverage"])).toEqual([]);

    await undo.click();
    await expect(toast).toContainText("Restored Undo coverage");
    await expect(undo).toHaveCount(0);
    await expect(dialog.locator(".existing-group")).toContainText("Undo coverage");
    await expect(dialog.getByRole("button", { name: "Ungroup", exact: true })).toBeFocused();
    expect(await groupsNamed(page, ["Undo coverage"])).toEqual([group]);
    await expect(page).toHaveURL(new RegExp(`workspace=${group.id}`));

    await page.keyboard.press("Enter");
    await expect(toast).toContainText("Ungrouped Undo coverage");
    await expect(undo).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toast).toContainText("Restored Undo coverage");
    expect(await groupsNamed(page, ["Undo coverage"])).toEqual([group]);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Restored Undo coverage");
    await expect(page.getByRole("button", { name: /Undo coverage 2 folders/ })).toHaveAttribute("aria-current", "page");
  } finally { await removeGroups(page, ["Undo coverage"]); }
});

test("one Undo toast collects quick ungroups, holds while hovered, and expiring leaves them removed", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  const names = ["Expiry one", "Expiry two"];
  await createGroup(page, names[0], ["/synthetic/workspaces/orbit", "/synthetic/workspaces/orbit-auth"]);
  await createGroup(page, names[1], ["/synthetic/workspaces/atlas-api", "/synthetic/workspaces/design-system"]);
  try {
    await page.getByRole("button", { name: "Group workspaces", exact: true }).click();
    const dialog = page.locator("dialog.workspace-dialog");
    const toast = dialog.locator(".toast");
    for (const name of names) await expect(dialog.locator(".existing-group", { hasText: name })).toHaveCount(1);
    await dialog.locator(".existing-group", { hasText: names[0] }).getByRole("button", { name: "Ungroup", exact: true }).click();
    await expect(toast).toHaveText("Ungrouped Expiry oneUndo");
    await dialog.locator(".existing-group", { hasText: names[1] }).getByRole("button", { name: "Ungroup", exact: true }).click();
    await expect(toast).toHaveText("Ungrouped Expiry one and Expiry twoUndo");
    expect(await groupsNamed(page, names)).toEqual([]);

    await toast.hover();
    await page.clock.fastForward(15_000);
    await expect(toast).toBeVisible();
    await page.mouse.move(5, 5);
    await page.clock.fastForward(9_000);
    await expect(toast).toBeVisible();
    await page.clock.fastForward(1_500);
    await expect(toast).toHaveCount(0);
    expect(await groupsNamed(page, names)).toEqual([]);
    await expect(dialog.locator(".existing-group")).toHaveCount(0);
  } finally { await removeGroups(page, names); }
});

test("a group ungrouped while an Undo is restoring keeps its own Undo toast", async ({ page }) => {
  await page.goto("/");
  const names = ["Race first", "Race second"];
  const first = await createGroup(page, names[0], ["/synthetic/workspaces/orbit", "/synthetic/workspaces/orbit-auth"]);
  await createGroup(page, names[1], ["/synthetic/workspaces/atlas-api", "/synthetic/workspaces/design-system"]);
  try {
    await page.getByRole("button", { name: "Group workspaces", exact: true }).click();
    const dialog = page.locator("dialog.workspace-dialog");
    const toast = dialog.locator(".toast");
    const undo = toast.getByRole("button", { name: "Undo", exact: true });
    for (const name of names) await expect(dialog.locator(".existing-group", { hasText: name })).toHaveCount(1);
    await dialog.locator(".existing-group", { hasText: names[0] }).getByRole("button", { name: "Ungroup", exact: true }).click();
    await expect(toast).toHaveText("Ungrouped Race firstUndo");

    let release!: () => void, posted!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const restoring = new Promise<void>(resolve => { posted = resolve; });
    await page.route("**/api/groups", async route => {
      if (route.request().method() === "POST") { posted(); await held; }
      await route.continue();
    });
    await undo.click();
    await restoring;
    await dialog.locator(".existing-group", { hasText: names[1] }).getByRole("button", { name: "Ungroup", exact: true }).click();
    await expect(toast).toHaveText("Ungrouped Race secondUndo");
    release();
    await expect(dialog.locator(".existing-group", { hasText: names[0] })).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(toast).toHaveText("Ungrouped Race secondUndo");
    expect(await groupsNamed(page, [names[0]])).toEqual([first]);
    expect(await groupsNamed(page, [names[1]])).toEqual([]);

    await page.unroute("**/api/groups");
    await undo.click();
    await expect(toast).toHaveText("Restored Race second");
    expect((await groupsNamed(page, names)).map(group => group.name).sort()).toEqual(names);
  } finally { await removeGroups(page, names); }
});

test("session and event pagination remain bounded and navigable", async ({ page }) => {
  const listing = await (await page.request.get("/api/sessions")).json();
  const secondPageCount = Math.min(listing.limit, listing.total - listing.limit);
  await page.goto("/");
  await expect(page.locator(".session-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Next recordings" }).click();
  await expect(page).toHaveURL(/offset=50/);
  await expect(page.locator(".session-row")).toHaveCount(secondPageCount);
  await page.reload();
  await expect(page.locator(".session-row")).toHaveCount(secondPageCount);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/offset=50/);
  await page.getByRole("button", { name: "Previous recordings" }).click();
  await expect(page.locator(".session-row")).toHaveCount(50);
  await page.getByRole("textbox", { name: "Search all recordings" }).fill("Long recording");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event")).toHaveCount(60);
  await expect(page.locator(".replay-event-header > code")).toHaveText(["/synthetic/browser-tests"]);
  await page.getByRole("button", { name: "Next 60 events" }).click();
  await expect(page.locator(".replay-event").first()).toContainText("Long recording event 60");
  await expect(page.locator(".replay-event-header > code")).toHaveText(["/synthetic/browser-tests"]);
  await page.getByRole("button", { name: "Previous events" }).click();
  await expect(page.locator(".replay-event").first()).toContainText("Long recording event 0");
  await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
  await expect(page.locator(".replay-event").last()).toContainText("Long recording event 174");
  await expect.poll(() => page.locator(".replay-scroll").evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(10);
});

test("new records arrive exactly once without interrupting history", async ({ page }) => {
  await page.goto("/?q=Live+update+verification");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-event")).toHaveCount(1);
  const record = { type: "assistant", uuid: "live-added", timestamp: new Date().toISOString(), message: { role: "assistant", content: "Freshly recorded browser-test response" } };
  await appendFile(".blackbox/e2e/projects/browser-regressions/live-recording.jsonl", JSON.stringify(record) + "\n");
  await expect(page.locator(".replay-event")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Recording updated/ })).toBeVisible();
  await page.reload();
  await expect(page.locator(".replay-event")).toHaveCount(2);
});

test("transcript HTML cannot execute scripts, spoof app styles, or load remote images", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("blocked.invalid")) remoteRequests.push(request.url()); });
  await page.goto("/?q=Unsafe+markdown+verification");
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: "Safe content" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).blackboxXss)).toBeUndefined();
  await expect(page.locator('.md-content script, .md-content img, .md-content [href^="javascript:"], .md-content .nav-scrim')).toHaveCount(0);
  expect(remoteRequests).toEqual([]);
});

test("Markdown soft newlines wrap naturally while explicit structure stays intact", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?q=Markdown+wrapping+verification");
  await page.locator(".session-row").first().click();
  const markdown = page.locator(".md-content").filter({ has: page.getByRole("heading", { name: "Natural wrapping" }) });
  await expect(markdown).toBeVisible();
  const prose = markdown.locator(":scope > p").first();
  await expect(prose).toHaveText("Soft-wrapped prose stays on one line when there is room.");
  await expect(prose.locator("br")).toHaveCount(0);
  const lineCount = () => prose.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set(Array.from(range.getClientRects(), rectangle => rectangle.top)).size;
  });
  expect(await lineCount()).toBe(1);
  await expect(markdown.locator(":scope > p")).toHaveCount(7);
  await expect(markdown.locator(":scope > p").nth(1)).toHaveText("A separate paragraph stays separate.");
  for (const label of ["Two-space hard break.", "Backslash hard break.", "HTML hard break."]) {
    await expect(markdown.locator("p").filter({ hasText: label }).locator("br")).toHaveCount(1);
  }
  await expect(markdown.locator("li")).toHaveCount(2);
  await expect(markdown.locator("li").first()).toHaveText("A list item with a soft newline continues naturally.");
  await expect(markdown.locator("li br, blockquote br")).toHaveCount(0);
  await expect(markdown.locator("blockquote p")).toHaveText("A quote with a soft newline continues naturally.");
  expect(await markdown.locator("pre code").textContent()).toBe("const first = 1;\nconst second = 2;\n");
  for (const [width, height] of [[3440, 1440], [1920, 1080], [1366, 768], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    expect(await markdown.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 390) expect(await lineCount()).toBeGreaterThan(1);
  }
});

test("demo Markdown separates sections consistently across viewports and text sizes", async ({ page }) => {
  for (const title of ["Make conversation search feel instant", DEMO_HERO_TITLE]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/?q=${encodeURIComponent(title)}`);
    await page.locator(".session-row").click();
    const markdown = page.locator(".md-content").filter({ has: page.locator("table") }).first();
    await expect(markdown.locator("table + h3")).toBeVisible();
    for (const textSize of ["standard", "larger"]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("combobox", { name: "Text size" }).selectOption(textSize);
      for (const [width, height] of [[1440, 1000], [390, 844], [320, 640]]) {
        await page.setViewportSize({ width, height });
        const spacing = await markdown.evaluate(element => {
          const gapBefore = (selector: string) => {
            const block = element.querySelector(selector)!;
            return block.getBoundingClientRect().top - block.previousElementSibling!.getBoundingClientRect().bottom;
          };
          return {
            section: gapBefore("table + h3"),
            heading: gapBefore("h3 + ol"),
            table: gapBefore("p + table"),
            code: gapBefore("ol + pre"),
            paragraph: gapBefore("pre + p"),
            first: getComputedStyle(element.firstElementChild!).marginTop,
            last: getComputedStyle(element.lastElementChild!).marginBottom,
          };
        });
        expect(spacing).toEqual({ section: 24, heading: 12, table: 16, code: 16, paragraph: 16, first: "0px", last: "0px" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  }
});

test("Markdown heading rhythm covers every level without loosening nested content", async ({ page }) => {
  await page.goto("/?q=Markdown+rhythm+verification");
  await page.locator(".session-row").click();
  const markdown = page.locator(".md-content").filter({ has: page.getByRole("heading", { name: "Opening heading" }) });
  await expect(markdown).toBeVisible();
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    const spacing = await markdown.evaluate(element => {
      const headings = Array.from(element.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      const quote = element.querySelector("blockquote")!;
      const nestedList = getComputedStyle(element.querySelector("li > ul")!);
      return {
        before: headings.slice(1).map(heading => heading.getBoundingClientRect().top - heading.previousElementSibling!.getBoundingClientRect().bottom),
        after: headings.map(heading => heading.nextElementSibling!.getBoundingClientRect().top - heading.getBoundingClientRect().bottom),
        quoteStart: getComputedStyle(quote.firstElementChild!).marginTop,
        quoteEnd: getComputedStyle(quote.lastElementChild!).marginBottom,
        nestedStart: nestedList.marginTop,
        nestedEnd: nestedList.marginBottom,
      };
    });
    expect(spacing.before).toEqual([24, 24, 24, 24, 24, 24]);
    expect(spacing.after).toEqual([12, 12, 12, 12, 12, 12, 12]);
    expect(spacing.quoteStart).toBe("0px");
    expect(spacing.quoteEnd).toBe("0px");
    expect(spacing.nestedStart).toBe("0px");
    expect(spacing.nestedEnd).toBe("0px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("mobile navigation and replay avoid horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await page.getByRole("button", { name: "orbit-auth 2", exact: true }).click();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.locator(".session-row").first().click();
  await expect(page.getByRole("region", { name: "Session replay" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Close replay" }).click();
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toBeVisible();
});

test("library, replay and grouping have no serious accessibility violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".session-row").first()).toBeVisible();
  const audit = async () => {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
  };
  await audit();
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await audit();
  await page.getByRole("button", { name: "Group workspaces", exact: true }).first().click();
  await audit();
});

test("event permalinks and open tool disclosures survive metadata refresh", async ({ page }) => {
  await page.goto("/?q=effortless");
  await page.locator(".session-row").click();
  const tool = page.locator('.tool-summary[aria-expanded="false"]').first();
  await tool.click();
  const expanded = await page.locator('.tool-summary[aria-expanded="true"]').count();
  const bookmark = page.getByRole("button", { name: "Bookmark this recording", exact: true });
  const pressed = await bookmark.getAttribute("aria-pressed");
  // The toggle shows the new state at once, so wait for the session metadata the bookmark refreshes.
  const refreshed = page.waitForResponse(response => response.request().method() === "GET" && /^\/api\/sessions\/[^/]+$/.test(new URL(response.url()).pathname));
  await bookmark.click();
  await refreshed;
  await expect(bookmark).not.toHaveAttribute("aria-pressed", pressed!);
  await expect(page.locator('.tool-summary[aria-expanded="true"]')).toHaveCount(expanded);
  const link = page.locator(".replay-event-link").nth(1);
  const href = await link.getAttribute("href");
  const eventId = new URL(href!, "http://127.0.0.1:12003").searchParams.get("event");
  await page.goto(href!);
  await expect(page.locator(".replay-event").first()).toHaveAttribute("data-event-id", eventId!);
  await page.getByRole("textbox", { name: "Find in this recording" }).fill("retryBudget");
  await expect(page).toHaveURL(/replayQ=retryBudget/);
  await expect(page.locator(".tool-code mark").first()).toHaveText("retryBudget");
});

test("mobile navigation removes hidden controls from keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation", exact: true }).last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open workspace navigation" })).toBeFocused();
  await expect(page.locator(".sidebar")).toHaveAttribute("inert", "");
});

test("desktop layouts adapt from compact laptops through 4K and ultrawide monitors", async ({ page }) => {
  const sizes = [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3440, height: 1440 },
    { width: 3840, height: 2160 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator(".session-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const rows = await page.locator(".session-row").evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, bottom: bounds.bottom, width: bounds.width };
    }));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every(row => row.left === rows[0].left && row.width === rows[0].width)).toBe(true);
    expect(rows.slice(1).every((row, index) => row.top >= rows[index].bottom - 1)).toBe(true);
    expect(await page.locator(".recordings-scroll").evaluate(element => element.clientHeight)).toBeGreaterThan(180);
    await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
    await expect(page.locator(".replay-event").first()).toBeVisible();
    const widths = await page.locator(".replay-panel").evaluate(panel => ({
      panel: panel.clientWidth,
      body: panel.querySelector(".replay-body")!.getBoundingClientRect().width,
      scroll: panel.querySelector(".replay-scroll")!.clientWidth,
      timeline: panel.querySelector(".replay-timeline")!.getBoundingClientRect().width,
    }));
    expect(Math.abs(widths.body - widths.panel)).toBeLessThan(1);
    expect(Math.abs(widths.timeline - widths.scroll)).toBeLessThan(1);
    const content = await page.locator(".md-content").filter({ has: page.locator("pre") }).first().evaluate(element => {
      const paragraph = element.querySelector("p")!;
      return {
        prose: paragraph.getBoundingClientRect().width,
        available: element.getBoundingClientRect().width,
        code: element.querySelector("pre")!.getBoundingClientRect().width,
      };
    });
    expect(content.prose).toBe(content.available);
    expect(content.code).toBe(content.available);
    if (size.width >= 2560) {
      expect(widths.timeline).toBeGreaterThan(1400);
      expect(content.code).toBeGreaterThan(1400);
    }
    expect(await page.locator(".replay-scroll").evaluate(element => element.clientHeight)).toBeGreaterThan(180);
    if (size.width >= 2000) await expect(page.getByRole("complementary", { name: "Recording overview" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("replay layout controls preserve reading and navigation", async ({ page }) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  const library = page.getByRole("region", { name: "Session library" });
  const overview = page.getByRole("complementary", { name: "Recording overview" });
  const timeline = page.locator(".replay-timeline");
  const timelineWidth = () => timeline.evaluate(element => element.getBoundingClientRect().width);
  const originalWidth = await timelineWidth();
  await expect(overview).toBeVisible();
  await page.getByRole("button", { name: "Hide overview" }).click();
  await expect(overview).toBeHidden();
  expect(await timelineWidth()).toBeGreaterThan(originalWidth + 200);
  await page.getByRole("button", { name: "Hide library" }).click();
  await expect(library).toBeHidden();
  await expect(page.getByRole("separator")).toHaveCount(0);
  expect(await timelineWidth()).toBeGreaterThan(originalWidth + 600);
  await page.getByRole("button", { name: "Show library" }).click();
  await expect(library).toBeVisible();
  await page.getByRole("button", { name: "Hide library" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toBeFocused();
  await expect(library).toBeVisible();
  await expect(overview).toBeHidden();
  await page.getByRole("button", { name: "Show overview" }).click();
  await page.locator(".replay-raw > summary").first().click();
  const expandedWidth = await timelineWidth();
  await page.getByRole("button", { name: "Hide overview" }).click();
  expect(await timelineWidth()).toBeGreaterThan(expandedWidth + 200);
  await page.getByRole("button", { name: "Hide library" }).click();
  expect(await timelineWidth()).toBeGreaterThan(expandedWidth + 600);
  await page.getByRole("button", { name: "Show library" }).click();
  await page.getByRole("button", { name: "Show overview" }).click();
  expect(await timelineWidth()).toBeGreaterThan(2000);
  await expect(page.locator(".replay-raw").first()).toHaveAttribute("open", "");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(library).toBeHidden();
  await expect(overview).toBeHidden();
  await expect(page.getByRole("button", { name: "Hide library" })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Hide library" }).click();
  await page.getByRole("button", { name: "Close replay" }).click();
  await expect(library).toBeVisible();
});

test("replay prose and code use the available width across viewports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Focused reading" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-reading-width", "full");
  await expect(page.getByRole("combobox", { name: "Reading width" })).toHaveValue("full");
  const widthOf = (selector: string) => page.locator(selector).first().evaluate(element => element.getBoundingClientRect().width);
  for (const [width, height] of [[3440, 1440], [1920, 1080], [1366, 768], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height });
    const timelineWidth = await widthOf(".replay-timeline");
    const proseWidth = await widthOf(".md-content p");
    expect(proseWidth).toBe(await widthOf(".md-content"));
    const code = page.locator(".md-content pre").first();
    expect(await code.evaluate(element => element.getBoundingClientRect().width)).toBe(await code.evaluate(element => element.parentElement!.getBoundingClientRect().width));
    expect(await page.locator(".replay-scroll").evaluate(element => element.clientWidth)).toBeCloseTo(timelineWidth, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("session library divider supports pointer keyboard and responsive bounds", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  const divider = page.getByRole("separator", { name: "Resize session library" });
  const libraryWidth = () => page.locator(".library-split").evaluate(element => Math.round(element.getBoundingClientRect().width));
  const originalWidth = await libraryWidth();
  await expect(divider).toHaveAttribute("aria-valuenow", String(originalWidth));
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(libraryWidth).toBe(originalWidth + 24);
  await expect(divider).toHaveAttribute("aria-valuenow", String(originalWidth + 24));
  await page.keyboard.press("Home");
  await expect.poll(libraryWidth).toBe(240);
  await page.keyboard.press("End");
  await expect.poll(libraryWidth).toBe(560);
  const bounds = await divider.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 - 100, bounds!.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(libraryWidth).toBe(460);
  await divider.dblclick();
  await expect.poll(libraryWidth).toBe(originalWidth);
  await divider.press("End");
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(libraryWidth).toBeLessThan(350);
  await expect.poll(() => page.locator(".replay-panel").evaluate(element => element.clientWidth)).toBeGreaterThanOrEqual(480);
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(divider).toBeHidden();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect.poll(libraryWidth).toBe(560);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("compact replay reserves vertical space for conversation across viewports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  for (const [width, height, minimumReadingHeight] of [[1440, 900, 610], [1366, 768, 490], [390, 844, 500], [320, 640, 296], [844, 390, 110]]) {
    await page.setViewportSize({ width, height });
    const transcript = await page.locator(".replay-scroll").boundingBox();
    expect(transcript!.height).toBeGreaterThanOrEqual(minimumReadingHeight);
    await expect(page.locator(".session-details-menu")).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy resume command" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close replay" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Find in this recording" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of [".replay-actions", ".replay-controls", ".replay-footer"]) {
      expect(await page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  }
});

test("session details preserve context and keyboard access without shifting the conversation", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-event").first()).toBeVisible();
  const transcript = await page.locator(".replay-scroll").boundingBox();
  const disclosure = page.locator(".session-details > summary");
  await disclosure.focus();
  await page.keyboard.press("Enter");
  const details = page.getByRole("region", { name: "Session details", exact: true });
  await expect(details).toBeVisible();
  await expect(details).toContainText(DEMO_HERO_TITLE);
  await expect(details).toContainText("feat/auth-delight");
  await expect(details).toContainText("Sonnet 4.5");
  await expect(details).toContainText("3 messages · 7 tools");
  const copyPath = details.getByRole("button", { name: /synthetic\/workspaces\/orbit-auth/ });
  await copyPath.click();
  await expect(page.locator(".toast")).toContainText("Source path copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("/synthetic/workspaces/orbit-auth");
  expect(await page.locator(".replay-scroll").boundingBox()).toEqual(transcript);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(disclosure).toBeFocused();
  await page.keyboard.press("Space");
  await expect(details).toBeVisible();
  const audit = await new AxeBuilder({ page }).include(".replay-panel-heading").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(audit.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
});

const shownProvenance = (page: Page) => page.locator(".replay-provenance .provenance-value").evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({ text: element.textContent, clipped: element.scrollWidth > element.clientWidth + 1 })));
const oneLine = (page: Page) => page.locator(".replay-provenance").evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) + 1 && element.scrollWidth <= element.clientWidth + 1);

test("the provenance strip names folder, branch, recorded span and model in split and full layouts", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".replay-provenance")).toBeVisible();
  const facts = async (model: boolean) => {
    const shown = await shownProvenance(page);
    expect(shown.map(value => value.text)).toEqual(["orbit-auth", "feat/auth-delight", expect.stringMatching(/\d{4}/), ...(model ? ["Sonnet 4.5"] : [])]);
    expect(await oneLine(page)).toBe(true);
  };
  await facts(true);
  await expect(page.locator(".provenance-folder")).toHaveAttribute("title", "/synthetic/workspaces/orbit-auth");
  await expect(page.locator(".provenance-dates")).toHaveAttribute("title", /^First recorded .+\. Last recorded .+\.$/);
  await expect(page.locator(".replay-heading-content")).toContainText("Folder orbit-auth");

  // Full mode keeps the same strip, and the overview rail no longer repeats the workspace and start date.
  await page.getByRole("button", { name: "Hide library" }).click();
  await facts(true);
  const overview = page.getByRole("complementary", { name: "Recording overview" });
  await expect(overview).toBeVisible();
  await expect(overview).not.toContainText("ORIGINAL WORKSPACE");
  await expect(overview).not.toContainText("/synthetic/workspaces/orbit-auth");
  await page.getByRole("button", { name: "Show library" }).click();

  // A phone-width pane keeps folder, branch and days on the line; times and the model stay in Session actions.
  await page.setViewportSize({ width: 390, height: 844 });
  await facts(false);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await oneLine(page)).toBe(true);
});

test("the provenance strip gives up the folder before the branch, dates or model", async ({ page }) => {
  const cwd = "/synthetic/" + "a-worktree-folder-with-a-very-long-leaf-name-".repeat(3) + "end";
  await page.route(/\/api\/sessions\/[^/?]+$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), cwd, branch: "feat/provenance" } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".library-split")).toBeVisible();
  await expect(page.locator(".provenance-folder")).toHaveAttribute("title", cwd);
  expect((await shownProvenance(page)).map(value => value.clipped)).toEqual([true, false, false, false]);
  expect(await oneLine(page)).toBe(true);
});

test("long session context stays accessible at compact sizes and larger text", async ({ page }) => {
  const longTitle = "Review the authentication flow and verify every recovery path ".repeat(8).trim();
  const longPath = "/synthetic/" + "deeply-nested-workspace/".repeat(12);
  await page.addInitScript(() => { localStorage.setItem("blackbox:text-size", "larger"); });
  await page.route(/\/api\/sessions\/[^/?]+$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), title: longTitle, cwd: longPath } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  const title = page.locator(".replay-panel-heading h2");
  await expect(title).toHaveText(longTitle);
  await expect(page.getByRole("combobox", { name: "Text size" })).toHaveValue("larger");
  const strip = page.locator(".replay-provenance");
  await expect(strip.locator(".provenance-folder")).toHaveAttribute("title", longPath);
  for (const [width, height] of [[1440, 900], [390, 844], [320, 640], [844, 390]]) {
    await page.setViewportSize({ width, height });
    expect(await title.evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBe(true);
    expect(await strip.evaluate(element => element.clientHeight <= parseFloat(getComputedStyle(element).lineHeight) + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Bookmark this recording" })).toBeInViewport();
    await page.locator(".session-details > summary").click();
    const details = page.getByRole("region", { name: "Session details", exact: true });
    await expect(details).toContainText(longTitle);
    await expect(details).toContainText(longPath);
    const bounds = await details.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await details.getByText("Source type", { exact: true }).scrollIntoViewIfNeeded();
    await expect(details.getByText("Main recording", { exact: true })).toBeInViewport();
    await page.locator(".session-details > summary").press("Escape");
  }
});

test("utility typography stays readable across desktop and compact viewports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await expect(page.locator(".md-content").first()).toBeVisible();
  for (const width of [1920, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const selector of [".nav-item", ".session-title", ".filter-tab", ".search-box input", ".replay-tab", ".replay-find input", ".resume-command"]) {
      await expect(page.locator(selector).first()).toHaveCSS("font-size", "14px");
    }
    for (const selector of [".session-path", ".session-time", ".source-path", ".replay-provenance"]) {
      await expect(page.locator(selector).first()).toHaveCSS("font-size", "12px");
    }
    await expect(page.locator(".tool-preview").first()).toHaveCSS("font-size", "13px");
    await expect(page.locator(".md-content code").first()).toHaveCSS("font-size", "14px");
    await expect(page.locator(".md-content").first()).toHaveCSS("font-size", "15px");
    await expect(page.locator(".md-content").first()).toHaveCSS("line-height", "24.75px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const selector of [".replay-controls", ".replay-actions", ".replay-footer"]) {
      expect(await page.locator(selector).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  }
});

test("larger text persists without resetting replay and respects browser font preferences", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(DEMO_HERO_TITLE) }).click();
  await page.locator(".replay-raw > summary").first().click();
  const replayUrl = page.url();
  const selector = page.getByRole("combobox", { name: "Text size" });
  await selector.selectOption("larger");
  await expect(page.locator(".replay-find input")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".source-path")).toHaveCSS("font-size", "14px");
  await expect(page.locator(".tool-code pre").first()).toHaveCSS("font-size", "15px");
  await expect(page.locator(".md-content").first()).toHaveCSS("font-size", "17px");
  await expect(page.locator(".replay-raw").first()).toHaveAttribute("open", "");
  expect(page.url()).toBe(replayUrl);
  await page.reload();
  await expect(selector).toHaveValue("larger");
  await expect(page.locator(".replay-find input")).toHaveCSS("font-size", "16px");
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const target of [".replay-controls", ".replay-actions", ".replay-footer"]) {
      expect(await page.locator(target).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  }
  await page.getByRole("button", { name: "Open workspace navigation" }).click();
  await expect(page.locator(".sidebar-mobile-close")).toBeFocused();
  await selector.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await expect(selector).toHaveValue("standard");
  await page.getByRole("button", { name: "Close navigation", exact: true }).last().click();
  await expect(page.locator(".replay-find input")).toHaveCSS("font-size", "14px");
  await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
  await expect(page.locator(".replay-find input")).toHaveCSS("font-size", "17.5px");
  await expect(page.locator(".md-content").first()).toHaveCSS("font-size", "18.75px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("text size remains usable when local storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
  });
  await page.goto("/");
  const selector = page.getByRole("combobox", { name: "Text size" });
  await expect(selector).toHaveValue("standard");
  await selector.selectOption("larger");
  await expect(page.getByRole("textbox", { name: "Search all recordings" })).toHaveCSS("font-size", "16px");
});
