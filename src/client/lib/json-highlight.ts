export type JsonTokenKind = "key" | "string" | "number" | "boolean" | "null" | "punctuation";

export interface TextSegment {
  text: string;
  kind?: JsonTokenKind;
}

/** A run of consecutive segments that are all inside, or all outside, a search match. */
export interface MarkedRun {
  match: boolean;
  segments: TextSegment[];
}

/** Values longer than this are shown as plain text instead of being scanned for payloads. */
export const JSON_SCAN_LIMIT = 2_000_000;
/** A value that would split into more segments than this is shown as plain text to bound the DOM. */
export const JSON_SEGMENT_LIMIT = 60_000;

const OPENING = /[{[]/g;
const ATTACHED = /[\w.)\]$]/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y;

type Expect = "value" | "element" | "key" | "member" | "colon" | "next";

interface Scan {
  /** Where scanning stopped: the end of the payload on success, the offending character otherwise. */
  stop: number;
  segments?: TextSegment[];
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x0a || code === 0x0d || code === 0x09;
}

function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 0x22) return index + 1;
    if (code === 0x5c) {
      ESCAPE.lastIndex = index;
      if (!ESCAPE.test(text)) return -1;
      index = ESCAPE.lastIndex;
      continue;
    }
    if (code < 0x20) return -1;
    index++;
  }
  return -1;
}

function scalar(text: string, start: number): { kind: JsonTokenKind; end: number } | undefined {
  const char = text[start];
  if (char === '"') {
    const end = stringEnd(text, start);
    return end === -1 ? undefined : { kind: "string", end };
  }
  if (char === "t" && text.startsWith("true", start)) return { kind: "boolean", end: start + 4 };
  if (char === "f" && text.startsWith("false", start)) return { kind: "boolean", end: start + 5 };
  if (char === "n" && text.startsWith("null", start)) return { kind: "null", end: start + 4 };
  NUMBER.lastIndex = start;
  return NUMBER.test(text) ? { kind: "number", end: NUMBER.lastIndex } : undefined;
}

/**
 * Strictly scans one JSON object or array starting at `start`, emitting a segment per token, whitespace run, or key.
 * Containers without a single key or value, such as a markdown checkbox, do not count as payloads.
 */
function scanPayload(text: string, start: number, limit: number): Scan {
  const segments: TextSegment[] = [];
  const stack: ("object" | "array")[] = [];
  let expect: Expect = "value";
  let index = start;
  let values = 0;
  const push = (end: number, kind?: JsonTokenKind) => {
    segments.push(kind ? { text: text.slice(index, end), kind } : { text: text.slice(index, end) });
    if (kind && kind !== "punctuation") values++;
    index = end;
  };
  const close = (): Scan | undefined => {
    push(index + 1, "punctuation");
    stack.pop();
    if (stack.length) {
      expect = "next";
      return undefined;
    }
    return values ? { stop: index, segments } : { stop: index };
  };
  while (index < text.length && index < limit) {
    const char = text[index]!;
    if (isSpace(text.charCodeAt(index))) {
      let end = index + 1;
      while (end < text.length && isSpace(text.charCodeAt(end))) end++;
      push(end);
      continue;
    }
    const top = stack[stack.length - 1];
    switch (expect) {
      case "value":
      case "element": {
        if (char === "{") { push(index + 1, "punctuation"); stack.push("object"); expect = "key"; continue; }
        if (char === "[") { push(index + 1, "punctuation"); stack.push("array"); expect = "element"; continue; }
        if (char === "]" && expect === "element") { const done = close(); if (done) return done; continue; }
        const token = scalar(text, index);
        if (!token) return { stop: index };
        push(token.end, token.kind);
        expect = "next";
        continue;
      }
      case "key":
      case "member": {
        if (char === "}" && expect === "key") { const done = close(); if (done) return done; continue; }
        if (char !== '"') return { stop: index };
        const end = stringEnd(text, index);
        if (end === -1) return { stop: index };
        push(end, "key");
        expect = "colon";
        continue;
      }
      case "colon":
        if (char !== ":") return { stop: index };
        push(index + 1, "punctuation");
        expect = "value";
        continue;
      case "next":
        if (char === ",") { push(index + 1, "punctuation"); expect = top === "object" ? "member" : "value"; continue; }
        if ((char === "}" && top === "object") || (char === "]" && top === "array")) { const done = close(); if (done) return done; continue; }
        return { stop: index };
    }
  }
  return { stop: index };
}

