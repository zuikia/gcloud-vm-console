const RESOURCE_NAME_PATTERN = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const PUBLIC_IP_MODES = new Set(["ephemeral", "static", "none"]);
const NETWORK_TIERS = new Set(["PREMIUM", "STANDARD"]);
const NIC_TYPES = new Set(["GVNIC", "VIRTIO_NET"]);
const PUBLIC_NODE_METHODS = new Set(["singbox_plus", "three_x_ui"]);

export const NETWORK_PROFILE_RECOMMENDED = Object.freeze({
  externalIpMode: "static",
  networkTier: "PREMIUM",
  nicType: "GVNIC"
});

function enumValue(value, fallback, allowed, label) {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!allowed.has(normalized)) throw new Error(`desired.network.${label} is invalid.`);
  return normalized;
}

function externalIpMode(value) {
  const normalized = String(value || "ephemeral").trim().toLowerCase();
  if (!PUBLIC_IP_MODES.has(normalized)) throw new Error("desired.network.externalIpMode is invalid.");
  return normalized;
}

export function deriveStaticAddressName(instanceName) {
  let base = String(instanceName || "gcloud-instance")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!/^[a-z]/.test(base)) base = `vm-${base}`;
  base = base.slice(0, 60).replace(/-+$/, "") || "gcloud-instance";
  return `${base}-ip`;
}

export function normalizeNetworkProfile(input = {}, { instanceName = "" } = {}) {
  const mode = externalIpMode(input.externalIpMode);
  const tier = enumValue(input.networkTier, "PREMIUM", NETWORK_TIERS, "networkTier");
  const nicType = enumValue(input.nicType, "VIRTIO_NET", NIC_TYPES, "nicType");
  const profile = {
    name: String(input.name || "default").trim() || "default",
    subnet: String(input.subnet || "default").trim() || "default",
    externalIpMode: mode,
    networkTier: tier,
    nicType
  };
  if (mode === "static") {
    const addressName = String(input.addressName || deriveStaticAddressName(instanceName)).trim().toLowerCase();
    if (!RESOURCE_NAME_PATTERN.test(addressName)) {
      throw new Error("desired.network.addressName must be a valid Compute Engine resource name.");
    }
    profile.addressName = addressName;
  }
  return profile;
}

function modeLabel(mode) {
  return {
    ephemeral: "临时 IPv4",
    static: "静态 IPv4",
    none: "无公网 IPv4"
  }[mode] || mode;
}

function nicLabel(nicType) {
  return nicType === "VIRTIO_NET" ? "VirtIO" : nicType;
}

export function toNetworkProfileView(input = {}, {
  instanceName = "",
  deployMethod = "vm_only"
} = {}) {
  try {
    const profile = normalizeNetworkProfile(input, { instanceName });
    const needsPublicIp = PUBLIC_NODE_METHODS.has(String(deployMethod || ""));
    const valid = !(needsPublicIp && profile.externalIpMode === "none");
    const reason = valid ? "" : "Sing-Box-Plus 和 3X-UI 需要公网 IPv4。";
    const hint = profile.externalIpMode === "static"
      ? `执行时将校验或保留区域静态地址 ${profile.addressName}；未挂载的静态 IPv4 仍可能计费。`
      : profile.externalIpMode === "ephemeral"
        ? "实例停止再启动后，临时公网 IPv4 可能变化。"
        : "不会分配公网 IPv4，仅适用于可通过私网或 IAP 管理的实例。";
    return {
      profile,
      valid,
      reason,
      addressVisible: profile.externalIpMode === "static",
      tierDisabled: profile.externalIpMode === "none",
      summary: `${profile.networkTier === "PREMIUM" ? "Premium" : "Standard"} · ${modeLabel(profile.externalIpMode)} · ${nicLabel(profile.nicType)}`,
      hint
    };
  } catch (error) {
    return {
      profile: null,
      valid: false,
      reason: error?.message || String(error),
      addressVisible: String(input.externalIpMode || "").toLowerCase() === "static",
      tierDisabled: String(input.externalIpMode || "").toLowerCase() === "none",
      summary: "网络配置无效",
      hint: error?.message || String(error)
    };
  }
}
