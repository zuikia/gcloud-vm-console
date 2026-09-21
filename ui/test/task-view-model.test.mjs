import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDuration,
  taskTypeLabel,
  taskStatusLabel,
  taskTimelineHint,
  toTaskResult,
  toTaskRow,
  toTaskSteps
} from "../public/lib/task-view-model.js";
import { toNodeResultView, toVerificationView } from "../public/lib/node-result-view-model.js";
import { toVerificationRecoveryView } from "../public/lib/verification-recovery-view-model.js";

const records = [
  {
    id: "record-a",
    identity: {
      name: "vm-a",
      projectId: "project-a",
      zone: "us-west1-b"
    }
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("task status labels keep preview state user-facing", () => {
  assert.equal(taskStatusLabel("PREVIEW"), "预览已生成");
  assert.equal(taskStatusLabel("succeeded"), "成功");
});

test("task timeline hint follows the selected task instead of always describing previews", () => {
  assert.equal(taskTimelineHint(null), "预览指纹失效后必须重新生成。");
  assert.equal(
    taskTimelineHint({ type: "verification", status: "partial" }),
    "只读任务不会修改云端；阶段与结果来自本地任务历史。"
  );
  assert.equal(
    taskTimelineHint({ type: "maintenance-system-update", status: "interrupted" }),
    "任务因服务重启中断，系统未自动续跑；请用只读探测确认实际状态。"
  );
  assert.equal(
    taskTimelineHint({ type: "execute-change", status: "succeeded" }),
    "阶段与结果来自本地任务历史；再次执行仍需原有确认。"
  );
});

test("verification recovery maps missing firewall to guided deploy action without hiding links", () => {
  const view = toVerificationRecoveryView({
    status: "partial",
    method: "singbox_plus",
    checks: [
      { id: "ssh", label: "SSH 连接", status: "passed", detail: "SSH 实际连接 22（已从 45400 回退）" },
      { id: "links", label: "节点链接", status: "passed", detail: "2 条链接已收集" },
      { id: "firewall", label: "防火墙", status: "partial", detail: "规则状态：missing" }
    ],
    firewall: { status: "missing", rules: [{ name: "vm-a-singbox-udp", protocol: "udp", ports: ["23293"] }] },
    warnings: ["防火墙：规则状态：missing"]
  }, {
    nodeResult: { links: [{ name: "tuic-v5", url: "tuic://example" }] }
  });

  assert.equal(view.severity, "warning");
  assert.equal(view.headline, "防火墙未匹配");
  assert.equal(view.actions[0].targetAction, "deployNodes");
  assert.equal(view.actions[0].kind, "guided_write");
  assert.equal(view.nodeLinksStillUsable, true);
  assert.match(view.explanation, /节点链接已生成/);
});

test("verification recovery maps SSH failure to critical read-first guidance", () => {
  const view = toVerificationRecoveryView({
    status: "failed",
    method: "singbox_plus",
    checks: [
      { id: "ssh", label: "SSH 连接", status: "failed", detail: "Permission denied (publickey)" }
    ],
    warnings: ["Permission denied (publickey)"]
  });

  assert.equal(view.severity, "critical");
  assert.equal(view.headline, "SSH 无法连接");
  assert.deepEqual(view.actions.map((action) => action.targetAction), ["smartDiagnoseInstance"]);
  assert.equal(view.actions.every((action) => action.kind === "read"), true);
});

test("verification recovery treats BBR as warning and passed verification as ok", () => {
  const bbr = toVerificationRecoveryView({
    status: "partial",
    method: "singbox_plus",
    checks: [
      { id: "ssh", label: "SSH 连接", status: "passed", detail: "SSH 实际连接 45400" },
      { id: "bbr", label: "BBR", status: "partial", detail: "BBR 未确认" }
    ]
  });
  assert.equal(bbr.severity, "warning");
  assert.equal(bbr.headline, "BBR 未确认");
  assert.equal(bbr.actions[0].targetAction, "smartDiagnoseInstance");

  const passed = toVerificationRecoveryView({
    status: "passed",
    method: "vm_only",
    checks: [{ id: "ssh", label: "SSH 连接", status: "passed", detail: "SSH 实际连接 22" }]
  });
  assert.equal(passed.severity, "ok");
  assert.equal(passed.headline, "验证通过");
});

test("task row maps succeeded jobs to concrete deployment labels without mutating raw job", () => {
  const job = {
    id: "job-1",
    type: "node-deploy",
    recordId: "record-a",
    status: "succeeded",
    stages: [
      { name: "node_pipeline", status: "running", detail: "install", at: "2026-06-18T10:00:10.000Z" },
      { name: "firewall_sync", status: "succeeded", detail: "ports synced", at: "2026-06-18T10:01:40.000Z" }
    ],
    result: {
      method: "singbox_plus",
      nodeResult: {
        type: "singbox_plus",
        bbr: true,
        links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://example" }]
      }
    },
    error: null,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:02:05.000Z"
  };
  const before = clone(job);

  const row = toTaskRow(job, records);

  assert.deepEqual(job, before);
  assert.equal(row.id, "job-1");
  assert.equal(row.typeLabel, "部署 Sing-Box-Plus");
  assert.equal(row.vmName, "vm-a");
  assert.equal(row.statusLabel, "成功");
  assert.equal(row.duration, "2 分 5 秒");
  assert.equal(formatDuration(job), "2 分 5 秒");
});

test("node deployment task rows never fall back to ambiguous deployment wording", () => {
  const fallback = toTaskRow({
    id: "job-ambiguous",
    type: "node-deploy",
    recordId: "record-a",
    status: "running",
    result: null,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:10.000Z"
  }, records);

  assert.equal(fallback.typeLabel, "部署方式未确认");
  assert.notEqual(fallback.typeLabel, "部署节点");
});

test("task steps preserve backend stage order and expose Chinese stage labels", () => {
  const job = {
    id: "job-2",
    type: "execute-change",
    status: "running",
    stages: [
      { name: "fingerprint_check", status: "running", detail: "Validate fingerprint", at: "2026-06-18T10:00:00.000Z" },
      { name: "create_vm", status: "queued", detail: "Create VM", at: "2026-06-18T10:00:01.000Z" }
    ],
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:01.000Z"
  };

  assert.deepEqual(toTaskSteps(job).map((step) => step.label), ["校验指纹", "创建实例"]);
  assert.deepEqual(toTaskSteps(job).map((step) => step.status), ["running", "queued"]);
  assert.deepEqual(toTaskSteps(job).map((step) => step.detail), [
    "执行前复核已保存的预览指纹",
    "创建预览中确认的 Compute Engine 实例"
  ]);
});

test("node pipeline stage label avoids ambiguous deployment wording", () => {
  const steps = toTaskSteps({
    id: "job-node-stage",
    type: "node-deploy",
    status: "running",
    stages: [
      { name: "node_pipeline", status: "running", detail: "Run selected pipeline", at: "2026-06-18T10:00:00.000Z" },
      { name: "firewall_sync", status: "queued", detail: "Sync ports", at: "2026-06-18T10:00:01.000Z" }
    ]
  });

  assert.deepEqual(steps.map((step) => step.label), ["执行部署管线", "同步防火墙"]);
  assert.deepEqual(steps.map((step) => step.detail), ["执行所选部署管线并同步端口", "同步部署所需的防火墙端口"]);
  assert.notEqual(steps[0].label, "部署节点");
});

test("custom SSH port stage has a concise user-facing label", () => {
  const steps = toTaskSteps({
    id: "job-ssh-port",
    type: "node-deploy",
    status: "running",
    stages: [
      { name: "ssh_port", status: "running", detail: "Configure SSH port 45400", at: "2026-07-16T10:00:00.000Z" }
    ]
  });

  assert.deepEqual(steps.map((step) => step.label), ["配置 SSH 端口"]);
  assert.equal(steps[0].detail, "配置并验证 SSH 端口 45400");
});

test("completed node deployment expands persisted result stages without leaving a running stage", () => {
  const steps = toTaskSteps({
    id: "job-node-complete",
    type: "node-deploy",
    status: "succeeded",
    stages: [{ name: "node_pipeline", status: "succeeded", detail: "pipeline complete", at: "2026-07-16T10:00:00.000Z" }],
    result: {
      stages: ["ssh_port", "install", "bbr_check", "firewall_sync", "collect"],
      firewall: { status: "synced" },
      sshPort: { status: "configured" }
    }
  });

  assert.deepEqual(steps.map((step) => step.label), [
    "配置 SSH 端口",
    "安装组件",
    "检查 BBR",
    "同步防火墙",
    "收集结果"
  ]);
  assert.equal(steps.every((step) => step.status === "succeeded"), true);
});

test("verification task keeps local node results and exposes project firewall risk", () => {
  const result = toTaskResult({
    id: "job-verify-node",
    type: "verification",
    recordId: "record-a",
    status: "partial",
    result: {
      status: "partial",
      method: "singbox_plus",
      ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false, label: "SSH 实际连接 45400" },
      bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
      firewall: { status: "overexposed", ownedStatus: "matched", error: "外部共享规则 ruzhan1 过度开放" },
      checks: [
        { id: "ssh", label: "SSH", status: "passed", detail: "SSH 实际连接 45400" },
        { id: "firewall", label: "防火墙", status: "partial", detail: "自有规则已匹配；外部共享规则 ruzhan1 过度开放" }
      ],
      warnings: ["防火墙：外部共享规则 ruzhan1 过度开放"],
      nodeResult: {
        type: "singbox_plus",
        bbr: true,
        links: [{ name: "tuic-v5", protocol: "udp", port: "41716", url: "tuic://local-result" }]
      }
    },
    createdAt: "2026-07-16T10:00:00.000Z",
    updatedAt: "2026-07-16T10:00:10.000Z"
  });

  assert.equal(result.nodeResult.links.length, 1);
  assert.equal(result.recovery.headline, "防火墙过度开放");
  assert.equal(result.recovery.nodeLinksStillUsable, true);
  assert.equal(result.recovery.actions.length, 0);
  assert.equal(result.canRetry, false);
  assert.equal(result.recovery.evidence.find((row) => row.label === "部署方式").value, "Sing-Box-Plus");
  assert.equal(result.recovery.evidence.find((row) => row.label === "防火墙").value, "过度开放");
  assert.match(result.summary, /防火墙.*过度开放/);
});

test("task result handles failed long errors no result and retryability", () => {
  const longError = "Permission denied ".repeat(30);
  const job = {
    id: "job-3",
    type: "maintenance-status",
    recordId: "record-a",
    status: "failed",
    stages: [],
    result: null,
    error: longError,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:00.000Z"
  };

  const result = toTaskResult(job);

  assert.equal(result.statusLabel, "失败");
  assert.equal(result.canRetry, true);
  assert.match(result.summary, /没有可用结果/);
  assert.equal(result.error, longError);
  assert.equal(result.nodeLinks.length, 0);
});

test("interrupted tasks are terminal warning states with read-only recovery guidance", () => {
  const job = {
    id: "job-interrupted",
    type: "maintenance-system-update",
    recordId: "record-a",
    status: "interrupted",
    stages: [
      { name: "system_update", status: "running", detail: "Updating packages", at: "2026-07-12T12:00:00.000Z" },
      { name: "restart_recovery", status: "interrupted", detail: "本地服务重启，任务未自动续跑。", at: "2026-07-12T12:05:00.000Z" }
    ],
    result: null,
    error: null,
    interruption: {
      reason: "server_restart",
      previousStatus: "running",
      detectedAt: "2026-07-12T12:05:00.000Z"
    },
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: "2026-07-12T12:05:00.000Z"
  };

  const row = toTaskRow(job, records);
  const steps = toTaskSteps(job);
  const result = toTaskResult(job);

  assert.equal(row.statusLabel, "服务中断");
  assert.equal(row.statusTone, "warning");
  assert.equal(row.active, false);
  assert.equal(row.duration, "5 分 0 秒");
  assert.equal(steps.at(-1).label, "服务重启恢复");
  assert.equal(result.canRetry, false);
  assert.match(result.summary, /云端最终状态未确认/);
  assert.equal(result.recovery.headline, "任务因服务重启中断");
  assert.deepEqual(result.recovery.actions.map((action) => action.targetAction), ["smartDiagnoseInstance"]);
  assert.equal(result.recovery.actions.every((action) => action.kind === "read"), true);
});

test("task result extracts node links and panel details when present", () => {
  const job = {
    id: "job-4",
    type: "node-deploy",
    status: "succeeded",
    stages: [],
    result: {
      nodeResult: {
        type: "three_x_ui",
        bbr: false,
        panel: { url: "http://203.0.113.10:54321", username: "admin", password: "secret" },
        links: [{ name: "vless-reality", protocol: "tcp", port: "443", url: "vless://example" }]
      }
    },
    error: null,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:10.000Z"
  };

  const result = toTaskResult(job);

  assert.equal(result.nodePanel.url, "http://203.0.113.10:54321");
  assert.equal(result.nodeLinks[0].name, "vless-reality");
  assert.match(result.summary, /1 个节点链接/);
});

test("task result marks partial node deployment as retryable partial success", () => {
  const job = {
    id: "job-5",
    type: "node-deploy",
    recordId: "record-a",
    status: "partial",
    stages: [],
    result: {
      firewall: { status: "failed", error: "firewall denied", rules: [] },
      nodeResult: {
        type: "singbox_plus",
        bbr: true,
        links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://example" }],
        firewall: { status: "failed", error: "firewall denied", rules: [] }
      }
    },
    error: null,
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:01:00.000Z"
  };

  const row = toTaskRow(job, records);
  const result = toTaskResult(job);

  assert.equal(row.statusLabel, "部分完成");
  assert.equal(row.statusTone, "cloud");
  assert.equal(result.statusLabel, "部分完成");
  assert.equal(result.canRetry, true);
  assert.match(result.summary, /防火墙同步失败/);
});

test("task result summarizes verification jobs and combined node verification", () => {
  const verificationJob = {
    id: "job-verify",
    type: "verification",
    status: "partial",
    result: {
      status: "partial",
      checks: [{ id: "firewall", label: "防火墙", status: "partial", detail: "规则缺失" }]
    }
  };
  const verification = toTaskResult(verificationJob);
  assert.equal(toTaskRow(verificationJob).typeLabel, "重新验证实例");
  assert.equal(verification.summary, "验证部分通过");
  assert.equal(verification.canRetry, true);
  assert.equal(verification.recovery.headline, "防火墙未匹配");

  const node = toTaskResult({
    id: "job-node-verify",
    type: "node-deploy",
    status: "partial",
    result: {
      nodeResult: { type: "singbox_plus", bbr: true, links: [{ name: "tuic-v5", url: "tuic://result" }] },
      verification: { status: "partial", checks: [] }
    }
  });
  assert.match(node.summary, /验证部分通过/);
  assert.equal(node.recovery.headline, "验证结果需要复核");
});

test("task result summarizes deployment recognition without leaking raw evidence", () => {
  const result = toTaskResult({
    id: "job-recognition",
    type: "maintenance-status",
    status: "succeeded",
    result: {
      recognition: {
        method: "three_x_ui",
        confidence: "medium",
        source: "ssh_probe",
        managedState: "external_observed",
        evidence: [
          { source: "ssh_probe", label: "服务", value: "x-ui active", confidence: "medium" },
          { source: "ssh_probe", label: "raw-link", value: "vless://secret@example", confidence: "medium" }
        ],
        warnings: []
      }
    }
  });

  assert.equal(result.recognition.method, "three_x_ui");
  assert.match(result.summary, /识别为 3X-UI/);
  assert.doesNotMatch(JSON.stringify(result), /vless:\/\/secret/);
});

test("task rows name the concrete node deployment method when result is available", () => {
  const singbox = toTaskRow({
    id: "job-6",
    type: "node-deploy",
    recordId: "record-a",
    status: "succeeded",
    result: { method: "singbox_plus", nodeResult: { type: "singbox_plus", links: [] } },
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:10.000Z"
  }, records);
  const xui = toTaskRow({
    id: "job-7",
    type: "node-deploy",
    recordId: "record-a",
    status: "succeeded",
    result: { method: "three_x_ui", nodeResult: { type: "three_x_ui", links: [] } },
    createdAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:10.000Z"
  }, records);

  assert.equal(singbox.typeLabel, "部署 Sing-Box-Plus");
  assert.equal(xui.typeLabel, "部署 3X-UI");
});

test("owned firewall repair tasks expose three concrete stages and a compact result summary", () => {
  const job = {
    id: "job-firewall",
    type: "firewall-owned-repair",
    recordId: "record-a",
    status: "partial",
    stages: [
      { name: "preview_recheck", status: "succeeded", detail: "fingerprint matched", at: "2026-07-14T12:00:00.000Z" },
      { name: "ensure_owned_rules", status: "partial", detail: "one rule skipped", at: "2026-07-14T12:00:01.000Z" },
      { name: "post_verify", status: "succeeded", detail: "external rules remain", at: "2026-07-14T12:00:02.000Z" }
    ],
    result: {
      status: "partial",
      changes: [
        { name: "gvc-vm-a-ssh-iap-tcp", action: "created" },
        { name: "gvc-vm-a-public-service-udp", action: "unchanged" },
        { name: "gvc-vm-a-public-service-tcp", action: "skipped", error: "permission denied" }
      ],
      governance: {
        externalActions: [{ ruleName: "ruzhan1" }, { ruleName: "default-allow-ssh" }]
      }
    },
    createdAt: "2026-07-14T12:00:00.000Z",
    updatedAt: "2026-07-14T12:00:02.000Z"
  };

  assert.equal(toTaskRow(job, records).typeLabel, "补齐自有规则");
  assert.deepEqual(toTaskSteps(job).map((step) => step.label), ["复核治理预览", "补齐自有规则", "复核防火墙结果"]);
  const result = toTaskResult(job);
  assert.match(result.summary, /新增 1/);
  assert.match(result.summary, /未变 1/);
  assert.match(result.summary, /跳过 1/);
  assert.match(result.summary, /2 条外部规则/);
  assert.equal(result.canRetry, false);
});

test("network exposure tasks show SSH policy, isolated firewall and ordered safety stages", () => {
  const job = {
    id: "job-21",
    type: "network-exposure-apply",
    status: "succeeded",
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:00:05.000Z",
    stages: [
      { name: "exposure_recheck", status: "succeeded", detail: "rechecked" },
      { name: "exposure_allow", status: "succeeded", detail: "allows ready" },
      { name: "exposure_isolation_prepare", status: "succeeded", detail: "isolation prepared" },
      { name: "ssh_preflight", status: "succeeded", detail: "ssh checked" },
      { name: "ssh_key_entry", status: "succeeded", detail: "45400 ready" },
      { name: "ssh_password_policy", status: "succeeded", detail: "22 hardened" },
      { name: "exposure_pre_enable", status: "succeeded", detail: "public path ready" },
      { name: "exposure_enable", status: "succeeded", detail: "deny enabled" },
      { name: "exposure_post_verify", status: "succeeded", detail: "verified" }
    ],
    result: {
      sshPolicy: {
        mode: "dual_entry",
        entries: [
          { port: 22, authentication: "publickey,password", exposure: "iap" },
          { port: 45400, authentication: "publickey", exposure: "public+iap" }
        ]
      },
      exposure: {
        public: [{ protocol: "tcp", port: "443" }, { protocol: "tcp", port: "45400" }],
        iap: [{ protocol: "tcp", port: "22" }, { protocol: "tcp", port: "45400" }]
      },
      firewall: { effectiveStatus: "isolated", externalRuleNames: ["ruzhan1"] }
    }
  };

  assert.equal(toTaskRow(job).typeLabel, "应用端口策略");
  assert.deepEqual(toTaskSteps(job).map((step) => step.label), [
    "复核端口预览",
    "建立允许规则",
    "准备实例隔离",
    "检查 SSH 环境",
    "验证 45400 密钥入口",
    "收紧 22 认证",
    "启用前连通检查",
    "启用实例隔离",
    "复核管理路径"
  ]);
  const result = toTaskResult(job);
  assert.match(result.summary, /公网 2 个端口/);
  assert.match(result.summary, /SSH 双入口/);
  assert.match(result.summary, /实例隔离已生效/);
  assert.equal(result.canRetry, false);
});

test("node result view model creates compact instance detail rows and copy targets", () => {
  const longHy2 = `hy2://user:${"a".repeat(80)}@203.0.113.10:25737?obfs=salamander&obfs-password=${"b".repeat(80)}#hy2-obfs-warp`;
  const view = toNodeResultView({
    type: "singbox_plus",
    bbr: true,
    ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true },
    links: [
      { name: "hy2-obfs-warp", protocol: "udp", port: "25737", url: longHy2 },
      { name: "tuic-v5-warp", protocol: "udp", port: "23293", url: "tuic://warp" },
      { name: "hy2-obfs", protocol: "udp", port: "36111", url: "hy2://direct" },
      { name: "tuic-v5", protocol: "udp", port: "36222", url: "tuic://direct" }
    ],
    firewall: { status: "failed", error: "permission denied", rules: [] }
  }, { deployMethod: "singbox_plus" });

  assert.equal(view.empty, false);
  assert.equal(view.methodLabel, "Sing-Box-Plus");
  assert.equal(view.bbr.label, "BBR 已开启");
  assert.equal(view.firewall.label, "防火墙同步失败");
  assert.equal(view.ssh.desiredLabel, "SSH 期望端口 45400");
  assert.equal(view.ssh.actualLabel, "SSH 实际连接 22");
  assert.equal(view.ssh.fallback, true);
  assert.deepEqual(view.links.map((link) => link.label), ["HY2 obfs WARP", "TUIC v5 WARP", "HY2 obfs 直连", "TUIC v5 直连"]);
  assert.equal(view.links[0].copyValue, longHy2);
  assert.ok(view.warnings.some((warning) => /防火墙/.test(warning)));
});

