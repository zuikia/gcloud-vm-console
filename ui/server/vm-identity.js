import { createHash } from "node:crypto";

const CONFIGURATION_PATTERN = /^[a-z][-a-z0-9]{0,62}$/;
const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const ZONE_PATTERN = /^[a-z][a-z0-9-]*-[a-z]$/;
const INSTANCE_PATTERN = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

function requiredLower(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function normalizeVmIdentity(input = {}) {
  const configuration = requiredLower(input.configuration, "configuration");
  const account = requiredLower(input.account, "account");
  const projectId = requiredLower(input.projectId, "projectId");
  const zone = requiredLower(input.zone, "zone");
  const name = requiredLower(input.name, "name");

  if (!CONFIGURATION_PATTERN.test(configuration)) {
    throw new Error("configuration must be a valid lowercase gcloud configuration name.");
  }
  if (!account.includes("@") || /\s/.test(account)) {
    throw new Error("account must be a valid gcloud account identifier.");
  }
  if (!PROJECT_PATTERN.test(projectId)) {
    throw new Error("projectId must be a valid Google Cloud project ID.");
  }
  if (!ZONE_PATTERN.test(zone)) {
    throw new Error("zone must be a valid Compute Engine zone.");
  }
  if (!INSTANCE_PATTERN.test(name)) {
    throw new Error("name must be a valid Compute Engine instance name.");
  }

  return {
    configuration,
    account,
    projectId,
    region: zone.replace(/-[a-z]$/, ""),
    zone,
    name
  };
}

export function cloudIdentityKey(input) {
  const identity = normalizeVmIdentity(input);
  return [identity.account, identity.projectId, identity.zone, identity.name].join("::");
}

export function recordIdForIdentity(input) {
  const identity = normalizeVmIdentity(input);
  const digest = createHash("sha256").update(cloudIdentityKey(identity)).digest("hex").slice(0, 12);
  const prefix = identity.name.slice(0, 49).replace(/-+$/, "") || "vm";
  return `${prefix}-${digest}`;
}
