import type { ActiveTime, RecordedCost, RecordedCostTotal, Session, UsageSummary } from "../../shared/types";

/** A measured length of time: `42s`, `5m 36s`, `6h 39m`, `1d 3h`. A positive time under half a second reads as `<1s`. */
export function duration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (milliseconds > 0 && seconds === 0) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Where a recording's active time comes from, and why it differs from its recorded span. */
export const activeTimeNote = "Active time is the sum of the turn durations that Claude Code 2.1.27x and later measure and write at the end of each turn, from the prompt to the reply. The recorded span runs from the first to the last recorded timestamp and counts the pauses between turns.";

export function activeTimeSummary(active: ActiveTime): string {
  return `${duration(active.durationMs)} across ${tokenCount(active.turns)} ${active.turns === 1 ? "turn" : "turns"}`;
}

/** Claude Code's own measured API and tool time from its running total, as `7m 30s in API calls · 2m 12s in tools`; empty when it measured neither. */
export function measuredTime(recorded: RecordedCost): string {
  return [recorded.apiDurationMs !== null ? `${duration(recorded.apiDurationMs)} in API calls` : "", recorded.toolDurationMs !== null ? `${duration(recorded.toolDurationMs)} in tools` : ""].filter(Boolean).join(" · ");
}

export const measuredTimeNote = "The tracker behind Claude Code's running total also measures the time its API requests took, retries included, and the time its tools ran, over the same requests the total counts.";

const counted = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** A recording's errors with the API errors among them named, as `3 errors (1 API error)` or `2 API errors`; empty when it has none. */
export function errorBreakdown(session: Pick<Session, "errorCount" | "apiErrorCount">): string {
  const { errorCount: errors, apiErrorCount: apiErrors } = session;
  if (!errors) return "";
  if (apiErrors === errors) return counted(apiErrors, "API error", "API errors");
  return apiErrors ? `${counted(errors, "error", "errors")} (${counted(apiErrors, "API error", "API errors")})` : counted(errors, "error", "errors");
}

/** The tools a decision stopped, which never count as errors, as `2 tools stopped`; empty when none was. */
export function stoppedTools(session: Pick<Session, "decisionCount">): string {
  return session.decisionCount ? counted(session.decisionCount, "tool stopped", "tools stopped") : "";
}

/** A recording's errors and stopped tools together, as `3 errors (1 API error) · 2 tools stopped`; empty when it has neither. */
export function errorSummary(session: Pick<Session, "errorCount" | "apiErrorCount" | "decisionCount">): string {
  return [errorBreakdown(session), stoppedTools(session)].filter(Boolean).join(" · ");
}

/** How long the model thought on a reasoning step, with the thinking tokens the API reported for it when it did. */
export function thinkingSummary(measure: { durationMs: number; tokens: number | null }): string {
  return `thought for ${duration(measure.durationMs)}${measure.tokens !== null ? ` (${tokenCount(measure.tokens)} thinking tokens)` : ""}`;
}

export function dollars(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** Why Claude Code's own total normally runs above the estimate: the estimate covers only the requests a recording holds. */
export const recordedCostNote = "Its running total also counts the session's subagents and the requests Claude Code bills but never writes to a recording, such as prompt suggestions, compaction, summaries, memory extraction, and hook evaluations, so the estimate from the recorded requests is a lower bound.";

/** States Claude Code's own total for one session or for a selection, before `recordedCostNote` explains the gap. */
export function recordedCostSummary(recorded: RecordedCost | RecordedCostTotal): string {
  if (!("recordings" in recorded)) return `Claude Code recorded ${dollars(recorded.costUSD)} for this session.`;
  return `Claude Code recorded ${dollars(recorded.costUSD)} across ${tokenCount(recorded.recordings)} of these recordings.`;
}

/** Claude Code's per-model costs from its running total, largest first, as `model $x · model $y`. */
export function recordedModelCosts(recorded: RecordedCost): string {
  return Object.entries(recorded.models).sort(([, left], [, right]) => right.costUSD - left.costUSD)
    .map(([model, usage]) => `${modelName(model)} ${dollars(usage.costUSD)}`).join(" · ");
}

export function usageCost(usage: UsageSummary): string {
  if (!usage.requests) return "Not recorded";
  if (usage.unpricedRequests === usage.requests) return "Unavailable";
  return dollars(usage.costUSD) + (usage.unpricedRequests ? "+" : "");
}

export function tokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

const modelList = new Intl.ListFormat("en", { type: "conjunction" });

/** Explains which requests have no estimate and why: a model this build has no rates for, which a later release can
 *  price, or else fast mode without a known rate or no recorded model. `unratedModels` names the former when known. */
export function pricingGap(usage: UsageSummary, unratedModels: string[]): string {
  const unrated = usage.unratedRequests, other = usage.unpricedRequests - unrated, several = unratedModels.length > 1;
  const unratedText = (subject: string) => `${subject} ${unrated === 1 ? "uses" : "use"} ${several ? "models" : "a model"} this version of Claude Blackbox has no rates for yet${unratedModels.length ? `: ${modelList.format(unratedModels)}` : ""}.`;
  const otherText = (subject: string) => `${subject} used fast mode without a known rate for ${other === 1 ? "its" : "their"} model, or recorded no model.`;
  const share = `${tokenCount(usage.unpricedRequests)} of ${tokenCount(usage.requests)} requests`;
  const reasons = unrated && other ? `${share} have no estimate. ${unratedText(tokenCount(unrated))} ${otherText(tokenCount(other))}` : unrated ? unratedText(share) : otherText(share);
  const update = unrated ? `, and a release that adds ${several ? "their" : "its"} rates will price ${unrated === 1 ? "it" : "them"}` : "";
  return `Cost is incomplete: ${reasons} ${usage.unpricedRequests === 1 ? "Its" : "Their"} tokens are still included${update}.`;
}

export function effortName(effort: string | null): string {
  if (!effort) return "Not recorded";
  const labels: Record<string, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", auto: "Auto" };
  return Object.hasOwn(labels, effort) ? labels[effort] : effort;
}

export function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function timeAgo(value: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(value)) / 1000);
  if (!Number.isFinite(seconds)) return "Unknown";
  // A stamp up to a minute ahead is clock skew and reads as now. One further ahead reads as its date, since no
  // relative phrase describes it truthfully.
  if (seconds < -60 || seconds >= 604800) return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// The minutes east of UTC that make a plain date bound cover the reader's local calendar day: the offset in effect at
