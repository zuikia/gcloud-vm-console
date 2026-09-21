import assert from "node:assert/strict";
import test from "node:test";

import { toInstanceDetailView } from "../public/lib/instance-detail-view-model.js";

function action(id, enabled = true, label = id) {
  return { id, enabled, label, reason: enabled ? "" : "当前不可用" };
}

function managedItem(overrides = {}) {
  return {
    key: "project-a/us-west1-b/vm-a",
    source: "managed",
    identity: {
      name: "vm-a",
      projectId: "project-a",
      zone: "us-west1-b",
      account: "user@example.com"
    },
    cloud: {
      status: "RUNNING",
      machineType: "e2-micro",
      network: {
        externalIp: "203.0.113.10",
        name: "default",
        subnet: "default"
      }
    },
    record: {
      id: "record-a",
      status: "managed",
      updatedAt: "2026-07-09T10:00:00.000Z",
      desired: {
        machineType: "e2-micro",
        image: "debian-cloud/debian-12",
        network: { name: "default", subnet: "default" },
        deploy: { method: "singbox_plus" }
      },
      observed: {
        sshConnection: {
          desiredPort: 45400,
          actualPort: 45400,
          verified: true,
          fallback: false
        }
      },
      nodeResult: {
        type: "singbox_plus",
        bbr: false,
        ssh: {
          desiredPort: 45400,
          actualPort: 45400,
          verified: true,
          fallback: false
        },
        firewall: { status: "missing", matchedPorts: [], missingPorts: [{ protocol: "udp", port: "443" }] },
        links: []
      },
      verification: {
        status: "partial",
        checkedAt: "2026-07-10T11:00:00.000Z",
        method: "singbox_plus",
        ssh: {
          desiredPort: 45400,
          actualPort: 22,
          verified: true,
          fallback: true
        },
        bbr: {
          enabled: true,
          congestionControl: "bbr",
          qdisc: "fq"
        },
        firewall: {
          status: "partial",
          matchedPorts: [{ protocol: "udp", port: "443" }],
          missingPorts: [{ protocol: "udp", port: "8443" }]
        },
        services: [
          { name: "sing-box", status: "active" },
          { name: "warp-svc", status: "active" },
          { name: "x-ui", status: "inactive" }
        ],
        checks: [
          { id: "ssh", label: "SSH", status: "passed", detail: "SSH 实际连接 22" },
          { id: "firewall", label: "防火墙", status: "partial", detail: "部分端口未开放" }
        ]
      }
    },
    ...overrides
  };
}

function readiness(overrides = {}) {
  return {
    detailPrimary: action("detailPrimary", true, "修改部署"),
    cloneVm: action("cloneVm", true, "基于此新建"),
    deployNodes: action("deployNodes", true, "部署 Sing-Box-Plus"),
    smartDiagnoseInstance: action("smartDiagnoseInstance", true, "重新探测"),
    adoptLocalInstance: action("adoptLocalInstance", false, "接管本地"),
    restartVm: action("restartVm", true, "重启实例"),
    systemUpdate: action("systemUpdate", true, "系统更新"),
    deleteLocalRecord: action("deleteLocalRecord", true, "移除本地记录"),
    deleteCloudResource: action("deleteCloudResource", false, "删除云端资源"),
    showNodeResults: action("showNodeResults", false, "查看节点结果"),
    ...overrides
  };
}

test("instance detail uses fixed status order and newer verification evidence", () => {
  const view = toInstanceDetailView({
    item: managedItem(),
    recognitionPreview: {
      checkedAt: "2026-07-10T10:00:00.000Z",
      recognition: {
        method: "three_x_ui",
        confidence: "high",
        probes: {
          ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
          bbr: { enabled: false, congestionControl: "cubic", qdisc: "fq_codel" },
          firewall: { status: "matched", matchedPorts: [{ protocol: "tcp", port: "45400" }], missingPorts: [] },
          services: [{ name: "x-ui", status: "active" }]
        }
      }
    },
    actionReadiness: readiness()
  });

  assert.deepEqual(view.statuses.map((item) => item.id), [
    "ssh",
    "bbr",
    "firewall",
    "services"
  ]);
  assert.equal(view.statuses.find((item) => item.id === "ssh").value, "22（从 45400 回退）");
  assert.equal(view.statuses.find((item) => item.id === "bbr").value, "已启用");
  assert.equal(view.statuses.find((item) => item.id === "firewall").value, "部分开放 1/2");
  assert.equal(view.statuses.find((item) => item.id === "services").value, "2 项运行中");
  assert.equal(view.statuses.every((item) => item.source === "verification"), true);
  assert.equal(view.header.checkedAt, "2026-07-10T11:00:00.000Z");
  assert.equal(view.header.methodLabel, "Sing-Box-Plus");
});

