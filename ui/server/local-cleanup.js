import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

const CANDIDATES = Object.freeze([
  "ui/output",
  "ui/.playwright-cache/npm",
  "ui/.playwright-cache/home/Library/Caches/node-gyp",
  "ui/.playwright-cache/home/Library/Caches/com.apple.python",
  "ui/.npm-cache",
  "ui/.DS_Store",
  ".DS_Store"
]);

const PROTECTED = Object.freeze([
  "ui/.playwright-cache/browsers",
  ".gcp-vm-console/records",
  ".gcp-vm-console/jobs",
  ".gcp-vm-console/legacy-iac-archive"
]);

function inside(base, target) {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function existingStat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function measuredBytes(target, allowedRoot) {
  const metadata = await existingStat(target);
  if (!metadata) return 0;
  if (metadata.isSymbolicLink()) {
    let resolved;
    try {
      resolved = await realpath(target);
    } catch {
      throw new Error(`Symlink escape or broken link rejected: ${path.basename(target)}`);
    }
    if (!inside(allowedRoot, resolved)) {
      throw new Error(`Symlink escape rejected: ${path.basename(target)}`);
    }
    return metadata.size;
  }
  if (!metadata.isDirectory()) return metadata.size;
  const entries = await readdir(target, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) total += await measuredBytes(path.join(target, entry.name), allowedRoot);
  return total;
}

async function inspectCandidate(projectReal, projectRoot, relativePath) {
  const target = path.resolve(projectRoot, relativePath);
  if (!inside(projectRoot, target)) throw new Error(`Cleanup path escapes project root: ${relativePath}`);
  const metadata = await existingStat(target);
  if (!metadata) return { relativePath, target, exists: false, bytes: 0 };
  if (metadata.isSymbolicLink()) throw new Error(`Cleanup root symlink rejected: ${relativePath}`);
  const targetReal = await realpath(target);
  if (!inside(projectReal, targetReal)) throw new Error(`Cleanup path escapes project root: ${relativePath}`);
  const bytes = await measuredBytes(target, targetReal);
  return { relativePath, target, exists: true, bytes };
}

export function cleanupCandidates() {
  return [...CANDIDATES];
}

export async function runLocalCleanup({ projectRoot, apply = false } = {}) {
  if (!projectRoot) throw new Error("projectRoot is required.");
  const root = path.resolve(projectRoot);
  const projectReal = await realpath(root);
  const inspected = [];
  for (const relativePath of CANDIDATES) {
    inspected.push(await inspectCandidate(projectReal, root, relativePath));
  }

  const beforeBytes = inspected.reduce((total, item) => total + item.bytes, 0);
  if (apply) {
    for (const item of inspected) {
      if (item.exists) await rm(item.target, { recursive: true, force: true });
    }
  }

  const afterItems = apply
    ? await Promise.all(CANDIDATES.map((relativePath) => inspectCandidate(projectReal, root, relativePath)))
    : inspected;
  const afterBytes = afterItems.reduce((total, item) => total + item.bytes, 0);

  return {
    mode: apply ? "apply" : "dry-run",
    beforeBytes,
    afterBytes,
    potentialBytes: beforeBytes,
    reclaimedBytes: apply ? Math.max(0, beforeBytes - afterBytes) : 0,
    items: inspected.map(({ relativePath, exists, bytes }) => ({ relativePath, exists, bytes })),
    protectedPaths: [...PROTECTED]
  };
}
