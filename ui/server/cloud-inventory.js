import { normalizeVmIdentity } from "./vm-identity.js";
import { classifyNetworkError } from "./network-error-classifier.js";
import { createSingleFlight } from "./single-flight.js";

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function basename(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split("/").filter(Boolean).at(-1) || "";
}

function zoneFrom(value) {
  return basename(value);
}

function metadataObject(metadata = {}) {
  const output = {};
  for (const item of metadata.items || []) {
    if (item?.key) output[item.key] = item.value ?? "";
  }
  return output;
}

function bootDisk(instance = {}) {
  return (instance.disks || []).find((disk) => disk.boot) || (instance.disks || [])[0] || {};
}

function firstNetwork(instance = {}) {
  return (instance.networkInterfaces || [])[0] || {};
}

function isNotFound(error) {
  return /not found|404|was not found/i.test(error?.message || "");
}

function normalizeCloudInstance(instance = {}, scope = {}) {
  const network = firstNetwork(instance);
  const accessConfig = (network.accessConfigs || [])[0] || null;
  const disk = bootDisk(instance);
  const metadata = metadataObject(instance.metadata);
  const zone = zoneFrom(instance.zone || scope.zone);
  const labels = { ...(instance.labels || {}) };
  return {
    exists: true,
    configuration: scope.configuration || "",
    account: scope.account || "",
    projectId: scope.projectId || "",
    name: required(instance.name, "instance.name"),
    zone,
    region: zone.replace(/-[a-z]$/, ""),
    status: instance.status || "UNKNOWN",
    machineType: basename(instance.machineType),
    image: metadata["gcp-vm-console-image"] || labels.gcp_vm_console_image || "",
    disk: {
      sizeGb: Number(disk.diskSizeGb || disk.sizeGb || 0),
      type: basename(disk.diskType || disk.type)
    },
    network: {
      name: basename(network.network),
      subnet: basename(network.subnetwork),
      externalIpMode: accessConfig ? "ephemeral" : "none",
      externalIp: accessConfig?.natIP || "",
      networkTier: accessConfig?.networkTier || "",
      nicType: network.nicType || "VIRTIO_NET"
    },
    labels,
    tags: Array.isArray(instance.tags?.items) ? [...instance.tags.items] : [],
    metadata: {
      startupScriptHash: metadata["gcp-vm-console-startup-script-hash"] || metadata.startupScriptHash || "",
      gvcRecordSchema: metadata["gvc-record-schema"] || metadata.gvcRecordSchema || "",
      gvcDeployMethod: metadata["gvc-deploy-method"] || metadata.gvcDeployMethod || ""
    },
    serviceAccount: (instance.serviceAccounts || [])[0]?.email || ""
  };
}

function projectContext(scope = {}) {
  return {
    configuration: required(scope.configuration, "configuration"),
    account: required(scope.account, "account"),
    projectId: required(scope.projectId, "projectId")
  };
}

export function createCloudInventory({ runner, snapshotStore = null, now = () => new Date().toISOString() } = {}) {
  if (!runner?.runJson) throw new Error("runner with runJson() is required.");
  const reads = createSingleFlight();

  async function readObserved(input) {
    const identity = normalizeVmIdentity(input);
    try {
      const result = await runner.runJson(["compute", "instances", "describe", identity.name], {
        context: {
          configuration: identity.configuration,
          account: identity.account,
          projectId: identity.projectId
        },
        location: { zone: identity.zone }
      });
      return normalizeCloudInstance(result.data, identity);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  function listInstancesLive(scope = {}) {
    const context = projectContext(scope);
    const key = `instances:${context.configuration}:${context.account}:${context.projectId}`;
    return reads.run(key, async () => {
      const result = await runner.runJson(["compute", "instances", "list"], {
        context,
        allowGlobal: true
      });
      return {
        instances: (result.data || [])
        .map((instance) => normalizeCloudInstance(instance, context))
        .sort((a, b) => a.name.localeCompare(b.name)),
        retryAttempts: Number(result.retryAttempts || 1)
      };
    });
  }

  async function listInstances(scope = {}) {
    return (await listInstancesLive(scope)).instances;
  }

  async function listInstancesSnapshot(scope = {}) {
    const context = projectContext(scope);
    const checkedAt = now();
    try {
      const live = await listInstancesLive(context);
      let cacheWriteFailed = false;
      if (snapshotStore?.save) {
        try {
          await snapshotStore.save(context, live.instances, checkedAt);
        } catch {
          cacheWriteFailed = true;
        }
      }
      return {
        instances: live.instances,
        meta: {
          source: "live",
          checkedAt,
          stale: false,
          ageSeconds: 0,
          retryAttempts: live.retryAttempts,
          blocker: null,
          cacheWriteFailed
        }
      };
    } catch (error) {
      const cached = snapshotStore?.load ? await snapshotStore.load(context, checkedAt) : null;
      if (!cached) throw error;
      const classified = classifyNetworkError(error);
      const ageSeconds = Math.max(0, Math.floor((new Date(checkedAt).getTime() - new Date(cached.checkedAt).getTime()) / 1000));
      return {
        instances: cached.instances.map((instance) => ({ ...instance, ...context })),
        meta: {
          source: "cache",
          checkedAt: cached.checkedAt,
          stale: true,
          ageSeconds,
          retryAttempts: Number(error?.retryAttempts || 1),
          blocker: {
            category: classified.category,
            code: classified.code,
            message: classified.recognized ? classified.message : "云端实例清单读取失败，正在显示本地缓存。"
          },
          cacheWriteFailed: false
        }
      };
    }
  }

  return { listInstances, listInstancesSnapshot, readObserved };
}
