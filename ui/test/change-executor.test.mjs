import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createChangeExecutor } from "../server/change-executor.js";
import { createChangePreview } from "../server/change-planner.js";
import { createTaskLock } from "../server/task-lock.js";
import { createVmRecordStore } from "../server/vm-record-store.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const desired = {
  machineType: "e2-micro",
  image: "debian-cloud/debian-12",
  disk: { sizeGb: 30, type: "pd-standard" },
  network: {
    name: "default",
    subnet: "default",
    externalIpMode: "ephemeral",
    networkTier: "PREMIUM",
    nicType: "VIRTIO_NET"
  },
  labels: { managed_by: "gcp-vm-console" },
  tags: ["gcp-vm-console"],
  metadata: { startupScriptHash: "script-v1" },
  deploy: { method: "vm_only" }
};

async function setup(t, { observedSequence = [null, { exists: true, status: "RUNNING" }], runImpl } = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "gcp-change-executor-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const store = createVmRecordStore({ rootDir, now: () => "2026-06-17T12:00:00.000Z" });
  const calls = [];
  const runner = {
    async run(command, options) {
      calls.push({ command, options });
      if (runImpl) return runImpl(command, options);
      return { exitCode: 0, stdout: "", stderr: "", command };
    }
  };
  let readIndex = 0;
  const inventory = {
    async readObserved() {
      const value = observedSequence[Math.min(readIndex, observedSequence.length - 1)];
      readIndex += 1;
      return value;
    }
  };
  return {
    calls,
    store,
    executor: createChangeExecutor({ runner, inventory, recordStore: store, taskLock: createTaskLock(), now: () => "2026-06-17T12:00:00.000Z" })
  };
}

test("change executor creates a VM only after the saved preview still matches", async (t) => {
  const fixture = await setup(t);
  const preview = createChangePreview({ identity, desired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired, observed: null, preview });

  const result = await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "create-1" });

  assert.equal(result.status, "succeeded");
  assert.equal(result.reused, false);
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(fixture.calls[0].command.slice(0, 4), ["compute", "instances", "create", "vm-a"]);
  assert.ok(fixture.calls[0].command.includes("--machine-type=e2-micro"));
  assert.ok(fixture.calls[0].command.includes("--network-interface=network=default,subnet=default,nic-type=VIRTIO_NET,network-tier=PREMIUM"));
  assert.ok(fixture.calls[0].command.includes("--image-family=debian-12"));
  assert.ok(fixture.calls[0].command.includes("--image-project=debian-cloud"));
  assert.deepEqual(fixture.calls[0].options.context, {
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });
  assert.deepEqual(fixture.calls[0].options.location, { zone: "us-west1-b" });

  const saved = await fixture.store.get(record.id);
  assert.equal(saved.status, "managed");
  assert.equal(saved.history.at(-1).idempotencyKey, "create-1");
  assert.equal(saved.history.at(-1).status, "succeeded");
});

test("change executor passes a custom startup script through a temporary metadata file", async (t) => {
  const script = "#!/bin/bash\nprintf 'gvc-startup-ready\\n'\n";
  const startupDesired = {
    ...desired,
    metadata: { ...desired.metadata, startupScriptHash: "script-custom" },
    deploy: { method: "custom_startup", startupScript: script, configureSshPort: false }
  };
  const fixture = await setup(t, {
    runImpl: async (command) => {
      const startupFlag = command.find((part) => part.startsWith("--metadata-from-file=startup-script="));
      if (startupFlag) {
        const filePath = startupFlag.slice("--metadata-from-file=startup-script=".length);
        assert.equal(await readFile(filePath, "utf8"), script);
      }
      return { exitCode: 0, stdout: "", stderr: "", command };
    }
  });
  const preview = createChangePreview({ identity, desired: startupDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: startupDesired, observed: null, preview });

  await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "create-custom-startup" });

  assert.equal(fixture.calls.filter((call) => call.command.some((part) => part.startsWith("--metadata-from-file=startup-script="))).length, 1);
  const startupFlag = fixture.calls[0].command.find((part) => part.startsWith("--metadata-from-file=startup-script="));
  const startupPath = startupFlag.slice("--metadata-from-file=startup-script=".length);
  await assert.rejects(() => readFile(startupPath, "utf8"));
});

