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
