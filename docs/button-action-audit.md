# Button Action Audit

## Action Readiness Contract

`ui/public/lib/action-readiness-view-model.js` is the front-end source of truth for button enabled state, labels, disabled reasons, and confirmation expectations. `ui/public/lib/action-policy.js` remains the final confirmation and safety policy for governed read/write/danger actions.

Browser audit opens write and danger confirmations and cancels them to prove no write is sent before explicit confirmation.

## Function Integrity Registry

`ui/public/lib/function-integrity-registry.js` is the static audit source for every visible button's page, surface, user intent, method-qualified API references, write scope, and priority. `ui/test/function-integrity-registry.test.mjs` cross-checks that registry against the DOM button IDs, readiness IDs, confirmation policy or registry policy, handler references in `ui/public/app.js`, and the backend API flow registry.

The registry does not replace `action-policy.js`. It complements confirmation policy with non-dialog boundaries such as route navigation, local-only writes, read-plus-local-result writes, disabled cloud deletion, and compact low-priority actions.

## Consolidation Result

`docs/function-consolidation-audit.md` records the current merge/keep/demote decisions. The instance detail UI now groups existing buttons under compact, non-overlapping operation clusters instead of a flat button wall:

- `配置操作`: `设置部署 / 修改部署`, `基于此新建`, and the applicable node deployment action
- `智能诊断`: `运行只读探测 / 重新探测` and conditional `接管本地`
- `维护操作`: `重启实例`, `系统更新`
- progressively disclosed network governance: one `管理端口与 SSH` entry inside `更多属性`
- conditional WARP egress management: one `管理` entry inside `节点结果`
- recommendation-only local disclosure: `查看节点结果`
- folded `危险操作`: local record removal and disabled cloud deletion

`ui/public/lib/operation-hub-view-model.js` derives the primary action and low-priority demotions from current readiness state. `ui/test/full-function-scenario-matrix.test.mjs` covers beginner-critical states including no context, failed sync, external recognition/adoption, preview readiness, partial verification, clipboard fallback, and long values.

The selected-instance header has one canonical visible owner for SSH, BBR, firewall, and service status. `ui/public/lib/instance-detail-view-model.js` resolves each status independently using latest verification, current recognition probe, node result, observed SSH, then pending. Node and verification renderers may retain detailed rules, ports, errors, links, and recovery guidance inside disclosures, but they do not render a second summary strip.

## 总览

| Button | Effect | Cloud write | Confirmation |
| --- | --- | --- | --- |
| 重新读取 | Reloads local gcloud configurations and accessible projects with busy feedback | No | No |
| 切换到此项目 | Resets stale VM/preview state and sets UI context only | No | No |
| 打开实例清单 / 查看当前实例 | Opens the unified instance inventory | No | No |
| 打开实例清单 | Opens instance inventory from the current-instance panel | No | No |
| 查看任务 | Opens the task page | No | No |
| 运行体检 | Reads local gcloud account/project state, required API state, free-rule/cache state, inventory sync, and local verification evidence; displays compact read-only guidance | No | No |
| 更新规则提示 | Fetches Google official free-tier documentation, updates `.gcp-vm-console/cache/free-rules.json`, and refreshes local cost/free-region guidance | Local cache write only | No |

The overview has one route-only `下一步` owner. It sends users to the existing instance page; diagnosis remains owned by `智能诊断`, so the overview cannot duplicate or bypass that action's readiness and safety policy.

体检证据进入 UI 前会经过 `ui/public/lib/doctor-view-model.js` 脱敏，节点链接和 token/password/key 类字段不会原样显示。

## Top Bar

| Button | Effect | Cloud write | Confirmation |
| --- | --- | --- | --- |
| 刷新数据 | Reloads records, cloud inventory, region catalog, free-rule cache, and Doctor in one parallel context snapshot | No | No |
| 新建实例 | Resets stale form/preview state and opens configuration | No | No |

## 实例

