import assert from "node:assert/strict";
import test from "node:test";

import { createGuestAttributesService } from "../server/guest-attributes-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

function fakeRunner(responses = []) {
  const calls = [];
  return {
    calls,
    runner: {
      async runJson(command, options) {
        calls.push({ command, options });
        const response = responses.shift() || {};
        if (response.error) throw response.error;
        return { data: response.data ?? null };
      }
    }
  };
}

test("guest attributes service reads console namespace through explicit gcloud context", async () => {
  const fake = fakeRunner([{
    data: {
      items: [
        { key: "deploy-method", value: "three_x_ui" },
        { key: "schema-version", value: "1" },
        { key: "verified-at", value: "2026-07-08T10:00:00.000Z" }
      ]
    }
  }]);
  const service = createGuestAttributesService({ runner: fake.runner });

  const result = await service.readConsoleAttributes(identity);

  assert.equal(result.available, true);
  assert.equal(result.namespace, "gcp-vm-console");
  assert.equal(result.values["deploy-method"], "three_x_ui");
  assert.deepEqual(fake.calls[0], {
    command: ["compute", "instances", "get-guest-attributes", "vm-a", "--query-path=gcp-vm-console"],
    options: {
      context: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" },
      location: { zone: "us-west1-b" }
    }
  });
});

test("guest attributes service treats disabled guest attributes as unavailable", async () => {
  const fake = fakeRunner([{ error: new Error("Guest attributes are disabled for this instance") }]);
  const service = createGuestAttributesService({ runner: fake.runner });

  const result = await service.readConsoleAttributes(identity);

  assert.equal(result.available, false);
  assert.deepEqual(result.values, {});
  assert.match(result.warnings.join("\n"), /Guest Attributes 未可用/);
});

test("guest attributes service treats permission denied as warning instead of fatal", async () => {
  const fake = fakeRunner([{ error: new Error("PERMISSION_DENIED: compute.instances.getGuestAttributes") }]);
  const service = createGuestAttributesService({ runner: fake.runner });

  const result = await service.readConsoleAttributes(identity);

  assert.equal(result.available, false);
  assert.match(result.warnings.join("\n"), /权限/);
});

test("guest attributes service drops oversize and secret-like values", async () => {
  const fake = fakeRunner([{
    data: {
      items: [
        { key: "deploy-method", value: "singbox_plus" },
        { key: "raw-link", value: "vless://secret@example" },
        { key: "password", value: "secret" },
        { key: "oversize", value: "x".repeat(5000) }
      ]
    }
  }]);
  const service = createGuestAttributesService({ runner: fake.runner });

  const result = await service.readConsoleAttributes(identity);

  assert.equal(result.available, true);
  assert.deepEqual(result.values, { "deploy-method": "singbox_plus" });
  assert.match(result.warnings.join("\n"), /已忽略/);
});
