import { afterAll, beforeAll, test as bunTest } from "bun:test";
import { chromium, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { recorder, server } from "./server";

let browser: Browser;
beforeAll(async () => {
  await mkdir("test-results", { recursive: true });
  browser = await chromium.launch({ channel: "msedge", headless: true });
});
afterAll(async () => {
  await browser?.close();
  await server.stop(true);
  await recorder.close();
});

export { expect };
export function test(name: string, run: (context: { page: Page; context: BrowserContext }) => Promise<void>) {
  bunTest(name, async () => {
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:12003", viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.tracing.start({ screenshots: true, snapshots: true });
    try {
      await run({ page, context });
      expect(errors).toEqual([]);
      await context.tracing.stop();
    } catch (error) {
      const file = `test-results/${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
      await page.screenshot({ path: `${file}.png` });
      await context.tracing.stop({ path: `${file}.zip` });
      throw error;
    } finally { await context.close(); }
  }, 30000);
}
