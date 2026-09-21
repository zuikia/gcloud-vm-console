import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACTIVE_PUBLIC_EXTENSIONS = new Set([".css", ".html", ".js"]);

function collectFiles(root, relativeDirectory, accept) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];
  const files = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(root, relativePath, accept));
    else if (entry.isFile() && accept(relativePath)) files.push(relativePath);
  }
  return files;
}

export function computeRuntimeRevision({
  uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
} = {}) {
  const root = path.resolve(uiRoot);
  const direct = ["package.json", "package-lock.json", "server.js", path.join("scripts", "runtime-revision.mjs")]
    .filter((relativePath) => existsSync(path.join(root, relativePath)) && lstatSync(path.join(root, relativePath)).isFile());
  const serverFiles = collectFiles(root, "server", (relativePath) => path.extname(relativePath) === ".js");
  const publicFiles = collectFiles(root, "public", (relativePath) => ACTIVE_PUBLIC_EXTENSIONS.has(path.extname(relativePath)));
  const files = [...new Set([...direct, ...serverFiles, ...publicFiles])].sort();
  const hash = createHash("sha256").update("gcp-vm-console-runtime-v1\0");
  for (const relativePath of files) {
    hash.update(relativePath.split(path.sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(path.join(root, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${computeRuntimeRevision()}\n`);
}