test("node detail data remains complete when the instance renderer hides its status strip", () => {
  const view = toNodeResultView({
    type: "three_x_ui",
    bbr: true,
    ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true },
    panel: { url: "https://panel.example/base", username: "admin", password: "secret", port: 443 },
    links: [{ name: "vless-reality", protocol: "tcp", port: "443", url: "vless://result" }],
    firewall: {
      status: "synced",
      rules: [{
        name: "allow-xui",
        action: "created",
        protocol: "tcp",
        ports: ["443"],
        targetTags: ["xui"],
        sourceRanges: ["0.0.0.0/0"]
      }]
    }
  });

  assert.equal(view.links[0].copyValue, "vless://result");
  assert.deepEqual(view.panel.rows.map((row) => row.label), ["面板地址", "用户名", "密码"]);
  assert.equal(view.ssh.actualPort, 22);
  assert.equal(view.ssh.fallback, true);
  assert.equal(view.bbr.label, "BBR 已开启");
  assert.equal(view.firewall.label, "防火墙已同步");
  assert.equal(view.firewall.rules[0].actionLabel, "已创建");
  assert.equal(view.firewall.rules[0].name, "allow-xui");
});

test("node result view model handles 3X-UI panel credentials and empty instance states", () => {
  const xui = toNodeResultView({
    type: "three_x_ui",
    panel: { url: "http://203.0.113.10:443/base", username: "admin", password: "secret" },
    links: [{ name: "vless-reality", protocol: "tcp", port: "443", url: "vless://result" }]
  }, { deployMethod: "three_x_ui" });

  assert.equal(xui.panel.title, "3X-UI 面板");
  assert.deepEqual(xui.panel.rows.map((row) => row.label), ["面板地址", "用户名", "密码"]);
  assert.equal(xui.panel.rows[2].copyValue, "secret");
  assert.equal(xui.links[0].label, "VLESS Reality");

  assert.equal(toNodeResultView(null, { hasLocalRecord: false }).emptyMessage, "未接管，部署后会生成节点结果");
  assert.equal(toNodeResultView(null, { deployMethod: "vm_only", hasLocalRecord: true }).emptyMessage, "只开实例，不会生成节点链接");
  assert.equal(toNodeResultView(null, { deployMethod: "singbox_plus", hasLocalRecord: true }).emptyMessage, "尚未部署节点");
});