test("change executor reserves a compatible static address before creating a GVNIC VM", async (t) => {
  const staticDesired = {
    ...desired,
    network: {
      ...desired.network,
      externalIpMode: "static",
      networkTier: "PREMIUM",
      nicType: "GVNIC",
      addressName: "vm-a-ip"
    }
  };
  const fixture = await setup(t, {
    observedSequence: [null, {
      exists: true,
      status: "RUNNING",
      network: { externalIp: "203.0.113.10", networkTier: "PREMIUM", nicType: "GVNIC" }
    }],
    runImpl: async (command) => command.slice(0, 3).join(" ") === "compute addresses list"
      ? { exitCode: 0, stdout: "[]\n", stderr: "", command }
      : { exitCode: 0, stdout: "", stderr: "", command }
  });
  const preview = createChangePreview({ identity, desired: staticDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: staticDesired, observed: null, preview });

  const result = await fixture.executor.execute({
    recordId: record.id,
    previewFingerprint: preview.fingerprint,
    idempotencyKey: "create-static"
  });

  assert.deepEqual(fixture.calls.map((call) => call.command.slice(0, 3).join(" ")), [
    "compute addresses list",
    "compute addresses create",
    "compute instances create"
  ]);
  assert.ok(fixture.calls[1].command.includes("--network-tier=PREMIUM"));
  assert.deepEqual(fixture.calls[1].options.location, { region: "us-west1" });
  assert.ok(fixture.calls[2].command.includes("--network-interface=network=default,subnet=default,nic-type=GVNIC,network-tier=PREMIUM,address=vm-a-ip"));
  assert.equal(result.network.addressName, "vm-a-ip");
  assert.equal(result.network.externalIp, "203.0.113.10");

  const saved = await fixture.store.get(record.id);
  assert.equal(saved.desired.network.externalIpMode, "static");
  assert.equal(saved.desired.network.externalIp, "203.0.113.10");
  assert.equal(saved.observed.network.externalIpMode, "static");
  assert.equal(saved.observed.network.addressName, "vm-a-ip");
});

test("change executor reuses only a reserved address with matching region and tier", async (t) => {
  const staticDesired = {
    ...desired,
    network: {
      ...desired.network,
      externalIpMode: "static",
      networkTier: "STANDARD",
      nicType: "GVNIC",
      addressName: "vm-a-ip"
    }
  };
  const address = [{
    name: "vm-a-ip",
    address: "203.0.113.11",
    status: "RESERVED",
    networkTier: "STANDARD",
    region: "https://www.googleapis.com/compute/v1/projects/project-a/regions/us-west1",
    users: []
  }];
  const fixture = await setup(t, {
    observedSequence: [null, { exists: true, status: "RUNNING", network: { externalIp: "203.0.113.11" } }],
    runImpl: async (command) => command.slice(0, 3).join(" ") === "compute addresses list"
      ? { exitCode: 0, stdout: `${JSON.stringify(address)}\n`, stderr: "", command }
      : { exitCode: 0, stdout: "", stderr: "", command }
  });
  const preview = createChangePreview({ identity, desired: staticDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: staticDesired, observed: null, preview });

  await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "reuse-static" });

  assert.equal(fixture.calls.some((call) => call.command.slice(0, 3).join(" ") === "compute addresses create"), false);
  assert.equal(fixture.calls.filter((call) => call.command.slice(0, 3).join(" ") === "compute instances create").length, 1);
});

