import type { Session } from "../../shared/types";

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
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-/g, " ").replace(/^\w/, value => value.toUpperCase());
}

export function resumeCommand(session: Pick<Session, "cwd" | "sessionId">): string {
  const windows = /^[A-Za-z]:[\\/]/.test(session.cwd) || session.cwd.startsWith("\\\\");
  const quote = (value: string) => windows ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
  const resume = `claude --resume ${quote(session.sessionId)}`;
  return session.cwd ? windows ? `Set-Location -LiteralPath ${quote(session.cwd)}; ${resume}` : `cd -- ${quote(session.cwd)} && ${resume}` : resume;
}

export function searchHighlight(query: string): string {
  return query.match(/"([^"]+)"/)?.[1] || query.split(/\s+/).find(term => term && !term.startsWith("-")) || "";
}
