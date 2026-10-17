import { expect, test } from "./harness";

// The fixture holds one prompt, two assistant turns, and seven of Claude Code's session state records, three of which copy
// the prompt.
test("session state records read as notes and never repeat the prompt in search or find", async ({ page }) => {
  // A library search for the prompt's word opens on Conversation at the prompt, not on a state record that copies it.
  await page.goto("/?q=Brackenfold");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".session-row .session-snippet")).toContainText("Rename the Brackenfold helper");
  await page.locator(".session-row").click();
  await expect(page.locator(".replay-scroll")).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(/replayKind=conversation/);
  await expect(page.locator(".replay-event-selected .replay-role")).toHaveText("user");
  await expect(page.locator(".replay-event")).toHaveCount(3);

  await page.getByRole("button", { name: "All events", exact: true }).click();
  await expect(page.locator(".replay-find > .replay-count")).toHaveText("10 records");
  await expect(page.locator(".replay-event")).toHaveCount(10);
  const notes = page.locator(".replay-event-state");
  await expect(notes).toHaveCount(7);
  await expect(notes.locator(".replay-role")).toHaveText(Array(7).fill("Session state"));
  await expect(notes.locator(".tool-hidden code")).toHaveText(["queue-operation", "last-prompt", "atis-latch", "cost-state", "permission-mode", "last-prompt", "atis-latch"]);
  await expect(page.locator(".replay-event-link time", { hasText: "Unknown time" })).toHaveCount(0);
  await expect(notes.locator(".replay-event-link time", { hasText: "No timestamp" })).toHaveCount(6);
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
