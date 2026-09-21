import { createRouter } from "./router.js";
import { createDoctorService } from "./doctor-service.js";
import { createDeploymentProbeService } from "./deployment-probe-service.js";
import { createFirewallGovernanceService } from "./firewall-governance-service.js";
import { createFirewallService } from "./firewall-service.js";
import { createGuestAttributesService } from "./guest-attributes-service.js";
import { createProxyInspector } from "./proxy-inspector.js";
import { createReadOnlySshProbeRunner } from "./read-only-ssh-probe-runner.js";
import { createRecognitionProbeService } from "./recognition-probe-service.js";
import { createWarpEgressService } from "./warp-egress-service.js";
import { createWarpSshRunner } from "./warp-ssh-runner.js";

export function createServerApp(dependencies = {}) {
  const proxyInspector = dependencies.proxyInspector || createProxyInspector({ baseEnv: dependencies.baseEnv });
  const doctorService = dependencies.doctorService || createDoctorService({
    accountService: dependencies.accountService,
    cloudInventory: dependencies.inventory,
    freeRuleService: dependencies.freeRuleService,
    recordStore: dependencies.recordStore,
    regionCatalog: dependencies.regionCatalog,
    runner: dependencies.runner,
    proxyInspector
  });
  const guestAttributesService = dependencies.guestAttributesService || createGuestAttributesService({
    runner: dependencies.runner
  });
  const deploymentProbeService = dependencies.deploymentProbeService || createDeploymentProbeService({
    runner: dependencies.runner,
    sshProbeRunner: dependencies.readOnlySshProbeRunner || createReadOnlySshProbeRunner()
  });
  const firewallService = dependencies.firewallService || createFirewallService({
    runner: dependencies.runner
  });
  const recognitionProbeService = dependencies.recognitionProbeService || createRecognitionProbeService({
    inventory: dependencies.inventory,
    guestAttributesService,
    deploymentProbeService,
    firewallService
  });
  const firewallGovernanceService = dependencies.firewallGovernanceService || createFirewallGovernanceService({
    inventory: dependencies.inventory,
    firewallService,
    now: dependencies.now
  });
  const secretStore = dependencies.secretStore || {
    async publicStatus() { return { configured: false, versionId: "", updatedAt: "" }; },
    async saveSshPassword() { throw new Error("Local SSH secret store is unavailable."); }
  };
  const networkExposureService = dependencies.networkExposureService || {
    async preview() { throw new Error("Network exposure service is unavailable."); },
    async apply() { throw new Error("Network exposure service is unavailable."); }
  };
  const warpEgressService = dependencies.warpEgressService || createWarpEgressService({
    sshRunner: dependencies.warpSshRunner || createWarpSshRunner(),
    taskLock: dependencies.taskLock,
    now: dependencies.now
  });
  const router = createRouter({
    ...dependencies,
    doctorService,
    guestAttributesService,
    deploymentProbeService,
    firewallService,
    firewallGovernanceService,
    recognitionProbeService,
    networkExposureService,
    warpEgressService,
    secretStore
  });
  return {
    dispatch: router.dispatch
  };
}
