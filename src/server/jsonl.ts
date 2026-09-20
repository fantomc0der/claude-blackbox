import { open } from "node:fs/promises";
import { object } from "./normalize";

export interface JsonLine {
  offset: number;
  nextOffset: number;
  value: Record<string, unknown> | null;
  malformed: boolean;
}

export async function* readJsonLines(path: string, start: number, end: number): AsyncGenerator<JsonLine> {
  const file = await open(path, "r");
  let position = start;
  let lineOffset = start;
  let pending = Buffer.alloc(0);
  try {
    while (position < end) {
      const chunk = Buffer.allocUnsafe(Math.min(256 * 1024, end - position));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      position += bytesRead;
      pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      let newline = pending.indexOf(10);
      while (newline !== -1) {
        const nextOffset = lineOffset + newline + 1;
        const line = pending.subarray(0, newline).toString("utf8").trim();
        let value: Record<string, unknown> | null = null;
        if (line) {
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) value = object(parsed);
          } catch {}
        }
        yield { offset: lineOffset, nextOffset, value, malformed: Boolean(line) && value === null };
        pending = pending.subarray(newline + 1);
        lineOffset = nextOffset;
        newline = pending.indexOf(10);
      }
    }
    if (pending.length) {
      try {
        const parsed = JSON.parse(pending.toString("utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          yield { offset: lineOffset, nextOffset: position, value: object(parsed), malformed: false };
        }
      } catch {}
    }
  } finally {
    await file.close();
  }
}
