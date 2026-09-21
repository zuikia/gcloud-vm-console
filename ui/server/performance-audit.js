import path from "node:path";

function finiteEvent(event) {
  return Number.isFinite(event?.startedAt)
    && Number.isFinite(event?.finishedAt)
    && event.finishedAt >= event.startedAt;
}

function counts(values = []) {
  const result = new Map();
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    result.set(value, (result.get(value) || 0) + 1);
  }
  return result;
}

function duplicateRows(values = []) {
  return [...counts(values)]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countRequestWaves(events = []) {
  const valid = events
    .filter(finiteEvent)
    .sort((a, b) => a.startedAt - b.startedAt || a.finishedAt - b.finishedAt);
  if (!valid.length) return 0;

  let waves = 1;
  let waveEnd = valid[0].finishedAt;
  for (const event of valid.slice(1)) {
    if (event.startedAt > waveEnd) {
      waves += 1;
      waveEnd = event.finishedAt;
      continue;
    }
    waveEnd = Math.max(waveEnd, event.finishedAt);
  }
  return waves;
}

export function compressionSavings(originalBytes, compressedBytes) {
  const original = Number(originalBytes);
  const compressed = Number(compressedBytes);
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(compressed)) return 0;
  return Number((((original - compressed) / original) * 100).toFixed(2));
}

export function protectedPathViolations(candidatePaths = [], projectRoot) {
  const root = path.resolve(String(projectRoot || "."));
  const protectedRoots = [
    ".gcp-vm-console/records",
    ".gcp-vm-console/jobs",
    ".gcp-vm-console/legacy-iac-archive",
    "ui/.playwright-cache/browsers"
  ].map((entry) => path.resolve(root, entry));

  return candidatePaths
    .map((entry) => path.resolve(String(entry || "")))
    .filter((candidate) => protectedRoots.some((protectedRoot) => (
      candidate === protectedRoot || candidate.startsWith(`${protectedRoot}${path.sep}`)
    )));
}

export function buildPerformanceReport({
  requestEvents = [],
  gcloudCalls = [],
  renderEvents = [],
  assets = [],
  disk = {}
} = {}) {
  return {
    requestWaves: countRequestWaves(requestEvents),
    duplicateRequests: duplicateRows(requestEvents.map((event) => event?.name)),
    duplicateGcloudCalls: duplicateRows(gcloudCalls),
    renderCounts: Object.fromEntries([...counts(renderEvents)].sort(([a], [b]) => a.localeCompare(b))),
    assets: assets.map((asset) => ({ ...asset })),
    disk: { ...disk }
  };
}