| Button | Effect | Cloud write | Confirmation |
| --- | --- | --- | --- |
| 刷新清单 | Reloads records, cloud inventory, and derived Doctor state only; it does not reload region or free-rule catalogs | No | No |
| 资源行 | Selects instance only | No | No |
| 设置部署 / 修改部署 | Opens selected instance in the shared deployment form; label reflects whether a local record exists | No | No |
| 基于此新建 | Opens config form with copied basics | No | No |
| 运行只读探测 / 重新探测 | For local records, verifies SSH, services, ports, BBR, and firewall state. For cloud-only instances, reads safe labels/metadata, Guest Attributes, and SSH probe evidence to identify deployment method. | No cloud write; local result write only | No |
| 接管本地 | Saves the selected external cloud instance as a local JSON record using recognized or user-confirmed deployment method | No cloud write; local record write only | Yes |
| 管理端口与 SSH | Opens the compact local governance dialog. Opening it sends no API request and does not change the VM. | No | No |
| 保存密码并生成预览 / 生成端口预览 | On first use, stores the entered password in the local Secret Store without readback, then reads live instance/firewall state and persists a 15-minute SHA-256 preview. | Local sensitive write and cloud reads only | No cloud confirmation |
| 应用端口策略 | Revalidates the preview, configures the two SSH authentication paths, and applies only console-owned allow/deny rules plus the unique selected-instance tag. External rules never enter the execution list. | Yes | Typed confirmation |
| 重启实例 | Stops and starts selected VM | Yes | Yes |
| 系统更新 | Runs staged package update over IAP SSH | Yes | Yes |
| 部署 Sing-Box-Plus / 部署 3X-UI / 运行自定义脚本 | Runs the applicable selected deployment pipeline and firewall sync. `只开实例` hides this action rather than showing a disabled placeholder. | Yes | Yes |
| 查看节点结果 | Opens the existing node-results disclosure when links or 3X-UI panel data are available; it does not call an API | No | No |
| 管理 WARP 出口 | Opens the compact WARP dialog from the single row inside node results; opening sends no API or SSH request | No | No |
| 重新检测 | Runs the fixed WARP status SSH contract and stores only sanitized `observed.warp` evidence | Remote read and local result write only | No |
| 重连并尝试换 IP / 恢复 WARP 连接 / 再试一次 | Runs exactly one fixed WARP reconnect cycle, verifies the resulting exit, and writes a persistent task | Remote WARP service write only; no Google Cloud mutation | Yes |
| 移除本地记录 | Deletes local JSON record only | No | Danger section |
| 删除云端资源 | Disabled pending explicit delete design | Yes when implemented | Required |

Recovery guidance shown under verification results is explanatory only. It points to `智能诊断` or the current deployment method, but it does not add a new cloud action and does not bypass existing confirmation policy.

When inventory source is `cache` or same-session `memory`, create/configure, preview execution, node deployment, restart, system update, network-exposure preview, and network-exposure apply are disabled with one shared reason. Read-only diagnosis, browsing, search, copy, task history, local drafts, local adoption, and local record removal remain available.

## 配置

The visible network profile owns public IPv4 mode (`静态 / 临时 / 不分配`), Network Tier (`Premium / Standard`), and NIC type (`GVNIC / VirtIO`). These are form controls, not additional actions. Every change invalidates the existing preview. Static mode reveals one address-name field; Sing-Box-Plus and 3X-UI with no public IPv4 disable both save actions with one reason.

| Button | Effect | Cloud write | Confirmation |
| --- | --- | --- | --- |
| 保存草稿 | Writes local VM record | No | No |
| 保存并生成预览 | Saves local record and reads live state | No | No |

## 任务

| Button | Effect | Cloud write | Confirmation |
| --- | --- | --- | --- |
| 执行有效预览 | Runs the validated preview if the fingerprint matches. Static mode first validates or reserves the named regional address, then creates the VM; an address retained after partial failure is reported and never auto-deleted. | Yes | Preview gate |
| 清空 | Clears local log view | No | No |
| 复制摘要 | Copies a redacted local diagnostic summary for the selected instance/task; uses 复制备用 via a hidden textarea when browser clipboard permission is denied | No | No |

