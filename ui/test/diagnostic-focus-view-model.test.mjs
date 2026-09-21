import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnosticEvidenceForFocus,
  diagnosticVmFromResource,
  toDiagnosticFocus
} from "../public/lib/diagnostic-focus-view-model.js";

const managedResource = {
  key: "managed",
  identity: {
    name: "vm-a",
    zone: "us-west1-b"
  },
  cloud: { network: { externalIp: "203.0.113.10" } },
  record: {
    id: "vm-a-123",
    verification: { status: "passed" },
    nodeResult: { type: "singbox_plus", links: [{ url: "tuic://record" }] }
  }
};

const externalResource = {
  key: "external",
  identity: {
    name: "external-cloud-only",
    zone: "europe-west9-b"
  },
  cloud: { network: { externalIp: "203.0.113.9" } },
  record: null
};

const vmAJob = {
  id: "job-vm-a",
  recordId: "vm-a-123",
  type: "node-deploy",
  status: "succeeded",
  result: {
    nodeResult: { type: "singbox_plus", links: [{ url: "tuic://job" }] },
    verification: { status: "partial" }
  }
};

test("resource pages do not mix unrelated task node evidence into cloud-only instance diagnostics", () => {
  const focus = toDiagnosticFocus({
    route: "resources",
    selectedResource: externalResource,
    selectedJob: vmAJob,
    resources: [externalResource, managedResource]
  });
  const evidence = diagnosticEvidenceForFocus(focus);

  assert.equal(focus.resource.identity.name, "external-cloud-only");
  assert.equal(focus.job, null);
  assert.equal(evidence.nodeResult, null);
  assert.equal(evidence.verification, null);
});

test("task page focuses the selected task record instead of stale selected resource", () => {
  const focus = toDiagnosticFocus({
    route: "tasks",
    selectedResource: externalResource,
    selectedJob: vmAJob,
    resources: [externalResource, managedResource]
  });
  const evidence = diagnosticEvidenceForFocus(focus);
  const vm = diagnosticVmFromResource(focus.resource);

  assert.equal(focus.resource.identity.name, "vm-a");
  assert.equal(focus.job.id, "job-vm-a");
  assert.equal(vm.name, "vm-a");
  assert.equal(vm.externalIp, "203.0.113.10");
  assert.equal(evidence.nodeResult.links[0].url, "tuic://record");
  assert.equal(evidence.verification.status, "passed");
});

test("task page does not attach stale selected instance to an unmatched task", () => {
  const focus = toDiagnosticFocus({
    route: "tasks",
    selectedResource: externalResource,
    selectedJob: { ...vmAJob, recordId: "missing-record" },
    resources: [externalResource, managedResource]
  });

  assert.equal(focus.resource, null);
  assert.equal(focus.job.recordId, "missing-record");
  assert.equal(diagnosticVmFromResource(focus.resource), null);
});
