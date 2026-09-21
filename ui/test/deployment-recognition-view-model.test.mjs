import assert from "node:assert/strict";
import test from "node:test";

import {
  confidenceLabel,
  methodBadgeLabel,
  sourceLabel,
  toDeploymentRecognitionView
} from "../public/lib/deployment-recognition-view-model.js";

test("deployment recognition view labels canonical methods sources and confidence in Chinese", () => {
  assert.equal(methodBadgeLabel("vm_only"), "只开实例");
  assert.equal(methodBadgeLabel("singbox_plus"), "Sing-Box-Plus");
  assert.equal(methodBadgeLabel("three_x_ui"), "3X-UI");
  assert.equal(sourceLabel("ssh_probe"), "SSH 探测");
  assert.equal(confidenceLabel("medium"), "中可信");
});

test("deployment recognition view maps managed and external adopted states to compact actions", () => {
  const managed = toDeploymentRecognitionView({
    method: "singbox_plus",
    confidence: "high",
    source: "local_record",
    managedState: "managed",
    evidence: [{ source: "local_record", label: "最近验证", value: "2026-07-08T10:00:00.000Z", confidence: "high" }],
    warnings: [],
    suggestedAction: "verify"
  }, { hasLocalRecord: true, hasCloudInstance: true });
  const adopted = toDeploymentRecognitionView({
    method: "three_x_ui",
    confidence: "high",
    source: "user_confirmed",
    managedState: "external_adopted",
    evidence: [],
    warnings: [],
    suggestedAction: "verify"
  }, { hasLocalRecord: true, hasCloudInstance: true });

  assert.equal(managed.headline, "Sing-Box-Plus");
  assert.equal(managed.primaryActionId, "smartDiagnoseInstance");
  assert.equal(managed.summary, "本地记录 · 高可信 · 本地已管理");
  assert.equal(adopted.summary, "用户确认 · 高可信 · 外部已接管");
});

test("deployment recognition view recommends recognition and local adoption for cloud-only external instances", () => {
  const view = toDeploymentRecognitionView({
    method: "three_x_ui",
    confidence: "medium",
    source: "ssh_probe",
    managedState: "external_observed",
    evidence: [{ source: "ssh_probe", label: "服务 x-ui", value: "active", confidence: "medium" }],
    warnings: [],
    suggestedAction: "adopt"
  }, { hasLocalRecord: false, hasCloudInstance: true });

  assert.equal(view.tone, "warning");
  assert.equal(view.primaryActionId, "adoptLocalInstance");
  assert.equal(view.secondaryActionId, "smartDiagnoseInstance");
  assert.equal(view.summary, "SSH 探测 · 中可信 · 外部可接管");
});

test("deployment recognition view keeps unknown state explicit and hides stale conflict warnings", () => {
  const unknown = toDeploymentRecognitionView({
    method: "unmanaged_unknown",
    confidence: "none",
    source: "none",
    managedState: "unknown",
    evidence: [],
    warnings: ["未找到证据"],
    suggestedAction: "manual_choose"
  }, { hasLocalRecord: false, hasCloudInstance: true });
  const staleConflict = toDeploymentRecognitionView({
    method: "vm_only",
    confidence: "high",
    source: "local_record",
    managedState: "managed",
    evidence: [],
    warnings: ["证据冲突：本地记录为只开实例，SSH 探测为 3X-UI"],
    suggestedAction: "manual_choose"
  }, { hasLocalRecord: true, hasCloudInstance: true });

  assert.equal(unknown.headline, "未识别");
  assert.equal(unknown.tone, "muted");
  assert.equal(unknown.primaryActionId, "smartDiagnoseInstance");
  assert.equal(staleConflict.headline, "只开实例");
  assert.equal(staleConflict.tone, "success");
  assert.equal(staleConflict.primaryActionId, "smartDiagnoseInstance");
  assert.deepEqual(staleConflict.warnings, []);
});

