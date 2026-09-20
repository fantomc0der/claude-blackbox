import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";

export async function removeTestDirectory(directory: string): Promise<void> {
  const target = resolve(directory);
  const temporary = resolve(tmpdir()) + sep;
  if (!target.startsWith(temporary) || !basename(target).startsWith("blackbox-")) {
    throw new Error(`Refusing to remove an unexpected test directory: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
}