test("instance detail keeps firewall governance visible before and after a project assessment", () => {
  const pendingItem = managedItem();
  pendingItem.record.verification.firewall = {
    status: "overexposed",
    ownedStatus: "matched",
    error: "规则 ruzhan1 存在公网全端口开放"
  };
  const pending = toInstanceDetailView({
    item: pendingItem,
    actionReadiness: readiness(),
    now: "2026-07-14T12:05:00.000Z"
  });
  assert.equal(
    pending.statuses.find((status) => status.id === "firewall").context,
    "项目影响待分析"
  );

  pendingItem.record.observed.firewallGovernance = {
    checkedAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-14T12:15:00.000Z",
    severity: "critical",
    findings: [{ name: "ruzhan1", severity: "critical", ownership: "external" }],
    affectedInstances: ["vm-a", "vm-b", "vm-c", "vm-d", "vm-e"],
    coverage: { ready: false, blockedReason: "外部规则仅提供人工建议" },
    ownedActions: [],
    externalActions: [{ ruleName: "ruzhan1" }]
  };
  const assessed = toInstanceDetailView({
    item: pendingItem,
    actionReadiness: readiness(),
    now: "2026-07-14T12:05:00.000Z"
  });
  assert.equal(
    assessed.statuses.find((status) => status.id === "firewall").context,
    "自有规则已匹配 · 5 台实例"
  );
  assert.equal(assessed.statuses.find((status) => status.id === "firewall").value, "严重风险");
  assert.equal(assessed.statuses.find((status) => status.id === "firewall").tone, "danger");
});

test("instance detail presents verified SSH dual entry and effective instance isolation without repeating external exposure", () => {
  const item = managedItem();
  item.record.verification.status = "passed";
  item.record.verification.checkedAt = "2026-07-16T11:58:00.000Z";
  item.record.verification.ssh = {
    desiredPort: 45400,
    actualPort: 45400,
    fallback: false,
    verified: true,
    label: "SSH 双入口已验证"
  };
  item.record.verification.firewall = { status: "isolated", matchedPorts: [], missingPorts: [] };
  item.record.observed.sshAuthPolicy = {
    mode: "dual_entry",
    checkedAt: "2026-07-16T11:58:00.000Z",
    entries: [
      { port: 22, authentication: "publickey,password", exposure: "iap" },
      { port: 45400, authentication: "publickey", exposure: "public+iap" }
    ]
  };
  item.record.observed.firewallGovernance = {
    checkedAt: "2026-07-16T11:58:00.000Z",
    expiresAt: "2026-07-16T12:13:00.000Z",
    severity: "critical",
    findings: [{ name: "shared-wide-rule", severity: "critical", ownership: "external" }],
    affectedInstances: ["vm-a", "vm-b"],
    coverage: { ready: true },
    ownedActions: [],
    externalActions: [{ ruleName: "shared-wide-rule" }],
    effectiveIsolation: {
      effectiveStatus: "isolated",
      targetTag: "gvc-isolate-a",
      allowPriority: 998,
      denyPriority: 999
    }
  };

  const view = toInstanceDetailView({
    item,
    now: "2026-07-16T12:00:00.000Z",
    actionReadiness: readiness()
  });
  const ssh = view.statuses.find((status) => status.id === "ssh");
  const firewall = view.statuses.find((status) => status.id === "firewall");

  assert.equal(ssh.value, "45400 · 双入口");
  assert.match(ssh.context, /22 IAP.*密钥 \+ 密码.*45400 公网.*密钥/);
  assert.equal(firewall.value, "已按所选端口隔离");
  assert.equal(firewall.tone, "success");
  assert.match(firewall.context, /外部共享规则仍有项目级风险/);
  assert.doesNotMatch(firewall.value, /过度开放|严重风险/);
});

test("instance detail falls through each evidence source independently", () => {
  const item = managedItem();
  delete item.record.verification.bbr;
  delete item.record.verification.firewall;
  delete item.record.verification.services;
  item.record.verification.checks = item.record.verification.checks
    .filter((check) => check.id === "ssh");
  const view = toInstanceDetailView({
    item,
    recognitionPreview: {
      checkedAt: "2026-07-10T10:00:00.000Z",
      recognition: {
        method: "singbox_plus",
        confidence: "high",
        probes: {
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          services: [{ name: "sing-box", status: "active" }]
        }
      }
    },
    actionReadiness: readiness()
  });

  assert.equal(view.statuses.find((entry) => entry.id === "ssh").source, "verification");
  assert.equal(view.statuses.find((entry) => entry.id === "bbr").source, "recognition");
  assert.equal(view.statuses.find((entry) => entry.id === "firewall").source, "nodeResult");
  assert.equal(view.statuses.find((entry) => entry.id === "services").source, "recognition");
});