test("verification view model compacts checks, warnings, SSH, and firewall state", () => {
  const view = toVerificationView({
    status: "partial",
    checkedAt: "2026-07-05T00:00:00.000Z",
    ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" },
    bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
    checks: [
      { id: "ssh", label: "SSH 连接", status: "passed", detail: "SSH 实际连接 22" },
      { id: "firewall", label: "防火墙", status: "partial", detail: "规则缺失" }
    ],
    firewall: {
      status: "partial",
      matchedPorts: [{ protocol: "udp", port: "23293" }],
      missingPorts: [{ protocol: "udp", port: "25737" }],
      rules: [{ name: "vm-a-singbox-udp", protocol: "udp", ports: ["23293"] }]
    },
    warnings: ["防火墙：规则缺失"]
  });

  assert.equal(view.empty, false);
  assert.equal(view.stateLabel, "部分通过");
  assert.equal(view.stateTone, "cloud");
  assert.equal(view.sshLabel, "SSH 实际连接 22（已从 45400 回退）");
  assert.equal(view.bbr.label, "BBR 已开启");
  assert.equal(view.bbr.detail, "bbr / fq");
  assert.equal(view.rows[0].label, "SSH 连接");
  assert.equal(view.rows[1].tone, "cloud");
  assert.equal(view.firewall.label, "防火墙部分开放 1/2");
  assert.deepEqual(view.warnings, ["防火墙：规则缺失"]);
  assert.equal(view.recovery.headline, "防火墙未匹配");
  assert.equal(view.recovery.actions[0].targetAction, "deployNodes");

  const empty = toVerificationView(null);
  assert.equal(empty.empty, true);
  assert.equal(empty.stateLabel, "未验证");
});

