import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evidenceFreshness } from "../public/lib/instance-evidence-freshness-view-model.js";
import { createCloudInventory } from "../server/cloud-inventory.js";
import { createDeploymentProbeService } from "../server/deployment-probe-service.js";
import { createFirewallService } from "../server/firewall-service.js";
import { createGcloudRunner } from "../server/gcloud-runner.js";
import { createGuestAttributesService } from "../server/guest-attributes-service.js";
import { createReadOnlyCommandGuard } from "../server/read-only-command-guard.js";
import { createReadOnlySshProbeRunner } from "../server/read-only-ssh-probe-runner.js";
import { createRecognitionProbeService } from "../server/recognition-probe-service.js";
import { createVmRecordStore } from "../server/vm-record-store.js";

const TARGETS = Object.freeze({
  "example-singbox-instance": Object.freeze({ method: "singbox_plus", service: "sing-box", sshPort: 45400 }),
  "example-xui-instance": Object.freeze({ method: "three_x_ui", service: "x-ui", sshPort: 45400 })
});

function parseArgs(argv = []) {
  let targets = [];
  let format = "plain";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--targets") targets = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg.startsWith("--targets=")) targets = arg.slice(10).split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--json") format = "json";
    else if (arg === "--plain") format = "plain";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!targets.length || targets.some((target) => !TARGETS[target])) {
    throw new Error("Target allowlist permits only example-singbox-instance and example-xui-instance.");
  }
  return { targets: [...new Set(targets)], format };
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function recordsHash(records) {
  const selected = [...records].sort((a, b) => String(a?.id || a?.identity?.name || "").localeCompare(String(b?.id || b?.identity?.name || "")));
  return stableHash(selected);
}

function nodeResultsHash(records) {
  return stableHash([...records]
    .map((record) => ({ id: record?.id || "", name: record?.identity?.name || "", nodeResult: record?.nodeResult || null }))
    .sort((a, b) => `${a.id}:${a.name}`.localeCompare(`${b.id}:${b.name}`)));
}

