import assert from "node:assert/strict";
import test from "node:test";

import { toDiagnosticSummary } from "../public/lib/diagnostic-summary-view-model.js";

test("diagnostic summary redacts secrets and keeps compact rows", () => {
  const summary = toDiagnosticSummary({
    context: { account: "user@example.com", projectId: "project-a", configuration: "acct-a" },
    selectedVm: { name: "vm-a", zone: "us-west1-b", externalIp: "203.0.113.10" },
    doctorView: { status: "warning", title: "环境体检有 1 项需要注意", issues: [{ label: "免费规则", reason: "缓存过期" }] },
    selectedJob: { id: "job-a", type: "deploy", status: "failed", error: "password=secret-token panel http://x" },
    nodeResult: { panel: { url: "http://203.0.113.10:2053", username: "admin", password: "secret" }, links: [{ name: "hy2", url: "hysteria2://secret@example" }] },
    verification: { status: "partial" }
  });

  assert.equal(summary.rows.some((row) => row.label === "实例" && row.value === "vm-a"), true);
  assert.doesNotMatch(summary.text, /secret-token|password=|hysteria2:\/\/secret|password: secret/i);
  assert.match(summary.text, /环境体检有 1 项需要注意/);
});

test("diagnostic summary includes node result evidence without raw links", () => {
  const summary = toDiagnosticSummary({
    selectedVm: { name: "vm-a" },
    nodeResult: {
      links: [
        { name: "hy2", url: "hysteria2://secret@example" },
        { name: "vless", url: "vless://uuid@example" }
      ],
      panel: { url: "http://203.0.113.10:2053", username: "admin", password: "secret" }
    }
  });

  assert.equal(summary.rows.some((row) => row.label === "节点链接" && row.value === "2 条"), true);
  assert.equal(summary.rows.some((row) => row.label === "面板" && row.value.includes("203.0.113.10")), true);
  assert.doesNotMatch(summary.text, /hysteria2:\/\/secret|vless:\/\/uuid|password: secret/i);
});

test("diagnostic summary includes deployment recognition without raw evidence", () => {
  const summary = toDiagnosticSummary({
    selectedVm: { name: "vm-a" },
    recognition: {
      method: "three_x_ui",
      confidence: "medium",
      source: "ssh_probe",
      managedState: "external_observed",
      evidence: [{ label: "raw-link", value: "vless://secret@example" }]
    }
  });

  assert.equal(summary.rows.some((row) => row.label === "部署识别" && /3X-UI/.test(row.value)), true);
  assert.doesNotMatch(summary.text, /vless:\/\/secret|raw-link/i);
});

test("diagnostic summary localizes verification and task enums", () => {
  const summary = toDiagnosticSummary({
    selectedVm: { name: "vm-a" },
    selectedJob: { id: "job-a", type: "verification", status: "partial" },
    verification: { status: "partial" }
  });

  assert.equal(summary.rows.find((item) => item.label === "验证")?.value, "部分通过");
  assert.equal(summary.rows.find((item) => item.label === "任务")?.value, "重新验证实例 / 部分完成");
  assert.doesNotMatch(summary.text, /\b(?:partial|verification)\b/);
});
