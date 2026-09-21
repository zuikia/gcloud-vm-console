function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function required(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function coreProperties(configuration = {}) {
  return configuration.properties?.core || {};
}

function normalizeConfiguration(configuration = {}) {
  const core = coreProperties(configuration);
  const name = normalizeString(configuration.name);
  return {
    name,
    configuration: name,
    account: normalizeLower(core.account),
    projectId: normalizeLower(core.project),
    isActive: configuration.is_active === true || configuration.is_active === "true" || configuration.is_active === "True",
    credentialStatus: "unknown"
  };
}

function normalizeProject(project = {}) {
  return {
    projectId: normalizeLower(project.projectId),
    name: normalizeString(project.name),
    lifecycleState: normalizeString(project.lifecycleState || "ACTIVE")
  };
}

function isCredentialRepairError(error) {
  return /reauth|re-auth|login|credential|permission|invalid_grant|expired/i.test(error?.message || "");
}

export function createAccountService({ runner } = {}) {
  if (!runner?.runJson) throw new Error("runner with runJson() is required.");
  const reads = createSingleFlight();

  function listConfigurations() {
    return reads.run("configurations", async () => {
    const result = await runner.runJson(["config", "configurations", "list"], {
      contextScope: "local",
      allowGlobal: true
    });
    return (result.data || [])
      .map(normalizeConfiguration)
      .filter((configuration) => configuration.name);
    });
  }

  function listProjects({ configuration, account } = {}) {
    const context = {
      configuration: required(configuration, "configuration"),
      account: required(account, "account")
    };
    const key = `projects:${context.configuration}:${context.account}`;
    return reads.run(key, async () => {
      const result = await runner.runJson(["projects", "list"], {
        context,
        contextScope: "account",
        allowGlobal: true
      });
      return (result.data || [])
        .map(normalizeProject)
        .filter((project) => project.projectId && project.lifecycleState === "ACTIVE")
        .sort((a, b) => a.projectId.localeCompare(b.projectId));
    });
  }

  async function checkCredential({ configuration, account } = {}) {
    const context = {
      configuration: required(configuration, "configuration"),
      account: required(account, "account")
    };
    try {
      const result = await runner.runJson(["auth", "list", `--filter=account=${context.account}`], {
        context,
        contextScope: "account",
        allowGlobal: true
      });
      const matching = (result.data || []).find((entry) => normalizeLower(entry.account) === normalizeLower(context.account));
      if (!matching) return { status: "login_required", message: "gcloud account is not logged in." };
      const status = normalizeString(matching.status || matching.Status).toUpperCase();
      return status === "ACTIVE"
        ? { status: "active", message: "gcloud account is active." }
        : { status: "login_required", message: "gcloud account is not active." };
    } catch (error) {
      if (isCredentialRepairError(error)) {
        return { status: "reauth_required", message: error.message };
      }
      throw error;
    }
  }

  function loginCommandPlan({ configuration } = {}) {
    const config = required(configuration, "configuration");
    return {
      steps: [
        {
          title: "创建或确认 gcloud 配置",
          command: ["gcloud", "config", "configurations", "create", config]
        },
        {
          title: "浏览器登录 Google 账号",
          command: ["gcloud", "auth", "login", `--configuration=${config}`]
        }
      ]
    };
  }

  return { checkCredential, listConfigurations, listProjects, loginCommandPlan };
}
import { createSingleFlight } from "./single-flight.js";