async function readJobHistory(rootDir) {
  try {
    const entries = (await readdir(rootDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^job-\d{6,}\.json$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const output = [];
    for (const entry of entries) {
      const content = await readFile(path.join(rootDir, entry.name));
      output.push({ name: entry.name, sha256: createHash("sha256").update(content).digest("hex") });
    }
    return output;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function blocker(error) {
  const message = String(error?.message || error || "");
  if (/read-only command policy/i.test(message)) return { category: "policy", message: "只读命令策略已阻止请求" };
  if (/proxy|tunnel connection failed|503/i.test(message)) return { category: "proxy", message: "代理连接阻止了实时验收" };
  if (/iap|failed to connect to backend/i.test(message)) return { category: "iap", message: "IAP 连接阻止了实时验收" };
  if (/permission denied|publickey|ssh|connection refused|timed out/i.test(message)) return { category: "ssh", message: "SSH 连接阻止了实时验收" };
  if (/unauthenticated|login|invalid_grant/i.test(message)) return { category: "auth", message: "gcloud 登录状态阻止了实时验收" };
  return { category: "unknown", message: "实时只读验收失败" };
}

function activeServices(probe) {
  return (Array.isArray(probe?.services) ? probe.services : [])
    .filter((service) => String(service?.status || "").toLowerCase() === "active")
    .map((service) => String(service.name || ""))
    .filter(Boolean);
}

function targetSummary(name, result, now) {
  const expected = TARGETS[name];
  const services = activeServices(result.sshProbe);
  const broadRuleNames = (result.firewallProbe?.broadRuleNames || result.firewallProbe?.broadRules?.map((rule) => rule.name) || []).filter(Boolean);
  const ssh = {
    desired: result.sshProbe?.ssh?.desiredPort || expected.sshPort,
    actual: result.sshProbe?.ssh?.actualPort || null,
    fallback: Boolean(result.sshProbe?.ssh?.fallback),
    verified: Boolean(result.sshProbe?.ssh?.verified)
  };
  const bbr = { enabled: Boolean(result.sshProbe?.bbr?.enabled) };
  const firewall = { status: result.firewallProbe?.status || "unknown", broadRuleNames };
  const checkedAt = result.checkedAt || result.sshProbe?.checkedAt || "";
  const base = {
    name,
    zone: result.cloudInstance?.zone || result.cloudInstance?.identity?.zone || "us-west1-b",
    method: { value: result.recognition?.method || "unmanaged_unknown", confidence: result.recognition?.confidence || "none", source: result.recognition?.source || "none" },
    ssh,
    bbr,
    services,
    firewall,
    checkedAt,
    freshness: evidenceFreshness(checkedAt, { now })
  };
  if (firewall.status === "unknown" && result.firewallProbe?.error) {
    return { ...base, status: "blocked", blocker: blocker(result.firewallProbe.error), drift: [] };
  }
  const drift = [];
  if (result.cloudInstance?.status !== "RUNNING") drift.push(`instance_status:${result.cloudInstance?.status || "missing"}`);
  if (result.recognition?.method !== expected.method) drift.push(`method:${result.recognition?.method || "unknown"}`);
  if (!services.includes(expected.service)) drift.push(`service:${expected.service}:inactive`);
  if (!ssh.verified || ssh.actual !== expected.sshPort) drift.push(`ssh:${ssh.actual || "unverified"}`);
  if (!bbr.enabled) drift.push("bbr:disabled");
  if (firewall.status !== "overexposed" || !broadRuleNames.length) drift.push("firewall:broad-rule-not-detected");
  return {
    ...base,
    status: drift.length ? "drift" : "passed",
    drift
  };
}

function plain(summary) {
  const lines = [
    `Read-only acceptance: ${summary.status}`,
    `Record hash unchanged: ${summary.recordHashUnchanged ? "yes" : "no"}`,
    `Job hash unchanged: ${summary.jobHashUnchanged ? "yes" : "no"}`,
    `Node-result hash unchanged: ${summary.nodeResultHashUnchanged ? "yes" : "no"}`
  ];
  for (const target of summary.targets) {
    lines.push(`${target.name}: ${target.status}`);
    if (target.blocker) {
      lines.push(`  blocker: ${target.blocker.category} - ${target.blocker.message}`);
      continue;
    }
    lines.push(`  method: ${target.method.value} (${target.method.confidence}, ${target.method.source})`);
    lines.push(`  ssh: desired=${target.ssh.desired} actual=${target.ssh.actual || "unknown"} fallback=${target.ssh.fallback}`);
    lines.push(`  bbr: ${target.bbr.enabled ? "enabled" : "disabled"}`);
    lines.push(`  services: ${target.services.join(",") || "none"}`);
    lines.push(`  firewall: ${target.firewall.status} broad=${target.firewall.broadRuleNames.join(",") || "none"}`);
    if (target.drift.length) lines.push(`  drift: ${target.drift.join(",")}`);
  }
  lines.push(`Command ledger: ${summary.commandLedger.map((entry) => entry.category).join(",") || "none"}`);
  return `${lines.join("\n")}\n`;
}

export async function runReadonlyAcceptance({
  argv = [],
  recordStore,
  recognitionProbeService,
  jobHistoryReader = async () => [],
  commandLedger = [],
  outputDir,
  now = () => new Date().toISOString(),
  emit = false
} = {}) {
  const options = parseArgs(argv);
  if (!recordStore?.list || !recognitionProbeService?.probe) throw new Error("Acceptance dependencies are incomplete.");
  const beforeRecords = await recordStore.list();
  const beforeRecordHash = recordsHash(beforeRecords);
  const beforeNodeResultHash = nodeResultsHash(beforeRecords);
  const beforeJobHash = stableHash(await jobHistoryReader());
  const byName = new Map(beforeRecords.map((record) => [record.identity?.name, record]));
  const targets = [];
  for (const name of options.targets) {
    const record = byName.get(name);
    if (!record) {
      targets.push({ name, zone: "us-west1-b", status: "blocked", blocker: { category: "local_record", message: "未找到目标的本地记录" }, drift: [] });
      continue;
    }
    try {
      const result = await recognitionProbeService.probe({
        identity: record.identity,
        ssh: {
          sshUser: record.desired?.ssh?.user,
          sshKeyFile: record.desired?.ssh?.keyFile,
          sshPort: record.desired?.ssh?.port
        },
        localRecord: null
      });
      targets.push(targetSummary(name, result, now()));
    } catch (error) {
      targets.push({ name, zone: record.identity.zone, status: "blocked", blocker: blocker(error), drift: [] });
    }
  }
  const afterRecords = await recordStore.list();
  const recordHashUnchanged = beforeRecordHash === recordsHash(afterRecords);
  const nodeResultHashUnchanged = beforeNodeResultHash === nodeResultsHash(afterRecords);
  const jobHashUnchanged = beforeJobHash === stableHash(await jobHistoryReader());
  const passed = recordHashUnchanged && nodeResultHashUnchanged && jobHashUnchanged && targets.every((target) => target.status === "passed");
  const summary = {
    status: passed ? "passed" : "failed",
    checkedAt: now(),
    recordHashUnchanged,
    jobHashUnchanged,
    nodeResultHashUnchanged,
    targets,
    commandLedger: commandLedger.map((entry) => ({ mode: entry.mode, category: entry.category }))
  };
  const rendered = options.format === "json" ? `${JSON.stringify(summary, null, 2)}\n` : plain(summary);
  const resolvedOutputDir = outputDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "output", "readonly-acceptance");
  await mkdir(resolvedOutputDir, { recursive: true, mode: 0o700 });
  const outputPath = path.join(resolvedOutputDir, `latest.${options.format === "json" ? "json" : "txt"}`);
  await writeFile(outputPath, rendered, { encoding: "utf8", mode: 0o600 });
  if (emit) process.stdout.write(rendered);
  return { exitCode: passed ? 0 : 1, summary, outputPath };
}

async function main() {
  const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataRoot = path.resolve(uiRoot, "..", ".gcp-vm-console");
  const recordStore = createVmRecordStore({ rootDir: path.join(dataRoot, "records") });
  const ledger = [];
  const guardedRunner = createReadOnlyCommandGuard(createGcloudRunner(), { onCommand: (entry) => ledger.push(entry) });
  const inventory = createCloudInventory({ runner: guardedRunner });
  const guestAttributesService = createGuestAttributesService({ runner: guardedRunner });
  const deploymentProbeService = createDeploymentProbeService({
    runner: guardedRunner,
    sshProbeRunner: createReadOnlySshProbeRunner({ onCommand: (entry) => ledger.push(entry) })
  });
  const firewallService = createFirewallService({ runner: guardedRunner });
  const recognitionProbeService = createRecognitionProbeService({ inventory, guestAttributesService, deploymentProbeService, firewallService });
  const result = await runReadonlyAcceptance({
    argv: process.argv.slice(2),
    recordStore,
    recognitionProbeService,
    jobHistoryReader: () => readJobHistory(path.join(dataRoot, "jobs")),
    commandLedger: ledger,
    emit: true
  });
  process.exitCode = result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${blocker(error).category}: ${blocker(error).message}\n`);
    process.exitCode = 1;
  });
}
