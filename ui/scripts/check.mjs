import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.dirname(uiRoot);

async function walk(root, predicate) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", "output", ".playwright-cache", ".npm-cache"].includes(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target, predicate));
    else if (predicate(target)) files.push(target);
  }
  return files;
}

function run(command, args, cwd = uiRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const sourceRoots = [
  path.join(uiRoot, "public"),
  path.join(uiRoot, "scripts"),
  path.join(uiRoot, "server"),
  path.join(uiRoot, "test")
];
const sourceFiles = [path.join(uiRoot, "server.js")];
for (const root of sourceRoots) {
  sourceFiles.push(...await walk(root, (target) => /\.(?:js|mjs)$/.test(target)));
}
sourceFiles.sort();

const shellFiles = (await walk(path.join(projectRoot, "scripts"), (target) => target.endsWith(".sh"))).sort();
const testFiles = sourceFiles.filter((target) => target.endsWith(".test.mjs"));

process.stdout.write(`Syntax: ${sourceFiles.length} JavaScript modules, ${shellFiles.length} shell scripts\n`);
for (const target of sourceFiles) run(process.execPath, ["--check", target]);
for (const target of shellFiles) run("bash", ["-n", target], projectRoot);

process.stdout.write(`Tests: ${testFiles.length} files\n`);
run(process.execPath, ["--test", ...testFiles]);