function nextCandidate(text: string, from: number): number {
  OPENING.lastIndex = from;
  for (let match = OPENING.exec(text); match; match = OPENING.exec(text)) {
    if (match.index === 0 || !ATTACHED.test(text[match.index - 1]!)) return match.index;
  }
  return -1;
}

/**
 * Splits text into segments, tagging every token of each complete JSON object or array it contains.
 * Text outside those payloads, including payloads that fail to parse, stays untagged. The returned
 * segments always concatenate back to the input.
 */
export function jsonSegments(text: string): TextSegment[] {
  if (text.length > JSON_SCAN_LIMIT) return [{ text }];
  const segments: TextSegment[] = [];
  let budget = text.length * 4 + 20_000;
  let plainStart = 0;
  let candidate = nextCandidate(text, 0);
  while (candidate !== -1 && budget > 0) {
    const scan = scanPayload(text, candidate, Math.min(text.length, candidate + budget));
    budget -= scan.stop - candidate + 1;
    if (!scan.segments) {
      candidate = nextCandidate(text, candidate + 1);
      continue;
    }
    if (candidate > plainStart) segments.push({ text: text.slice(plainStart, candidate) });
    for (const segment of scan.segments) segments.push(segment);
    if (segments.length > JSON_SEGMENT_LIMIT) return [{ text }];
    plainStart = scan.stop;
    candidate = nextCandidate(text, scan.stop);
  }
  if (plainStart < text.length) segments.push({ text: text.slice(plainStart) });
  return segments;
}

/** Returns the segments covering the character window `[start, end)`, splitting segments at its edges. */
export function sliceSegments(segments: TextSegment[], start: number, end: number): TextSegment[] {
  const result: TextSegment[] = [];
  let offset = 0;
  for (const segment of segments) {
    const segmentEnd = offset + segment.text.length;
    if (segmentEnd > start && offset < end) {
      const text = segment.text.slice(Math.max(0, start - offset), Math.min(segment.text.length, end - offset));
      if (text) result.push(segment.kind ? { text, kind: segment.kind } : { text });
    }
    offset = segmentEnd;
    if (offset >= end) break;
  }
  return result;
}

/**
 * Groups segments into runs by whether they fall inside a case-insensitive occurrence of `term`,
 * splitting segments at match edges so one match may span several tokens.
 */
export function markSegments(segments: TextSegment[], term: string): MarkedRun[] {
  const result: MarkedRun[] = [];
  const push = (segment: TextSegment, text: string, match: boolean) => {
    if (!text) return;
    const piece = segment.kind ? { text, kind: segment.kind } : { text };
    const last = result[result.length - 1];
    if (last && last.match === match) last.segments.push(piece);
    else result.push({ match, segments: [piece] });
  };
  if (!term) {
    for (const segment of segments) push(segment, segment.text, false);
    return result;
  }
  const lower = segments.map(segment => segment.text).join("").toLowerCase();
  const needle = term.toLowerCase();
  const ranges: [number, number][] = [];
  for (let found = lower.indexOf(needle); found !== -1; found = lower.indexOf(needle, found + needle.length)) ranges.push([found, found + needle.length]);
  let offset = 0;
  let range = 0;
  for (const segment of segments) {
    const length = segment.text.length;
    let local = 0;
    while (local < length) {
      while (range < ranges.length && ranges[range]![1] <= offset + local) range++;
      const current = ranges[range];
      if (!current || current[0] >= offset + length) {
        push(segment, segment.text.slice(local), false);
        local = length;
      } else if (current[0] > offset + local) {
        push(segment, segment.text.slice(local, current[0] - offset), false);
        local = current[0] - offset;
      } else {
        const stop = Math.min(current[1] - offset, length);
        push(segment, segment.text.slice(local, stop), true);
        local = stop;
      }
    }
    offset += length;
  }
  return result;
}
