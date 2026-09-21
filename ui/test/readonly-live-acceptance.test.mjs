import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runReadonlyAcceptance } from "../scripts/readonly-live-acceptance.mjs";

function record(name, method) {
  return {
    id: name, identity: { configuration: "cfg", account: "user@example.com", projectId: "project-a", zone: "us-west1-b", name },
    desired: { deploy: { method }, ssh: { user: "y", keyFile: `/secret/${name}`, port: 45400 } }
  };
}

function deps(overrides = {}) {
  const records = [record("example-singbox-instance", "singbox_plus"), record("example-xui-instance", "three_x_ui")];
  return {
    recordStore: overrides.recordStore || { async list() { return structuredClone(records); } },
    recognitionProbeService: overrides.recognitionProbeService || {
      async probe({ identity, localRecord }) {
        assert.equal(localRecord, null);
        const xui = identity.name === "example-xui-instance";
        return {
          cloudInstance: { status: "RUNNING" }, checkedAt: "2026-07-10T12:00:00.000Z",
          recognition: { method: xui ? "three_x_ui" : "singbox_plus", confidence: "high", source: "ssh_deep_probe" },
          sshProbe: {
            ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
            bbr: { enabled: true }, services: [{ name: xui ? "x-ui" : "sing-box", status: "active" }]
          },
          firewallProbe: { status: "overexposed", broadRuleNames: ["ruzhan1"] }
        };
      }
    },
    jobHistoryReader: overrides.jobHistoryReader || (async () => [{ id: "job-1", status: "succeeded" }]),
    commandLedger: [{ mode: "read", category: "instances.describe" }],
    now: () => "2026-07-10T12:00:00.000Z"
  };
}

test("readonly acceptance validates both allowlisted targets without persistence", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "readonly-acceptance-"));
  const result = await runReadonlyAcceptance({
    argv: ["--targets", "example-singbox-instance,example-xui-instance", "--json"], outputDir, ...deps()
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.recordHashUnchanged, true);
  assert.equal(result.summary.jobHashUnchanged, true);
  assert.equal(result.summary.nodeResultHashUnchanged, true);
  assert.equal(result.summary.targets.every((target) => target.status === "passed"), true);
  assert.equal(result.summary.targets[0].firewall.status, "overexposed");
  const output = await readFile(result.outputPath, "utf8");
  assert.equal(output.includes("/secret/"), false);
  assert.equal((await stat(result.outputPath)).mode & 0o777, 0o600);
});

test("readonly acceptance fails when records jobs or node results change during probing", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "readonly-acceptance-"));
  let recordReads = 0;
  let jobReads = 0;
  const base = deps();
  const result = await runReadonlyAcceptance({
    argv: ["--targets", "example-singbox-instance,example-xui-instance", "--plain"],
    outputDir,
    ...base,
    recordStore: {
      async list() {
        recordReads += 1;
        const records = [record("example-singbox-instance", "singbox_plus"), record("example-xui-instance", "three_x_ui")];
        records[0].nodeResult = { links: [{ name: "node", url: recordReads === 1 ? "hy2://before" : "hy2://after" }] };
        return records;
      }
    },
    jobHistoryReader: async () => {
      jobReads += 1;
      return [{ id: "job-1", status: jobReads === 1 ? "succeeded" : "partial" }];
    }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.recordHashUnchanged, false);
  assert.equal(result.summary.jobHashUnchanged, false);
  assert.equal(result.summary.nodeResultHashUnchanged, false);
  const output = await readFile(result.outputPath, "utf8");
  assert.match(output, /Job hash unchanged: no/);
  assert.match(output, /Node-result hash unchanged: no/);
  assert.doesNotMatch(output, /hy2:\/\/(before|after)/);
});

test("readonly acceptance rejects any target outside the exact allowlist", async () => {
  await assert.rejects(() => runReadonlyAcceptance({
    argv: ["--targets", "example-singbox-instance,other-vm", "--plain"], ...deps()
  }), /allowlist/i);
});

test("readonly acceptance reports drift and sanitized blockers as nonzero", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "readonly-acceptance-"));
  const result = await runReadonlyAcceptance({
    argv: ["--targets", "example-singbox-instance,example-xui-instance", "--plain"],
    outputDir,
    ...deps({
      recognitionProbeService: {
        async probe({ identity }) {
          if (identity.name === "example-singbox-instance") throw new Error("ProxyError token=secret-value /secret/key");
          return {
            cloudInstance: { status: "RUNNING" }, checkedAt: "2026-07-10T12:00:00.000Z",
            recognition: { method: "singbox_plus", confidence: "high", source: "ssh_deep_probe" },
            sshProbe: { ssh: { desiredPort: 45400, actualPort: 22, verified: true, fallback: true }, bbr: { enabled: false }, services: [] },
            firewallProbe: { status: "matched", broadRuleNames: [] }
          };
        }
      }
    })
  });
  assert.equal(result.exitCode, 1);
  const output = await readFile(result.outputPath, "utf8");
  assert.equal(output.includes("secret-value"), false);
  assert.equal(output.includes("/secret/key"), false);
  assert.match(output, /proxy|drift/i);
});

test("readonly acceptance reports firewall read failures as blockers instead of drift", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "readonly-acceptance-"));
  const base = deps();
  const result = await runReadonlyAcceptance({
    argv: ["--targets", "example-singbox-instance,example-xui-instance", "--json"],
    outputDir,
    ...base,
    recognitionProbeService: {
      async probe(input) {
        const value = await base.recognitionProbeService.probe(input);
        if (input.identity.name === "example-xui-instance") {
          value.firewallProbe = { status: "unknown", broadRuleNames: [], error: "ProxyError: Tunnel connection failed: 503" };
        }
        return value;
      }
    }
  });
  const target = result.summary.targets.find((item) => item.name === "example-xui-instance");
  assert.equal(result.exitCode, 1);
  assert.equal(target.status, "blocked");
  assert.equal(target.blocker.category, "proxy");
  assert.deepEqual(target.drift, []);
});