test("change executor fails closed on an incompatible static address before VM creation", async (t) => {
  const staticDesired = {
    ...desired,
    network: { ...desired.network, externalIpMode: "static", networkTier: "PREMIUM", nicType: "GVNIC", addressName: "vm-a-ip" }
  };
  const fixture = await setup(t, {
    runImpl: async (command) => command.slice(0, 3).join(" ") === "compute addresses list"
      ? {
        exitCode: 0,
        stdout: `${JSON.stringify([{ name: "vm-a-ip", status: "RESERVED", networkTier: "STANDARD", region: "regions/us-west1" }])}\n`,
        stderr: "",
        command
      }
      : { exitCode: 0, stdout: "", stderr: "", command }
  });
  const preview = createChangePreview({ identity, desired: staticDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: staticDesired, observed: null, preview });

  await assert.rejects(
    () => fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "wrong-tier" }),
    /Network Tier|network tier/i
  );
  assert.equal(fixture.calls.some((call) => call.command.slice(0, 3).join(" ") === "compute instances create"), false);
});

test("change executor rejects an internal address that collides with the requested static IPv4 name", async (t) => {
  const staticDesired = {
    ...desired,
    network: { ...desired.network, externalIpMode: "static", networkTier: "PREMIUM", nicType: "GVNIC", addressName: "vm-a-ip" }
  };
  const fixture = await setup(t, {
    runImpl: async (command) => command.slice(0, 3).join(" ") === "compute addresses list"
      ? {
        exitCode: 0,
        stdout: `${JSON.stringify([{
          name: "vm-a-ip",
          status: "RESERVED",
          addressType: "INTERNAL",
          ipVersion: "IPV4",
          networkTier: "PREMIUM",
          region: "regions/us-west1"
        }])}\n`,
        stderr: "",
        command
      }
      : { exitCode: 0, stdout: "", stderr: "", command }
  });
  const preview = createChangePreview({ identity, desired: staticDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: staticDesired, observed: null, preview });

  await assert.rejects(
    () => fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "internal-address" }),
    /external IPv4/i
  );
  assert.equal(fixture.calls.some((call) => call.command.slice(0, 3).join(" ") === "compute instances create"), false);
});

test("change executor retains a newly reserved address when VM creation fails", async (t) => {
  const staticDesired = {
    ...desired,
    network: { ...desired.network, externalIpMode: "static", networkTier: "PREMIUM", nicType: "GVNIC", addressName: "vm-a-ip" }
  };
  const fixture = await setup(t, {
    runImpl: async (command) => {
      const kind = command.slice(0, 3).join(" ");
      if (kind === "compute addresses list") return { exitCode: 0, stdout: "[]\n", stderr: "", command };
      if (kind === "compute instances create") throw new Error("simulated create failure");
      return { exitCode: 0, stdout: "", stderr: "", command };
    }
  });
  const preview = createChangePreview({ identity, desired: staticDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: staticDesired, observed: null, preview });

  await assert.rejects(
    () => fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "retain-address" }),
    /静态地址 vm-a-ip 已保留/
  );
  assert.equal(fixture.calls.some((call) => call.command.includes("delete")), false);
});

test("change executor creates a private-only GVNIC without an external tier flag", async (t) => {
  const privateDesired = {
    ...desired,
    network: { ...desired.network, externalIpMode: "none", networkTier: "STANDARD", nicType: "GVNIC" }
  };
  const fixture = await setup(t);
  const preview = createChangePreview({ identity, desired: privateDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: privateDesired, observed: null, preview });

  await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "private-only" });

  const networkFlag = fixture.calls[0].command.find((part) => part.startsWith("--network-interface="));
  assert.equal(networkFlag, "--network-interface=network=default,subnet=default,nic-type=GVNIC,no-address");
  assert.doesNotMatch(networkFlag, /network-tier/);
});

