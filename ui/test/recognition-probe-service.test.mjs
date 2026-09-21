import assert from "node:assert/strict";
import test from "node:test";

import { createRecognitionProbeService } from "../server/recognition-probe-service.js";

const identity = {
  configuration: "cfg", account: "user@example.com", projectId: "project-a", zone: "us-west1-b", name: "vm-a"
};

function service(overrides = {}) {
  const calls = [];
  return {
    calls,
    probeService: createRecognitionProbeService({
      inventory: overrides.inventory || {
        async readObserved(input) {
          calls.push(["inventory", input]);
          return { ...input, exists: true, status: "RUNNING", labels: {}, metadata: {}, network: { externalIp: "203.0.113.10" } };
        }
      },
      guestAttributesService: overrides.guestAttributesService || {
        async readConsoleAttributes(input) {
          calls.push(["guest", input]);
          return { available: false, namespace: "gcp-vm-console", values: {}, warnings: [] };
        }
      },
      deploymentProbeService: overrides.deploymentProbeService || {
        async probe(input, ssh) {
          calls.push(["ssh", input, ssh]);
          return {
            ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
            services: [{ name: "sing-box", status: "active" }],
            ports: [{ protocol: "tcp", port: "45400", process: "sshd", listening: true }, { protocol: "udp", port: "443", process: "sing-box", listening: true }],
            files: ["sing-box-config"], processes: ["sing-box run"], bbr: { enabled: true }, checkedAt: "2026-07-10T11:59:00.000Z"
          };
        }
      },
      firewallService: overrides.firewallService || {
        async inspectInstanceExposure(input) {
          calls.push(["firewall", input]);
          return { status: "overexposed", broadRuleNames: ["ruzhan1"], matchedPorts: input.expectedPorts, missingPorts: [] };
        }
      },
      now: () => "2026-07-10T12:00:00.000Z"
    })
  };
}

test("recognition probe service performs only the four read probes and recognizes Sing-Box-Plus", async () => {
  const { probeService, calls } = service();
  const result = await probeService.probe({ identity, ssh: { user: "y", port: 45400 }, localRecord: null });
  assert.deepEqual(calls.map(([name]) => name), ["inventory", "guest", "ssh", "firewall"]);
  assert.equal(result.recognition.method, "singbox_plus");
  assert.equal(result.checkedAt, "2026-07-10T12:00:00.000Z");
  assert.deepEqual(calls[3][1].expectedPorts, [
    { protocol: "tcp", port: "45400" },
    { protocol: "udp", port: "443" }
  ]);
});

test("recognition probe service preserves safe Network Tier evidence", async () => {
  const { probeService } = service({
    inventory: {
      async readObserved(input) {
        return {
          ...input,
          exists: true,
          status: "RUNNING",
          labels: {},
          metadata: {},
          network: { externalIp: "203.0.113.10", networkTier: "PREMIUM" }
        };
      }
    }
  });

  const result = await probeService.probe({ identity, ssh: { user: "y", port: 45400 }, localRecord: null });
  assert.equal(result.cloudInstance.network.networkTier, "PREMIUM");
});

test("recognition probe service recognizes 3X-UI and preserves sanitized SSH failure evidence", async () => {
  const { probeService } = service({
    deploymentProbeService: {
      async probe() {
        return {
          ssh: { desiredPort: 45400, actualPort: 22, verified: true, fallback: true },
          services: [{ name: "x-ui", status: "active" }],
          ports: [{ protocol: "tcp", port: "8443", process: "x-ui", listening: true }],
          files: ["x-ui-config-dir"], processes: ["x-ui"], bbr: { enabled: true }, checkedAt: "2026-07-10T11:59:00.000Z"
        };
      }
    }
  });
  const result = await probeService.probe({ identity, ssh: { user: "y", port: 45400 } });
  assert.equal(result.recognition.method, "three_x_ui");
  assert.equal(result.sshProbe.ssh.actualPort, 22);
});

test("recognition probe service reports unknown when SSH probe has no usable evidence", async () => {
  const { probeService } = service({
    deploymentProbeService: {
      async probe() {
        return { ssh: { desiredPort: 45400, actualPort: null, verified: false }, services: [], ports: [], warnings: ["proxy unavailable"], checkedAt: "2026-07-10T11:59:00.000Z" };
      }
    }
  });
  const result = await probeService.probe({ identity, ssh: { user: "y", port: 45400 } });
  assert.equal(result.recognition.method, "unmanaged_unknown");
  assert.equal(result.sshProbe.ssh.verified, false);
});

test("recognition probe service preserves a sanitized firewall read failure", async () => {
  const { probeService } = service({
    firewallService: {
      async inspectInstanceExposure() {
        return { status: "unknown", broadRules: [], warning: "ProxyError: Tunnel connection failed: 503 Service Unavailable" };
      }
    }
  });
  const result = await probeService.probe({ identity, ssh: { user: "y", port: 45400 } });
  assert.equal(result.firewallProbe.status, "unknown");
  assert.match(result.firewallProbe.error, /ProxyError.*503/);
});

test("recognition probe service redacts unsafe cloud, guest and probe values", async () => {
  const { probeService } = service({
    inventory: {
      async readObserved(input) {
        return { ...input, status: "RUNNING", metadata: { startupScript: "token=cloud-secret" }, labels: { safe: "ok" }, network: { externalIp: "203.0.113.10" } };
      }
    },
    guestAttributesService: {
      async readConsoleAttributes() {
        return { available: true, namespace: "gcp-vm-console", values: { "deploy-method": "three_x_ui", password: "guest-secret" }, warnings: [] };
      }
    },
    deploymentProbeService: {
      async probe() {
        return {
          ssh: { desiredPort: 45400, actualPort: 45400, verified: true, rawOutput: "remote-secret" },
          services: [{ name: "x-ui", status: "active", token: "service-secret" }],
          ports: [], files: [], rawOutput: "full-output", checkedAt: "2026-07-10T11:59:00.000Z"
        };
      }
    }
  });
  const serialized = JSON.stringify(await probeService.probe({ identity, ssh: { user: "y", keyFile: "/secret/key", port: 45400 } }));
  for (const secret of ["cloud-secret", "guest-secret", "remote-secret", "service-secret", "full-output", "/secret/key"]) {
    assert.equal(serialized.includes(secret), false);
  }
});
