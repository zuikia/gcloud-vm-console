import assert from "node:assert/strict";
import test from "node:test";

import { toNetworkExposureView } from "../public/lib/network-exposure-view-model.js";

function record(overrides = {}) {
  return {
    id: "record-a",
    identity: { name: "vm-a", projectId: "project-a", zone: "us-west1-b" },
    verification: {
      checkedAt: "2026-07-16T11:55:00.000Z",
      ports: [
        { protocol: "tcp", port: "54321", process: "x-ui", scope: "wildcard", listening: true },
        { protocol: "udp", port: "443", process: "sing-box", scope: "network", listening: true },
        { protocol: "tcp", port: "8080", process: "custom-service", scope: "network", listening: true },
        { protocol: "tcp", port: "9090", process: "local-agent", scope: "loopback", listening: true }
      ]
    },
    observed: {},
    ...overrides
  };
}

test("network exposure view exposes only fresh network listeners and selects known node processes", () => {
  const view = toNetworkExposureView({
    record: record(),
    secretStatus: { configured: false },
    now: "2026-07-16T12:00:00.000Z"
  });

  assert.equal(view.freshness, "fresh");
  assert.equal(view.hasFreshPortEvidence, true);
  assert.deepEqual(view.candidates.map((item) => item.key), ["tcp/8080", "tcp/54321", "udp/443"]);
  assert.deepEqual(view.selectedPortKeys, ["tcp/54321", "udp/443"]);
  assert.equal(view.secret.configured, false);
  assert.equal(view.previewActionLabel, "保存密码并生成预览");
  assert.equal(view.canApply, false);
});

test("network exposure view preserves a current preview selection and summarizes isolation changes", () => {
  const preview = {
    fingerprint: "preview-fingerprint",
    checkedAt: "2026-07-16T11:58:00.000Z",
    expiresAt: "2026-07-16T12:13:00.000Z",
    coverage: { ready: true, freshness: "fresh", blockedReason: "" },
    selection: {
      publicSsh22: true,
      ports: [{ protocol: "tcp", port: "8080" }]
    },
    desiredExposure: {
      public: [
        { protocol: "tcp", port: "22" },
        { protocol: "tcp", port: "8080" },
        { protocol: "tcp", port: "45400" }
      ],
      iap: [{ protocol: "tcp", port: "22" }, { protocol: "tcp", port: "45400" }]
    },
    changes: {
      open: [{ protocol: "tcp", port: "8080" }],
      retain: [{ protocol: "tcp", port: "45400" }],
      close: [{ protocol: "udp", port: "443" }]
    },
    isolation: {
      targetTag: "gvc-isolate-a",
      allowPriority: 998,
      denyPriority: 999,
      ruleActions: [
        { purpose: "ssh-iap", sourceRanges: ["35.235.240.0/20"] },
        { purpose: "public-service", sourceRanges: ["0.0.0.0/0"] },
        { purpose: "isolation-deny", sourceRanges: ["0.0.0.0/0"] }
      ]
    },
    sshPolicy: { passwordVersion: "secret-v1" }
  };
  const view = toNetworkExposureView({
    record: record(),
    secretStatus: { configured: true, versionId: "secret-v1", updatedAt: "2026-07-16T11:00:00.000Z" },
    preview,
    now: "2026-07-16T12:00:00.000Z"
  });

  assert.deepEqual(view.selectedPortKeys, ["tcp/8080"]);
  assert.equal(view.publicSsh22, true);
  assert.equal(view.secret.configured, true);
  assert.equal(view.previewActionLabel, "重新生成预览");
  assert.equal(view.canApply, true);
  assert.match(view.preview.summary, /公网 3 个端口/);
  assert.match(view.preview.detail, /新增 1.*保留 1.*关闭 1/);
  assert.match(view.preview.isolation, /gvc-isolate-a.*998\/999/);
  const rows = Object.fromEntries(view.preview.rows.map((row) => [row.label, row.value]));
  assert.match(rows.端口变化, /tcp\/8080.*tcp\/45400.*udp\/443/);
  assert.match(rows.规则来源, /35\.235\.240\.0\/20.*0\.0\.0\.0\/0/);
  assert.match(rows.影响范围, /vm-a.*gvc-isolate-a.*998\/999/);
  assert.match(rows.失败回滚, /仅禁用.*deny/);
});

test("network exposure view fails closed for stale evidence or expired preview", () => {
  const stale = toNetworkExposureView({
    record: record({
      verification: {
        checkedAt: "2026-07-16T10:00:00.000Z",
        ports: [{ protocol: "udp", port: "443", process: "sing-box", scope: "network", listening: true }]
      },
      observed: {
        networkExposurePreview: {
          fingerprint: "expired",
          expiresAt: "2026-07-16T11:00:00.000Z",
          coverage: { ready: true },
          selection: { ports: [{ protocol: "udp", port: "443" }] }
        }
      }
    }),
    secretStatus: { configured: true },
    now: "2026-07-16T12:00:00.000Z"
  });

  assert.equal(stale.freshness, "aging");
  assert.equal(stale.hasFreshPortEvidence, false);
  assert.equal(stale.canApply, false);
  assert.match(stale.evidenceHint, /重新运行只读探测/);
  assert.equal(stale.preview.tone, "warning");
});

test("network exposure view rejects a preview bound to a missing or replaced local secret", () => {
  const preview = {
    fingerprint: "preview-fingerprint",
    expiresAt: "2026-07-16T12:13:00.000Z",
    coverage: { ready: true },
    selection: { ports: [] },
    desiredExposure: { public: [{ protocol: "tcp", port: "45400" }] },
    sshPolicy: { passwordVersion: "secret-v1" }
  };
  const missing = toNetworkExposureView({
    record: record(),
    secretStatus: { configured: false },
    preview,
    now: "2026-07-16T12:00:00.000Z"
  });
  const replaced = toNetworkExposureView({
    record: record(),
    secretStatus: { configured: true, versionId: "secret-v2" },
    preview,
    now: "2026-07-16T12:00:00.000Z"
  });

  assert.equal(missing.canApply, false);
  assert.equal(replaced.canApply, false);
  assert.match(missing.preview.detail, /密码.*重新生成预览/);
  assert.match(replaced.preview.detail, /密码.*重新生成预览/);
});
