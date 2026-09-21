import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { deriveStaticAddressName, normalizeNetworkProfile } from "../public/lib/network-profile.js";
import { createChangePreview, normalizeStartupScript, previewMatchesCurrentState, validateDesiredInputs } from "./change-planner.js";
import { cloudIdentityKey, normalizeVmIdentity } from "./vm-identity.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function successfulHistory(record, idempotencyKey) {
  return (record.history || []).find((entry) =>
    entry.idempotencyKey === idempotencyKey &&
    (entry.status === "succeeded" || entry.status === "replacement_pending_verification")
  );
}

function hasFailedAttemptForPreview(record, previewFingerprint) {
  return (record.history || []).some((entry) =>
    entry.previewFingerprint === previewFingerprint && entry.status === "failed"
  );
}

function imageFlags(image) {
  const [project, name] = String(image || "").split("/");
  if (!project || !name) throw new Error("desired.image must use project/image-family format.");
  return [`--image-family=${name}`, `--image-project=${project}`];
}

function labelsFlag(labels = {}) {
  const entries = Object.entries(labels)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  return entries.length ? [`--labels=${entries.join(",")}`] : [];
}

function safeMetadataValue(value) {
  const text = String(value ?? "").trim();
  if (!text || /(?:vless|vmess|hy2|hysteria2|tuic|ss):\/\/|password|passwd|secret|token|private[_-]?key|credential/i.test(text)) return "";
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) return "";
  return text;
}

function metadataFlag(metadata = {}) {
  const allowed = [
    ["gcp-vm-console-startup-script-hash", ["startupScriptHash", "gcp-vm-console-startup-script-hash"]],
    ["gvc-record-schema", ["gvcRecordSchema", "gvc-record-schema"]],
    ["gvc-deploy-method", ["gvcDeployMethod", "gvc-deploy-method"]]
  ];
  const entries = [];
  for (const [outputKey, inputKeys] of allowed) {
    const value = inputKeys.map((key) => safeMetadataValue(metadata[key])).find(Boolean);
    if (value) entries.push(`${outputKey}=${value}`);
  }
  return entries.length ? [`--metadata=${entries.join(",")}`] : [];
}

function tagsFlag(tags = []) {
  return Array.isArray(tags) && tags.length ? [`--tags=${tags.join(",")}`] : [];
}

function basename(value) {
  return String(value || "").split("/").filter(Boolean).at(-1) || "";
}

function networkInterfaceFlag(network = {}, { instanceName = "", addressName = "" } = {}) {
  const profile = normalizeNetworkProfile(network, { instanceName });
  const values = [
    `network=${profile.name}`,
    `subnet=${profile.subnet}`,
    `nic-type=${profile.nicType}`
  ];
  if (profile.externalIpMode === "none") values.push("no-address");
  else {
    values.push(`network-tier=${profile.networkTier}`);
    if (profile.externalIpMode === "static") values.push(`address=${addressName || profile.addressName}`);
  }
  return `--network-interface=${values.join(",")}`;
}

function createVmCommand(identity, desired, { name = identity.name, addressName = "", startupScriptPath = "" } = {}) {
  const disk = desired.disk || {};
  const network = desired.network || {};
  const command = [
    "compute",
    "instances",
    "create",
    name,
    `--machine-type=${desired.machineType}`,
    `--boot-disk-size=${Number(disk.sizeGb || 10)}GB`,
    `--boot-disk-type=${disk.type || "pd-standard"}`,
    networkInterfaceFlag(network, { instanceName: name, addressName }),
    ...imageFlags(desired.image),
    ...labelsFlag(desired.labels),
    ...metadataFlag(desired.metadata),
    ...(startupScriptPath ? [`--metadata-from-file=startup-script=${startupScriptPath}`] : []),
    ...tagsFlag(desired.tags)
  ];
  if (desired.serviceAccount) command.push(`--service-account=${desired.serviceAccount}`);
  return command;
}

