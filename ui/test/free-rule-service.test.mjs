import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createFreeRuleService } from "../server/free-rule-service.js";

const officialHtml = `
  <main>
    <p>Compute Engine includes 1 non-preemptible e2-micro VM instance per month.</p>
    <p>Supported regions include us-west1, us-central1, and us-east1.</p>
    <p>30 GB-months standard persistent disk and 1 GB of outbound data transfer from North America to all region destinations excluding China and Australia.</p>
    <p>GPUs and TPUs are not included.</p>
  </main>
`;

const networkPricingHtml = `
  <main>
    <p>External IPv4 address pricing.</p>
    <p>Free Tier: For 0 hour to 1 hour, per 1 month per account.</p>
    <p>Static and ephemeral IP addresses in use on standard VM instances are charged per hour.</p>
    <p>Static IP address (assigned but unused) is charged separately.</p>
  </main>
`;

async function tempCache(t) {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "gcp-free-cache-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

test("free rule service calibrates official Compute Engine Always Free rules and writes cache", async (t) => {
  const cacheDir = await tempCache(t);
  const calls = [];
  const service = createFreeRuleService({
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z",
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => url.includes("network-pricing") ? networkPricingHtml : officialHtml
      };
    }
  });

  const result = await service.calibrate({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.deepEqual(result.rules.compute.alwaysFreeRegions, ["us-west1", "us-central1", "us-east1"]);
  assert.equal(result.rules.compute.machineType, "e2-micro");
  assert.equal(result.rules.compute.provisioningModel, "non-preemptible");
  assert.equal(result.rules.compute.monthlyInstanceLimit, "1 e2-micro VM instance equivalent per month");
  assert.equal(result.rules.compute.disk.standardPersistentDiskGbMonths, 30);
  assert.equal(result.rules.compute.outbound.allowanceGb, 1);
  assert.deepEqual(result.rules.compute.excludedAccelerators, ["GPU", "TPU"]);
  assert.equal(result.rules.network.externalIpv4.separatePricing, true);
  assert.equal(result.rules.network.externalIpv4.freeTier, "1 hour per month");
  assert.equal(result.rules.network.externalIpv4.risk, "Public IPv4 can incur cost even when Compute Engine Always Free conditions are met.");
  assert.deepEqual(result.rules.costRisks.map((risk) => risk.id), [
    "external_ipv4",
    "disk_type_or_size",
    "non_free_region",
    "non_e2_micro",
    "egress_over_allowance",
    "gpu_tpu"
  ]);
  assert.equal(result.source.kind, "official");
  assert.equal(result.generatedAt, "2026-06-18T00:00:00.000Z");
  assert.equal(result.source.account, "user@example.com");
  assert.equal(result.source.projectId, "project-a");
  assert.equal(calls[0], "https://docs.cloud.google.com/free/docs/free-cloud-features");
  assert.equal(calls[1], "https://cloud.google.com/vpc/network-pricing");

  const cache = JSON.parse(await readFile(path.join(cacheDir, "free-rules.json"), "utf8"));
  assert.equal(cache.generatedAt, "2026-06-18T00:00:00.000Z");
  assert.equal(cache.source.kind, "official");
  assert.equal(cache.rules.network.externalIpv4.separatePricing, true);
});

test("free rule service refuses official success when required markers are missing", async (t) => {
  const cacheDir = await tempCache(t);
  const service = createFreeRuleService({
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<p>changed page</p>" })
  });

  const result = await service.calibrate({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.equal(result.source.kind, "fallback");
  assert.equal(result.stale, true);
  assert.match(result.warning, /required free-tier markers/i);
  assert.deepEqual(result.rules.compute.alwaysFreeRegions, ["us-west1", "us-central1", "us-east1"]);
});

test("free rule service uses stale cache when official fetch fails", async (t) => {
  const cacheDir = await tempCache(t);
  const first = createFreeRuleService({
    cacheDir,
    now: () => "2026-06-18T00:00:00.000Z",
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      text: async () => url.includes("network-pricing") ? networkPricingHtml : officialHtml
    })
  });
  await first.calibrate({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" });

  const second = createFreeRuleService({
    cacheDir,
    now: () => "2026-06-18T01:00:00.000Z",
    fetchImpl: async () => { throw new Error("network offline"); }
  });
  const result = await second.calibrate({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.equal(result.source.kind, "stale-cache");
  assert.equal(result.stale, true);
  assert.ok(result.warning.includes("network offline"));
  assert.equal(result.generatedAt, "2026-06-18T00:00:00.000Z");
});
