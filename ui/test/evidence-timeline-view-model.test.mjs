import assert from "node:assert/strict";
import test from "node:test";

import { toEvidenceTimeline } from "../public/lib/evidence-timeline-view-model.js";

test("evidence timeline orders doctor task verification and node evidence", () => {
  const view = toEvidenceTimeline({
    doctorView: { status: "warning", issues: [{ label: "免费规则", status: "warning", reason: "缓存过期" }] },
    selectedJob: { id: "job-a", type: "verify", status: "failed", error: "long failure" },
    recognition: { method: "three_x_ui", confidence: "medium", source: "ssh_probe", evidence: [{ value: "vless://secret" }] },
    verification: { status: "partial", checks: [{ label: "SSH", status: "passed" }, { label: "防火墙", status: "failed" }] },
    nodeResult: { links: [{ url: "vless://secret" }] }
  });

  assert.equal(view.title, "证据时间线");
  assert.deepEqual(view.items.map((item) => item.id), ["doctor", "task", "recognition", "verification", "node"]);
  assert.equal(view.items[0].tone, "warning");
  assert.equal(view.items[1].detail, "重新验证实例 / 失败");
  assert.equal(view.items[2].detail, "3X-UI / 中可信");
  assert.equal(view.items[3].detail, "1 项失败");
  assert.equal(view.items[4].detail, "1 条节点链接");
  assert.doesNotMatch(JSON.stringify(view), /vless:\/\/secret/);
});

test("evidence timeline localizes partial verification when no check failed", () => {
  const view = toEvidenceTimeline({
    selectedJob: { id: "job-a", type: "verification", status: "partial" },
    verification: { status: "partial", checks: [{ label: "SSH", status: "passed" }] }
  });

  assert.equal(view.items.find((item) => item.id === "task")?.detail, "重新验证实例 / 部分完成");
  assert.equal(view.items.find((item) => item.id === "verification")?.detail, "部分通过");
  assert.doesNotMatch(view.items.map((item) => item.detail).join(" "), /\b(?:partial|verification)\b/);
});

test("evidence timeline returns compact empty state", () => {
  const view = toEvidenceTimeline({});
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].id, "empty");
  assert.match(view.items[0].detail, /暂无/);
});