async function withStartupScript(desired, operation) {
  const { startupScript } = validateDesiredInputs(desired);
  if (!startupScript) return operation("");
  const directory = await mkdtemp(path.join(tmpdir(), "gvc-startup-"));
  const filePath = path.join(directory, "startup.sh");
  try {
    await writeFile(filePath, normalizeStartupScript(startupScript, { required: true }), { encoding: "utf8", mode: 0o600 });
    return await operation(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function gcloudOptions(identity) {
  return {
    context: {
      configuration: identity.configuration,
      account: identity.account,
      projectId: identity.projectId
    },
    location: { zone: identity.zone }
  };
}

function addressListOptions(identity) {
  return {
    context: {
      configuration: identity.configuration,
      account: identity.account,
      projectId: identity.projectId
    },
    allowGlobal: true
  };
}

function addressWriteOptions(identity) {
  return {
    context: {
      configuration: identity.configuration,
      account: identity.account,
      projectId: identity.projectId
    },
    location: { region: identity.region }
  };
}

function replacementNameFor(identity, fingerprint) {
  const suffix = createHash("sha256").update(fingerprint).digest("hex").slice(0, 6);
  const maxBaseLength = Math.max(1, 63 - "-r-".length - suffix.length);
  const base = identity.name.slice(0, maxBaseLength).replace(/-+$/, "") || "vm";
  return `${base}-r-${suffix}`;
}

function appendHistory(record, entry) {
  return [...(record.history || []), entry];
}

function resultFromHistory(entry) {
  return { ...(entry.result || { status: entry.status }), reused: true };
}

export function createChangeExecutor({
  runner,
  inventory,
  recordStore,
  taskLock,
  now = () => new Date().toISOString()
} = {}) {
  if (!runner?.run) throw new Error("runner with run() is required.");
  if (!inventory?.readObserved) throw new Error("inventory with readObserved() is required.");
  if (!recordStore?.get || !recordStore?.save) throw new Error("recordStore with get() and save() is required.");
  if (!taskLock?.run) throw new Error("taskLock with run() is required.");

  async function saveHistory(record, entry, patch = {}) {
    return recordStore.save({
      ...record,
      ...patch,
      history: appendHistory(record, entry)
    });
  }

  async function assertFreshPreview(record, previewFingerprint) {
    if (!record.preview) throw new Error("A saved change preview is required before execution.");
    if (record.preview.fingerprint !== previewFingerprint) {
      throw new Error("Saved preview fingerprint does not match the requested execution.");
    }

    const observed = await inventory.readObserved(record.identity);
    const match = previewMatchesCurrentState(record.preview, {
      identity: record.identity,
      desired: record.desired,
      observed
    });
    if (!match.ok) throw new Error(`Saved preview is stale: ${match.reason}`);
    return observed;
  }

  async function findStaticAddress(identity, addressName) {
    const result = await runner.run([
      "compute",
      "addresses",
      "list",
      `--filter=name=${addressName}`,
      "--format=json"
    ], addressListOptions(identity));
    let addresses;
    try {
      addresses = JSON.parse(result.stdout || "[]");
    } catch {
      throw new Error("Static address lookup returned invalid JSON.");
    }
    if (!Array.isArray(addresses)) throw new Error("Static address lookup returned an invalid response.");
    return addresses.find((item) => (
      item?.name === addressName
      && basename(item.region) === identity.region
    )) || null;
  }

  function validateReusableAddress(existing, addressName, profile) {
    if (existing.addressType && String(existing.addressType).toUpperCase() !== "EXTERNAL") {
      throw new Error(`Static address ${addressName} must be an external IPv4 address.`);
    }
    if (existing.ipVersion && String(existing.ipVersion).toUpperCase() !== "IPV4") {
      throw new Error(`Static address ${addressName} must be an external IPv4 address.`);
    }
    const tier = String(existing.networkTier || "").toUpperCase();
    if (tier !== profile.networkTier) {
      throw new Error(`Static address ${addressName} uses Network Tier ${tier || "unknown"}, expected ${profile.networkTier}.`);
    }
    if (String(existing.status || "").toUpperCase() !== "RESERVED") {
      throw new Error(`Static address ${addressName} is already in use.`);
    }
  }

  async function ensureStaticAddress(identity, network, targetName) {
    const profile = normalizeNetworkProfile(network, { instanceName: targetName });
    if (profile.externalIpMode !== "static") return null;
    const addressName = targetName === identity.name
      ? profile.addressName
      : deriveStaticAddressName(targetName);
    const existing = await findStaticAddress(identity, addressName);
    if (existing) {
      validateReusableAddress(existing, addressName, profile);
      return { addressName, address: existing.address || "", created: false };
    }

    try {
      await runner.run([
        "compute",
        "addresses",
        "create",
        addressName,
        `--network-tier=${profile.networkTier}`
      ], addressWriteOptions(identity));
    } catch (error) {
      const raced = await findStaticAddress(identity, addressName);
      if (!raced) throw error;
      validateReusableAddress(raced, addressName, profile);
      return { addressName, address: raced.address || "", created: false };
    }
    return { addressName, address: "", created: true };
  }

  function savedNetworkState(record, latestObserved, profile, staticAddress) {
    const externalIp = latestObserved?.network?.externalIp || staticAddress?.address || "";
    const desiredNetwork = {
      ...(record.desired?.network || {}),
      ...profile,
      ...(profile.externalIpMode === "static" && externalIp ? { externalIp } : {})
    };
    const observedNetwork = {
      ...(latestObserved?.network || {}),
      externalIpMode: profile.externalIpMode,
      networkTier: profile.networkTier,
      nicType: profile.nicType,
      ...(profile.externalIpMode === "static" ? { addressName: staticAddress?.addressName || profile.addressName } : {})
    };
    return { desiredNetwork, observedNetwork, externalIp };
  }

  async function executeCreate(record, idempotencyKey, observed) {
    const identity = normalizeVmIdentity(record.identity);
    const profile = normalizeNetworkProfile(record.desired?.network || {}, { instanceName: identity.name });
    const staticAddress = await ensureStaticAddress(identity, profile, identity.name);
    await withStartupScript(record.desired, async (startupScriptPath) => {
      try {
        await runner.run(createVmCommand(identity, record.desired, {
          addressName: staticAddress?.addressName || "",
          startupScriptPath
        }), gcloudOptions(identity));
      } catch (error) {
        if (staticAddress?.created) {
          throw new Error(`静态地址 ${staticAddress.addressName} 已保留，但实例创建失败：${error?.message || String(error)}`);
        }
        throw error;
      }
    });
    const latestObserved = await inventory.readObserved(identity);
    const networkState = savedNetworkState(record, latestObserved, profile, staticAddress);
    const result = {
      status: "succeeded",
      network: {
        externalIpMode: profile.externalIpMode,
        networkTier: profile.networkTier,
        nicType: profile.nicType,
        ...(staticAddress?.addressName ? { addressName: staticAddress.addressName } : {}),
        ...(networkState.externalIp ? { externalIp: networkState.externalIp } : {})
      }
    };
    await saveHistory(record, {
      idempotencyKey,
      previewFingerprint: record.preview.fingerprint,
      status: "succeeded",
      result,
      at: now()
    }, {
      status: "managed",
      desired: {
        ...record.desired,
        network: networkState.desiredNetwork
      },
      observed: {
        ...(clone(latestObserved ?? observed) || {}),
        network: networkState.observedNetwork
      }
    });
    return { ...result, reused: false };
  }

  async function executeReplacement(record, idempotencyKey, observed) {
    const identity = normalizeVmIdentity(record.identity);
    const replacementName = replacementNameFor(identity, record.preview.fingerprint);
    const profile = normalizeNetworkProfile(record.desired?.network || {}, { instanceName: replacementName });
    const staticAddress = await ensureStaticAddress(identity, profile, replacementName);
    await withStartupScript(record.desired, async (startupScriptPath) => {
      try {
        await runner.run(createVmCommand(identity, record.desired, {
          name: replacementName,
          addressName: staticAddress?.addressName || "",
          startupScriptPath
        }), gcloudOptions(identity));
      } catch (error) {
        if (staticAddress?.created) {
          throw new Error(`静态地址 ${staticAddress.addressName} 已保留，但替换实例创建失败：${error?.message || String(error)}`);
        }
        throw error;
      }
    });
    const result = {
      status: "replacement_pending_verification",
      replacementName,
      network: {
        externalIpMode: profile.externalIpMode,
        networkTier: profile.networkTier,
        nicType: profile.nicType,
        ...(staticAddress?.addressName ? { addressName: staticAddress.addressName } : {})
      }
    };
    await saveHistory(record, {
      idempotencyKey,
      previewFingerprint: record.preview.fingerprint,
      status: "replacement_pending_verification",
      result,
      at: now()
    }, {
      status: "replacing",
      observed: clone(observed),
      replacement: {
        name: replacementName,
        ...(staticAddress?.addressName ? { addressName: staticAddress.addressName } : {}),
        createdAt: now(),
        verified: false
      }
    });
    return { ...result, reused: false };
  }

  async function executeNoop(record, idempotencyKey) {
    const result = { status: "succeeded", noop: true };
    await saveHistory(record, {
      idempotencyKey,
      previewFingerprint: record.preview.fingerprint,
      status: "succeeded",
      result,
      at: now()
    });
    return { ...result, reused: false };
  }

  async function execute({ recordId, previewFingerprint, idempotencyKey } = {}) {
    const requestedRecordId = required(recordId, "recordId");
    const requestedFingerprint = required(previewFingerprint, "previewFingerprint");
    const requestedIdempotencyKey = required(idempotencyKey, "idempotencyKey");
    const initialRecord = await recordStore.get(requestedRecordId);
    if (!initialRecord) throw new Error("VM record was not found.");

    const initialEntry = successfulHistory(initialRecord, requestedIdempotencyKey);
    if (initialEntry) return resultFromHistory(initialEntry);

    const lockKey = cloudIdentityKey(initialRecord.identity);
    return taskLock.run(lockKey, async () => {
      const record = await recordStore.get(requestedRecordId);
      if (!record) throw new Error("VM record was not found.");

      const existingEntry = successfulHistory(record, requestedIdempotencyKey);
      if (existingEntry) return resultFromHistory(existingEntry);
      if (!record.preview || record.preview.fingerprint !== requestedFingerprint) {
        throw new Error("Saved preview fingerprint does not match the requested execution.");
      }

      let observed;
      try {
        observed = hasFailedAttemptForPreview(record, requestedFingerprint)
          ? record.observed
          : await assertFreshPreview(record, requestedFingerprint);

        if (record.preview.actions.some((action) => action.id === "create-replacement-vm")) {
          return await executeReplacement(record, requestedIdempotencyKey, observed);
        }
        if (record.preview.actions.some((action) => action.id === "create-vm")) {
          return await executeCreate(record, requestedIdempotencyKey, observed);
        }
        if (record.preview.actions.length === 0) {
          return await executeNoop(record, requestedIdempotencyKey);
        }

        const refreshedPreview = createChangePreview({
          identity: record.identity,
          desired: record.desired,
          observed,
          operation: record.preview.operation
        });
        throw new Error(`Unsupported gcloud change action set: ${refreshedPreview.actions.map((action) => action.id).join(", ")}`);
      } catch (error) {
        await saveHistory(record, {
          idempotencyKey: requestedIdempotencyKey,
          previewFingerprint: requestedFingerprint,
          status: "failed",
          error: error?.message || String(error),
          at: now()
        });
        throw error;
      }
    });
  }

  return { execute };
}