test("deployment recognition view redacts raw links and constrains long evidence", () => {
  const view = toDeploymentRecognitionView({
    method: "three_x_ui",
    confidence: "medium",
    source: "ssh_probe",
    managedState: "external_observed",
    evidence: [
      { source: "ssh_probe", label: "raw", value: "vless://secret@example", confidence: "medium" },
      { source: "ssh_probe", label: "长证据", value: "x".repeat(400), confidence: "medium" }
    ],
    warnings: [],
    suggestedAction: "adopt"
  }, { hasLocalRecord: false, hasCloudInstance: true });

  assert.equal(view.evidence[0].value, "[已隐藏]");
  assert.equal(view.evidence[1].value.length <= 123, true);
});

test("deployment recognition view exposes compact probe facts and grouped evidence", () => {
  const view = toDeploymentRecognitionView({
    method: "three_x_ui",
    confidence: "high",
    score: 95,
    source: "ssh_deep_probe",
    managedState: "external_observed",
    probes: {
      ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true },
      bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
      firewall: {
        status: "partial",
        matchedPorts: [{ protocol: "tcp", port: "45400" }],
        missingPorts: [{ protocol: "udp", port: "23293" }]
      },
      services: [{ name: "x-ui", status: "active" }, { name: "xray", status: "active" }],
      processes: [{ command: "x-ui", args: "x".repeat(300) }],
      containers: [{ name: "3x-ui", image: "ghcr.io/mhsanaei/3x-ui:latest" }],
      configSummary: [{ kind: "xray-inbound", protocols: ["vless", "trojan"] }]
    },
    evidence: [
      { source: "ssh_deep_probe", label: "服务 x-ui", value: "active", confidence: "high" },
      { source: "firewall_probe", label: "防火墙", value: "tcp/45400 matched", confidence: "medium" }
    ],
    warnings: ["udp/23293 未开放"],
    suggestedAction: "adopt"
  }, { hasLocalRecord: false, hasCloudInstance: true });

  assert.equal(view.summary, "SSH 深探测 · 高可信 · 外部可接管 · 95分");
  assert.deepEqual(view.probeFacts.map((item) => item.label), ["SSH", "BBR", "防火墙", "服务"]);
  assert.match(view.probeFacts.find((item) => item.label === "SSH").value, /22.*45400/);
  assert.match(view.probeFacts.find((item) => item.label === "BBR").value, /bbr.*fq/i);
  assert.match(view.probeFacts.find((item) => item.label === "防火墙").value, /部分/);
  assert.ok(view.evidenceGroups.some((group) => group.title === "服务与配置"));
  assert.ok(view.evidenceGroups.some((group) => group.title === "网络与防火墙"));
  assert.ok(view.detailRows.every((row) => row.value.length <= 140));
});

test("deployment recognition view marks public allow-all firewall rules as dangerous", () => {
  const view = toDeploymentRecognitionView({
    method: "three_x_ui",
    confidence: "high",
    source: "ssh_probe",
    managedState: "external_observed",
    probes: {
      ssh: { verified: true, actualPort: 45400 },
      bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
      firewall: {
        status: "overexposed",
        matchedPorts: [{ protocol: "tcp", port: "8443" }],
        missingPorts: [],
        broadRules: [{ name: "public-allow-all" }]
      },
      services: [{ name: "x-ui", status: "active" }]
    }
  });

  const firewall = view.probeFacts.find((item) => item.label === "防火墙");
  assert.equal(firewall.value, "过度开放");
  assert.equal(firewall.tone, "danger");
});

test("deployment recognition view translates a not-required firewall status instead of exposing raw enum text", () => {
  const view = toDeploymentRecognitionView({
    method: "vm_only",
    confidence: "high",
    source: "local_verification",
    managedState: "managed",
    probes: {
      ssh: { desiredPort: 45400, actualPort: 45400, fallback: false, verified: true },
      bbr: { enabled: false, congestionControl: "cubic", qdisc: "fq_codel" },
      firewall: { status: "not_required" },
      services: []
    },
    evidence: [],
    warnings: []
  }, { hasLocalRecord: true, hasCloudInstance: true });

  assert.equal(view.probeFacts.find((item) => item.label === "防火墙").value, "无需检查");
  assert.equal(view.probeFacts.find((item) => item.label === "BBR").value, "cubic / fq_codel");
});
