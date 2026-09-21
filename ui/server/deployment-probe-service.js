import { normalizeVmIdentity } from "./vm-identity.js";
import {
  runSshCommand,
  unverifiedSshConnection
} from "./ssh-service.js";

export const READ_ONLY_PROBE_COMMAND = "sudo bash -lc 'echo __GVC_SERVICES__; for svc in sing-box warp-svc x-ui xray v2ray hysteria-server hysteria2 tuic-server; do status=$(systemctl is-active \"$svc\" 2>/dev/null || true); [ -n \"$status\" ] && echo \"$svc $status\"; done; echo __GVC_UNITS__; systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei \"(sing-box|warp-svc|x-ui|xray|v2ray|hysteria|tuic)\" | head -40 || true; systemctl cat sing-box x-ui xray v2ray 2>/dev/null | grep -Ei \"^(# |ExecStart=|EnvironmentFile=|Description=)\" | head -60 || true; echo __GVC_PROCESSES__; ps -eo comm,args --no-headers 2>/dev/null | grep -Ei \"(sing-box|warp-svc|x-ui|xray|v2ray|hysteria|tuic)\" | grep -v grep | head -60 || true; echo __GVC_PORTS__; ss -H -tunlp 2>/dev/null || true; echo __GVC_FILES__; test -d /etc/x-ui && echo x-ui-config-dir; test -f /usr/local/x-ui/x-ui && echo x-ui-binary; test -f /etc/default/x-ui && echo x-ui-env; test -f /etc/systemd/system/x-ui.service && echo x-ui-systemd; test -d /var/log/x-ui && echo x-ui-log-dir; test -d /etc/sing-box && echo sing-box-config-dir; test -f /etc/sing-box/config.json && echo sing-box-config; test -x /usr/bin/sing-box && echo sing-box-binary; test -x /usr/local/bin/sing-box && echo sing-box-local-binary; test -f /etc/systemd/system/sing-box.service && echo sing-box-systemd; test -f /lib/systemd/system/sing-box.service && echo sing-box-lib-systemd; command -v warp-cli >/dev/null 2>&1 && echo warp-cli-command; test -x /usr/local/bin/xray && echo xray-binary; test -d /usr/local/etc/xray && echo xray-config-dir; test -f /etc/systemd/system/xray.service && echo xray-systemd; test -x /usr/bin/v2ray && echo v2ray-binary; test -d /etc/v2ray && echo v2ray-config-dir; echo __GVC_CONTAINERS__; if command -v docker >/dev/null 2>&1; then docker ps --format \"{{json .}}\" 2>/dev/null | grep -Ei \"(sing-box|3x-ui|x-ui|xray|v2ray|hysteria|tuic)\" | head -40 || true; fi; echo __GVC_VERSIONS__; command -v sing-box >/dev/null 2>&1 && sing-box version 2>/dev/null | head -1 || true; command -v xray >/dev/null 2>&1 && xray version 2>/dev/null | head -1 || true; command -v x-ui >/dev/null 2>&1 && echo x-ui-command-present || true; command -v warp-cli >/dev/null 2>&1 && warp-cli --version 2>/dev/null | head -1 || true; echo __GVC_CONFIG_SUMMARY__; if command -v jq >/dev/null 2>&1 && test -f /etc/sing-box/config.json; then jq -r \"\\\"sing-box-inbounds: \\\" + ([.inbounds[]?.type] | unique | join(\\\",\\\"))\" /etc/sing-box/config.json 2>/dev/null | head -1 || true; fi; for config in /opt/sing-box/config.json /etc/sing-box/config.json /usr/local/etc/sing-box/config.json /etc/sing-box-plus/config.json; do if command -v jq >/dev/null 2>&1 && test -r \"$config\"; then warp_server=$(jq -r '\''[.outbounds[]? | select(.tag == \"warp\" and .type == \"socks\")][0].server // empty'\'' \"$config\" 2>/dev/null || true); warp_port=$(jq -r '\''[.outbounds[]? | select(.tag == \"warp\" and .type == \"socks\")][0].server_port // empty'\'' \"$config\" 2>/dev/null || true); warp_routes=$(jq -r '\''[.route.rules[]? | select(.outbound == \"warp\") | .inbound[]? | select(type == \"string\" and test(\"warp$\"; \"i\"))] | unique | length'\'' \"$config\" 2>/dev/null || printf 0); if [ \"$warp_server\" = 127.0.0.1 ] && [ -n \"$warp_port\" ]; then printf \"warp-proxy: %s:%s,routes=%s\\n\" \"$warp_server\" \"$warp_port\" \"$warp_routes\"; fi; break; fi; done; echo __GVC_BBR__; printf \"congestion_control=\"; sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || true; printf \"default_qdisc=\"; sysctl -n net.core.default_qdisc 2>/dev/null || true'";

const KNOWN_SERVICE_NAMES = new Set(["sing-box", "warp-svc", "x-ui", "xray", "v2ray", "hysteria-server", "hysteria2", "tuic-server"]);
const MAX_ITEMS = 24;

