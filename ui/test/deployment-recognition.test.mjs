import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDeploymentMethod,
  recognizeDeployment,
  toRecognitionSummary
} from "../server/deployment-recognition.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

test("deployment recognition treats local record as high confidence managed evidence", () => {
  const recognition = recognizeDeployment({
    localRecord: {
      identity,
      desired: { deploy: { method: "singbox_plus" } },
      verification: { status: "passed", checkedAt: "2026-07-08T10:00:00.000Z" }
    }
  });

  assert.equal(recognition.method, "singbox_plus");
  assert.equal(recognition.confidence, "high");
  assert.equal(recognition.source, "local_record");
  assert.equal(recognition.managedState, "managed");
  assert.equal(recognition.suggestedAction, "verify");
  assert.match(toRecognitionSummary(recognition), /Sing-Box-Plus/);
});

test("deployment recognition keeps cloud-only instances unknown without evidence", () => {
  const recognition = recognizeDeployment({
    cloudInstance: { identity, labels: {}, metadata: {} }
  });

  assert.equal(recognition.method, "unmanaged_unknown");
  assert.equal(recognition.confidence, "none");
  assert.equal(recognition.source, "none");
  assert.equal(recognition.managedState, "unknown");
  assert.equal(recognition.suggestedAction, "manual_choose");
});

test("deployment recognition reads safe cloud labels and metadata as method hints", () => {
  const fromLabel = recognizeDeployment({
    cloudInstance: { labels: { gvc_deploy_method: "three_x_ui" }, metadata: {} }
  });
  const fromMetadata = recognizeDeployment({
    cloudInstance: { labels: {}, metadata: { gvcDeployMethod: "singbox_plus" } }
  });

  assert.equal(fromLabel.method, "three_x_ui");
  assert.equal(fromLabel.confidence, "medium");
  assert.equal(fromLabel.source, "cloud_label");
  assert.equal(fromLabel.suggestedAction, "adopt");
  assert.equal(fromMetadata.method, "singbox_plus");
  assert.equal(fromMetadata.source, "cloud_metadata");
});