test("instance detail lets a fresh probe replace stale verification per status", () => {
  const item = managedItem();
  item.record.verification.checkedAt = "2026-07-10T02:00:00.000Z";
  const view = toInstanceDetailView({
    item,
    now: "2026-07-10T12:00:00.000Z",
    recognitionPreview: {
      checkedAt: "2026-07-10T11:58:00.000Z",
      recognition: {
        method: "three_x_ui", confidence: "high",
        probes: {
          ssh: { desiredPort: 45400, actualPort: 45400, verified: true },
          bbr: { enabled: true }, firewall: { status: "overexposed" },
          services: [{ name: "x-ui", status: "active" }]
        }
      }
    },
    actionReadiness: readiness()
  });
  assert.equal(view.statuses.every((status) => status.source === "recognition"), true);
  assert.equal(view.header.methodLabel, "3X-UI");
  assert.equal(view.statuses.find((status) => status.id === "ssh").freshness, "fresh");
});

test("instance detail retains values after a newer failed attempt without fresh success tone", () => {
  const item = managedItem();
  item.record.verification.checkedAt = "2026-07-10T11:40:00.000Z";
  item.record.observed.lastProbeAttempt = {
    status: "failed", checkedAt: "2026-07-10T11:59:00.000Z", category: "ssh", message: "SSH 连接失败"
  };
  const view = toInstanceDetailView({ item, now: "2026-07-10T12:00:00.000Z", actionReadiness: readiness() });
  assert.equal(view.statuses.every((status) => status.historical), true);
  assert.equal(view.statuses.some((status) => status.tone === "success"), false);
  assert.equal(view.recommendation.actionId, "smartDiagnoseInstance");
  assert.equal(view.header.checkedAt, "2026-07-10T11:59:00.000Z");
});

test("instance detail keeps empty and cloud-only unknown states explicit", () => {
  const empty = toInstanceDetailView();
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.statuses.map((item) => item.value), [
    "待探测",
    "待探测",
    "待探测",
    "待探测"
  ]);

  const cloudUnknown = toInstanceDetailView({
    item: {
      key: "project-a/us-west1-b/external-a",
      source: "cloud",
      identity: { name: "external-a", projectId: "project-a", zone: "us-west1-b", account: "user@example.com" },
      cloud: { status: "RUNNING", network: { externalIp: "203.0.113.11" } },
      record: null
    },
    actionReadiness: readiness({
      detailPrimary: action("detailPrimary", true, "设置部署"),
      smartDiagnoseInstance: action("smartDiagnoseInstance", true, "运行只读探测"),
      adoptLocalInstance: action("adoptLocalInstance", false, "接管本地"),
      deployNodes: action("deployNodes", false, "部署方式未确认")
    })
  });

  assert.equal(cloudUnknown.header.methodLabel, "未识别");
  assert.equal(cloudUnknown.recommendation.actionId, "smartDiagnoseInstance");
  assert.equal(cloudUnknown.autoOpenGroupId, "diagnose");
});

test("instance detail recommends adoption only after external recognition", () => {
  const item = {
    key: "project-a/us-west1-b/external-a",
    source: "cloud",
    identity: { name: "external-a", projectId: "project-a", zone: "us-west1-b", account: "user@example.com" },
    cloud: { status: "RUNNING", network: { externalIp: "203.0.113.11" } },
    record: null
  };
  const view = toInstanceDetailView({
    item,
    recognitionPreview: {
      checkedAt: "2026-07-10T12:00:00.000Z",
      recognition: {
        method: "three_x_ui",
        confidence: "high",
        managedState: "external_observed",
        warnings: [],
        probes: {
          ssh: { desiredPort: 45400, actualPort: 22, verified: true, fallback: true },
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          firewall: { status: "matched", matchedPorts: [{ protocol: "tcp", port: "45400" }], missingPorts: [] },
          services: [{ name: "x-ui", status: "active" }]
        }
      }
    },
    actionReadiness: readiness({
      detailPrimary: action("detailPrimary", true, "设置部署"),
      smartDiagnoseInstance: action("smartDiagnoseInstance", true, "重新探测"),
      adoptLocalInstance: action("adoptLocalInstance", true, "接管本地"),
      deployNodes: action("deployNodes", false, "需要先接管")
    })
  });

  assert.equal(view.header.methodLabel, "3X-UI");
  assert.equal(view.recommendation.actionId, "adoptLocalInstance");
  assert.equal(view.autoOpenGroupId, "diagnose");
});

