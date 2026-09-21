import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { recordIdForIdentity } from "./vm-identity.js";

function parseTfvars(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"?([^"\n]+)"?\s*$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function safeDate(value) {
  return String(value).replace(/[:.]/g, "-");
}

function targetFromTfvars(values) {
  return {
    projectId: values.project_id || values.projectId || "",
    zone: values.zone || "",
    name: values.vm_name || values.instance_name || values.name_prefix || ""
  };
}

function targetKey(target) {
  return [target.projectId, target.zone, target.name].join("::");
}

function desiredFromTfvars(values) {
  return {
    machineType: values.machine_type || "e2-micro",
    image: values.image || "",
    disk: {
      sizeGb: Number(values.disk_size_gb || 20),
      type: values.disk_type || "pd-balanced"
    },
    network: {
      name: values.network || "default",
      subnet: values.subnet || "default",
      externalIpMode: values.external_ip_mode || "ephemeral"
    },
    labels: { managed_by: "gcp-vm-console" },
    tags: values.target_tag ? [values.target_tag] : [],
    metadata: {},
    deploy: { method: values.node_deploy_method || "vm_only" }
  };
}

async function profileDirs(rootDir) {
  const instancesDir = path.join(rootDir, "instances");
  let entries;
  try {
    entries = await readdir(instancesDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readLegacyProfile(rootDir, profile) {
  const profileDir = path.join(rootDir, "instances", profile);
  const tfvars = parseTfvars(await readFile(path.join(profileDir, "terraform.tfvars"), "utf8"));
  return {
    profile,
    profileDir,
    tfvars,
    target: targetFromTfvars(tfvars),
    desired: desiredFromTfvars(tfvars)
  };
}

function normalizeCloud(cloud) {
  return {
    ...cloud,
    projectId: cloud.projectId || "",
    zone: cloud.zone || "",
    name: cloud.name || ""
  };
}

export function createLegacyMigrator({
  rootDir,
  recordStore,
  cloudInstances = [],
  now = () => new Date().toISOString()
} = {}) {
  if (!rootDir) throw new Error("rootDir is required.");
  if (!recordStore?.get || !recordStore?.save) throw new Error("recordStore with get() and save() is required.");

  async function preview() {
    const profiles = await Promise.all((await profileDirs(rootDir)).map((profile) => readLegacyProfile(rootDir, profile)));
    const counts = new Map();
    for (const profile of profiles) {
      const key = targetKey(profile.target);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const clouds = cloudInstances.map(normalizeCloud);
    const matched = [];
    const unmatched = [];
    const conflicts = [];
    for (const profile of profiles) {
      const key = targetKey(profile.target);
      if (counts.get(key) > 1) {
        conflicts.push({ ...profile, reason: "duplicate_legacy_target" });
        continue;
      }
      const cloud = clouds.find((candidate) => targetKey(candidate) === key);
      if (!cloud) {
        unmatched.push({ ...profile, reason: "no_cloud_match" });
        continue;
      }
      matched.push({
        ...profile,
        identity: {
          configuration: cloud.configuration,
          account: cloud.account,
          projectId: cloud.projectId,
          zone: cloud.zone,
          name: cloud.name
        },
        observed: cloud
      });
    }

    return {
      matched,
      unmatched,
      conflicts,
      summary: {
        matched: matched.length,
        unmatched: unmatched.length,
        conflicts: conflicts.length
      }
    };
  }

  async function archiveProfile(archiveDir, item) {
    const from = path.join(rootDir, "instances", item.profile);
    const to = path.join(archiveDir, item.profile);
    try {
      await rename(from, to);
      return { profile: item.profile, from, to };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function confirm(previewResult) {
    const timestamp = safeDate(now());
    const archiveDir = path.join(rootDir, "legacy-archive", timestamp);
    await mkdir(archiveDir, { recursive: true });
    const archivedProfiles = [];
    let created = 0;
    let reused = 0;

    for (const item of previewResult.matched || []) {
      const id = recordIdForIdentity(item.identity);
      const existing = await recordStore.get(id);
      if (existing) {
        reused += 1;
      } else {
        await recordStore.save({
          status: "managed",
          identity: item.identity,
          desired: item.desired,
          observed: item.observed,
          migration: {
            source: "legacy-terraform-profile",
            sourceProfile: item.profile,
            confirmedAt: now(),
            tfvars: item.tfvars
          }
        });
        created += 1;
      }

      const archived = await archiveProfile(archiveDir, item);
      if (archived) archivedProfiles.push(archived);
    }

    const manifest = {
      createdAt: now(),
      archivedProfiles
    };
    const manifestPath = path.join(archiveDir, "manifest.json");
    let shouldWriteManifest = true;
    if (!archivedProfiles.length) {
      try {
        await readFile(manifestPath, "utf8");
        shouldWriteManifest = false;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    if (shouldWriteManifest) {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return {
      manifestPath,
      summary: {
        created,
        reused,
        archived: archivedProfiles.length
      }
    };
  }

  return { confirm, preview };
}
