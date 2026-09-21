# gcloud-only traceability

This document records the public safety contracts and their automated test
owners. It intentionally contains no live account, project, VM, IP, credential,
or production acceptance data.

| Contract | Implementation | Test coverage |
| --- | --- | --- |
| Explicit gcloud account/project context | `ui/server/gcloud-runner.js`, `ui/server/account-service.js` | `account-service.test.mjs`, `gcloud-runner.test.mjs` |
| Read-only inventory and diagnosis | `ui/server/cloud-inventory.js`, `ui/server/doctor-service.js` | `cloud-inventory.test.mjs`, `doctor-service.test.mjs` |
| Metadata-safe SSH probe | `ui/server/read-only-ssh-probe-runner.js`, `ui/server/read-only-command-guard.js` | `read-only-ssh-probe-runner.test.mjs`, `read-only-command-guard.test.mjs` |
| Preview fingerprint and task lock | `ui/server/change-planner.js`, `ui/server/change-executor.js`, `ui/server/task-lock.js` | `change-planner.test.mjs`, `change-executor.test.mjs`, `task-lock.test.mjs` |
| Local secret boundary | `ui/server/local-secret-store.js` | `local-secret-store.test.mjs`, `documentation-secret-boundary.test.mjs` |
| Firewall ownership and fail-closed governance | `ui/server/firewall-service.js`, `ui/server/firewall-governance-service.js` | `firewall-service.test.mjs`, `firewall-governance-service.test.mjs` |
| Persistent task history and interrupted recovery | `ui/server/job-store.js`, `ui/public/lib/task-view-model.js` | `job-store.test.mjs`, `task-view-model.test.mjs` |
| UI action ownership and confirmation | `ui/public/lib/action-policy.js`, `ui/public/lib/action-readiness-view-model.js` | `action-policy.test.mjs`, `action-readiness-view-model.test.mjs` |
| Redacted diagnostics and node evidence | `ui/public/lib/diagnostic-summary-view-model.js`, `ui/public/lib/node-result-view-model.js` | `diagnostic-summary-view-model.test.mjs`, `node-result-view-model.test.mjs` |

## Test boundary

The automated suite uses fake runners, mock responses, reserved documentation
addresses, and temporary local directories. It does not create, modify, stop,
restart, delete, or deploy resources in a real cloud project.
