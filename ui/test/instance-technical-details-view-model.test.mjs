import assert from "node:assert/strict";
import test from "node:test";

import { toInstanceTechnicalDetailsView } from "../public/lib/instance-technical-details-view-model.js";

function managedItem() {
  return {
    key: "project-a/us-west1-b/example-xui-instance",
    source: "managed",
    identity: {
      name: "example-xui-instance",
      projectId: "example-project-with-a-long-project-suffix",
      zone: "us-west1-b",
      account: "operator-with-a-long-account-name@example.com"
    },
    cloud: {
      status: "RUNNING",
      machineType: "e2-micro",
      network: { externalIp: "203.0.113.10", name: "default", subnet: "default" }
    },
    record: {
      id: "record-a",
      desired: {
        machineType: "e2-micro",
        image: "debian-cloud/debian-12",
        network: { name: "default", subnet: "default" },
        deploy: { method: "three_x_ui" }
      }
    }
  };
}

function recognition() {
  return {
    method: "three_x_ui",
    source: "ssh_deep_probe",
    confidence: "high",
    managedState: "managed",
    score: 96,
    probes: {
      services: [{ name: "x-ui", status: "active" }],
      configSummary: [{ kind: "3X-UI", value: "panel detected" }]
    },
    evidence: [
      { source: "ssh_deep_probe", label: "服务", value: "x-ui active", confidence: "high" },
      { source: "ssh_deep_probe", label: "token", value: "raw-token-value", confidence: "high", sensitive: true }
    ],
    warnings: ["证据冲突：忽略旧标签"]
  };
}

function verification() {
  return {
    status: "partial",
    method: "three_x_ui",
    firewall: { status: "overexposed" },
    ssh: { verified: true, actualPort: 45400, label: "SSH 实际连接 45400" },
    checks: [
      { id: "links", label: "节点链接", status: "failed", detail: "未收集到节点链接" },
      { id: "firewall", label: "防火墙", status: "failed", detail: "公网全端口开放" }
    ],
    warnings: [
      "防火墙：公网全端口开放",
      "调试链接 vless://uuid-secret@example.com:443?password=raw-secret"
    ]
  };
}

test("technical details returns exactly three summary responsibilities", () => {
  const view = toInstanceTechnicalDetailsView({ item: managedItem(), recognition: recognition(), verification: verification() });

  assert.deepEqual(Object.keys(view), ["recognition", "issue", "recovery", "attributeGroups", "manualMethod", "evidence"]);
  assert.equal(view.recognition.value, "3X-UI");
  assert.match(view.recognition.note, /SSH 深探测|历史验证/);
  assert.equal(view.issue.count, 2);
  assert.equal(view.issue.value, "2 个问题");
  assert.match(view.issue.note, /防火墙/);
  assert.equal(view.recovery.actionId, "smartDiagnoseInstance");
  assert.equal(view.recovery.value, "智能诊断");
  assert.equal(Array.isArray(view.issue.items), false);
  assert.equal(Array.isArray(view.recovery.steps), false);
});

test("secondary attributes preserve grouped facts and redacted evidence", () => {
  const view = toInstanceTechnicalDetailsView({ item: managedItem(), recognition: recognition(), verification: verification() });

  assert.deepEqual(view.attributeGroups.map((group) => group.id), ["basic", "network", "identity"]);
  assert.equal(view.manualMethod, "auto");
  assert.equal(view.evidence.length > 0, true);
  const serialized = JSON.stringify(view);
  for (const secret of ["vless://", "uuid-secret", "raw-secret", "raw-token-value"]) {
    assert.equal(serialized.includes(secret), false, `${secret} must be redacted`);
  }
  assert.match(serialized, /\[已隐藏\]|\[redacted/);
});

test("technical summaries stay explicit for unknown and healthy instances", () => {
  const unknown = toInstanceTechnicalDetailsView({ item: managedItem() });
  assert.equal(unknown.recognition.value, "未识别");
  assert.equal(unknown.issue.value, "尚未验证");
  assert.equal(unknown.recovery.value, "智能诊断");

  const healthy = toInstanceTechnicalDetailsView({
    item: managedItem(),
    recognition: recognition(),
    verification: {
      status: "passed",
      checks: [{ id: "ssh", label: "SSH", status: "passed", detail: "SSH 实际连接 45400" }],
      warnings: []
    }
  });
  assert.equal(healthy.issue.value, "暂无待处理验证问题");
  assert.equal(healthy.issue.count, 0);
  assert.equal(healthy.recovery.value, "无需恢复操作");
  assert.equal(healthy.recovery.actionId, "");
});

test("critical project firewall governance overrides an otherwise healthy verification summary", () => {
  const item = managedItem();
  item.record.observed = {
    firewallGovernance: {
      checkedAt: "2026-07-16T09:20:00.000Z",
      expiresAt: "2026-07-16T09:35:00.000Z",
      severity: "critical",
      findings: [{ name: "ruzhan1", severity: "critical", ownership: "external" }],
      affectedInstances: ["vm-a", "vm-b", "vm-c"],
      coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh" },
      ownedActions: [],
      externalActions: [{ ruleName: "ruzhan1", type: "manual-review" }]
    }
  };
  const view = toInstanceTechnicalDetailsView({
    item,
    recognition: recognition(),
    verification: {
      status: "passed",
      firewall: { status: "matched" },
      checks: [{ id: "firewall", label: "防火墙", status: "passed", detail: "自有规则匹配" }],
      warnings: []
    },
    now: "2026-07-16T09:21:00.000Z"
  });

  assert.equal(view.issue.value, "1 个问题");
  assert.match(view.issue.note, /严重风险.*3 台实例/);
  assert.equal(view.issue.tone, "danger");
  assert.equal(view.recovery.value, "人工检查外部规则");
  assert.equal(view.recovery.actionId, "");
});

test("technical details show evidence source, freshness and a failed latest attempt compactly", () => {
  const item = managedItem();
  item.record.verification = {
    ...verification(),
    checkedAt: "2026-07-10T11:40:00.000Z",
    services: [{ name: "x-ui", status: "active" }]
  };
  item.record.observed = {
    lastProbeAttempt: {
      status: "failed", checkedAt: "2026-07-10T11:59:00.000Z", category: "ssh", message: "SSH 连接失败"
    }
  };
  const view = toInstanceTechnicalDetailsView({
    item,
    recognition: recognition(),
    verification: item.record.verification,
    now: "2026-07-10T12:00:00.000Z"
  });
  assert.match(view.recognition.note, /历史验证|SSH 深探测/);
  assert.equal(view.issue.value, "最新探测失败");
  assert.equal(view.recovery.actionId, "smartDiagnoseInstance");
  const evidenceText = JSON.stringify(view.evidence);
  for (const label of ["部署证据", "SSH 证据", "BBR 证据", "防火墙证据", "服务证据"]) {
    assert.match(evidenceText, new RegExp(label));
  }
  assert.match(JSON.stringify(view.evidence), /最新尝试/);
});
