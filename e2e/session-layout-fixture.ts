import type { Page } from "@playwright/test";
import type { SessionPage, UsageSummary } from "../src/shared/types";

const usage = (costUSD: number, totalTokens: number, requests = 1, unpricedRequests = 0): UsageSummary => ({ inputTokens: totalTokens / 2, outputTokens: totalTokens / 4, cacheCreationTokens: 0, cacheReadTokens: totalTokens / 4, totalTokens, costUSD, requests, unpricedRequests, recordedCostRequests: requests - unpricedRequests });

const rows = [
  { title: "A deliberately long session title that verifies the recording title reserves space for the bookmark instead of swallowing it at every responsive width", workspace: "workspace-with-a-name-long-enough-to-test-metadata-truncation", branch: "feature/a-branch-name-that-is-intentionally-long-for-column-boundary-coverage", model: "Custom research model with an exceptionally descriptive deployment label", bookmarked: true, usage: usage(0.004, 7_000), messageCount: 7, toolCount: 0, startedAt: "2026-01-01T08:00:00Z", updatedAt: "2026-01-01T08:01:00Z" },
  { title: "Short title", workspace: "orbit-authentication-and-account-recovery", branch: "feature/long-lived-session-layout-regression-coverage", model: "claude-sonnet-4-5", bookmarked: false, usage: usage(3.13, 233_000), messageCount: 233, toolCount: 837, startedAt: "2026-01-02T09:00:00Z", updatedAt: "2026-01-02T11:00:00Z" },
  { title: "High-volume recording", workspace: "design-system", branch: "release/a-very-long-branch-name-for-a-realistic-project", model: "claude-opus-4-5", bookmarked: false, usage: usage(180.02, 12_000_000, 2, 1), messageCount: 12_000, toolCount: 10_000, startedAt: "2026-01-03T10:00:00Z", updatedAt: "2026-01-03T18:00:00Z" },
  { title: "Unpriced session with a very long workspace and branch", workspace: "archive-of-experimental-conversation-recordings", branch: "chore/missing-usage-never-means-zero-cost", model: "", bookmarked: false, usage: usage(0, 0, 0), messageCount: 0, toolCount: 837, startedAt: "2026-01-04T11:00:00Z", updatedAt: "2026-01-04T11:01:00Z" },
  { title: "Large currency formatting", workspace: "billing-observability", branch: "feat/format-expensive-long-running-recordings", model: "claude-opus-4-5", bookmarked: false, usage: usage(12_345.67, 10_000_000), messageCount: 10_000, toolCount: 10_000, startedAt: "2026-01-05T12:00:00Z", updatedAt: "2026-01-05T22:00:00Z" },
] as const;

export async function installSessionLayoutFixture(page: Page) {
  await page.route("**/api/sessions?*", async route => {
    const response = await route.fetch();
    const pageData = await response.json() as SessionPage;
    const items = rows.map((overrides, index) => ({ ...pageData.items[index % pageData.items.length], ...overrides }));
    await route.fulfill({ response, json: { ...pageData, items, total: items.length, limit: items.length, sessionsWithUsage: items.filter(item => item.usage.requests > 0).length } });
  });
}
