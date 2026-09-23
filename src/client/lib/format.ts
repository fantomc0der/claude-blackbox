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
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (!Number.isFinite(seconds)) return "Unknown";
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dateTime(value: string): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not recorded";
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

export function searchHighlight(query: string): string {
  return query.match(/"([^"]+)"/)?.[1] || query.split(/\s+/).find(term => term && !term.startsWith("-")) || "";
}
