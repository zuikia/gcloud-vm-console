import { normalizeVmIdentity } from "./vm-identity.js";
import {
  runSshCommand,
  unverifiedSshConnection
} from "./ssh-service.js";

const VERIFY_COMMAND = "sudo bash -lc 'echo __GVC_SERVICES__; systemctl is-active sing-box 2>/dev/null | sed \"s/^/sing-box /\" || true; systemctl is-active x-ui 2>/dev/null | sed \"s/^/x-ui /\" || true; echo __GVC_BBR__; sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || true; sysctl -n net.core.default_qdisc 2>/dev/null || true; echo __GVC_PORTS__; ss -H -lunpt 2>/dev/null || true'";

const REQUIREMENTS = {
  vm_only: { services: [], links: false, firewall: false, bbr: false },
  singbox_plus: { services: ["sing-box"], links: true, firewall: true, bbr: true },
  three_x_ui: { services: ["x-ui"], links: false, panel: true, firewall: true, bbr: false },
  custom_startup: { services: [], links: false, firewall: false, bbr: false }
};

function normalizeMethod(desired = {}, nodeResult = {}, methodOverride = "") {
  return methodOverride || desired.deploy?.method || nodeResult?.type || "vm_only";
}

function parseSections(output = "") {
  const sections = { services: [], bbr: [], ports: [] };
  let active = "";
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "__GVC_SERVICES__") {
      active = "services";
      continue;
    }
    if (trimmed === "__GVC_BBR__") {
      active = "bbr";
      continue;
    }
    if (trimmed === "__GVC_PORTS__") {
      active = "ports";
      continue;
    }
    if (active && trimmed) sections[active].push(trimmed);
  }
  return sections;
}

function parseServices(lines = []) {
  return lines.map((line) => {
    const match = line.match(/^(\S+)\s+(.+)$/);
    return {
      name: match?.[1] || line,
      status: match?.[2] || "unknown"
    };
  });
}

function serviceStatus(services, name) {
  return services.find((service) => service.name === name)?.status || "unknown";
}

function expectedPorts(method, nodeResult = {}) {
  if (method === "singbox_plus") {
    return [...new Set((Array.isArray(nodeResult.links) ? nodeResult.links : [])
      .map((link) => ({
        protocol: String(link.protocol || link.transport || "udp").toLowerCase(),
        port: String(link.port || "")
      }))
      .filter((item) => item.port && item.protocol === "udp")
      .map((item) => `${item.protocol}:${item.port}`))]
      .sort()
      .map((value) => {
        const [protocol, port] = value.split(":");
        return { protocol, port };
      });
  }
  if (method === "three_x_ui") {
    return [{ protocol: "tcp", port: String(nodeResult.panel?.port || "443") }];
  }
  return [];
}

function lineShowsPort(line, { protocol, port }) {
  const normalized = String(line || "").toLowerCase();
  return normalized.startsWith(protocol) && new RegExp(`:${port}(?:\\s|$)`).test(normalized);
}

function portRows(ports, portLines) {
  return ports.map((expected) => ({
    protocol: expected.protocol,
    port: expected.port,
    expected: true,
    listening: portLines.some((line) => lineShowsPort(line, expected))
  }));
}

