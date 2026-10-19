# Usage and cost

claude-blackbox shows tokens and USD API-equivalent cost for each recording, source folder, or workspace group, beside Claude Code's own recorded total when a recording carries one. Costs are **API-equivalent estimates, not Claude Pro/Max subscription charges or a billing statement**. Historical prices, provider discounts and server-side tool fees may differ.

## Where usage appears

- **Usage summary:** expand **Usage** for input/output/cache totals and a clickable folder breakdown, which opens at the top of the recording list and scrolls away with the rows. Totals cover every matching page and follow the existing filters; hidden subagent recordings still count.
- **Model & effort:** expand **Usage** and choose **Model & effort** to compare estimated expenses within the selected workspace group or filtered recordings. Each row shows a model/effort pair, unique request count, tokens, and estimated USD; the total reconciles with the group summary. Breakdowns can be ordered by cost, tokens, or name. Select a model/effort row to find recordings containing that pair; totals still include every request in those recordings. **Folders** returns to the original-folder breakdown. A single-folder selection shows the model matrix directly.
- **Sidebar cost order:** the sidebar's **Highest cost (est.)** order covers every session and folder in each workspace, independently of the current date, search, bookmark, or other session filters. Copied requests count once within a workspace group; separate, ungrouped workspaces each show their own total. Missing or entirely unpriced usage sorts after known costs, including a recorded zero. Partial totals carry `+`; they rank by the known amount, not an assumed final cost.
- **Quiet refreshes:** existing totals and the expanded breakdown stay visible while a small dot indicates a background refresh. Slow requests finish before queued updates run; pagination and sorting retain the same usage selection, while a different filter waits for its own totals.

## Model and effort attribution

Model and effort are attributed per request, not from a recording's last model. Model aliases, dated IDs and gateway-style IDs such as `anthropic/claude-opus-5.5` are normalized consistently with pricing. Effort is read only from explicit `effort` or `output_config.effort` fields on the assistant record or message. When absent, it is **Not recorded**—never inferred from model, token count, thinking blocks, or current Claude settings. This groups existing token costs; it does not apply an effort surcharge. Duplicate streaming updates retain recorded effort, and older indexes rebuild this metadata automatically.

## How costs are estimated

Usage comes directly from assistant `message.usage` records in the indexed JSONL transcripts; no account, network request, or ccusage installation is required.

- Recorded nonnegative `costUSD` values take precedence.
- Otherwise, the bundled per-model [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing) snapshot (October 16, 2026) estimates input, output, cache writes (5-minute and 1-hour), and cache reads.
- Recognized fast-mode and US-inference metadata are applied, along with Claude Haiku 5.5's higher rates for prompts over 100,000 tokens and legacy Sonnet 4/4.5 long-context rates.
- When a request lists the API's server-side steps in `usage.iterations`, the estimate follows Claude Code's own cost tracker: an advisor's tokens are added and priced at the advisor model's rates, and a server-side fallback is priced from its hops, each at its own model's rates, with the last hop free when the reply still ended in a refusal. Where a request's steps add up to more than one of its top-level counts, the larger is kept, which Claude Code's tracker does not do.
- When a release changes a model's bundled rates or the pricing rules, the recordings that used it are re-indexed once so every estimate uses the same snapshot.

### Unpriced requests

Unknown models or unsupported fast-mode rates remain unpriced rather than borrowing another model's rates, because new models often launch at very different prices. Requests on a service tier other than standard, such as priority, also remain unpriced: Claude Code prices them at standard rates, but the API does not, and this version has no rates for them. So do requests that presented a fallback credit, whose billing the API decides.

Their tokens still count, the UI marks the cost incomplete, and the usage note states why each unpriced request has no estimate, naming the recorded models this version has no rates for, which are also flagged as **Model not recognized** in the model breakdown.

## Claude Code's recorded total

The estimate covers the requests a recording holds, and for recordings written by Claude Code 2.1.27x and later it is a **lower bound** of what Claude Code billed. Those versions also run requests that never reach the recording, such as prompt suggestions, compaction, away and agent summaries, memory extraction, and hook evaluations, several of them after every turn against the full cached context, and they write their own running total into the recording as a `cost-state` record that counts those requests and the session's subagents.

When a recording carries that record, its row, the replay header, the session details, and the usage notes show **Claude Code recorded $X** beside the estimate, with Claude Code's per-model split in the details. The gap is expected, often a quarter or more of the recorded total, and is stated rather than flagged as an anomaly; where both figures cover the same requests, the estimate matches Claude Code's own cost to the cent. Claude Code's per-model keys are its requested model strings, normalized the same way as the estimate's models; a `@preset/…` key stays as recorded.

## Deduplication and subagents

Repeated assistant messages are deduplicated by message/request identity, including across selected recordings. More complete streaming usage replaces earlier samples. Distinct subagent requests count once. Records without stable IDs cannot reliably be deduplicated across files.

Usage totals always include the subagent recordings that match the other filters, even while **Show subagents** is off, so a workspace's breakdown matches its sidebar cost; **Subagents only** totals the subagent recordings alone. Recording rows, the replay header, cost sorting and cost bounds use each recording's own requests, so with subagents hidden the visible rows add up to less than the total; the expanded breakdown states the hidden share. Shared history is assigned to one source folder within an aggregate, so adding individual recording totals can exceed the deduplicated selection total.

## Attribution and filters

Folder attribution follows each recording's original working directory, consistent with workspace grouping; it does not split a recording when later events change directory. Date, model, search and other filters select **whole recordings**, not individual usage requests (date filters use the recording's last activity). Missing usage is not zero spend: the expanded summary shows how many matching recordings report usage. Partial-cent costs display as `<$0.01` rather than `$0.00`.

## Index upgrades

The derived index upgrades automatically and rebuilds usage from existing recordings on first launch after this update. Source transcripts, bookmarks and workspace groups are preserved. Pricing is offline and versioned with the application; changing bundled rates requires reindexing existing usage.