function sectioned(output = "") {
  const sections = {
    services: [],
    units: [],
    processes: [],
    ports: [],
    files: [],
    containers: [],
    versions: [],
    configSummary: [],
    bbr: []
  };
  let active = "";
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "__GVC_SERVICES__") {
      active = "services";
      continue;
    }
    if (trimmed === "__GVC_UNITS__") {
      active = "units";
      continue;
    }
    if (trimmed === "__GVC_PROCESSES__") {
      active = "processes";
      continue;
    }
    if (trimmed === "__GVC_PORTS__") {
      active = "ports";
      continue;
    }
    if (trimmed === "__GVC_FILES__") {
      active = "files";
      continue;
    }
    if (trimmed === "__GVC_CONTAINERS__") {
      active = "containers";
      continue;
    }
    if (trimmed === "__GVC_VERSIONS__") {
      active = "versions";
      continue;
    }
    if (trimmed === "__GVC_CONFIG_SUMMARY__") {
      active = "configSummary";
      continue;
    }
    if (trimmed === "__GVC_BBR__") {
      active = "bbr";
      continue;
    }
    if (active && trimmed && !secretLike(trimmed)) sections[active].push(compact(trimmed, 320));
  }
  return sections;
}

function compact(value = "", max = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function secretLike(value = "") {
  return /(?:vless|vmess|hy2|hysteria2|tuic|ss|trojan):\/\/|password=|passwd=|token=|private[_-]?key|credential|secret/i.test(String(value || ""));
}

function parseServices(lines = []) {
  return lines.slice(0, MAX_ITEMS).map((line) => {
    const match = line.match(/^(\S+)\s+(\S+)/);
    return {
      name: match?.[1] || line.split(/\s+/)[0] || "unknown",
      status: match?.[2] || "unknown"
    };
  }).filter((service) => KNOWN_SERVICE_NAMES.has(service.name));
}

function parseUnits(lines = []) {
  const units = [];
  const seen = new Set();
  for (const line of lines) {
    const match = line.match(/\b((?:sing-box|x-ui|xray|v2ray|hysteria2?|tuic)[\w.-]*\.service)\b/i);
    if (!match) continue;
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name);
    units.push({ name, status: /active|running/i.test(line) ? "active" : "observed", detail: compact(line, 120) });
    if (units.length >= MAX_ITEMS) break;
  }
  return units;
}