function normalizedExpectedPorts(ports = []) {
  const seen = new Set();
  return (Array.isArray(ports) ? ports : [])
    .map((item) => ({
      protocol: String(item?.protocol || "").toLowerCase(),
      port: String(item?.port || "")
    }))
    .filter((item) => item.protocol && item.port)
    .filter((item) => {
      const key = `${item.protocol}/${item.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function runtimePortRows(ports, runtimePorts = []) {
  return ports.map((expected) => {
    const observed = (Array.isArray(runtimePorts) ? runtimePorts : []).find((item) => (
      String(item?.protocol || "").toLowerCase() === expected.protocol &&
      String(item?.port || "") === expected.port
    ));
    return {
      protocol: expected.protocol,
      port: expected.port,
      expected: true,
      listening: Boolean(observed && observed.listening !== false),
      scope: String(observed?.exposureScope || observed?.scope || "")
    };
  });
}

function bbrView(runtimeProbe = null, sections = {}) {
  if (runtimeProbe?.bbr && typeof runtimeProbe.bbr === "object") {
    return {
      enabled: Boolean(runtimeProbe.bbr.enabled),
      congestionControl: String(runtimeProbe.bbr.congestionControl || ""),
      qdisc: String(runtimeProbe.bbr.qdisc || "")
    };
  }
  const bbrLines = (sections.bbr || []).map((line) => String(line || "").trim()).filter(Boolean);
  const congestionControl = bbrLines.find((line) => /^(bbr2?|cubic|reno)$/i.test(line)) || "";
  const qdisc = bbrLines.find((line) => line !== congestionControl && /^(fq|fq_codel|cake|pfifo_fast|noqueue)$/i.test(line)) || "";
  return {
    enabled: /\bbbr\b/i.test(congestionControl),
    congestionControl,
    qdisc
  };
}

function checkStatus(ok, partial = false) {
  if (ok) return "passed";
  return partial ? "partial" : "failed";
}

function statusFromChecks(checks) {
  if (checks.some((check) => check.status === "failed")) return "partial";
  if (checks.some((check) => check.status === "partial")) return "partial";
  return "passed";
}

function targetTags(desired = {}, identity) {
  return Array.isArray(desired.tags) && desired.tags.length ? desired.tags : [identity.name];
}

function sourceRanges(desired = {}) {
  return Array.isArray(desired.sourceRanges) && desired.sourceRanges.length ? desired.sourceRanges : ["0.0.0.0/0"];
}

function firewallRuleFor(method, identity, ports) {
  if (method === "singbox_plus") {
    return {
      name: `${identity.name}-singbox-udp`,
      protocol: "udp",
      ports: ports.map((item) => item.port)
    };
  }
  if (method === "three_x_ui") {
    return {
      name: `${identity.name}-3x-ui-tcp`,
      protocol: "tcp",
      ports: ports.map((item) => item.port)
    };
  }
  return null;
}

function warningFor(check) {
  if (check.status === "passed") return "";
  return `${check.label}：${check.detail}`;
}

export function createDeploymentVerifier({
  runner,
  firewallService,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sshRetryDelayMs = 10000,
  sshMaxAttempts = 6,
  now = () => new Date().toISOString()
} = {}) {
  if (!runner?.run) throw new Error("runner with run() is required.");
  if (!firewallService?.inspectOwnedRule) throw new Error("firewallService with inspectOwnedRule() is required.");
  const sshRetry = { wait, retryDelayMs: sshRetryDelayMs, maxAttempts: sshMaxAttempts };

  async function verify({
    identity: rawIdentity,
    desired = {},
    nodeResult = null,
    ssh = {},
    methodOverride = "",
    runtimeProbe = null,
    expectedRuntimePorts = [],
    firewallProbe = null
  } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const method = normalizeMethod(desired, nodeResult, methodOverride);
    const requirements = REQUIREMENTS[method] || REQUIREMENTS.custom_startup;
    let sshConnection;
    let sections = { services: [], bbr: [], ports: [] };
    let services = [];

    if (runtimeProbe) {
      if (!runtimeProbe.ssh?.verified) {
        const detail = runtimeProbe.warnings?.[0] || "只读 SSH 探测未通过";
        return {
          status: "failed",
          checkedAt: now(),
          method,
          ssh: runtimeProbe.ssh || unverifiedSshConnection(ssh),
          bbr: bbrView(runtimeProbe),
          checks: [{ id: "ssh", label: "SSH 连接", status: "failed", detail }],
          services: Array.isArray(runtimeProbe.services) ? runtimeProbe.services : [],
          ports: [],
          firewall: firewallProbe || { status: "unknown", rules: [], error: "" },
          warnings: [detail]
        };
      }
      sshConnection = runtimeProbe.ssh;
      services = Array.isArray(runtimeProbe.services) ? runtimeProbe.services : [];
    } else {
      let sshRun;
      try {
        sshRun = await runSshCommand(runner, identity, ssh, VERIFY_COMMAND, {
          ...sshRetry,
          requestedSsh: ssh,
          operationClass: "ssh-read"
        });
      } catch (error) {
        return {
          status: "failed",
          checkedAt: now(),
          method,
          ssh: unverifiedSshConnection(ssh),
          bbr: null,
          checks: [{ id: "ssh", label: "SSH 连接", status: "failed", detail: error?.message || String(error) }],
          services: [],
          ports: [],
          firewall: { status: "unknown", rules: [], error: "" },
          warnings: [error?.message || String(error)]
        };
      }
      sshConnection = sshRun.sshConnection;
      sections = parseSections(sshRun.result.stdout);
      services = parseServices(sections.services);
    }

    const explicitRuntimePorts = normalizedExpectedPorts(expectedRuntimePorts);
    const ports = explicitRuntimePorts.length ? explicitRuntimePorts : expectedPorts(method, nodeResult || {});
    const observedPorts = runtimeProbe
      ? runtimePortRows(ports, runtimeProbe.ports)
      : portRows(ports, sections.ports);
    const bbr = bbrView(runtimeProbe, sections);
    const checks = [{
      id: "ssh",
      label: "SSH 连接",
      status: "passed",
      detail: sshConnection.label
    }];

    if (requirements.services.length) {
      const missing = requirements.services.filter((name) => serviceStatus(services, name) !== "active");
      checks.push({
        id: "service",
        label: "服务状态",
        status: checkStatus(!missing.length),
        detail: missing.length ? `未运行：${missing.join(", ")}` : `${requirements.services.join(", ")} active`
      });
    }

    if (requirements.links) {
      const links = Array.isArray(nodeResult?.links) ? nodeResult.links : [];
      checks.push({
        id: "links",
        label: "节点链接",
        status: checkStatus(links.length > 0),
        detail: links.length ? `${links.length} 条链接已收集` : "未收集到节点链接"
      });
    }

    if (requirements.panel) {
      const panel = nodeResult?.panel || {};
      const ok = Boolean(panel.url && panel.username && panel.password);
      checks.push({
        id: "panel",
        label: "3X-UI 面板",
        status: checkStatus(ok),
        detail: ok ? "面板地址和账号已收集" : "面板地址、用户名或密码缺失"
      });
    }

    if (ports.length) {
      const missingPorts = observedPorts.filter((port) => !port.listening).map((port) => `${port.protocol}/${port.port}`);
      checks.push({
        id: "ports",
        label: "端口监听",
        status: checkStatus(!missingPorts.length, true),
        detail: missingPorts.length ? `未监听：${missingPorts.join(", ")}` : `${ports.length} 个端口已监听`
      });
    }

    if (requirements.bbr || runtimeProbe?.bbr) {
      checks.push({
        id: "bbr",
        label: "BBR",
        status: checkStatus(bbr.enabled, true),
        detail: bbr.enabled
          ? `BBR 已开启${bbr.qdisc ? ` / ${bbr.qdisc}` : ""}`
          : `BBR 未开启${bbr.congestionControl ? `（${bbr.congestionControl}）` : ""}`
      });
    }

    let firewall = { status: "not_required", rules: [] };
    const firewallRule = requirements.firewall ? firewallRuleFor(method, identity, ports) : null;
    if (requirements.firewall && firewallProbe) {
      firewall = {
        status: firewallProbe.status || "unknown",
        rules: Array.isArray(firewallProbe.rules) ? firewallProbe.rules : [],
        matchedPorts: Array.isArray(firewallProbe.matchedPorts) ? firewallProbe.matchedPorts : [],
        missingPorts: Array.isArray(firewallProbe.missingPorts) ? firewallProbe.missingPorts : [],
        internalPorts: Array.isArray(firewallProbe.internalPorts) ? firewallProbe.internalPorts : [],
        broadRules: Array.isArray(firewallProbe.broadRules) ? firewallProbe.broadRules : [],
        exposedPorts: Array.isArray(firewallProbe.exposedPorts) ? firewallProbe.exposedPorts : [],
        error: firewallProbe.warning || firewallProbe.error || ""
      };
      checks.push({
        id: "firewall",
        label: "防火墙",
        status: firewall.status === "matched" ? "passed" : "partial",
        detail: firewall.status === "matched"
          ? "实例端口暴露匹配"
          : (firewall.error || `实例端口暴露：${firewall.status}`)
      });
    } else if (firewallRule) {
      try {
        const inspected = await firewallService.inspectOwnedRule({
          identity,
          name: firewallRule.name,
          protocol: firewallRule.protocol,
          ports: firewallRule.ports,
          targetTags: targetTags(desired, identity),
          sourceRanges: sourceRanges(desired)
        });
        firewall = { status: inspected.status, rules: [inspected], error: inspected.error || "" };
      } catch (error) {
        firewall = { status: "unknown", rules: [], error: error?.message || String(error) };
      }
      checks.push({
        id: "firewall",
        label: "防火墙",
        status: firewall.status === "matched" ? "passed" : "partial",
        detail: firewall.status === "matched" ? "规则匹配" : (firewall.error || `规则状态：${firewall.status}`)
      });
    }

    const warnings = checks.map(warningFor).filter(Boolean);
    if (sshConnection.fallback) warnings.push(`SSH 自定义端口未验证，当前通过 ${sshConnection.actualPort} 连接`);

    return {
      status: statusFromChecks(checks),
      checkedAt: now(),
      method,
      ssh: sshConnection,
      bbr,
      checks,
      services,
      ports: observedPorts,
      firewall,
      warnings
    };
  }

  return { verify };
}
