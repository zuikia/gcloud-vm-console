import { createHash } from "node:crypto";

import { normalizeVmIdentity } from "./vm-identity.js";
import {
  runSshCommand,
  unverifiedSshConnection
} from "./ssh-service.js";

const SINGBOX_TARGETS = new Set(["hy2-obfs-warp", "tuic-v5-warp", "hy2-obfs", "tuic-v5"]);
const IAP_SOURCE_RANGE = "35.235.240.0/20";
const SINGBOX_FRAGMENT_NAMES = {
  "hysteria2-obfs": "hy2-obfs",
  "hysteria2-obfs-warp": "hy2-obfs-warp",
  "tuic-v5": "tuic-v5",
  "tuic-v5-warp": "tuic-v5-warp"
};

function stripAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function canonicalSingboxName(fragment = "") {
  return SINGBOX_FRAGMENT_NAMES[String(fragment || "").trim().toLowerCase()] || "";
}

function extractPortFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) return parsed.port;
  } catch {
    // Fall back to a conservative last ":port" match below.
  }
  const match = String(url || "").match(/(?::|%3A)(\d{2,5})(?:[/?#]|$)/i);
  return match?.[1] || "";
}

function linkFromUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url || !/^(?:hy2|tuic):\/\//i.test(url)) return null;
  const fragment = decodeURIComponent(url.split("#").pop() || "");
  const name = canonicalSingboxName(fragment);
  if (!SINGBOX_TARGETS.has(name)) return null;
  const port = extractPortFromUrl(url);
  if (!port) return null;
  return { name, port, protocol: "udp", url };
}

function parseSingboxLinks(output) {
  const links = [];
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const normalized = line.trim();
    const legacyMatch = normalized.match(/^(hy2-obfs-warp|tuic-v5-warp|hy2-obfs|tuic-v5)\s+(\d{2,5})\s+UDP\s+(\S+)/i);
    if (legacyMatch) {
      const name = legacyMatch[1].toLowerCase();
      if (SINGBOX_TARGETS.has(name)) links.push({ name, port: legacyMatch[2], protocol: "udp", url: legacyMatch[3] });
      continue;
    }
    for (const match of normalized.matchAll(/\b(?:hy2|tuic):\/\/\S+/gi)) {
      const link = linkFromUrl(match[0]);
      if (link) links.push(link);
    }
  }
  return links;
}

function unquoteValue(value) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\\ /g, " ");
}

function keyValues(output) {
  const values = {};
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = unquoteValue(match[2]);
  }
  return values;
}

function uniqueSortedPorts(links) {
  return [...new Set(links.map((link) => link.port).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b));
}

function requestedCustomSshPort(ssh = {}) {
  const port = Number(ssh.sshPort || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Custom SSH port must be an integer between 1 and 65535.");
  }
  return port === 22 ? null : port;
}

function requestedPanelPort(value = 443) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) {
    throw new Error("3X-UI panelPort must be an integer between 1 and 65535.");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("3X-UI panelPort must be an integer between 1 and 65535.");
  }
  return String(port);
}

function requestedXuiVersion(value = "v2.9.4") {
  if (typeof value !== "string" || value.length > 64 || !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value)) {
    throw new Error("3X-UI xuiVersion must be an explicit version such as v2.9.4 or v2.10.0-rc.1.");
  }
  return value;
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "vm";
}

function sshIapRuleName(identity) {
  const base = `gvc-${safeSlug(identity.name)}-ssh-iap-tcp`;
  if (base.length <= 63) return base;
  const hash = createHash("sha256")
    .update(`${identity.projectId}:${identity.name}:ssh-iap:tcp`)
    .digest("hex")
    .slice(0, 8);
  return `${base.slice(0, 54).replace(/-+$/g, "")}-${hash}`.slice(0, 63);
}

function sshPortResult(result) {
  if (!result) return null;
  return {
    status: result.status,
    port: result.port,
    ...(result.error ? { error: String(result.error).slice(0, 240) } : {}),
    ...(result.rule ? { firewallRule: result.rule } : {})
  };
}

