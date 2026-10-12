export interface SearchTerm { value: string; exclude: boolean }

export function parseSearch(query: string): SearchTerm[] {
  const terms: SearchTerm[] = [];
  const matcher = /(-?)(?:"([^"]+)"|(\S+))/g;
  for (const match of query.slice(0, 1000).matchAll(matcher)) {
    const value = (match[2] || match[3] || "").trim();
    if (value) terms.push({ value, exclude: match[1] === "-" });
    if (terms.length === 12) break;
  }
  return terms;
}

export function ftsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function pageNumber(value: string | null, fallback: number, maximum: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.min(Number(value), maximum);
}

export function numericBound(value: string | null, integer = false): number | null {
  if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER && (!integer || Number.isSafeInteger(number)) ? number : null;
}

// A plain `YYYY-MM-DD` date bounds a whole calendar day: in UTC, or in the zone `offset` minutes east of UTC when that
// is a whole number within 14 hours of UTC either way, which covers every real zone (-12:00 to +14:00) with room to
// spare. Any other offset is ignored, leaving the UTC day.
export function dateBound(value: string | null, end = false, offset: string | null = null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const minutes = offset && /^[+-]?\d{1,3}$/.test(offset) ? Number(offset) : NaN;
  if (value.length === 10 && Math.abs(minutes) <= 840) {
    const zone = `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
    return dateBound(`${value}T${end ? "23:59:59.999" : "00:00:00"}${zone}`);
  }
  if (value.length > 10 && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const calendar = Date.parse(value.slice(0, 10));
  if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (value.length === 10 && date.toISOString().slice(0, 10) !== value) return null;
  if (end && value.length === 10) date.setUTCMilliseconds(86399999);
  return date.toISOString();
}
