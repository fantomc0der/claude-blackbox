# Library: search, filters, and workspaces

The session library lists every indexed recording. This guide covers finding recordings: full-record search, filters, sorting, workspace groups, subagent visibility, and indexing status. To read a recording once it is open, see [Replay](replay.md). For tokens and estimated cost, see [Usage and cost](usage-and-cost.md).

## Search

Full-record search covers prompts, assistant responses, reasoning, file paths, commands, tool inputs/results, and recorded metadata. Matching snippets link directly to their events, and each result keeps its folder and branch beneath the snippet. Press `Ctrl/⌘ K` or `/` to focus it.

Search words combine with AND, including matches in different events of the same session. Quote phrases and prefix exclusions with a minus sign:

```text
authentication retry
"default limit" -timeout
src/auth.ts
```

Transcript search uses Unicode word/phrase tokenization, not regular expressions or fuzzy matching. Session titles and workspace metadata also support substring matches. Calendar date bounds and displayed event times both use your browser's local timezone.

A library search result opens at the matching record; see [Investigating long recordings](replay.md#investigating-long-recordings).

### Session titles

A recording is titled the way Claude Code's own `--resume` picker titles it: by its agent name, else the title `/rename` gave it, else the title Claude Code generated, else the summary an older version wrote, else its first prompt, which skips the slash command, local command output, hook, interruption, and IDE context records the picker skips. A later title of the same kind replaces the earlier one, and a title of a lower kind never replaces one of a higher kind.

## Filters

Combine filters for workspace group, original folder, any recorded model, recorded effort, Claude Code version, branch, last-activity date, observed tool, file changes, errors, recent activity, bookmarks, main/subagent recordings, pricing coverage, and optional cost/token/record-count bounds. All filters and sorts are read-only and never modify source transcripts.

Library filters select **whole recordings**:

- A model filter matches historical model evidence, not just the last model displayed on a recording. A model/effort drill-down requires that pair on the same usage request.
- The **Claude Code version** filter matches any record that names that version, so a recording whose records name two versions, as a resumed session's can, matches both; the replay header and session details show the last version named.
- Tool filters match observed names exactly, with a separate MCP-tool family option.
- Last-activity presets are rolling windows ending now and replace custom date bounds; **From** and **Through** cover whole local calendar days.
- "Recently active" means a recording changed within two minutes, not that a Claude process has been independently verified as running.
- Cost bounds use only recordings with complete pricing coverage, so a partial estimate cannot silently qualify as a known final amount. Token bounds exclude recordings without usage. A recorded zero remains distinct from missing or entirely unpriced usage.
- Filter choices show up to 200 values per dimension and indicate when that list is limited. Malformed or oversized metadata stays available in raw records and full-record search rather than becoming misleading filter choices.

Resetting filters preserves your chosen recording order.

### Recorded span and active time

Recorded span is the time between first and last recorded timestamps, including pauses, not measured execution time. **Active time** is measured: Claude Code 2.1.27x and later end each turn with a `turn_duration` record timing it from the prompt to the reply, and a recording's active time is the sum of those turns, shown as **5m 36s active** beside the span and in the replay header and session details. A recording that stayed open for a day and worked for six minutes ranks first by span and near last by active time. Older recordings say **Active time not recorded** rather than zero.

The session details also show the time Claude Code's own tracker measured in API calls and in tools when the recording carries a `cost-state` record; its `totalDuration` is left out because that clock is restored across resumes, so it can exceed the recording's own span.

### API bounds

Date-only API bounds cover UTC days unless `afterTz` or `beforeTz` gives that bound's offset in minutes east of UTC (within ±840); the interface sends the offset in effect on each chosen day, so a range across a daylight-saving change still runs from local midnight to local midnight. Timestamp bounds must include `Z` or an explicit offset. Invalid numeric bounds are ignored by the API; reversed valid bounds match nothing.

## Sorting

Sort recordings by recent or oldest activity, most records (every record Claude Code wrote, including its own session state and API request copies), highest/lowest estimated cost or tokens, most errors or tool calls, longest active time, longest recorded span, or title. Ranking covers all matching recordings before pagination; unknown usage is not treated as zero, and a recording without measured turns ranks after every measured one rather than as zero active time.

## Workspaces

### Workspace groups

Reversible workspace groups give worktrees or clones one shared history without moving files. Original working directories remain visible and filterable: grouped rows read "Orbit › orbit-auth", and an open replay names its folder, branch, recorded span, model, and, on a wide pane, the Claude Code version that wrote it under the title. Grouping is explicit—not guessed from similar folder names. **Ungroup** takes effect at once and offers **Undo** for 10 seconds, held open while the pointer or keyboard focus is on it, which restores the same group, folders, and workspace selection.

### Sidebar

Sort the sidebar by most sessions (default), highest estimated cost, or folder name A–Z. Name sorting uses natural order (for example, `project-2` before `project-10`) and a group's display name. The choice stays in this browser. Use the sidebar search button to filter workspace names or any original folder path without changing session-search filters. See [Usage and cost](usage-and-cost.md#where-usage-appears) for how the cost order is computed.

## Subagents

Main sessions are shown by default. **Show subagents**, the switch beside the session library's **Filters** button, includes delegated recordings across all workspaces, session lists, and sidebar counts; the setting stays with your current URL as you browse folders and groups. Agent-only workspaces are hidden while the toggle is off. Subagent rows carry an explicit **Subagent** label on the metadata line below the title, including in compact and mobile lists, without taking width away from the title. **Subagents only** in **Filters** lists subagent recordings alone, and an **Including subagents** chip confirms when the switch is on. Workspace cost sorting and usage totals still include all recordings, including hidden subagents.

The toggle filters archive discovery, not linked recordings: [session family navigation](replay.md#subagents-and-session-families) works with it off.

## Indexing status

- **Progress:** beside **Rescan recordings** in the sidebar, longer scans show recording files checked out of the discovered total. Finding files is a separate stage because the total is not known yet. The first scan after an update that changes how recordings are read starts with **Upgrading index**, which shows only a percentage, while the recordings already indexed stay available. Quick background checks stay quiet; when idle, the status shows the indexed recording count. Progress counts files, not individual messages.
- **Unrecognized records:** when the index holds records of a type, or a `system` or `attachment` subtype, that this build does not recognize, an alert glyph follows the indexed recording count; its tooltip counts them, names a few of their kinds, and says that a different Claude Code version may have changed its recording format. Those records still appear under **All events**, where **Raw event** shows them in full.
- **Scan failures:** a quiet warning identifies an incomplete index while keeping indexed recordings available. Failures are announced to assistive technology even with mobile navigation closed; Rescan retries the scan without clearing the visible usage breakdown.

Large libraries use bounded result pages and on-demand tool bodies instead of mounting the entire archive. Files are tracked by source identity, size, modification time, and byte checkpoints; truncated/replaced files and interrupted indexing are reconciled. Malformed complete records are counted as warnings; incomplete trailing writes wait for completion.
