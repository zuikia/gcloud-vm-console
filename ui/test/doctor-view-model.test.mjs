import assert from "node:assert/strict";
import test from "node:test";

import { toDoctorView } from "../public/lib/doctor-view-model.js";

test("doctor view model groups checks and chooses compact summary copy", () => {
  const view = toDoctorView({
    status: "warning",
    generatedAt: "2026-07-07T00:00:00.000Z",
    summary: { pass: 2, warning: 1, blocked: 0 },
    checks: [
      { id: "gcloud_accounts", group: "local", label: "gcloud 账号", status: "pass", reason: "OK", evidence: "acct-a" },
      { id: "free_rules", group: "catalog", label: "免费规则", status: "warning", reason: "缓存过期", evidence: "cache", nextAction: "更新规则提示", actionRef: "auditFreeRules" },
      { id: "inventory_sync", group: "inventory", label: "清单同步", status: "pass", reason: "OK", evidence: "1 cloud / 1 local" }
    ]
  });

  assert.equal(view.status, "warning");
  assert.equal(view.title, "环境体检有 1 项需要注意");
  assert.equal(view.sections.length, 3);
  assert.equal(view.sections.find((section) => section.id === "catalog").items[0].actionRef, "auditFreeRules");
});

test("doctor view model contains long evidence inside display-safe strings", () => {
  const longEvidence = "x".repeat(400);
  const view = toDoctorView({
    status: "blocked",
    summary: { pass: 0, warning: 0, blocked: 1 },
    checks: [{ id: "project_access", group: "project", label: "项目访问", status: "blocked", reason: "失败", evidence: longEvidence }]
  });

  assert.equal(view.sections[0].items[0].evidence.length <= 180, true);
  assert.equal(view.severityRank, 3);
});

test("doctor view model redacts raw node links and secret-like evidence", () => {
  const view = toDoctorView({
    status: "warning",
    summary: { pass: 0, warning: 1, blocked: 0 },
    checks: [{
      id: "node_service_state",
      group: "runtime",
      label: "节点服务",
      status: "warning",
      reason: "已读取到节点服务证据 token=secret-token",
      evidence: "hy2://user:password@example.com:443/?token=secret-token"
    }]
  });
  const text = JSON.stringify(view);

  assert.doesNotMatch(text, /hy2:\/\/user|secret-token|token=secret-token/);
  assert.match(text, /hy2:\/\/\[redacted-link\]|token=\[redacted\]/);
});

test("doctor view model collapses runtime checks into one compact section summary", () => {
  const view = toDoctorView({
    status: "pass",
    summary: { pass: 4, warning: 0, blocked: 0 },
    checks: [
      { id: "ssh_state", group: "runtime", label: "SSH", status: "pass", reason: "已连接", evidence: "actual 22" },
      { id: "firewall_state", group: "runtime", label: "防火墙", status: "pass", reason: "已匹配", evidence: "2 rules" },
      { id: "bbr_state", group: "runtime", label: "BBR", status: "pass", reason: "已启用", evidence: "vm-a" },
      { id: "node_service_state", group: "runtime", label: "节点服务", status: "pass", reason: "active", evidence: "4 links" }
    ]
  });

  assert.equal(view.title, "环境体检通过");
  assert.equal(view.sections[0].id, "runtime");
  assert.equal(view.sections[0].collapsible, true);
  assert.equal(view.sections[0].summary, "4 项检查 · 全部正常");
  assert.deepEqual(view.sections[0].items.map((item) => item.id), ["ssh_state", "firewall_state", "bbr_state", "node_service_state"]);
});

test("doctor runtime summary reports attention counts without repeating remediation copy", () => {
  const view = toDoctorView({
    status: "warning",
    summary: { pass: 1, warning: 3, blocked: 1 },
    checks: [
      { id: "verification_state", group: "runtime", label: "验证状态", status: "warning", reason: "部分通过" },
      { id: "ssh_state", group: "runtime", label: "SSH", status: "pass", reason: "已连接" },
      { id: "firewall_state", group: "runtime", label: "防火墙", status: "blocked", reason: "过度开放" },
      { id: "bbr_state", group: "runtime", label: "BBR", status: "warning", reason: "部分启用" },
      { id: "node_service_state", group: "runtime", label: "节点服务", status: "warning", reason: "部分运行" }
    ]
  });

  const runtime = view.sections[0];
  assert.equal(runtime.collapsible, true);
  assert.equal(runtime.status, "blocked");
  assert.equal(runtime.summary, "5 项检查 · 4 项需处理");
});

test("doctor view model exposes ordered remediation issues", () => {
  const view = toDoctorView({
    status: "blocked",
    summary: { pass: 1, warning: 1, blocked: 1 },
    checks: [
      { id: "free_rules", group: "catalog", label: "免费规则", status: "warning", reason: "缓存过期", evidence: "cache", nextAction: "更新规则提示", actionRef: "auditFreeRules" },
      { id: "project_access", group: "project", label: "项目访问", status: "blocked", reason: "项目不可读", evidence: "project-a", nextAction: "重新读取项目", actionRef: "reloadAccounts" },
      { id: "inventory_sync", group: "inventory", label: "清单同步", status: "pass", reason: "OK", evidence: "1/1" }
    ]
  });

  assert.deepEqual(view.issues.map((item) => item.id), ["project_access", "free_rules"]);
  assert.equal(view.issues[0].actionLabel, "重新读取");
  assert.equal(view.issues[1].actionLabel, "更新规则提示");
});

test("doctor view suppresses repeated per-row diagnosis copy when guidance owns the action", () => {
  const view = toDoctorView({
    status: "warning",
    summary: { pass: 0, warning: 1, blocked: 0 },
    checks: [{
      id: "ssh_state",
      group: "runtime",
      label: "SSH",
      status: "warning",
      reason: "部分实例需要更新",
      evidence: "4/5 已验证",
      nextAction: "选择实例后运行智能诊断。",
      actionRef: "verifyInstance"
    }]
  });
  assert.equal(view.sections[0].items[0].showNextAction, false);
});