Task history is a persistent local read surface, not a management surface. A task recovered after service restart is shown as `服务中断`, never auto-resumed, and points only to the existing read-only diagnosis flow. It does not add a retry, delete, export, or restore button.

All asynchronous buttons use the same busy/disabled state and toast feedback. Editing any configuration field invalidates the previous executable preview.

`ui/public/lib/diagnostic-focus-view-model.js` prevents cross-instance diagnostics: instance pages show only evidence for the selected instance, and the task page focuses the selected task's matching record when one exists.

Every visible button maps to one user intent, readiness entry, policy or registry boundary, handler, and test row. `ui/test/write-safety-static.test.mjs` verifies the runtime has no browser-native confirmation shortcut, no cloud delete route/command pattern, and no external firewall mutation path. `ui/test/browser-layout-audit.mjs` opens write or danger confirmations and cancels them for execute preview, restart, system update, deploy nodes, network-exposure apply, WARP reconnect, local record removal, and local adoption.

WARP `管理` is route-local and never probes automatically. `重新检测` is enabled only for a local WARP candidate with verified key SSH. The reconnect action additionally requires current supported WARP evidence, a live inventory, a free per-instance lock, and normal confirmation. Canceling confirmation produces zero WARP API calls; `unchanged` changes the next label to `再试一次` but never schedules another attempt.

The registry records API references as `METHOD /path`. This is required because read and local-write flows may share the same path, such as `GET /api/vm-records` and `POST /api/vm-records`. Scope compatibility tests reject a button that references an API outside its declared read/local/cloud boundary.

## 外部实例识别与接管

`智能诊断` is read-only from the cloud perspective. For cloud-only instances it may call `POST /api/cloud-instances/adoption-preview`, which reads cloud inventory, Guest Attributes, metadata-safe SSH probe evidence, and one project firewall list. For local records it may call the verification path. Both use native `ssh` through `gcloud compute start-iap-tunnel`; `gcloud compute ssh` is forbidden because it may provision project SSH metadata. Diagnosis must not mutate cloud labels, metadata, guest attributes, firewall rules, or services; the local verification path may persist only its local task and verification result.

`接管本地` calls `POST /api/cloud-instances/adopt-local`. This is a local write only. It requires confirmation, rejects raw node links/password-like evidence, and requires manual method confirmation for unknown, conflicting, or low-confidence results.

The mode column and detail card must show `未识别` for cloud-only instances without evidence. They must not default those instances to `只开实例`.

## 防火墙治理

Governance appears only inside the existing `更多属性` disclosure. The top firewall tile remains the single canonical status owner. The governance rows show risk, affected instance count, and handling boundary, with at most three rule names plus `+N`.

`管理端口与 SSH` is shown once for a local record. The dialog defaults recognized node listeners on and unknown-process listeners off; loopback, stopped, invalid, and older-than-15-minute evidence is never executable. TCP 45400 public and TCP 22 IAP are fixed policy entries.

Only one primary step is visible in the dialog. Before a valid preview it stores the first-use local password when needed and generates the preview; after a valid preview it becomes `应用端口策略`. Applying requires typed confirmation, a matching SHA-256 fingerprint, a persistent Job, and the per-instance task lock. Canceling typed confirmation sends zero API requests. Unknown priority, tag collision, stale evidence, cache mode, or changed live state fails closed.

Execution first creates the console-owned allow rules and a disabled deny, then adds the unique tag. With those safe paths prepared, it configures both SSH listeners, verifies 45400 before tightening 22, independently rechecks public 45400, and enables deny only after that succeeds. Final verification failure disables only the deny owned by that task; it does not delete rules, tags, or external resources. Missing live status, tags, network, priorities, or an external rule-name collision fails closed before any SSH or firewall write.
