# Function Consolidation Audit

This audit is bound to `ui/public/lib/function-integrity-registry.js`, `ui/server/api-flow-registry.js`, and the matching tests. It documents why visible actions are merged, kept separate, demoted, or blocked inside the existing four-page gcloud-only console.

## Intent Groups

| Intent | Buttons | Decision |
| --- | --- | --- |
| refresh | 刷新数据, 刷新清单 | Same user intent, different scope. Keep one global refresh and one table-local refresh. |
| diagnose | 运行体检, 操作建议, 智能诊断, 接管本地, 更新规则提示, 复制摘要 | Shared diagnostic family. Instance-level 检查状态、重新验证 and 识别/接管 are consolidated behind 智能诊断; 接管本地 appears only after external recognition evidence is available. |
| navigate | 选择账号与项目/打开实例清单, 打开实例清单, 查看任务 | Route-only actions. Keep labels contextual, keep all non-writing. |
| reuse-instance | 设置部署/修改部署, 基于此新建 | Same destination form with different prefill behavior. Group under configuration/reuse. |
| cloud-write | 执行有效预览, 重启实例, 系统更新, applicable node deployment | Keep separate because each has different risk and server task type. All require confirmation. |
| local-write | 保存草稿, 接管本地 | Keep separate because one edits a normal local record and one adopts external evidence. |

## Confirmed Merges

- 刷新数据 remains the primary global refresh. 刷新清单 remains the local instance-list refresh and must stay visually secondary.
- 设置部署/修改部署 and 基于此新建 share the deployment form destination and sit together as configuration/reuse actions.
- Operation guidance may route to existing actions, but it does not create a separate write path or bypass confirmation.
- The instance page has exactly three primary action owners: configuration (edit/clone/applicable deployment), diagnosis (read-only probe/conditional adoption), and maintenance (restart/system update).
- `vm_only` removes node deployment from the visible action set. `查看节点结果` only opens an existing disclosure and never duplicates a grouped action.

## Kept Separate

- 运行体检 stays separate from 智能诊断. Doctor checks local environment readiness, project access, API/cache state, and existing evidence. 智能诊断 chooses the selected-instance path: external recognition for cloud-only instances, verification for local records, and lightweight status evidence through the same guided diagnostic surface.
- 接管本地 stays separate from 智能诊断. Recognition and verification are reads; adoption writes a local record and must remain explicit and confirmed.
- 保存草稿 stays separate from 保存并生成预览. Draft is local-only; preview reads live cloud state and stores a fingerprinted preview.
- 执行有效预览 stays on the task page because it is the cloud-write gate after preview fingerprint creation.
- 接管本地 stays explicit and confirmed because it writes a local adoption record from external evidence.

## Demoted Actions

- 检查状态、重新验证 and 识别/接管 are no longer equal-weight visible buttons. They are internal paths of 智能诊断, so the instance detail surface shows one primary read button plus 接管本地 only when adoption is possible.
- 更新规则提示 is low weight after context is valid. It belongs in folded cost/safety guidance, not in the main operation path.
- 复制摘要 is a utility on the task/diagnostic surface. It should not compete with task execution or instance maintenance.
- 删除云端资源 is visible only as a disabled danger affordance until a separate deletion design exists.
- Technical details, node results, firewall-rule details, recovery guidance, and danger operations are progressively disclosed instead of competing with primary status and actions.

## Canonical Status Ownership

SSH, BBR, firewall, and service status each have one visible primary owner in the selected-instance summary. `instance-detail-view-model.js` resolves every status independently with this precedence:

1. fresh or aging successful verification/read-only probe, selected independently per field
2. timestamped node or observed evidence
3. stale last-known evidence, visibly historical
4. pending/unknown

Freshness is fixed at 15 minutes and 6 hours. A fresh high/medium-confidence SSH deep probe may replace an older deployment conclusion; stale probes cannot replace user-confirmed or persisted intent. The latest failed attempt is recorded separately and recommends `智能诊断` without destroying the last usable verification.

Recognition displays one final method or `未识别`; conflict evidence is not a primary UI state. Detailed ports, rule names, service names, errors, links, panel data, and recovery guidance remain available inside disclosures without adding another status strip. No standalone firewall-write action exists.

