export const DEMO_MARKER_FILE = ".blackbox-demo";
export const DEMO_SESSION_COUNT = 15;
export const DEMO_TOOL_RESULT_KEYWORD = "retryBudget";

export const DEMO_SESSION_IDS = {
  orbitAuthHero: "10000000-0000-4000-8000-000000000001",
  orbitRefresh: "10000000-0000-4000-8000-000000000002",
  orbitQueue: "10000000-0000-4000-8000-000000000003",
  orbitOnboarding: "10000000-0000-4000-8000-000000000004",
  atlasBilling: "10000000-0000-4000-8000-000000000005",
  atlasWebhooks: "10000000-0000-4000-8000-000000000006",
  atlasRateLimits: "10000000-0000-4000-8000-000000000007",
  atlasChangelog: "10000000-0000-4000-8000-000000000008",
  designCommandPalette: "10000000-0000-4000-8000-000000000009",
  designTokens: "10000000-0000-4000-8000-00000000000a",
  designEmptyStates: "10000000-0000-4000-8000-00000000000b",
  blackboxSearch: "10000000-0000-4000-8000-00000000000c",
  blackboxProvenance: "10000000-0000-4000-8000-00000000000d",
  blackboxLiveReplay: "10000000-0000-4000-8000-00000000000e",
  blackboxDemoCatalog: "10000000-0000-4000-8000-00000000000f",
} as const;

export const DEMO_HERO_SESSION_ID = DEMO_SESSION_IDS.orbitAuthHero;
export const DEMO_HERO_TITLE = "Make the authentication flow feel effortless";

export const DEMO_WORKSPACES = [
  "orbit",
  "orbit-auth",
  "atlas-api",
  "design-system",
  "blackbox",
] as const;
