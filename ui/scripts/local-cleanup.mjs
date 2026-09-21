import path from "node:path";
import { fileURLToPath } from "node:url";

import { runLocalCleanup } from "../server/local-cleanup.js";

const args = new Set(process.argv.slice(2));
const supported = new Set(["--apply", "--json"]);
for (const arg of args) {
  if (!supported.has(arg)) throw new Error(`Unknown option: ${arg}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "../..");
const report = await runLocalCleanup({ projectRoot, apply: args.has("--apply") });

if (args.has("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const mib = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  process.stdout.write(`Local cleanup mode: ${report.mode}\n`);
  for (const item of report.items) {
    process.stdout.write(`- ${item.relativePath}: ${item.exists ? mib(item.bytes) : "not present"}\n`);
  }
  process.stdout.write(`Potential recovery: ${mib(report.potentialBytes)}\n`);
  process.stdout.write(`Reclaimed: ${mib(report.reclaimedBytes)}\n`);
  process.stdout.write(`Protected: ${report.protectedPaths.join(", ")}\n`);
}
