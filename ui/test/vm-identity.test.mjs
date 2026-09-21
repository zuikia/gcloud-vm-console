import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudIdentityKey,
  normalizeVmIdentity,
  recordIdForIdentity
} from "../server/vm-identity.js";

test("normalizeVmIdentity returns one explicit account project zone and VM identity", () => {
  assert.deepEqual(
    normalizeVmIdentity({
      configuration: "Acct-Japan",
      account: "USER@Example.COM",
      projectId: "example-project",
      zone: "asia-northeast1-a",
      name: "VM-Japan-01"
    }),
    {
      configuration: "acct-japan",
      account: "user@example.com",
      projectId: "example-project",
      region: "asia-northeast1",
      zone: "asia-northeast1-a",
      name: "vm-japan-01"
    }
  );
});

test("normalizeVmIdentity rejects incomplete or unsafe cloud identities", () => {
  assert.throws(
    () => normalizeVmIdentity({ configuration: "acct-a", account: "user@example.com", projectId: "project-a", zone: "us-west1-b", name: "../vm" }),
    /valid Compute Engine instance name/
  );
  assert.throws(
    () => normalizeVmIdentity({ configuration: "acct-a", account: "", projectId: "project-a", zone: "us-west1-b", name: "vm-a" }),
    /account is required/
  );
  assert.throws(
    () => normalizeVmIdentity({ configuration: "acct-a", account: "user@example.com", projectId: "", zone: "us-west1-b", name: "vm-a" }),
    /projectId is required/
  );
});

test("cloudIdentityKey isolates identical VM names by account project and zone", () => {
  const base = {
    configuration: "acct-a",
    account: "a@example.com",
    projectId: "project-a",
    zone: "us-west1-b",
    name: "shared-name"
  };

  const key = cloudIdentityKey(base);
  assert.equal(key, "a@example.com::project-a::us-west1-b::shared-name");
  assert.notEqual(key, cloudIdentityKey({ ...base, account: "b@example.com", configuration: "acct-b" }));
  assert.notEqual(key, cloudIdentityKey({ ...base, projectId: "project-b" }));
  assert.notEqual(key, cloudIdentityKey({ ...base, zone: "us-central1-a" }));
});

test("recordIdForIdentity is stable readable and path safe", () => {
  const identity = {
    configuration: "acct-a",
    account: "a@example.com",
    projectId: "project-a",
    zone: "us-west1-b",
    name: "vm-japan"
  };

  const id = recordIdForIdentity(identity);
  assert.equal(id, recordIdForIdentity({ ...identity }));
  assert.match(id, /^vm-japan-[a-f0-9]{12}$/);
  assert.doesNotMatch(id, /[\\/@:]/);
});
