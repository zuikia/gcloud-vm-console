import assert from "node:assert/strict";
import test from "node:test";

import { toInstanceDiagnosticView } from "../public/lib/node-result-view-model.js";

function failedVerification() {
  return {
    status: "partial",
    method: "singbox_plus",
    ssh: {
      verified: true,
      actualPort: 45400,
      label: "SSH 实际连接 45400"
    },
    firewall: { status: "overexposed" },
    checks: [
      { id: "links", label: "节点链接", status: "failed", detail: "未收集到节点链接" },
      { id: "firewall", label: "防火墙", status: "failed", detail: "规则 ruzhan1 存在公网全端口开放" },
      { id: "ssh", label: "SSH", status: "passed", detail: "SSH 实际连接 45400" }
    ],
    warnings: [
      "节点链接：未收集到节点链接",
      "防火墙：规则 ruzhan1 存在公网全端口开放",
      "防火墙规则缺失：ruzhan1"
    ]
  };
}

test("instance diagnostic merges duplicate checks and warnings into severity order", () => {
  const view = toInstanceDiagnosticView(failedVerification());

  assert.equal(view.empty, false);
  assert.equal(view.issueCount, 2);
  assert.deepEqual(view.issues.map((item) => item.label), ["防火墙", "节点链接"]);
  assert.deepEqual(view.issues.map((item) => item.tone), ["danger", "warning"]);
  assert.equal(view.issues.filter((item) => item.label === "防火墙").length, 1);
  assert.equal(view.issues.filter((item) => item.label === "节点链接").length, 1);
});

test("instance diagnostic orders recovery reads before guarded writes and preserves folded evidence", () => {
  const verification = failedVerification();
  verification.warnings.push("调试链接 vless://uuid-secret@example.com:443?password=raw-secret");
  const view = toInstanceDiagnosticView(verification);

  assert.equal(view.issueCount, 2);
  assert.deepEqual(view.recovery.steps.map((item) => item.kind), ["read", "guided_write"]);
  assert.equal(view.recovery.steps[0].label, "智能诊断");
  assert.equal(view.evidence.some((item) => item.label === "SSH"), true);
  assert.equal(JSON.stringify(view).includes("vless://"), false);
  assert.equal(JSON.stringify(view).includes("raw-secret"), false);
});

test("instance diagnostic stays empty when verification has no actionable issue", () => {
  const view = toInstanceDiagnosticView({
    status: "passed",
    checks: [{ id: "ssh", label: "SSH", status: "passed", detail: "SSH 实际连接 22" }],
    warnings: []
  });

  assert.equal(view.issueCount, 0);
  assert.deepEqual(view.issues, []);
  assert.equal(view.recovery, null);
});
