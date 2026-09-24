import { createProductionRuntime, runRelease } from "./release-workflow";

try {
  await runRelease(Bun.argv.slice(2), createProductionRuntime());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
