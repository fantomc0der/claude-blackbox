# Commands run overview

The session overview counts distinct Bash and PowerShell command texts and their runs across the whole recording. Selecting a row opens its latest run; the adjacent disclosure lists repeated runs. Searches and WebFetch calls have separate totals and retain the same replay navigation, filtering, and recorded-outcome behavior.

## Classification

- A single, recognizable program keeps a program group. Executable paths and Windows `.exe`, `.cmd`, and `.bat` suffixes normalize to the program name.
- Inline Bash environment assignments can precede a single program, such as `MODE=test python check.py`. Assignment-only calls never become program names.
- Chains (including `cd … && …`), pipelines, multiline scripts, shell interpreters, control flow, command substitutions, and ambiguous input go to **Other commands**. The classifier deliberately does not guess a dominant command or parse embedded shell code.
- Quotes protect literal operators in arguments: `python -c "print(1); print(2)"` is Python, and an ampersand in a quoted URL does not create a chain. Ordinary output redirects do not create another program. Unsupported syntax falls back conservatively.
- Known runtimes, compilers, package managers, and build/test tools appear in **Language & build tools**, still grouped by program. Recognized HTTP clients appear in **Network**, beside WebFetch calls. The allowlists live in `src/server/command-parts.ts`; unknown single programs remain visible under their own names. `wc` is a text utility, not a network tool.
- **Searches** keeps Grep, Glob, and WebSearch calls. All four disclosures start closed; category run/fetch totals and errors/stops remain visible while closed. Program groups inside a category retain frequency ordering.

## Faithful previews

Every shell row shows the original first non-empty line, capped for the sidebar, plus a count of additional non-empty lines. No setup fragments are moved below a guessed executable. The tooltip contains the bounded original command; opening the run reveals the recorded call in full. WebFetch rows show the URL with their prompt beneath it and deduplicate by URL and prompt.

Classification never executes a command, expands a variable, resolves an alias, or fetches a URL. Outcome badges describe the recorded tool result, not inferred success of every command in a pipeline. Subagent activity is not included. Existing group, command, and run limits still apply; overflow programs join Other, and the overview reports when its lists are shortened. This summary is computed from existing records and needs no index migration.
