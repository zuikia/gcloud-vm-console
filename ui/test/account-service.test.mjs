import assert from "node:assert/strict";
import test from "node:test";

import { createAccountService } from "../server/account-service.js";

function createFakeRunner(responses = []) {
  const calls = [];
  return {
    calls,
    runner: {
      async runJson(command, options) {
        calls.push({ command, options });
        const response = responses.shift();
        if (response?.error) throw response.error;
        return { data: response?.data ?? [] };
      }
    }
  };
}

test("account service lists local gcloud configurations without activating global state", async () => {
  const fake = createFakeRunner([{
    data: [
      {
        name: "acct-a",
        is_active: true,
        properties: { core: { account: "User@Example.com", project: "project-a" } }
      },
      {
        name: "acct-b",
        is_active: false,
        properties: { core: { account: "other@example.com" } }
      }
    ]
  }]);
  const service = createAccountService({ runner: fake.runner });

  const configurations = await service.listConfigurations();

  assert.deepEqual(configurations, [
    {
      name: "acct-a",
      configuration: "acct-a",
      account: "user@example.com",
      projectId: "project-a",
      isActive: true,
      credentialStatus: "unknown"
    },
    {
      name: "acct-b",
      configuration: "acct-b",
      account: "other@example.com",
      projectId: "",
      isActive: false,
      credentialStatus: "unknown"
    }
  ]);
  assert.deepEqual(fake.calls[0], {
    command: ["config", "configurations", "list"],
    options: { contextScope: "local", allowGlobal: true }
  });
  assert.equal(fake.calls.some((call) => call.command.includes("activate")), false);
});

test("account service lists projects through an account-scoped gcloud context", async () => {
  const fake = createFakeRunner([{
    data: [
      { projectId: "project-b", name: "Project B", lifecycleState: "ACTIVE" },
      { projectId: "project-a", name: "Project A", lifecycleState: "ACTIVE" },
      { projectId: "deleted-a", name: "Deleted", lifecycleState: "DELETE_REQUESTED" }
    ]
  }]);
  const service = createAccountService({ runner: fake.runner });

  const projects = await service.listProjects({ configuration: "acct-a", account: "user@example.com" });

  assert.deepEqual(projects.map((project) => project.projectId), ["project-a", "project-b"]);
  assert.deepEqual(fake.calls[0], {
    command: ["projects", "list"],
    options: {
      context: { configuration: "acct-a", account: "user@example.com" },
      contextScope: "account",
      allowGlobal: true
    }
  });
});

test("account service reports credential repair without ADC language", async () => {
  const fake = createFakeRunner([{ error: new Error("Reauthentication required for user@example.com") }]);
  const service = createAccountService({ runner: fake.runner });

  const status = await service.checkCredential({ configuration: "acct-a", account: "user@example.com" });
  const login = service.loginCommandPlan({ configuration: "acct-a" });
  const renderedCommands = login.steps.map((step) => step.command.join(" ")).join("\n");

  assert.equal(status.status, "reauth_required");
  assert.match(status.message, /Reauthentication required/);
  assert.doesNotMatch(renderedCommands, /application-default|ADC/i);
  assert.match(renderedCommands, /gcloud auth login --configuration=acct-a/);
});

test("account service coalesces identical concurrent configuration reads", async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const service = createAccountService({
    runner: {
      async runJson() {
        calls += 1;
        await pending;
        return { data: [{ name: "acct-a", properties: { core: { account: "user@example.com" } } }] };
      }
    }
  });

  const first = service.listConfigurations();
  const second = service.listConfigurations();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
});
