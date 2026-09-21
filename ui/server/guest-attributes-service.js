import { normalizeVmIdentity } from "./vm-identity.js";

const NAMESPACE = "gcp-vm-console";
const MAX_VALUE_LENGTH = 4096;

function secretLike(key = "", value = "") {
  return /password|passwd|secret|token|private|credential|raw-link|link|url/i.test(String(key || ""))
    || /(?:vless|vmess|hy2|hysteria2|tuic|ss):\/\/|password=|passwd=|token=|private[_-]?key/i.test(String(value || ""));
}

function unavailableWarning(error) {
  const message = error?.message || String(error || "");
  if (/permission|denied|forbidden/i.test(message)) return `Guest Attributes 读取权限不足：${message}`;
  if (/disabled|not enabled|not found|404|no guest attributes/i.test(message)) return `Guest Attributes 未可用：${message}`;
  return `Guest Attributes 读取失败：${message}`;
}

function itemPairs(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (data && typeof data === "object") {
    return Object.entries(data).map(([key, value]) => ({ key, value }));
  }
  return [];
}

function parseValues(data) {
  const values = {};
  const warnings = [];
  for (const item of itemPairs(data)) {
    const key = String(item?.key || item?.name || "").trim();
    const value = String(item?.value ?? "").trim();
    if (!key || !value) continue;
    if (value.length > MAX_VALUE_LENGTH || secretLike(key, value)) {
      warnings.push(`已忽略不安全或过长的 Guest Attribute：${key}`);
      continue;
    }
    values[key] = value;
  }
  return { values, warnings };
}

export function createGuestAttributesService({ runner } = {}) {
  if (!runner?.runJson) throw new Error("runner with runJson() is required.");

  async function readConsoleAttributes(input) {
    const identity = normalizeVmIdentity(input);
    try {
      const result = await runner.runJson(
        ["compute", "instances", "get-guest-attributes", identity.name, `--query-path=${NAMESPACE}`],
        {
          context: {
            configuration: identity.configuration,
            account: identity.account,
            projectId: identity.projectId
          },
          location: { zone: identity.zone }
        }
      );
      const parsed = parseValues(result.data);
      return {
        available: Object.keys(parsed.values).length > 0,
        namespace: NAMESPACE,
        values: parsed.values,
        warnings: parsed.warnings
      };
    } catch (error) {
      return {
        available: false,
        namespace: NAMESPACE,
        values: {},
        warnings: [unavailableWarning(error)]
      };
    }
  }

  return { readConsoleAttributes };
}
