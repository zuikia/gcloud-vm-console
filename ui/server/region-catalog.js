import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const ALWAYS_FREE_REGION_IDS = new Set(["us-west1", "us-central1", "us-east1"]);

const FALLBACK_ZONES = [
  "us-west1-a", "us-west1-b", "us-west1-c",
  "us-central1-a", "us-central1-b", "us-central1-c", "us-central1-f",
  "us-east1-b", "us-east1-c", "us-east1-d",
  "us-east4-a", "us-east4-b", "us-east4-c",
  "us-west2-a", "us-west2-b", "us-west2-c",
  "us-west3-a", "us-west3-b", "us-west3-c",
  "us-west4-a", "us-west4-b", "us-west4-c",
  "northamerica-northeast1-a", "northamerica-northeast1-b", "northamerica-northeast1-c",
  "northamerica-northeast2-a", "northamerica-northeast2-b", "northamerica-northeast2-c",
  "southamerica-east1-a", "southamerica-east1-b", "southamerica-east1-c",
  "southamerica-west1-a", "southamerica-west1-b", "southamerica-west1-c",
  "europe-west1-b", "europe-west1-c", "europe-west1-d",
  "europe-west2-a", "europe-west2-b", "europe-west2-c",
  "europe-west3-a", "europe-west3-b", "europe-west3-c",
  "europe-west4-a", "europe-west4-b", "europe-west4-c",
  "europe-west6-a", "europe-west6-b", "europe-west6-c",
  "europe-west8-a", "europe-west8-b", "europe-west8-c",
  "europe-west9-a", "europe-west9-b", "europe-west9-c",
  "europe-west10-a", "europe-west10-b", "europe-west10-c",
  "europe-west12-a", "europe-west12-b", "europe-west12-c",
  "europe-central2-a", "europe-central2-b", "europe-central2-c",
  "europe-north1-a", "europe-north1-b", "europe-north1-c",
  "europe-southwest1-a", "europe-southwest1-b", "europe-southwest1-c",
  "asia-east1-a", "asia-east1-b", "asia-east1-c",
  "asia-east2-a", "asia-east2-b", "asia-east2-c",
  "asia-northeast1-a", "asia-northeast1-b", "asia-northeast1-c",
  "asia-northeast2-a", "asia-northeast2-b", "asia-northeast2-c",
  "asia-northeast3-a", "asia-northeast3-b", "asia-northeast3-c",
  "asia-south1-a", "asia-south1-b", "asia-south1-c",
  "asia-south2-a", "asia-south2-b", "asia-south2-c",
  "asia-southeast1-a", "asia-southeast1-b", "asia-southeast1-c",
  "asia-southeast2-a", "asia-southeast2-b", "asia-southeast2-c",
  "australia-southeast1-a", "australia-southeast1-b", "australia-southeast1-c",
  "australia-southeast2-a", "australia-southeast2-b", "australia-southeast2-c",
  "me-central1-a", "me-central1-b", "me-central1-c",
  "me-central2-a", "me-central2-b", "me-central2-c",
  "me-west1-a", "me-west1-b", "me-west1-c",
  "africa-south1-a", "africa-south1-b", "africa-south1-c"
];

function uniqSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function regionFromZone(zone) {
  return String(zone || "").trim().replace(/-[a-z]$/, "");
}

function regionFromZoneRecord(zone = {}) {
  const explicit = String(zone.region || "").split("/").pop();
  return explicit || regionFromZone(zone.name);
}

function groupForRegion(regionId) {
  if (/^(us|northamerica)-/.test(regionId)) return "North America";
  if (/^southamerica-/.test(regionId)) return "South America";
  if (/^europe-/.test(regionId)) return "Europe";
  if (/^asia-/.test(regionId)) return "Asia Pacific";
  if (/^australia-/.test(regionId)) return "Australia";
  if (/^me-/.test(regionId)) return "Middle East";
  if (/^africa-/.test(regionId)) return "Africa";
  return "Other";
}

function regionLabel(regionId) {
  const labels = {
    "africa-south1": "南非/约翰内斯堡",
    "asia-east1": "中国台湾/彰化",
    "asia-east2": "中国香港/香港",
    "asia-northeast1": "日本/东京",
    "asia-northeast2": "日本/大阪",
    "asia-northeast3": "韩国/首尔",
    "asia-south1": "印度/孟买",
    "asia-south2": "印度/德里",
    "asia-southeast1": "新加坡/新加坡",
    "asia-southeast2": "印度尼西亚/雅加达",
    "asia-southeast3": "马来西亚/吉隆坡",
    "australia-southeast1": "澳大利亚/悉尼",
    "australia-southeast2": "澳大利亚/墨尔本",
    "europe-central2": "波兰/华沙",
    "europe-north1": "芬兰/哈米纳",
    "europe-north2": "瑞典/斯德哥尔摩",
    "europe-southwest1": "西班牙/马德里",
    "europe-west1": "比利时/圣吉斯兰",
    "europe-west10": "德国/柏林",
    "europe-west12": "意大利/都灵",
    "europe-west2": "英国/伦敦",
    "europe-west3": "德国/法兰克福",
    "europe-west4": "荷兰/埃姆斯哈文",
    "europe-west6": "瑞士/苏黎世",
    "europe-west8": "意大利/米兰",
    "europe-west9": "法国/巴黎",
    "me-central1": "卡塔尔/多哈",
    "me-central2": "沙特阿拉伯/达曼",
    "me-west1": "以色列/特拉维夫",
    "northamerica-northeast1": "加拿大/蒙特利尔",
    "northamerica-northeast2": "加拿大/多伦多",
    "northamerica-south1": "墨西哥/克雷塔罗",
    "us-central1": "美国/爱荷华",
    "us-east1": "美国/南卡罗来纳",
    "us-east4": "美国/北弗吉尼亚",
    "us-east5": "美国/哥伦布",
    "us-south1": "美国/达拉斯",
    "us-west1": "美国/俄勒冈",
    "us-west2": "美国/洛杉矶",
    "us-west3": "美国/盐湖城",
    "us-west4": "美国/拉斯维加斯",
    "southamerica-east1": "巴西/圣保罗",
    "southamerica-west1": "智利/圣地亚哥"
  };
  return labels[regionId] || regionId;
}