test("deployment recognition treats guest attributes as high confidence without keeping secrets", () => {
  const recognition = recognizeDeployment({
    guestAttributes: {
      available: true,
      values: {
        "deploy-method": "three_x_ui",
        "schema-version": "1",
        "verified-at": "2026-07-08T10:00:00.000Z",
        password: "secret",
        rawLink: "vless://secret@example"
      }
    }
  });

  assert.equal(recognition.method, "three_x_ui");
  assert.equal(recognition.confidence, "high");
  assert.equal(recognition.source, "guest_attributes");
  assert.equal(recognition.evidence.some((item) => /secret|vless:\/\//i.test(String(item.value))), false);
});

test("deployment recognition infers 3X-UI and Sing-Box from read-only SSH probe evidence", () => {
  const xui = recognizeDeployment({
    sshProbe: {
      services: [{ name: "x-ui", status: "active" }],
      ports: [{ protocol: "tcp", port: "443", listening: true }],
      files: ["x-ui-config-dir"]
    }
  });
  const singbox = recognizeDeployment({
    sshProbe: {
      services: [{ name: "sing-box", status: "active" }],
      ports: [{ protocol: "udp", port: "23293", listening: true }],
      files: ["sing-box-config"]
    }
  });

  assert.equal(xui.method, "three_x_ui");
  assert.equal(xui.confidence, "medium");
  assert.equal(xui.source, "ssh_probe");
  assert.equal(singbox.method, "singbox_plus");
  assert.equal(singbox.confidence, "medium");
  assert.equal(singbox.source, "ssh_probe");
});

test("deployment recognition scores deep SSH probe candidates with reasons", () => {
  const recognition = recognizeDeployment({
    sshProbe: {
      services: [{ name: "x-ui", status: "active" }, { name: "xray", status: "active" }],
      units: [{ name: "x-ui.service", status: "active" }],
      processes: [{ command: "x-ui", args: "/usr/local/x-ui/x-ui" }],
      ports: [{ protocol: "tcp", port: "45400", process: "x-ui", listening: true }],
      files: ["x-ui-config-dir", "x-ui-binary", "x-ui-env"],
      containers: [{ name: "3x-ui", image: "ghcr.io/mhsanaei/3x-ui:latest" }],
      configSummary: [{ kind: "xray-inbound", protocols: ["vless", "trojan"] }]
    }
  });

  assert.equal(recognition.method, "three_x_ui");
  assert.equal(recognition.source, "ssh_deep_probe");
  assert.equal(recognition.confidence, "high");
  assert.ok(recognition.score >= 85);
  assert.ok(recognition.candidates.some((candidate) => candidate.method === "three_x_ui" && candidate.score >= 85));
  assert.match(recognition.candidates.find((candidate) => candidate.method === "three_x_ui").reasons.join("\n"), /x-ui service active/i);
});

test("deployment recognition prefers stronger live SSH evidence over a matching medium-confidence cloud label", () => {
  const recognition = recognizeDeployment({
    cloudInstance: { labels: { gvc_deploy_method: "singbox_plus" }, metadata: {} },
    sshProbe: {
      services: [{ name: "sing-box", status: "active" }],
      units: [{ name: "sing-box.service", status: "active" }],
      processes: [{ command: "sing-box", args: "/usr/local/bin/sing-box run" }],
      ports: [{ protocol: "udp", port: "21320", process: "sing-box", listening: true }],
      files: ["sing-box-local-binary", "sing-box-systemd"]
    }
  });

  assert.equal(recognition.method, "singbox_plus");
  assert.equal(recognition.source, "ssh_deep_probe");
  assert.equal(recognition.confidence, "high");
  assert.ok(recognition.score >= 80);
});

test("deployment recognition keeps port-only evidence low confidence", () => {
  const recognition = recognizeDeployment({
    sshProbe: {
      services: [],
      ports: [{ protocol: "tcp", port: "443", listening: true }],
      files: [],
      processes: []
    }
  });

  assert.equal(recognition.method, "external_custom");
  assert.equal(recognition.confidence, "low");
  assert.ok(recognition.score < 50);
  assert.match(recognition.warnings.join("\n"), /端口.*不足|port.*insufficient/i);
});

test("deployment recognition reports multi-service conflicts instead of forcing one method", () => {
  const recognition = recognizeDeployment({
    sshProbe: {
      services: [{ name: "x-ui", status: "active" }, { name: "sing-box", status: "active" }],
      ports: [
        { protocol: "tcp", port: "45400", process: "x-ui", listening: true },
        { protocol: "udp", port: "23293", process: "sing-box", listening: true }
      ],
      files: ["x-ui-config-dir", "sing-box-config"],
      processes: [{ command: "x-ui", args: "" }, { command: "sing-box", args: "" }]
    }
  });

  assert.equal(recognition.method, "external_custom");
  assert.equal(recognition.suggestedAction, "manual_choose");
  assert.match(recognition.warnings.join("\n"), /多个|冲突/);
  assert.ok(recognition.candidates.some((candidate) => candidate.method === "three_x_ui"));
  assert.ok(recognition.candidates.some((candidate) => candidate.method === "singbox_plus"));
});

test("deployment recognition does not treat inactive service text as active", () => {
  const recognition = recognizeDeployment({
    sshProbe: {
      services: [{ name: "sing-box", status: "active" }, { name: "x-ui", status: "inactive" }],
      ports: [{ protocol: "udp", port: "23293", process: "sing-box", listening: true }],
      files: ["sing-box-config"],
      processes: [{ command: "sing-box", args: "/usr/bin/sing-box run" }]
    }
  });

  assert.equal(recognition.method, "singbox_plus");
  assert.equal(recognition.suggestedAction, "adopt");
  assert.doesNotMatch(recognition.warnings.join("\n"), /多个|冲突/);
  assert.equal(recognition.candidates.some((candidate) => candidate.method === "three_x_ui" && candidate.score > 0), false);
});

test("deployment recognition uses current high-confidence probe over stale local vm-only record", () => {
  const recognition = recognizeDeployment({
    localRecord: { desired: { deploy: { method: "vm_only" } } },
    sshProbe: {
      services: [{ name: "x-ui", status: "active" }],
      units: [{ name: "x-ui.service", status: "active" }],
      ports: [{ protocol: "tcp", port: "443", process: "x-ui", listening: true }],
      files: ["x-ui-config-dir"],
      processes: [{ command: "x-ui", args: "/usr/local/x-ui/x-ui" }]
    }
  });

  assert.equal(recognition.method, "three_x_ui");
  assert.equal(recognition.confidence, "high");
  assert.equal(recognition.source, "ssh_deep_probe");
  assert.equal(recognition.managedState, "managed");
  assert.equal(recognition.suggestedAction, "verify");
  assert.equal(recognition.warnings.some((warning) => /冲突|conflict/i.test(warning)), false);
  assert.ok(recognition.candidates.some((candidate) => candidate.method === "vm_only" && candidate.source === "local_record"));
});

test("deployment method normalization accepts common aliases", () => {
  assert.equal(normalizeDeploymentMethod("3x-ui"), "three_x_ui");
  assert.equal(normalizeDeploymentMethod("xui"), "three_x_ui");
  assert.equal(normalizeDeploymentMethod("sing-box-plus"), "singbox_plus");
  assert.equal(normalizeDeploymentMethod("vm-only"), "vm_only");
  assert.equal(normalizeDeploymentMethod("unknown"), "unmanaged_unknown");
});