test("instance detail prioritizes failed verification before available node links", () => {
  const item = managedItem();
  item.record.verification.status = "failed";
  item.record.nodeResult.links = [{ name: "hy2", url: "hy2://secret@example" }];
  const view = toInstanceDetailView({
    item,
    actionReadiness: readiness({
      showNodeResults: action("showNodeResults", true, "查看节点结果")
    })
  });

  assert.equal(view.recommendation.actionId, "smartDiagnoseInstance");
  assert.equal(view.autoOpenGroupId, "diagnose");
  assert.equal(view.disclosures.nodeSummary, "1 条节点链接");
  assert.doesNotMatch(JSON.stringify(view), /hy2:\/\/secret/);
});

test("instance detail recommends manual review when fresh external firewall risk is the only issue", () => {
  const item = managedItem();
  item.record.verification.status = "partial";
  item.record.verification.firewall = { status: "overexposed", ownedStatus: "matched" };
  item.record.verification.checks = [
    { id: "ssh", status: "passed", detail: "SSH 实际连接 45400" },
    { id: "bbr", status: "passed", detail: "bbr / fq" },
    { id: "services", status: "passed", detail: "sing-box active" },
    { id: "firewall", status: "partial", detail: "外部共享规则过度开放" }
  ];
  item.record.observed.firewallGovernance = {
    checkedAt: "2026-07-16T10:00:00.000Z",
    expiresAt: "2026-07-16T10:15:00.000Z",
    severity: "critical",
    findings: [{ name: "ruzhan1", severity: "critical", ownership: "external" }],
    affectedInstances: ["vm-a", "vm-b", "vm-c", "vm-d", "vm-e", "vm-f"],
    coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh", blockedReason: "" },
    ownedActions: [],
    externalActions: [{ ruleName: "ruzhan1" }]
  };

  const view = toInstanceDetailView({
    item,
    now: "2026-07-16T10:05:00.000Z",
    actionReadiness: readiness()
  });

  assert.equal(view.recommendation.title, "人工检查外部规则");
  assert.match(view.recommendation.detail, /严重风险.*6 台实例.*不会自动修改/);
  assert.equal(view.recommendation.actionId, "");
  assert.equal(view.autoOpenGroupId, "");
});

test("instance detail recommends node results when verification is healthy", () => {
  const item = managedItem();
  item.record.verification.status = "passed";
  item.record.nodeResult.links = [{ name: "hy2", url: "hy2://secret@example" }];
  item.record.nodeResult.panel = { url: "https://panel.example", username: "admin", password: "secret" };
  const view = toInstanceDetailView({
    item,
    actionReadiness: readiness({
      showNodeResults: action("showNodeResults", true, "查看节点结果")
    })
  });

  assert.equal(view.recommendation.actionId, "showNodeResults");
  assert.equal(view.autoOpenGroupId, "");
  assert.equal(view.disclosures.nodeSummary, "1 条节点链接 · 3X-UI 面板可用");
  assert.doesNotMatch(JSON.stringify(view), /panel\.example|admin|password|secret/);
});

test("instance detail removes conflict warnings from all visible summaries", () => {
  const view = toInstanceDetailView({
    item: managedItem(),
    recognitionPreview: {
      checkedAt: "2026-07-10T12:00:00.000Z",
      recognition: {
        method: "external_custom",
        confidence: "low",
        warnings: [
          "证据冲突：本地记录为只开实例，SSH 探测为 3X-UI",
          "需要人工确认部署方式"
        ],
        probes: {}
      }
    },
    actionReadiness: readiness()
  });

  assert.doesNotMatch(JSON.stringify(view), /证据冲突|evidence conflict/i);
});

test("instance detail assigns every action to one canonical group", () => {
  const view = toInstanceDetailView({
    item: managedItem(),
    actionReadiness: readiness()
  });

  assert.deepEqual(view.groups.map((group) => group.id), ["configure", "diagnose", "maintain"]);
  assert.deepEqual(view.groups.find((group) => group.id === "configure").actionIds, [
    "detailPrimary",
    "cloneVm",
    "deployNodes"
  ]);
  assert.deepEqual(view.groups.find((group) => group.id === "diagnose").actionIds, [
    "smartDiagnoseInstance"
  ]);
  assert.deepEqual(view.groups.find((group) => group.id === "maintain").actionIds, [
    "restartVm",
    "systemUpdate"
  ]);
  assert.equal(new Set(view.groups.flatMap((group) => group.actionIds)).size, 6);
});

test("instance detail omits node deployment for an external custom record", () => {
  const item = managedItem();
  item.record.desired.deploy.method = "external_custom";
  delete item.record.verification;
  delete item.record.nodeResult;
  delete item.record.observed;
  const view = toInstanceDetailView({
    item,
    actionReadiness: readiness({
      deployNodes: action("deployNodes", false, "节点部署不适用")
    })
  });

  assert.equal(view.recommendation.actionId, "smartDiagnoseInstance");
  assert.equal(
    view.groups.find((group) => group.id === "configure").actionIds.includes("deployNodes"),
    false
  );
});
