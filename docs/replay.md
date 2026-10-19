# Replay

Opening a recording replays its events in their original sequence. This guide covers the replay views, finding and filtering inside a recording, how the records Claude Code writes for itself are shown, errors, subagent navigation, and live updates. To find recordings, see [Library](library.md).

## Views

Structured replay renders Markdown, tables, code, bounded line diffs, terminal output, file reads/writes, checklists, questions, delegated tasks, reasoning, and errors. Tool results are linked across event boundaries: **Conversation** and **Tools** show each result inside its call's card, and a result shown on its own, as under **Errors**, names the tool and command that produced it. Unknown records stay available under **All events** and **Raw event**, where complete JSON payloads, including ones embedded in recorded text such as hook `stdout`, are syntax highlighted in both themes. Every tool row has a copy button beside its disclosure that copies the call's path, command, query, or pattern without opening it; the expanded panels keep **Copy** for their content.

**Conversation** hides internal metadata/context records; **All events** retains them. The **Conversation**, **Tools**, **Errors**, and **All events** tabs are views rather than filters, so choosing one never raises the **Filters** count. **Focused replay view** adds the prompts, responses, edits, thinking, and system views, and the count reflects those and every other constraint the active tab does not already show.

### Overview rail

Large displays also show recording metadata and an overview rail that switches between an outline of the current page, the prompts you typed across the whole session (slash and `!` shell commands included, each noting the errors and stopped tools that followed it), and the files the session changed, grouped under its working directory and any folders added with `/add-dir`, with files in Claude Code's per-session scratchpad set apart from other locations, and the shell commands it ran, deduplicated and grouped by program with each one's run count, failures, and stopped runs, so whether the tests ran and what happened is visible without scrolling.

The **Commands run** overview groups simple commands by program behind closed disclosures for source control, files and text, language/build tools, and network activity, with ambiguous shell scripts under Other commands and also listed as steps under each program they call. See [command grouping and previews](command-overview.md) for the classification rules.

## Find in a recording

Type a term in **Find in this recording** to highlight it in place. Press Enter and Shift+Enter, or use the arrow buttons, to step to the next and previous matching record, with an "n of m" position counted in records across the whole recording under the current view and filters; stepping turns pages as needed and keeps focus in the find box. Turn on **Only matching** to narrow the replay to those records instead. The term and that choice survive reload and browser history. Search within a recording uses literal substring matching.

## Investigating long recordings

Combine literal search with focused prompts, responses, edits, thinking, tools, errors, or system views, plus observed tool/model/directory and local date filters. Scope survives reload and browser history. A library search result opens with the matching record's header at the top of the transcript, the preceding records just above it, and the search term highlighted without narrowing the replay. Matches in conversation open on **Conversation**; matches in tool output or system records open on **All events**. Reveal surrounding context at a finding or jump to the beginning/latest records without changing the original sequence.

### Replay filters

Replay filters select **records inside one recording**, across every page.

- Mixed text/tool/thinking records remain discoverable in each relevant view.
- Model and directory constraints use metadata actually present on each record, not inferred values. Missing timestamps cannot match date bounds.
- The toolbar states one record count that agrees with the footer, such as "12 of 15 records" for a narrowed view or "15 records" for the whole recording; a tool result shown inside its call still counts as a record. Compact counts in the replay toolbar have exact totals in their tooltip and footer.
- Surrounding-context links restore original chronological evidence.
- Changing sessions clears the previous replay scope; library search and filters remain independent.

### Activity strip

Recordings longer than one page show an **activity strip** above the transcript: a bar chart of matching records over local time, with long idle stretches folded into labelled breaks (`95m`, `15h`). The outlined window is the page on screen. Click or drag the strip to open the page that starts at that moment, or focus it and use the arrow keys, Page Up/Down, Home, and End. **Previous** and **Next** sit in the footer beside **Beginning** and **Jump to latest**. Filters change the bar heights but keep the whole recording's time axis, so activity never moves sideways; a faint ghost shows every record behind the matches.

## Records Claude Code writes for itself

Recordings hold more than the conversation. These records keep their place in the sequence, but none of them reads as your words or Claude's reply.

