import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALWAYS_FREE_REGION_IDS,
  createRegionCatalog,
  firstZoneForRegion,
  regionFromZone
} from "../server/region-catalog.js";

function createRunner({ zones, error } = {}) {
  const calls = [];
  return {
    calls,
    runner: {
      async runJson(command, options) {
        calls.push({ command, options });
        if (error) throw error;
        return { data: zones };
      }
    }
  };
}

async function tempCache(t) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "gcp-region-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

test("region catalog derives grouped regions, zones, and free-tier labels from gcloud zones", async (t) => {
  const cacheDir = await tempCache(t);
  const fake = createRunner({
    zones: [
      { name: "us-west1-a", region: "https://www.googleapis.com/compute/v1/projects/p1/regions/us-west1", status: "UP" },
      { name: "us-west1-b", region: "https://www.googleapis.com/compute/v1/projects/p1/regions/us-west1", status: "UP" },
      { name: "us-west1-c", region: "https://www.googleapis.com/compute/v1/projects/p1/regions/us-west1", status: "UP" },
      { name: "europe-west9-a", region: "https://www.googleapis.com/compute/v1/projects/p1/regions/europe-west9", status: "UP" },
      { name: "asia-southeast2-a", region: "https://www.googleapis.com/compute/v1/projects/p1/regions/asia-southeast2", status: "UP" }
    ]
  });
  const service = createRegionCatalog({
    runner: fake.runner,
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z"
  });

  const catalog = await service.load({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.deepEqual([...ALWAYS_FREE_REGION_IDS], ["us-west1", "us-central1", "us-east1"]);
  assert.equal(catalog.freeRegionIds.includes("us-west1"), true);
  assert.equal(catalog.freeRegionIds.includes("europe-west9"), false);
  assert.equal(catalog.regions.find((region) => region.id === "us-west1").freeTier, "always_free");
  assert.equal(catalog.regions.find((region) => region.id === "us-west1").label, "美国/俄勒冈");
  assert.equal(catalog.regions.find((region) => region.id === "europe-west9").label, "法国/巴黎");
  assert.equal(catalog.regions.find((region) => region.id === "asia-southeast2").label, "印度尼西亚/雅加达");
  assert.deepEqual(catalog.regions.find((region) => region.id === "us-west1").zones, ["us-west1-a", "us-west1-b", "us-west1-c"]);
  assert.equal(catalog.regions.find((region) => region.id === "europe-west9").group, "Europe");
  assert.equal(catalog.regions.find((region) => region.id === "asia-southeast2").group, "Asia Pacific");
  assert.equal(catalog.source.kind, "gcloud-derived");
  assert.equal(catalog.source.account, "user@example.com");
  assert.equal(catalog.source.projectId, "project-a");
  assert.deepEqual(fake.calls[0].command, ["compute", "zones", "list"]);
});

test("region catalog writes source metadata to cache", async (t) => {
  const cacheDir = await tempCache(t);
  const fake = createRunner({
    zones: [
      { name: "us-central1-a", region: "regions/us-central1", status: "UP" },
      { name: "us-central1-b", region: "regions/us-central1", status: "UP" }
    ]
  });
  const service = createRegionCatalog({
    runner: fake.runner,
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z"
  });

  await service.load({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" });

  const cache = JSON.parse(await readFile(path.join(cacheDir, "region-catalog.json"), "utf8"));
  assert.equal(cache.generatedAt, "2026-06-18T00:00:00.000Z");
  assert.equal(cache.source.kind, "gcloud-derived");
  assert.equal(cache.source.command, "gcloud compute zones list --format=json");
  assert.equal(cache.source.account, "user@example.com");
  assert.equal(cache.source.projectId, "project-a");
  assert.equal((await stat(cacheDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(cacheDir, "region-catalog.json"))).mode & 0o777, 0o600);
});

test("region catalog only reuses a cache for the exact account, project, and configuration", async (t) => {
  const cacheDir = await tempCache(t);
  await chmod(cacheDir, 0o755);
  const first = createRegionCatalog({
    runner: createRunner({ zones: [{ name: "us-west1-a", status: "UP" }] }).runner,
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z"
  });
  const context = { configuration: "acct-a", account: "user@example.com", projectId: "project-a" };
  await first.load(context);
  await chmod(path.join(cacheDir, "region-catalog.json"), 0o644);

  const failed = createRegionCatalog({
    runner: createRunner({ error: new Error("offline") }).runner,
    cacheDir,
    now: () => "2026-06-18T01:00:00.000Z"
  });
  const sameContext = await failed.load(context);
  assert.equal(sameContext.source.kind, "stale-cache");
  assert.equal((await stat(cacheDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(cacheDir, "region-catalog.json"))).mode & 0o777, 0o600);

  const differentProject = await failed.load({ ...context, projectId: "project-b" });
  assert.equal(differentProject.source.kind, "fallback");
  assert.equal(differentProject.source.projectId, "project-b");
  const differentConfiguration = await failed.load({ ...context, configuration: "acct-b" });
  assert.equal(differentConfiguration.source.kind, "fallback");
  assert.equal(differentConfiguration.source.configuration, "acct-b");
  const differentAccount = await failed.load({ ...context, account: "other@example.com" });
  assert.equal(differentAccount.source.kind, "fallback");
  assert.equal(differentAccount.source.account, "other@example.com");
});

test("region catalog falls back to stale cached or built-in regions when gcloud fails", async (t) => {
  const cacheDir = await tempCache(t);
  const fake = createRunner({ error: new Error("boom network") });
  const service = createRegionCatalog({
    runner: fake.runner,
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z"
  });

  const catalog = await service.load({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.equal(catalog.source.kind, "fallback");
  assert.equal(catalog.stale, true);
  assert.ok(catalog.source.reason.includes("boom network"));
  assert.equal(catalog.regions.some((region) => region.id === "us-east1"), true);
  assert.equal(catalog.regions.find((region) => region.id === "us-east1").freeTier, "always_free");
  for (const region of catalog.regions) {
    assert.match(region.label, /^[\u4e00-\u9fff]+\/[\u4e00-\u9fff（）]+$/u, `${region.id} should have Chinese country/city label`);
    assert.notEqual(region.label, region.id);
  }
});

test("region helpers derive and preserve zones", () => {
  const catalog = {
    regions: [
      { id: "us-west1", zones: ["us-west1-a", "us-west1-b"] },
      { id: "europe-west9", zones: ["europe-west9-a"] }
    ]
  };

  assert.equal(regionFromZone("us-west1-b"), "us-west1");
  assert.equal(firstZoneForRegion(catalog, "us-west1", "us-west1-b"), "us-west1-b");
  assert.equal(firstZoneForRegion(catalog, "us-west1", "us-west1-z"), "us-west1-a");
  assert.equal(firstZoneForRegion(catalog, "missing", ""), "");
});