function buildRegionsFromZones(zones = []) {
  const grouped = new Map();
  for (const zone of zones) {
    const name = String(typeof zone === "string" ? zone : zone?.name || "").trim();
    if (!name) continue;
    if (zone?.status && zone.status !== "UP") continue;
    const regionId = regionFromZoneRecord(typeof zone === "string" ? { name } : zone);
    if (!regionId) continue;
    const list = grouped.get(regionId) || [];
    list.push(name);
    grouped.set(regionId, list);
  }
  return [...grouped.entries()]
    .map(([id, regionZones]) => ({
      id,
      label: regionLabel(id),
      group: groupForRegion(id),
      zones: uniqSorted(regionZones),
      defaultZone: uniqSorted(regionZones)[0] || "",
      freeTier: ALWAYS_FREE_REGION_IDS.has(id) ? "always_free" : "not_free"
    }))
    .sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
}

function fallbackCatalog({ now, context, reason = "" }) {
  const regions = buildRegionsFromZones(FALLBACK_ZONES);
  return {
    schemaVersion: 1,
    generatedAt: now(),
    stale: true,
    source: {
      kind: "fallback",
      reason,
      account: context.account || "",
      projectId: context.projectId || "",
      configuration: context.configuration || ""
    },
    freeRegionIds: [...ALWAYS_FREE_REGION_IDS],
    regions
  };
}

function cachePath(cacheDir) {
  return path.join(cacheDir, "region-catalog.json");
}

function cacheMatchesContext(catalog, context = {}) {
  const source = catalog?.source || {};
  return ["account", "projectId", "configuration"].every((key) => (
    String(source[key] || "") === String(context[key] || "")
  ));
}

async function readCache(cacheDir, context = {}) {
  try {
    await chmod(cacheDir, 0o700);
    await chmod(cachePath(cacheDir), 0o600);
    const cached = JSON.parse(await readFile(cachePath(cacheDir), "utf8"));
    return cacheMatchesContext(cached, context) ? cached : null;
  } catch {
    return null;
  }
}

async function writeCache(cacheDir, catalog) {
  await mkdir(cacheDir, { recursive: true });
  await chmod(cacheDir, 0o700);
  await writeFile(cachePath(cacheDir), `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  await chmod(cachePath(cacheDir), 0o600);
}

export function firstZoneForRegion(catalog, regionId, preferredZone = "") {
  const region = (catalog?.regions || []).find((item) => item.id === regionId);
  if (!region) return "";
  if (preferredZone && region.zones.includes(preferredZone)) return preferredZone;
  return region.defaultZone || region.zones[0] || "";
}

export function createRegionCatalog({ runner, cacheDir, now = () => new Date().toISOString() } = {}) {
  if (!runner?.runJson) throw new Error("runner with runJson() is required.");
  if (!cacheDir) throw new Error("cacheDir is required.");

  async function load(context = {}) {
    try {
      const result = await runner.runJson(["compute", "zones", "list"], {
        context: {
          configuration: context.configuration,
          account: context.account,
          projectId: context.projectId
        },
        allowGlobal: true
      });
      const catalog = {
        schemaVersion: 1,
        generatedAt: now(),
        stale: false,
        source: {
          kind: "gcloud-derived",
          command: "gcloud compute zones list --format=json",
          account: context.account || "",
          projectId: context.projectId || "",
          configuration: context.configuration || ""
        },
        freeRegionIds: [...ALWAYS_FREE_REGION_IDS],
        regions: buildRegionsFromZones(result.data || [])
      };
      await writeCache(cacheDir, catalog);
      return catalog;
    } catch (error) {
      const cached = await readCache(cacheDir, context);
      if (cached) {
        return {
          ...cached,
          stale: true,
          source: {
            ...(cached.source || {}),
            kind: "stale-cache",
            reason: error?.message || String(error)
          }
        };
      }
      return fallbackCatalog({
        now,
        context,
        reason: error?.message || String(error)
      });
    }
  }

  return { load };
}