// the day's first moment, or with `end` its last, so a range across a daylight-saving change still runs from local
// midnight to local midnight. Measured from the day's actual local start, which also covers zones that skip midnight.
export function localDayOffset(date: string, end = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const local = new Date(`${date}T${end ? "23:59:59.999" : "00:00:00"}`).getTime();
  const minutes = Math.round((Date.parse(date) + (end ? 86399999 : 0) - local) / 60000);
  return Number.isFinite(minutes) ? minutes : null;
}

// Adds `afterTz` and `beforeTz` for the plain dates in `after` and `before`, so the server bounds them on local days
// while URLs and filter chips keep the dates the reader picked.
export function withLocalDays(query: string): string {
  const params = new URLSearchParams(query);
  for (const key of ["after", "before"]) {
    const offset = localDayOffset(params.get(key) || "", key === "before");
    if (offset === null) params.delete(`${key}Tz`);
    else params.set(`${key}Tz`, String(offset));
  }
  return params.toString();
}

export function dateTime(value: string): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
}

// The span from the first to the last recorded moment: a time range within one day, a date range across days. With
// `days`, a day's times are left out so the range fits narrow panes.
export function recordedRange(start: string, end: string, options: { days?: boolean; locale?: string; timeZone?: string } = {}): string {
  const { days = false, locale, timeZone } = options;
  const times = [Date.parse(start), Date.parse(end)].filter(Number.isFinite);
  if (!times.length) return "Dates not recorded";
  const first = new Date(Math.min(...times)), last = new Date(Math.max(...times));
  const day = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "short" });
  const withTime = !days && day.format(first) === day.format(last);
  return new Intl.DateTimeFormat(locale, withTime ? { timeZone, dateStyle: "medium", timeStyle: "short" } : { timeZone, dateStyle: "medium" }).formatRange(first, last);
}

// The last segment of a recorded working directory, as the server names an ungrouped workspace.
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || "Unknown folder";
}

/** Short names for a set of folders: each takes its last segment, plus as many parent segments as tell it apart. */
export function folderLabels(paths: string[]): Map<string, string> {
  const segments = new Map(paths.map(path => [path, path.replace(/[\\/]+$/, "").split(/[\\/]/)]));
  const label = (path: string, depth: number) => segments.get(path)!.slice(-depth).join(path.includes("\\") ? "\\" : "/") || path;
  return new Map(paths.map(path => {
    let depth = 1;
    while (depth < segments.get(path)!.length && paths.some(other => other !== path && label(other, depth) === label(path, depth))) depth++;
    return [path, label(path, depth)];
  }));
}

export function modelName(model: string): string {
  if (!model || model === "<synthetic>") return "Model not recorded";
  const variant = model.match(/\[[^\]]*\]$/)?.[0] ?? "";
  const name = (variant ? model.slice(0, -variant.length) : model).replace(/^claude-/, "");
  const ordered = name.replace(/-\d{8}$/, "").replace(/^(\d+(?:-\d+)?)-([a-z]+)$/i, "$2-$1");
  const family = ordered.match(/^(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?$/i);
  const label = family ? `${family[1][0].toUpperCase()}${family[1].slice(1).toLowerCase()} ${family[2]}${family[3] ? `.${family[3]}` : ""}` : ordered;
  return variant ? `${label} ${variant}` : label;
}

export function resumeCommand(session: Pick<Session, "cwd" | "sessionId">): string {
  const windows = /^[A-Za-z]:[\\/]/.test(session.cwd) || session.cwd.startsWith("\\\\");
  const quote = (value: string) => windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
  const resume = `claude --resume ${quote(session.sessionId)}`;
  return session.cwd ? windows ? `Set-Location -LiteralPath ${quote(session.cwd)} -ErrorAction Stop; ${resume}` : `cd -- ${quote(session.cwd)} && ${resume}` : resume;
}

// The term the server matched a search result's snippet and record with: its first included term or quoted phrase
// that has a letter or digit, read the same way as `parseSearch` in the server.
export function searchHighlight(query: string): string {
  let terms = 0;
  for (const match of query.slice(0, 1000).matchAll(/(-?)(?:"([^"]+)"|(\S+))/g)) {
    const value = (match[2] || match[3] || "").trim();
    if (!value) continue;
    if (match[1] !== "-" && /[\p{L}\p{N}]/u.test(value)) return value;
    if (++terms === 12) break;
  }
  return "";
}
