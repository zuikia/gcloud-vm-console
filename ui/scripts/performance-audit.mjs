import { brotliCompressSync, gzipSync } from "node:zlib";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPerformanceReport, compressionSavings } from "../server/performance-audit.js";

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectRoot = path.dirname(uiRoot);

async function treeBytes(target) {
  try {
    const entry = await lstat(target);
    if (entry.isSymbolicLink()) return 0;
    if (entry.isFile()) return entry.size;
    if (!entry.isDirectory()) return 0;
    const children = await readdir(target);
    const sizes = await Promise.all(children.map((child) => treeBytes(path.join(target, child))));
    return sizes.reduce((total, size) => total + size, 0);
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function assetMetrics(relativePath) {
  const body = await readFile(path.join(uiRoot, relativePath));
  const gzipBytes = gzipSync(body).byteLength;
  const brotliBytes = brotliCompressSync(body).byteLength;
  return {
    name: relativePath,
    bytes: body.byteLength,
    gzipBytes,
    brotliBytes,
    gzipSavingsPercent: compressionSavings(body.byteLength, gzipBytes),
    brotliSavingsPercent: compressionSavings(body.byteLength, brotliBytes)
  };
}

const [assets, diskEntries, serverSource, appSource] = await Promise.all([
  Promise.all([
    assetMetrics("public/index.html"),
    assetMetrics("public/app.js"),
    assetMetrics("public/styles.css")
  ]),
  Promise.all(Object.entries({
    public: path.join(uiRoot, "public"),
    server: path.join(uiRoot, "server"),
    playwrightCache: path.join(uiRoot, ".playwright-cache"),
    npmCache: path.join(uiRoot, ".npm-cache"),
    output: path.join(uiRoot, "output"),
    legacyArchive: path.join(projectRoot, ".gcp-vm-console", "legacy-iac-archive"),
    records: path.join(projectRoot, ".gcp-vm-console", "records"),
    jobs: path.join(projectRoot, ".gcp-vm-console", "jobs")
  }).map(async ([name, target]) => [name, await treeBytes(target)])),
  readFile(path.join(uiRoot, "server.js"), "utf8"),
  readFile(path.join(uiRoot, "public", "app.js"), "utf8")
]);

const report = buildPerformanceReport({
  assets,
  disk: Object.fromEntries(diskEntries)
});

report.sourceSignals = {
  staticNoStore: /"cache-control":\s*"no-store"/.test(serverSource),
  refreshCalls: (appSource.match(/await refreshResources\(\)/g) || []).length,
  doctorSyncCalls: (appSource.match(/await syncDoctorAfterEvidenceChange\(\)/g) || []).length,
  appBytes: Buffer.byteLength(appSource)
};
report.generatedAt = new Date().toISOString();

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
