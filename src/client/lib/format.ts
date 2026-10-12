import type { Session, UsageSummary } from "../../shared/types";

export function dollars(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function usageCost(usage: UsageSummary): string {
  if (!usage.requests) return "Not recorded";
  if (usage.unpricedRequests === usage.requests) return "Unavailable";
  return dollars(usage.costUSD) + (usage.unpricedRequests ? "+" : "");
}

export function tokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
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