function parseProcesses(lines = []) {
  const processes = [];
  const seen = new Set();
  for (const line of lines) {
    if (secretLike(line)) continue;
    const [command = "", ...rest] = line.split(/\s+/);
    if (!/(sing-box|x-ui|xray|v2ray|hysteria|tuic)/i.test(`${command} ${rest.join(" ")}`)) continue;
    const key = `${command}:${rest.join(" ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    processes.push({ command: compact(command, 40), args: compact(rest.join(" "), 140) });
    if (processes.length >= MAX_ITEMS) break;
  }
  return processes;
}

function listenerEndpoint(line = "") {
  const fields = String(line || "").trim().split(/\s+/);
  const endpoint = fields[4] || "";
  const match = endpoint.match(/^(?:\[([^\]]+)\]|(.+)):(\d{1,5})$/);
  if (!match) return null;
  return {
    bindAddress: match[1] || match[2],
    port: match[3]
  };
}

function listenerScope(bindAddress = "") {
  const normalized = String(bindAddress || "").toLowerCase().split("%")[0];
  if (["*", "0.0.0.0", "::"].includes(normalized)) return "wildcard";
  if (normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)) return "loopback";
  return "network";
}

function listenerScopeRank(scope = "") {
  return { wildcard: 3, network: 2, loopback: 1 }[scope] || 0;
}

function parsePorts(lines = []) {
  const ports = new Map();
  for (const line of lines) {
    const protocol = String(line.split(/\s+/)[0] || "").toLowerCase();
    if (!["tcp", "udp"].includes(protocol)) continue;
    const endpoint = listenerEndpoint(line);
    if (!endpoint) continue;
    const exposureScope = listenerScope(endpoint.bindAddress);
    const key = `${protocol}:${endpoint.port}`;
    const process = line.match(/users:\(\("([^"]+)"/)?.[1] || "";
    const candidate = {
      protocol,
      port: endpoint.port,
      process: compact(process, 40),
      bindAddress: compact(endpoint.bindAddress, 64),
      exposureScope,
      listening: true
    };
    const existing = ports.get(key);
    if (!existing || listenerScopeRank(candidate.exposureScope) > listenerScopeRank(existing.exposureScope)) {
      ports.set(key, candidate);
    }
  }
  return [...ports.values()].sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
}

function parseFiles(lines = []) {
  const allowed = new Set([
    "x-ui-config-dir",
    "x-ui-binary",
    "x-ui-env",
    "x-ui-systemd",
    "x-ui-log-dir",
    "sing-box-config-dir",
    "sing-box-config",
    "sing-box-binary",
    "sing-box-local-binary",
    "sing-box-systemd",
    "sing-box-lib-systemd",
    "xray-binary",
    "xray-config-dir",
    "xray-systemd",
    "v2ray-binary",
    "v2ray-config-dir"
  ]);
  return [...new Set(lines.flatMap((line) => line.split(/\s+/)).filter((item) => allowed.has(item)))].sort();
}

function parseContainers(lines = []) {
  const containers = [];
  for (const line of lines) {
    if (secretLike(line)) continue;
    try {
      const parsed = JSON.parse(line);
      const name = compact(parsed.Names || parsed.Name || parsed.names || "", 64);
      const image = compact(parsed.Image || parsed.image || "", 96);
      const ports = compact(parsed.Ports || parsed.ports || "", 120);
      if (!/(sing-box|3x-ui|x-ui|xray|v2ray|hysteria|tuic)/i.test(`${name} ${image}`)) continue;
      containers.push({ name, image, ports });
    } catch {
      containers.push({ name: compact(line, 80), image: "", ports: "" });
    }
    if (containers.length >= MAX_ITEMS) break;
  }
  return containers;
}

function parseConfigSummary(lines = []) {
  const summaries = [];
  for (const line of lines) {
    if (secretLike(line)) continue;
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;
    const protocols = match[2].split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
    summaries.push({ kind: match[1], protocols, value: compact(`${match[1]}: ${protocols.join(", ")}`, 140) });
    if (summaries.length >= MAX_ITEMS) break;
  }
  return summaries;
}

function parseBbr(lines = []) {
  const joined = lines.join("\n");
  const congestionControl = joined.match(/congestion_control=([^\s]+)/)?.[1] || lines.find((line) => /^(bbr|cubic|reno)$/i.test(line)) || "";
  const qdisc = joined.match(/default_qdisc=([^\s]+)/)?.[1] || "";
  return {
    enabled: /\bbbr\b/i.test(congestionControl),
    congestionControl,
    qdisc
  };
}

function warningsFor(services, extra = []) {
  const warnings = [...extra];
  const activePrimary = services
    .filter((service) => String(service.status || "").toLowerCase() === "active" && ["sing-box", "x-ui"].includes(service.name))
    .map((service) => service.name);
  if (activePrimary.length > 1) warnings.push(`检测到多个服务同时 active：${activePrimary.join(", ")}`);
  return warnings;
}

function normalizeSshOptions(ssh = {}) {
  return {
    sshUser: ssh.sshUser || ssh.user,
    sshKeyFile: ssh.sshKeyFile || ssh.keyFile,
    sshPort: ssh.sshPort ?? ssh.port
  };
}

export function createDeploymentProbeService({
  runner,
  sshProbeRunner = null,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sshRetryDelayMs = 10000,
  sshMaxAttempts = 6,
  now = () => new Date().toISOString()
} = {}) {
  if (!sshProbeRunner?.run && !runner?.run) throw new Error("sshProbeRunner or runner with run() is required.");
  const sshRetry = { wait, retryDelayMs: sshRetryDelayMs, maxAttempts: sshMaxAttempts };

  async function probe(input, ssh = {}) {
    const identity = normalizeVmIdentity(input);
    const normalizedSsh = normalizeSshOptions(ssh);
    try {
      const runOptions = {
        ...sshRetry,
        requestedSsh: normalizedSsh,
        operationClass: "ssh-read"
      };
      const sshRun = sshProbeRunner?.run
        ? await sshProbeRunner.run(identity, normalizedSsh, READ_ONLY_PROBE_COMMAND, runOptions)
        : await runSshCommand(runner, identity, normalizedSsh, READ_ONLY_PROBE_COMMAND, runOptions);
      const sections = sectioned(sshRun.result.stdout);
      const services = parseServices(sections.services);
      const units = parseUnits(sections.units);
      const processes = parseProcesses(sections.processes);
      const ports = parsePorts(sections.ports);
      const files = parseFiles(sections.files);
      const containers = parseContainers(sections.containers);
      const versions = sections.versions.filter((line) => !secretLike(line)).slice(0, MAX_ITEMS).map((line) => compact(line, 120));
      const configSummary = parseConfigSummary(sections.configSummary);
      const bbr = parseBbr(sections.bbr);
      return {
        ssh: sshRun.sshConnection,
        services,
        units,
        processes,
        ports,
        files,
        containers,
        versions,
        configSummary,
        bbr,
        warnings: warningsFor(services),
        checkedAt: now()
      };
    } catch (error) {
      return {
        ssh: unverifiedSshConnection(normalizedSsh),
        services: [],
        units: [],
        processes: [],
        ports: [],
        files: [],
        containers: [],
        versions: [],
        configSummary: [],
        bbr: { enabled: false, congestionControl: "", qdisc: "" },
        warnings: [error?.message || String(error)],
        checkedAt: now()
      };
    }
  }

  return { probe };
}
