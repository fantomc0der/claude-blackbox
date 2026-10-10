import { expect, test } from "./harness";

test("image tool results render inline without base64 and blocked formats degrade safely", async ({ page }) => {
  await page.goto("/?q=Image+read+verification");
  await page.locator(".session-row").click();
  await expect(page.getByRole("heading", { name: "Image read verification" })).toBeVisible();
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(page.locator(".tool-summary")).toHaveCount(3);
  const tools = page.locator('.tool-summary[aria-expanded="false"]');
  while (await tools.count()) await tools.first().click();

  const panels = page.locator(".tool-image");
  await expect(panels).toHaveCount(3);
  const screenshot = panels.filter({ hasText: "screenshot.png" });
  const image = screenshot.locator("img");
  await expect(image).toBeVisible();
  expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(16);
  await expect(screenshot.locator(".tool-image-meta")).toHaveText(/^PNG · \d+ B · 16×12$/);
  await expect(image).toHaveAttribute("alt", "Image read from screenshot.png");
  const frame = screenshot.getByRole("button", { name: "Show image at actual size" });
  await frame.click();
  await expect(screenshot).toHaveAttribute("data-actual-size", "true");
  await expect(screenshot.getByRole("button", { name: "Fit image to card" })).toHaveAttribute("aria-pressed", "true");

  const mixed = page.locator(".tool-content").filter({ hasText: "mixed.png" });
  await expect(mixed.locator(".tool-code pre")).toContainText("Mixed image result caption");
  await expect(mixed.locator(".tool-image img")).toBeVisible();

  const svg = panels.filter({ hasText: "diagram.svg" });
  await expect(svg.locator(".tool-image-blocked")).toHaveText("Image not shown (unsupported or blocked format)");
  await expect(svg.locator("img")).toHaveCount(0);
  await expect(svg.locator(".tool-image-meta")).toHaveText(/^SVG · \d+ B$/);

  const unpaired = page.locator(".tool-result");
  await expect(unpaired).toHaveCount(1);
  await expect(unpaired.locator(".tool-attachment")).toContainText("Recorded image result");
  await expect(unpaired.locator(".tool-code")).toHaveCount(0);
  await expect(unpaired.locator("img")).toHaveCount(0);
  await unpaired.getByRole("button", { name: "Show image" }).click();
  await expect(unpaired.locator("img")).toBeVisible();

  await expect(page.locator(".tool-output-toggle")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Session replay" })).not.toContainText("iVBORw0KGgo");
});