export function createNodePipeline({
  runner,
  firewallService,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sshRetryDelayMs = 10000,
  sshMaxAttempts = 6
} = {}) {
  if (!runner?.run) throw new Error("runner with run() is required.");
  if (!firewallService?.ensureOwnedRule) throw new Error("firewallService with ensureOwnedRule() is required.");
  const sshRetry = {
    wait,
    retryDelayMs: sshRetryDelayMs,
    maxAttempts: sshMaxAttempts,
    operationClass: "long-running"
  };

  async function configureRequestedSshPort(identity, deploy, ssh) {
    if (!deploy.configureSshPort) return null;
    const port = requestedCustomSshPort(ssh);
    if (!port) return null;
    const bootstrap = await runSshCommand(
      runner,
      identity,
      ssh,
      "printf 'gvc-ssh-bootstrap-ready\\n'",
      { ...sshRetry, requestedSsh: ssh }
    );
    let rule = null;
    try {
      rule = await firewallService.ensureOwnedRule({
        identity,
        name: sshIapRuleName(identity),
        network: deploy.network || "default",
        protocol: "tcp",
        ports: ["22", String(port)],
        targetTags: deploy.targetTags || [identity.name],
        sourceRanges: [IAP_SOURCE_RANGE]
      });
      const configureCommand = `sudo bash -lc "set -e; install -d -m 0755 /etc/ssh/sshd_config.d; printf '%s\\n' 'Port 22' 'Port ${port}' > /etc/ssh/sshd_config.d/99-gcp-vm-console-port.conf; /usr/sbin/sshd -t; systemctl reload ssh 2>/dev/null || systemctl restart ssh 2>/dev/null || systemctl restart sshd"`;
      await runSshCommand(
        runner,
        identity,
        bootstrap.ssh,
        configureCommand,
        { ...sshRetry, requestedSsh: ssh }
      );
      const verified = await runSshCommand(
        runner,
        identity,
        ssh,
        "printf 'gvc-custom-ssh-ready\\n'",
        { ...sshRetry, requestedSsh: ssh, allowDefaultPortFallback: false }
      );
      return {
        status: "configured",
        port,
        rule,
        ssh: verified.ssh,
        sshConnection: verified.sshConnection
      };
    } catch (error) {
      return {
        status: "failed",
        port,
        rule,
        error: error?.message || String(error),
        ssh: bootstrap.ssh,
        sshConnection: bootstrap.sshConnection
      };
    }
  }

  async function deployVmOnly(ssh) {
    const sshConnection = unverifiedSshConnection(ssh);
    return {
      method: "vm_only",
      status: "succeeded",
      stages: ["vm_ready"],
      firewall: { status: "not_required", rules: [] },
      ssh: sshConnection,
      nodeResult: { type: "vm_only", links: [], firewall: { status: "not_required", rules: [] }, ssh: sshConnection }
    };
  }

  async function deploySingbox(identity, deploy, ssh) {
    const sshPort = await configureRequestedSshPort(identity, deploy, ssh);
    const deploymentSsh = sshPort?.ssh || ssh;
    const installRun = await runSshCommand(
      runner,
      identity,
      deploymentSsh,
      "sudo bash -lc \"apt-get update && apt-get install -y wget curl && wget -O sing-box-plus.sh https://raw.githubusercontent.com/Alvin9999-newpac/Sing-Box-Plus/main/sing-box-plus.sh && sed -i 's/^stty erase \\\\^H.*/[[ -t 0 ]] \\\\&\\\\& stty erase ^H || true # patched for noninteractive/' sing-box-plus.sh && chmod +x sing-box-plus.sh && printf '1\\n' | SBP_SOFT=1 bash sing-box-plus.sh\"",
      { ...sshRetry, requestedSsh: ssh }
    );
    const install = installRun.result;
    const bbr = await runSshCommand(
      runner,
      identity,
      installRun.ssh,
      "sudo bash -lc \"printf '%s\\n' 'net.core.default_qdisc=fq' 'net.ipv4.tcp_congestion_control=bbr' > /etc/sysctl.d/99-gcp-vm-console-bbr.conf; sysctl --system >/dev/null 2>&1 || true; sysctl net.ipv4.tcp_congestion_control || true\"",
      { ...sshRetry, requestedSsh: ssh }
    );
    const links = parseSingboxLinks(install.stdout);
    const ports = uniqueSortedPorts(links);
    const firewall = {
      status: sshPort?.rule ? "synced" : "not_required",
      rules: sshPort?.rule ? [sshPort.rule] : []
    };
    if (ports.length) {
      try {
        firewall.rules.push(await firewallService.ensureOwnedRule({
          identity,
          name: `${identity.name}-singbox-udp`,
          network: deploy.network || "default",
          protocol: "udp",
          ports,
          targetTags: deploy.targetTags || [identity.name],
          sourceRanges: deploy.sourceRanges || ["0.0.0.0/0"]
        }));
        firewall.status = "synced";
      } catch (error) {
        firewall.status = "failed";
        firewall.error = error?.message || String(error);
      }
    }
    const status = firewall.status === "failed" || sshPort?.status === "failed" ? "partial" : "succeeded";
    const sshConnection = bbr.sshConnection || installRun.sshConnection || unverifiedSshConnection(ssh);
    return {
      method: "singbox_plus",
      status,
      stages: [...(sshPort ? ["ssh_port"] : []), "install", "bbr_check", "firewall_sync", "collect"],
      firewall,
      ssh: sshConnection,
      sshPort: sshPortResult(sshPort),
      nodeResult: {
        type: "singbox_plus",
        bbr: /bbr/i.test(bbr.result.stdout || ""),
        links,
        firewall,
        sshPort: sshPortResult(sshPort),
        ssh: sshConnection
      }
    };
  }

  async function deployThreeXUi(identity, deploy, ssh) {
    const version = requestedXuiVersion(deploy.xuiVersion);
    const panelPort = requestedPanelPort(deploy.panelPort);
    const sshPort = await configureRequestedSshPort(identity, deploy, ssh);
    const deploymentSsh = sshPort?.ssh || ssh;
    const installRun = await runSshCommand(
      runner,
      identity,
      deploymentSsh,
      `sudo bash -lc "XUI_NONINTERACTIVE=1 XUI_DB_TYPE=sqlite XUI_PANEL_PORT=${panelPort} bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh) ${version}; if [ -f /etc/x-ui/install-result.env ]; then cat /etc/x-ui/install-result.env; fi"`,
      { ...sshRetry, requestedSsh: ssh }
    );
    const install = installRun.result;
    const firewall = {
      status: sshPort?.rule ? "synced" : "not_required",
      rules: sshPort?.rule ? [sshPort.rule] : []
    };
    try {
      firewall.rules.push(await firewallService.ensureOwnedRule({
        identity,
        name: `${identity.name}-3x-ui-tcp`,
        network: deploy.network || "default",
        protocol: "tcp",
        ports: [panelPort],
        targetTags: deploy.targetTags || [identity.name],
        sourceRanges: deploy.sourceRanges || ["0.0.0.0/0"]
      }));
      firewall.status = "synced";
    } catch (error) {
      firewall.status = "failed";
      firewall.error = error?.message || String(error);
    }
    const parsed = keyValues(install.stdout);
    const panelUrl = parsed.PANEL_URL || parsed.XUI_ACCESS_URL || "";
    const panelUsername = parsed.USERNAME || parsed.XUI_USERNAME || "";
    const panelPassword = parsed.PASSWORD || parsed.XUI_PASSWORD || "";
    const resolvedPanelPort = parsed.XUI_PANEL_PORT || panelPort;
    const status = firewall.status === "failed" || sshPort?.status === "failed" ? "partial" : "succeeded";
    const sshConnection = installRun.sshConnection || unverifiedSshConnection(ssh);
    return {
      method: "three_x_ui",
      status,
      stages: [...(sshPort ? ["ssh_port"] : []), "install", "firewall_sync", "collect"],
      firewall,
      ssh: sshConnection,
      sshPort: sshPortResult(sshPort),
      nodeResult: {
        type: "three_x_ui",
        panel: {
          url: panelUrl,
          username: panelUsername,
          credentialsAvailable: Boolean(panelPassword || parsed.XUI_API_TOKEN),
          port: resolvedPanelPort,
          webBasePath: parsed.XUI_WEB_BASE_PATH || ""
        },
        links: parsed.VLESS_REALITY ? [{ name: "vless-reality", url: parsed.VLESS_REALITY }] : [],
        firewall,
        sshPort: sshPortResult(sshPort),
        ssh: sshConnection
      }
    };
  }

  async function deploy({ identity: rawIdentity, deploy = {}, ssh = {} } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    if (deploy.method === "vm_only") return deployVmOnly(ssh);
    if (deploy.method === "singbox_plus") return deploySingbox(identity, deploy, ssh);
    if (deploy.method === "three_x_ui") return deployThreeXUi(identity, deploy, ssh);
    throw new Error(`Unsupported node deployment method: ${deploy.method || "unknown"}.`);
  }

  return { deploy };
}
