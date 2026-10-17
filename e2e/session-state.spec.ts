import { expect, test } from "./harness";

// The fixture holds one prompt, two assistant turns, and eight of Claude Code's session state records, three of which copy
// the prompt and two of which carry its running total.
test("session state records read as notes and never repeat the prompt in search or find", async ({ page }) => {
  // A library search for the prompt's word opens on Conversation at the prompt, not on a state record that copies it.
  await page.goto("/?q=Brackenfold");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".session-row .session-snippet")).toContainText("Rename the Brackenfold helper");
  // Claude Code's own total from the last `cost-state` record reads beside the estimate, which covers only the one
  // recorded request, in the row, the usage note, the replay header, and the session details.
  await expect(page.locator(".session-row .session-usage")).toContainText("$0.02 est. · $0.42 recorded");
  const usage = page.getByLabel("Usage and estimated cost");
  await usage.click();
  await expect(page.getByRole("region", { name: "Usage breakdown" }).locator(".usage-recorded")).toContainText("Claude Code recorded $0.42 across 1 of these recordings. Its running total also counts");
  await usage.click();
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(/replayKind=conversation/);
  await expect(page.locator(".replay-event-selected .replay-role")).toHaveText("user");
  await expect(page.locator(".replay-event")).toHaveCount(3);

  await page.getByRole("button", { name: "All events", exact: true }).click();
  await expect(page.locator(".replay-find > .replay-count")).toHaveText("11 records");
  await expect(page.locator(".replay-event")).toHaveCount(11);
  const notes = page.locator(".replay-event-state");
  await expect(notes).toHaveCount(8);
  await expect(notes.locator(".replay-role")).toHaveText(Array(8).fill("Session state"));
  await expect(notes.locator(".tool-hidden code")).toHaveText(["queue-operation", "last-prompt", "atis-latch", "cost-state", "permission-mode", "cost-state", "last-prompt", "atis-latch"]);
  await expect(page.locator(".replay-event-link time", { hasText: "Unknown time" })).toHaveCount(0);
  await expect(notes.locator(".replay-event-link time", { hasText: "No timestamp" })).toHaveCount(7);
  await expect(page.locator(".replay-usage .replay-usage-recorded")).toHaveText("Claude Code recorded $0.42");
  await page.locator(".session-details > summary").click();
  const details = page.getByRole("region", { name: "Session details" });
  await expect(details.locator("xpath=.//dt[normalize-space()='Claude Code recorded']/following-sibling::dd[1]")).toContainText("$0.42");
  await expect(details.locator(".recorded-models")).toHaveText("Sonnet 4.5 $0.40 · Haiku 4.5 $0.02");
  await expect(details.locator(".usage-recorded")).toContainText("Claude Code recorded $0.42 for this session. Its running total also counts");
  await page.locator(".session-details > summary").click();
  await expect(notes.first().locator(".replay-event-link time")).not.toHaveText("No timestamp");
  // The notes hold no readable prompt copy; Raw event still shows the whole record.
  await expect(notes.filter({ hasText: "Brackenfold" })).toHaveCount(0);
  await notes.nth(1).locator(".replay-raw summary").click();
  await expect(notes.nth(1).locator(".replay-raw .tool-code")).toContainText("Rename the Brackenfold helper");

  // Find counts the prompt once; a term held only by a state record shows that record's text on its note.
  const find = page.getByRole("textbox", { name: "Find in this recording" });
  await find.fill("Brackenfold");
  await expect(page.locator(".replay-match-count")).toHaveText("1 match");
  await expect(page.locator(".replay-event mark")).toHaveText(["Brackenfold"]);
  await find.fill("acceptEdits");
  await expect(page.locator(".replay-match-count")).toHaveText("1 match");
  await expect(notes.nth(4).locator(".tool-code")).toContainText("mode: acceptEdits");
  await expect(notes.nth(4).locator("mark")).toHaveText(["acceptEdits"]);
});
