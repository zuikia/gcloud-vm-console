import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_PROFILE_RECOMMENDED,
  deriveStaticAddressName,
  normalizeNetworkProfile,
  toNetworkProfileView
} from "../public/lib/network-profile.js";

test("recommended network profile selects Premium static IPv4 and GVNIC", () => {
  assert.deepEqual(NETWORK_PROFILE_RECOMMENDED, {
    externalIpMode: "static",
    networkTier: "PREMIUM",
    nicType: "GVNIC"
  });

  const profile = normalizeNetworkProfile(NETWORK_PROFILE_RECOMMENDED, { instanceName: "jp-osaka-singbox-01" });
  assert.deepEqual(profile, {
    name: "default",
    subnet: "default",
    externalIpMode: "static",
    networkTier: "PREMIUM",
    nicType: "GVNIC",
    addressName: "jp-osaka-singbox-01-ip"
  });
});

test("static address names remain valid at the Compute Engine length boundary", () => {
  assert.equal(deriveStaticAddressName("vm-a"), "vm-a-ip");
  const longName = `a${"b".repeat(61)}c`;
  const addressName = deriveStaticAddressName(longName);
  assert.match(addressName, /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/);
  assert.ok(addressName.length <= 63);
  assert.ok(addressName.endsWith("-ip"));
});

test("network profile validates explicit tier mode NIC and address name", () => {
  assert.throws(() => normalizeNetworkProfile({ externalIpMode: "public" }), /externalIpMode/);
  assert.throws(() => normalizeNetworkProfile({ networkTier: "FAST" }), /networkTier/);
  assert.throws(() => normalizeNetworkProfile({ nicType: "ENA" }), /nicType/);
  assert.throws(
    () => normalizeNetworkProfile({ externalIpMode: "static", addressName: "Invalid_Name" }, { instanceName: "vm-a" }),
    /addressName/
  );
});

test("network profile view fails closed when a node deployment has no public IPv4", () => {
  const view = toNetworkProfileView({
    externalIpMode: "none",
    networkTier: "PREMIUM",
    nicType: "GVNIC"
  }, {
    instanceName: "vm-a",
    deployMethod: "singbox_plus"
  });

  assert.equal(view.valid, false);
  assert.match(view.reason, /公网 IPv4/);
  assert.equal(view.tierDisabled, true);
  assert.equal(view.addressVisible, false);
});

test("network profile view summarizes the selected create behavior", () => {
  const view = toNetworkProfileView({
    externalIpMode: "static",
    networkTier: "STANDARD",
    nicType: "VIRTIO_NET",
    addressName: "vm-a-static"
  }, { instanceName: "vm-a", deployMethod: "vm_only" });

  assert.equal(view.valid, true);
  assert.match(view.summary, /Standard/);
  assert.match(view.summary, /静态 IPv4/);
  assert.match(view.summary, /VirtIO/);
  assert.match(view.hint, /vm-a-static/);
});