The selected-instance header owns name, runtime state, public IP, and checked time only. Deployment method is owned by the technical recognition summary and is no longer duplicated in the header.

Inside technical details, failed checks and matching warning strings are normalized in the view model, but the primary UI exposes only the issue count and highest-priority issue. Recovery exposes one read-first or guarded-action recommendation as non-clickable text. Machine, network, identity, manual classification, and redacted evidence are available only through `更多属性`; the only clickable operation controls remain in configuration, diagnosis, maintenance, and danger ownership groups.

## No-Go Boundaries

- 删除云端资源 remains 未开放. No cloud delete endpoint, handler, or gcloud delete command may be added by this consolidation pass.
- Read actions must not call cloud-write endpoints.
- Local writes must not call gcloud write commands.
- Cloud writes must retain confirmation and existing task lock/fingerprint boundaries.
- Recognition and adoption must not store raw node links, panel passwords, private keys, tokens, or credentials in logs, diagnostics, cloud-visible fields, or local recognition evidence.
- The UI remains four routes only: 总览, 实例, 部署, 任务.

## Verification Matrix

| Evidence | File/Test | Coverage |
| --- | --- | --- |
| Visible button to intent/page/write scope | `ui/public/lib/function-integrity-registry.js`, `ui/test/function-integrity-registry.test.mjs` | Every static button has one registry row, readiness row, policy or registry boundary, and handler reference. |
| API read/write safety | `ui/server/api-flow-registry.js`, `ui/test/api-flow-registry.test.mjs` | Every active endpoint has method, normalized path, write scope, confirmation expectation, and service owner. |
| Confirmation policy | `ui/public/lib/action-policy.js`, `ui/test/action-policy.test.mjs` | Governed read/write/danger actions retain confirmation behavior and fail closed on unknown governed IDs. |
| Button readiness | `ui/public/lib/action-readiness-view-model.js`, `ui/test/action-readiness-view-model.test.mjs` | Buttons expose label, enabled state, disabled reason, kind, and confirmation state. |
| Four-page UI boundary | `ui/public/index.html`, `ui/test/gcloud-only-ui-structure.test.mjs` | No new route is introduced by action consolidation. |
| Diagnostic focus isolation | `ui/public/lib/diagnostic-focus-view-model.js`, `ui/test/diagnostic-focus-view-model.test.mjs` | Resource diagnostics cannot display unrelated task node evidence; task diagnostics focus the selected task's matching record. |
| Layout audit fixture integrity | `ui/test/browser-layout-audit.mjs`, `ui/test/browser-layout-audit-fixtures.test.mjs` | Long-link stress content is injected only after selecting the managed fixture, so screenshots do not imply cloud-only unknown instances have generated links. |
| Canonical instance detail | `ui/public/lib/instance-detail-view-model.js`, `ui/test/instance-detail-view-model.test.mjs` | Fixed status order, evidence precedence, final deployment type, recommendation, action ownership, and secret-free disclosure summaries. |
| Distilled technical details | `ui/public/lib/instance-technical-details-view-model.js`, `ui/test/instance-technical-details-view-model.test.mjs` | Exactly three primary summaries, grouped secondary attributes, single recovery recommendation, and redacted recognition/verification evidence. |
| Evidence freshness and arbitration | `ui/public/lib/instance-evidence-freshness-view-model.js`, `ui/test/instance-evidence-freshness-view-model.test.mjs` | Exact boundary behavior, per-field arbitration, failed-attempt retention, historical tone, and secret exclusion. |
| Read-only live acceptance | `ui/server/read-only-command-guard.js`, `ui/scripts/readonly-live-acceptance.mjs`, matching tests | Exact target allowlist, command allowlist, no persistence, sanitized output, drift reporting, and record-hash comparison. |
| Responsive and duplicate audit | `ui/test/browser-layout-audit.mjs`, `ui/test/full-function-scenario-matrix.test.mjs` | Unique visible statuses/actions, desktop/tablet/mobile geometry, probe-state update, partial/failed verification, long-value containment, and cancellation safety. |