test("verification view model makes an overexposed firewall explicit", () => {
  const view = toVerificationView({
    status: "partial",
    bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
    ssh: { actualPort: 45400, verified: true },
    checks: [{ id: "firewall", label: "防火墙", status: "partial", detail: "存在公网全端口规则" }],
    firewall: {
      status: "overexposed",
      matchedPorts: [{ protocol: "tcp", port: "8443" }],
      missingPorts: [],
      broadRules: [{ name: "public-allow-all" }]
    }
  });

  assert.equal(view.firewall.label, "防火墙过度开放");
  assert.equal(view.firewall.tone, "error");
});

test("WARP reconnect task localizes stages and never exposes a direct retry", () => {
  const job = {
    id: "job-000099",
    type: "warp-reconnect",
    recordId: "osaka-record",
    status: "succeeded",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:20.000Z",
    stages: [
      { name: "precheck", status: "succeeded", detail: "ready", at: "2026-07-30T12:00:00.000Z" },
      { name: "disconnect", status: "succeeded", detail: "done", at: "2026-07-30T12:00:01.000Z" },
      { name: "hold", status: "succeeded", detail: "5 seconds", at: "2026-07-30T12:00:02.000Z" },
      { name: "connect", status: "succeeded", detail: "done", at: "2026-07-30T12:00:07.000Z" },
      { name: "verify", status: "succeeded", detail: "unchanged", at: "2026-07-30T12:00:15.000Z" },
      { name: "persist", status: "succeeded", detail: "saved", at: "2026-07-30T12:00:16.000Z" }
    ],
    result: {
      status: "succeeded",
      outcome: "unchanged",
      before: { ipv4: "203.0.113.13", ipv6: "" },
      after: { ipv4: "203.0.113.13", ipv6: "" }
    }
  };

  assert.equal(taskTypeLabel(job), "重连 WARP 出口");
  assert.deepEqual(toTaskSteps(job).map((step) => step.label), ["操作前检查", "断开 WARP", "保持断开", "连接 WARP", "验证出口", "保存结果"]);
  const result = toTaskResult(job);
  assert.match(result.summary, /IPv4 未变化/);
  assert.equal(result.canRetry, false);
  assert.doesNotMatch(JSON.stringify(result), /可重试/);
});

test("failed legacy WARP tasks replace a generic backend error with read-only recovery guidance", () => {
  const result = toTaskResult({
    id: "job-000013",
    type: "warp-reconnect",
    recordId: "osaka-record",
    status: "failed",
    error: "服务器内部错误",
    createdAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:08.000Z",
    stages: [{ name: "precheck", status: "failed", detail: "ready", at: "2026-07-30T12:00:00.000Z" }],
    result: null
  });

  assert.match(result.summary, /重连结果未确认/);
  assert.match(result.error, /重新检测 WARP/);
  assert.equal(result.recovery.actions[0].targetAction, "refreshWarpStatus");
  assert.equal(result.canRetry, false);
  assert.doesNotMatch(JSON.stringify(result), /服务器内部错误/);
});
