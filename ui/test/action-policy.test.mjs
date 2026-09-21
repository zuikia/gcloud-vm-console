import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACTION_POLICY,
  confirmationCopy,
  policyForAction
} from "../public/lib/action-policy.js";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

const readActions = ["reloadAccounts", "refreshAll", "refreshResources", "smartDiagnoseInstance", "doctorRunBtn", "copyDiagnosticSummary", "auditFreeRules", "clearLog", "refreshWarpStatus"];
const localWriteActions = ["saveNetworkExposurePreview"];
const writeActions = ["executePreview", "restartVm", "systemUpdate", "deployNodes", "adoptLocalInstance", "reconnectWarpEgress"];
const typedWriteActions = ["applyNetworkExposure"];
const dangerActions = ["deleteLocalRecord", "deleteCloudResource"];
const allActions = [...readActions, ...localWriteActions, ...writeActions, ...typedWriteActions, ...dangerActions];

test("every governed action has exactly one DOM button", () => {
  for (const id of allActions) {
    const matches = [...index.matchAll(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`, "g"))];
    assert.equal(matches.length, 1, `${id} should exist once in index.html`);
  }
});

test("action policy covers read write and danger groups", () => {
  assert.deepEqual(Object.keys(ACTION_POLICY).sort(), allActions.toSorted());

  for (const id of readActions) {
    assert.equal(policyForAction(id).kind, "read", `${id} should be read-only`);
    assert.equal(policyForAction(id).confirmation, "none", `${id} should not require confirmation`);
  }

  for (const id of localWriteActions) {
    assert.equal(policyForAction(id).kind, "local-write", `${id} should be a local sensitive write`);
    assert.equal(policyForAction(id).confirmation, "none", `${id} should not use a cloud confirmation`);
  }

  for (const id of writeActions) {
    assert.equal(policyForAction(id).kind, "write", `${id} should be a cloud write action`);
    assert.equal(policyForAction(id).confirmation, "confirm", `${id} should require one confirmation`);
  }

  for (const id of typedWriteActions) {
    assert.equal(policyForAction(id).kind, "write", `${id} should be a cloud write action`);
    assert.equal(policyForAction(id).confirmation, "typed", `${id} should require typed verification`);
    assert.match(policyForAction(id).verificationPhrase, /^APPLY /);
  }

  for (const id of dangerActions) {
    assert.equal(policyForAction(id).kind, "danger", `${id} should be danger`);
    assert.equal(policyForAction(id).confirmation, "typed", `${id} should require typed verification`);
    assert.match(policyForAction(id).verificationPhrase, /^ALLOW /);
  }
});

test("confirmation copy is Chinese and states impact billing or interruption", () => {
  const writeCopy = confirmationCopy("deployNodes", { vmName: "vm-a" });
  assert.equal(writeCopy.title, "部署方式未确认");
  assert.match(writeCopy.impact, /vm-a|所选实例/);
  assert.match(writeCopy.risk, /防火墙|端口|网络|费用/);
  assert.match(writeCopy.confirmLabel, /确认/);
  assert.equal(writeCopy.verificationPhrase, "");

  const previewCopy = confirmationCopy("executePreview", { vmName: "fr-paris-singbox-01" });
  assert.match(previewCopy.impact, /「fr-paris-singbox-01」/);

  const staticPreviewCopy = confirmationCopy("executePreview", {
    vmName: "jp-osaka-singbox-01",
    networkPlan: {
      externalIpMode: "static",
      networkTier: "PREMIUM",
      nicType: "GVNIC",
      addressName: "jp-osaka-singbox-01-ip"
    }
  });
  assert.match(staticPreviewCopy.impact, /Premium/);
  assert.match(staticPreviewCopy.impact, /静态 IPv4/);
  assert.match(staticPreviewCopy.impact, /GVNIC/);
  assert.match(staticPreviewCopy.impact, /jp-osaka-singbox-01-ip/);
  assert.match(staticPreviewCopy.risk, /静态.*费用|费用.*静态/);

  const dangerCopy = confirmationCopy("deleteLocalRecord", { vmName: "vm-a" });
  assert.match(dangerCopy.title, /移除本地记录/);
  assert.match(dangerCopy.impact, /不会删除云端实例/);
  assert.match(dangerCopy.risk, /本地|记录|恢复/);
  assert.equal(dangerCopy.verificationPhrase, "ALLOW vm-a");

  const verifyCopy = confirmationCopy("smartDiagnoseInstance", { vmName: "vm-a" });
  assert.match(verifyCopy.impact, /不会修改云端资源/);
  assert.match(verifyCopy.risk, /不会创建、重启、停止、删除或部署实例/);

  const doctorCopy = confirmationCopy("doctorRunBtn");
  assert.match(doctorCopy.impact, /只读/);
  assert.match(doctorCopy.risk, /不会产生费用/);

  const adoptCopy = confirmationCopy("adoptLocalInstance", { vmName: "vm-fr" });
  assert.match(adoptCopy.title, /接管为本地记录/);
  assert.match(adoptCopy.impact, /只写入本地记录/);
  assert.match(adoptCopy.risk, /不会修改云端/);

  const firewallCopy = confirmationCopy("applyNetworkExposure", {
    vmName: "vm-a",
    networkExposurePreview: {
      desiredExposure: { public: [{ protocol: "tcp", port: "45400" }, { protocol: "udp", port: "25737" }] },
      isolation: { targetTag: "gvc-isolate-a", allowPriority: 998, denyPriority: 999 }
    }
  });
  assert.match(firewallCopy.impact, /tcp\/45400/);
  assert.match(firewallCopy.impact, /udp\/25737/);
  assert.match(firewallCopy.impact, /gvc-isolate-a/);
  assert.match(firewallCopy.impact, /998\/999/);
  assert.match(firewallCopy.risk, /不会修改外部共享规则/);
  assert.equal(firewallCopy.confirmLabel, "确认应用");
  assert.equal(firewallCopy.verificationPhrase, "APPLY vm-a");
});

test("deploy confirmation copy names the concrete deployment pipeline", () => {
  const singbox = confirmationCopy("deployNodes", {
    vmName: "vm-a",
    deployMethod: "singbox_plus"
  });
  assert.equal(singbox.title, "部署 Sing-Box-Plus");
  assert.match(singbox.impact, /Sing-Box-Plus/);

  const xui = confirmationCopy("deployNodes", {
    vmName: "vm-b",
    deployMethod: "three_x_ui"
  });
  assert.equal(xui.title, "部署 3X-UI");
  assert.match(xui.impact, /3X-UI/);

  const custom = confirmationCopy("deployNodes", {
    vmName: "vm-c",
    deployMethod: "custom_startup"
  });
  assert.equal(custom.title, "运行自定义脚本");
  assert.match(custom.impact, /自定义脚本/);
});

test("unknown actions fail closed and app does not use window.confirm", () => {
  assert.throws(() => policyForAction("missingAction"), /Unknown action policy/);
  assert.doesNotMatch(app, /window\.confirm|[^.]confirm\(/);
});

test("WARP status is explicit read-local-write and reconnect uses one normal confirmation", () => {
  assert.equal(policyForAction("refreshWarpStatus").kind, "read");
  assert.equal(policyForAction("refreshWarpStatus").confirmation, "none");
  assert.equal(policyForAction("reconnectWarpEgress").kind, "write");
  assert.equal(policyForAction("reconnectWarpEgress").confirmation, "confirm");
  const copy = confirmationCopy("reconnectWarpEgress", { vmName: "jp-osaka-singbox-01", affectedCount: 2 });
  assert.match(copy.impact, /2 个 WARP 节点/);
  assert.match(copy.risk, /10.*60 秒/);
  assert.match(copy.risk, /直连节点.*SSH.*节点链接/);
});