test("change executor serializes only safe deployment recognition metadata into create commands", async (t) => {
  const fixture = await setup(t);
  const recognitionDesired = {
    ...desired,
    labels: {
      managed_by: "gcp-vm-console",
      gvc_managed: "true",
      gvc_deploy_method: "three_x_ui"
    },
    metadata: {
      startupScriptHash: "script-v1",
      gvcRecordSchema: "1",
      gvcDeployMethod: "three_x_ui",
      rawLink: "vless://secret@example",
      panelPassword: "secret"
    },
    deploy: { method: "three_x_ui" }
  };
  const preview = createChangePreview({ identity, desired: recognitionDesired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired: recognitionDesired, observed: null, preview });

  await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "create-recognition" });

  const command = fixture.calls[0].command.join(" ");
  assert.match(command, /--labels=.*gvc_managed=true/);
  assert.match(command, /--labels=.*gvc_deploy_method=three_x_ui/);
  assert.match(command, /--metadata=.*gvc-record-schema=1/);
  assert.match(command, /--metadata=.*gvc-deploy-method=three_x_ui/);
  assert.match(command, /--metadata=.*gcp-vm-console-startup-script-hash=script-v1/);
  assert.doesNotMatch(command, /vless:\/\/|panelPassword|rawLink|secret/);
});

test("change executor rejects a stale observed-state fingerprint before any command", async (t) => {
  const staleObserved = { exists: true, status: "RUNNING", machineType: "e2-small" };
  const fixture = await setup(t, { observedSequence: [staleObserved] });
  const preview = createChangePreview({ identity, desired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired, observed: null, preview });

  await assert.rejects(
    () => fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "stale-1" }),
    /observed_changed/
  );
  assert.equal(fixture.calls.length, 0);
});

test("change executor reuses a successful idempotency key without another cloud command", async (t) => {
  const fixture = await setup(t);
  const preview = createChangePreview({ identity, desired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired, observed: null, preview });

  await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "create-once" });
  const second = await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "create-once" });

  assert.equal(second.reused, true);
  assert.equal(fixture.calls.length, 1);
});

test("replacement execution creates a verified candidate and never deletes the original VM", async (t) => {
  const observed = {
    exists: true,
    status: "RUNNING",
    machineType: desired.machineType,
    image: desired.image,
    disk: desired.disk,
    network: desired.network,
    labels: desired.labels,
    tags: desired.tags,
    metadata: desired.metadata
  };
  const replacementDesired = { ...desired, image: "ubuntu-os-cloud/ubuntu-2404-lts-amd64" };
  const fixture = await setup(t, { observedSequence: [observed, observed] });
  const preview = createChangePreview({ identity, desired: replacementDesired, observed });
  const record = await fixture.store.save({ status: "managed", identity, desired: replacementDesired, observed, preview });

  const result = await fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "replace-1" });

  assert.equal(result.status, "replacement_pending_verification");
  assert.match(result.replacementName, /^vm-a-r-[a-f0-9]{6}$/);
  assert.equal(fixture.calls.some((call) => call.command.includes("delete")), false);
  assert.equal(fixture.calls.filter((call) => call.command.includes("create")).length, 1);
  assert.equal((await fixture.store.get(record.id)).status, "replacing");
});

test("change executor records a failed partial operation and releases the task lock", async (t) => {
  const failure = new Error("simulated gcloud failure");
  const fixture = await setup(t, { runImpl: async () => { throw failure; } });
  const preview = createChangePreview({ identity, desired, observed: null });
  const record = await fixture.store.save({ status: "draft", identity, desired, observed: null, preview });

  await assert.rejects(
    () => fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "failed-1" }),
    /simulated gcloud failure/
  );
  const failedRecord = await fixture.store.get(record.id);
  assert.equal(failedRecord.history.at(-1).status, "failed");

  await assert.rejects(
    () => fixture.executor.execute({ recordId: record.id, previewFingerprint: preview.fingerprint, idempotencyKey: "failed-2" }),
    /simulated gcloud failure/
  );
  assert.equal(fixture.calls.length, 2);
});
