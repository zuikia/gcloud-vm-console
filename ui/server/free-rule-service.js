import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FREE_RULES_URL = "https://docs.cloud.google.com/free/docs/free-cloud-features";
const NETWORK_PRICING_URL = "https://cloud.google.com/vpc/network-pricing";
const ALWAYS_FREE_REGIONS = ["us-west1", "us-central1", "us-east1"];

function baseRules() {
  return {
    compute: {
      monthlyInstanceLimit: "1 e2-micro VM instance equivalent per month",
      provisioningModel: "non-preemptible",
      machineType: "e2-micro",
      alwaysFreeRegions: ALWAYS_FREE_REGIONS,
      disk: {
        standardPersistentDiskGbMonths: 30,
        eligibleDiskTypes: ["pd-standard"],
        summary: "30 GB-months standard persistent disk"
      },
      outbound: {
        allowanceGb: 1,
        origin: "North America",
        excludedDestinations: ["China", "Australia"],
        summary: "1 GB outbound data transfer from North America except China and Australia"
      },
      excludedAccelerators: ["GPU", "TPU"],
      notes: [
        "The e2-micro instance limit is time-based, not one permanently free VM.",
        "Usage calculations are combined across the supported regions.",
        "External IPv4, disk type, network tier, and outbound traffic can still create cost risk."
      ]
    },
    network: {
      externalIpv4: {
        separatePricing: true,
        freeTier: "1 hour per month",
        inUseStandardVm: "$0.005 per hour per account",
        unusedStatic: "$0.01 per hour per account",
        sourceUrl: NETWORK_PRICING_URL,
        risk: "Public IPv4 can incur cost even when Compute Engine Always Free conditions are met."
      }
    },
    costRisks: [
      { id: "external_ipv4", label: "公网 IPv4 独立计费", severity: "high" },
      { id: "disk_type_or_size", label: "只有 30GB 标准持久磁盘计入 Always Free", severity: "medium" },
      { id: "non_free_region", label: "只有 us-west1/us-central1/us-east1 是 Compute Engine Always Free 候选区域", severity: "high" },
      { id: "non_e2_micro", label: "只有 e2-micro 计入 Compute Engine Always Free", severity: "high" },
      { id: "egress_over_allowance", label: "只有 1GB 北美出站额度，超出或目的地不符可能计费", severity: "medium" },
      { id: "gpu_tpu", label: "GPU/TPU 不包含在 Always Free 内", severity: "high" }
    ]
  };
}

function cachePath(cacheDir) {
  return path.join(cacheDir, "free-rules.json");
}

async function readCache(cacheDir) {
  try {
    return JSON.parse(await readFile(cachePath(cacheDir), "utf8"));
  } catch {
    return null;
  }
}

async function writeCache(cacheDir, payload) {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath(cacheDir), `${JSON.stringify(payload, null, 2)}\n`);
}

function verifyOfficialHtml(html) {
  const text = String(html || "").toLowerCase();
  return [
    "e2-micro",
    "non-preemptible",
    "us-west1",
    "us-central1",
    "us-east1",
    "30 gb-months standard persistent disk",
    "1 gb of outbound data transfer from north america",
    "excluding china and australia",
    "gpus and tpus are not included"
  ].every((marker) => text.includes(marker));
}

function verifyNetworkPricingHtml(html) {
  const text = String(html || "").toLowerCase();
  return [
    "external ipv4",
    "for 0 hour to 1 hour",
    "static and ephemeral ip addresses in use on",
    "standard vm instances",
    "static ip address (assigned but unused)"
  ].every((marker) => text.includes(marker));
}

function fallback({ generatedAt, context, warning }) {
  return {
    schemaVersion: 1,
    generatedAt,
    stale: true,
    warning,
    source: {
      kind: "fallback",
      url: FREE_RULES_URL,
      account: context.account || "",
        projectId: context.projectId || "",
        configuration: context.configuration || "",
        references: [FREE_RULES_URL, NETWORK_PRICING_URL]
      },
      rules: baseRules()
    };
}

export function createFreeRuleService({
  cacheDir,
  fetchImpl = fetch,
  now = () => new Date().toISOString()
} = {}) {
  if (!cacheDir) throw new Error("cacheDir is required.");
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl is required.");

  async function calibrate(context = {}) {
    try {
      const response = await fetchImpl(FREE_RULES_URL);
      if (!response?.ok) throw new Error(`official free-tier fetch failed with status ${response?.status || "unknown"}`);
      const html = await response.text();
      if (!verifyOfficialHtml(html)) throw new Error("official page is missing required free-tier markers");
      const networkResponse = await fetchImpl(NETWORK_PRICING_URL);
      if (!networkResponse?.ok) throw new Error(`network pricing fetch failed with status ${networkResponse?.status || "unknown"}`);
      const networkHtml = await networkResponse.text();
      if (!verifyNetworkPricingHtml(networkHtml)) throw new Error("network pricing page is missing required external IPv4 markers");
      const payload = {
        schemaVersion: 1,
        generatedAt: now(),
        stale: false,
        source: {
          kind: "official",
          url: FREE_RULES_URL,
          references: [FREE_RULES_URL, NETWORK_PRICING_URL],
          account: context.account || "",
          projectId: context.projectId || "",
          configuration: context.configuration || ""
        },
        rules: baseRules()
      };
      await writeCache(cacheDir, payload);
      return payload;
    } catch (error) {
      const reason = error?.message || String(error);
      const cached = await readCache(cacheDir);
      if (cached) {
        return {
          ...cached,
          stale: true,
          warning: reason,
          source: {
            ...(cached.source || {}),
            kind: "stale-cache",
            reason
          }
        };
      }
      return fallback({
        generatedAt: now(),
        context,
        warning: reason
      });
    }
  }

  async function readCached(context = {}) {
    const cached = await readCache(cacheDir);
    if (cached) return cached;
    return fallback({
      generatedAt: now(),
      context,
      warning: "No cached free-rule calibration is available yet."
    });
  }

  return { calibrate, readCached };
}