- **Unreturned reasoning.** Reasoning records whose text the API never returned (the default for newer models, which keep only an encrypted signature) stay out of the Conversation and Thinking views and appear under All events as a plain note; when Claude Code recorded how long the model thought, and the API how many thinking tokens it spent, the note says so (**thought for 12s (1,840 thinking tokens)**), as does the **Reasoning** summary of a readable step.
- **Turn timing.** A turn's `turn_duration` record reads under All events as a timestamped system note, **Turn took 2m 0s · measured by Claude Code**, rather than as a dump of its fields.
- **API request copies.** Newer Claude Code versions also store each message an API request adds as an untimed `api-request-blob` copy just before the `api-request` record. The assistant turns, tool calls and results, and reasoning in those copies repeat other records, so they add no tool calls, tool counts, or search hits; the copies' user and system text stays searchable where no other record holds it, because it includes context Claude Code composed for the request, such as hook output. The copy of the message sent for a prompt repeats the prompt beside that context, so its copy of the prompt is left out and Find and library search count the prompt once, on its user record. Wherever a copy and its request share a page, the copy reads inside the request's card under **messages stored with this request**.
- **Bookkeeping and session state.** The same versions keep Claude Code's own bookkeeping and session state in the recording, filed the way Claude Code files them: bookkeeping such as `last-prompt` after every turn and file history snapshots, and session state, where the latest record of a kind is the current value, such as `atis-latch` after every turn, a `queue-operation` for a queued prompt, `cost-state`, `permission-mode`, titles, and summaries. None carries a message. They add no conversation content or tool calls, and the prompt that `last-prompt` and `queue-operation` repeat is searchable only on the user record that holds it, so Find and library search count it once. Under All events each reads as a one-line **Bookkeeping** or **Session state** note naming its type, most without a timestamp because Claude Code writes none; **Raw event** shows the whole record.
- **Failed API requests.** When an API request fails for good, Claude Code records the failure itself as an assistant turn with the `<synthetic>` model, as it does for the `No response requested.` note. Such a stand-in reads as a **Claude Code** card in Conversation and All events rather than as Claude's reply, so it never counts as a message or appears under Responses, and an API error counts as an error, labeled with its recorded kind, cause, and HTTP status (**API error · rate limit · usage limit reached · HTTP 429**), under **Errors** and in the library's **With errors** filter.
- **Interruptions.** The interruption marker Claude Code writes as a user record when a turn is interrupted, `[Request interrupted by user]` or `[Request interrupted by user for tool use]` and nothing else, is Claude Code's own in the same way: it reads as a **Claude Code** card rather than as the user's words, so it never counts as a message or appears under Prompts, and the [title rules](library.md#session-titles) skip it.
- **Retry banners.** The retry banner Claude Code streams to its UI while it waits to retry a request is not one: a recording that holds one reads it under All events as a note, **API retry · attempt 2 of 10 · retry after 4s**.

## Errors and stopped tools

Tool filters include matching calls and their recorded results; the **Errors** view and the error constraint narrow that to failures and to the tools a decision stopped: the user, a permission rule, a safety check, a hook, or the auto mode classifier refused the call, or it was interrupted or cancelled before it finished. Each carries its own label (**Permission denied**, **Stopped by hook**, **Blocked by auto mode**, **Not reviewed by auto mode**, **Interrupted**, **Cancelled**) instead of **Error**, taken from the kind Claude Code 2.1.30x files beside the result, or from Claude Code's own message in a recording without one.

Only failures count as errors: a recording whose only flagged result is a decision has no errors, so it stays out of **With errors**, ranks last under **Most errors**, and adds nothing to the error bars. The library row's tooltip, the replay's error count, and **Session details** still say how many of the errors were API errors and how many tool results a decision stopped, such as **3 errors (1 API error) · 2 tools stopped**.

## Subagents and session families

Subagent replays keep an explicit **Subagent** identity beside the title. **Session family** navigation links back to the main session, offers a related-session switcher, and links to the direct parent and originating tool call when those relationships are recorded. This navigation works even with **Show subagents** off: the toggle filters archive discovery, not linked recordings. Main-session relationships use the nested `session/subagents/` recording path, or a shared recorded session ID for legacy `agent-*.jsonl` files in the same project folder. Direct parentage and Agent/Task links require recorded identifiers, never a similar title or prompt. Unknown parents and missing recordings are reported without invented links.

Launch correlation accepts `toolUseResult.agentId` metadata and standalone `agentId:` / `agent_id:` result lines, including parenthetical annotations. An event's top-level `agentId` identifies its owner, not a spawned child. Conflicting identifiers, repeated references and ambiguous filenames do not produce links. Very large families show at most 500 subagents plus the main session with an explicit partial-list notice. The selected recording and unambiguous targets referenced by its own Agent/Task calls take priority, so their preview and full-session links remain useful even outside the initial member window. These links identify the recorded targets; direct parentage and depth remain unknown in a partial family. Archive search can find omitted members.

**Subagents** on a main session, **Session family** on a child, and **Preview conversation** on a linked Agent/Task call open the same read-only preview without changing the current replay or URL. It defaults to **Conversation**, pairs tool results with calls, and supports paging and switching recordings. **Open full session** opens the normal replay for search, filters, bookmarking and raw evidence. Tool cards also offer **Open session** directly. Moving between recordings clears the previous replay filters while preserving archive filters; browser Back restores the prior replay scope and reading position. A child offers **Copy main session resume command** only when its main recording is available, using that recording's identifier and working directory rather than implying that the child is independently resumable.

## Live updates

The local index reconciles every 2.5 seconds. Reconnection refreshes the view. New events do not pull you away from older content: a recording that grows offers **Recording updated · Show latest** instead of changing your page. Reading at the end of the last page keeps new records in view until the page is full. After **Jump to latest** (or that button) the replay follows the newest records across pages for as long as you stay at the end.

## Return to your work

Bookmark a recording with the toggle beside its title, copy its source path or safely quoted resume command, use an event permalink, or export the original parsed records as JSONL. Resume commands use PowerShell literal-path quoting for Windows working directories and POSIX shell quoting for Unix paths. Export retains parsed record values but normalizes JSON whitespace and line endings.
