# Product Register

[简体中文](PRODUCT.zh-CN.md) · English

## Product

GCP VM Console is a local operations console for small Google Cloud Compute Engine instances. It uses gcloud as the single control path and keeps account/project selection, instance inventory, deployment preview, maintenance tasks, node deployment, logs, and results in one interface.

## Audience

The primary user is a beginner or intermediate Google Cloud user who wants to create or maintain small instances without memorizing gcloud, SSH, IAP, firewall, and node-deployment commands.

## Product Principles

1. One control model: all cloud actions go through gcloud with explicit configuration, account, project, and location.
2. One inventory: local records and cloud instances appear in the same instance list.
3. One decision point: deployment writes require a current preview and fingerprint.
4. One primary action per context: each page should make the next safe action clear.
5. Local and cloud deletion stay separate.
6. Node deployment is an automated pipeline; stage retry is shown only after failure.
7. Old workflow files are retained only as isolated migration evidence.
8. Read paths are coordinated and deduplicated; performance work must not weaken confirmation, fingerprint, task-lock, or local persistence boundaries.
9. The interface supports English and Simplified Chinese without translating cloud identifiers, commands, or serialized evidence; the selected language is stored locally.

## Pages

- 总览: account/project context, resource summary, selected instance, recent task, next action, and folded cost guidance.
- 实例: unified instance inventory with canonical runtime status, one recommended next step, three non-overlapping action groups, and progressively disclosed technical/node/danger details.
- 部署: new instance, edit instance, and clone-from-existing use one form with core fields visible, a compact network profile, advanced VPC/SSH fields folded, and an execution summary. A new draft defaults to `us-west1` when no valid prior region exists; explicit valid selections are preserved.
- 任务: log-first task workspace with read-only job history, selected task progress, execution summary, and progressively disclosed diagnostics, node links, firewall details, and raw errors.

## Current UI Contract

- Account/project switching is staged first and only commits after project and resource sync succeeds.
- Instance desktop inventory has exactly five columns: instance, location, status, public IPv4, and mode. Account, project, machine, OS, and network details live in the selected inspector.
- The selected-instance header owns only name, runtime state, public IP, and last-check time. Deployment method is not repeated there.
- The selected-instance inspector has one canonical visible owner for each of SSH, BBR, firewall, and service status. Evidence precedence is latest verification, current recognition probe, node result, observed SSH, then pending.
- Deployment method shows one final recognized type or `未识别`; recognition conflicts never become a primary UI state.
- Instance actions have three disjoint owners: configuration (`设置部署 / 修改部署`, clone, applicable node deployment), diagnosis (read-only probe, conditional local adoption, and conditional console-owned firewall repair), and maintenance (restart and system update).
- `vm_only` hides node deployment. Firewall repair has one conditional owner inside governance details; no duplicate standalone firewall action exists.
- Technical details open to exactly three summary rows: deployment recognition, verification issue summary, and one recovery recommendation. Full basic/network/identity attributes, manual classification, and redacted evidence live in one closed-by-default `更多属性` disclosure.
- Node links or 3X-UI panel data, node firewall-rule details, and dangerous actions stay available through separate disclosures without repeating the four canonical statuses.
- Eligible Sing-Box-Plus records expose one compact WARP egress row inside `节点结果`. Its dialog owns explicit status refresh and one confirmed reconnect attempt; it never becomes a fifth canonical status or a maintenance action.
- Deployment exposes public IPv4 mode, Compute Engine Network Tier, and NIC type in one compact visible network profile; VPC/subnet, SSH, labels, tags, and startup script remain in one advanced disclosure. Startup script and all three network choices contribute to the desired-state hash.
- New drafts default to `static + PREMIUM + GVNIC`. Static mode derives an editable regional address resource name, shows unused-address billing risk, and adds address reservation as an explicit preview action. `ephemeral` and `none` remain selectable; Sing-Box-Plus and 3X-UI fail closed when public IPv4 is disabled.
- Static address execution stays inside the existing fingerprint, confirmation, persistent Job, and task lock. It reuses only a reserved address with matching region and Network Tier, never auto-deletes an address after partial failure, and reports the retained resource explicitly.
- Opting into a custom SSH port keeps TCP 22 available through the IAP-only console-owned rule as a rescue path. The custom port is reported as actual only after a successful connection through that port; fallback remains explicit.
- Task logs are always visible at the top of the task page and remain session-only. Structured job history comes next, persists locally under `.gcp-vm-console/jobs`, and is read through `GET /api/jobs`; no job-management write endpoints exist.
- Selected task summary and recovery guidance remain visible. Diagnostics/evidence and node/firewall artifacts are folded by default, and the progress hint follows the selected task type instead of repeating preview-only guidance.
- Terminal jobs are retained for at most 30 days and at most 200 records. Jobs left queued or running across a local service restart become `interrupted`; they never auto-resume and must be confirmed through an existing read-only diagnosis flow.
- Legacy terminal jobs whose stored stage was still active are repaired locally on startup so a completed task cannot reappear as running. This compatibility repair does not issue cloud or SSH requests.
- Confirmation policy is centralized: read-only actions run directly, cloud writes require one confirmation, local dangerous actions require typed confirmation.
- Runtime evidence is field-specific. SSH, BBR, firewall, services, and deployment method each resolve independently using `fresh <= 15m`, `aging <= 6h`, `stale > 6h`, or `unknown` when time is invalid.
- A newer successful read-only probe can replace stale verification evidence. A stale probe cannot replace user-confirmed or persisted deployment intent.
- A failed latest probe is stored separately as `observed.lastProbeAttempt`; it does not erase the last usable verification and the UI marks retained values as historical.
- Read-only SSH diagnosis uses the fixed probe command through native `ssh` and a `gcloud compute start-iap-tunnel` ProxyCommand. It never calls `gcloud compute ssh`, because that command may provision project SSH metadata even when the remote command itself is read-only.
- Outside persisted user/local intent, deployment recognition selects the strongest confidence score. A high-confidence live SSH deep probe therefore outranks a matching medium-confidence cloud label instead of leaving the result artificially at medium confidence.
- Live acceptance is an independent, allowlisted, non-persisting read workflow for `example-singbox-instance` and `example-xui-instance`. It is not a repair or deployment workflow.
- Initial loading is limited to four request waves: health, jobs/accounts, projects, then one parallel context snapshot. Older project responses cannot overwrite the active context.
- `刷新数据` owns the complete context snapshot: records, cloud inventory, regions, free rules, and Doctor. `刷新清单` owns only records, cloud inventory, and the derived Doctor result.
- Static HTML, JavaScript, and CSS use ETag/Last-Modified revalidation and Brotli/gzip. IBM Plex Sans is the only bundled UI font; Chinese text uses platform CJK stacks.
- `/api/health` exposes a deterministic runtime source revision. The local start script compares it before reusing port 8787, so a healthy but stale process is restarted after active server or frontend sources change.
- HTTP bodies are limited to 1 MiB. gcloud commands use classified timeouts and 4 MiB stdout/stderr limits; timeout, output overflow, spawn failure, and command failure remain distinct sanitized errors.
- Ordinary gcloud reads retry only classified transient network/proxy failures, at most three attempts with 500 ms and 1500 ms waits. Writes, SSH, authentication, permission, not-found, timeout, and output-limit failures never retry.
- Live instance inventory is atomically cached per gcloud configuration/account/project for at most seven days and twenty contexts. Cache mode is read-only: browsing, search, diagnosis, local drafts, copy, task history, and local record removal remain available while all cloud-dependent writes are locked.
- Smart diagnosis produces one project-level firewall governance assessment. Every rule records severity, ownership, source/target scope, and affected instances; external rules are advisory only. A critical or high external rule keeps verification `partial` until an effective instance-level isolation result proves that the selected VM is no longer broadly exposed.
- `管理端口与 SSH` is the only network-governance entry. It uses fresh listener evidence to build a 15-minute fingerprinted preview, keeps TCP 22 on IAP with key-plus-password authentication, keeps TCP 45400 public with key authentication, and applies only console-owned allow/deny rules plus one unique instance tag.
- WARP management supports only live-confirmed `warp-svc + WarpProxy + Sing-box SOCKS outbound` deployments. A reconnect may return `changed`, `unchanged`, `restored`, `partial`, or `failed`; an unchanged IPv4 is a successful single attempt and never triggers an automatic second reconnect.
- WARP status and reconnect use fixed native-SSH contracts on the verified key-authenticated port. They never restart the VM, Sing-box, or `warp-svc`, and never change firewall rules, ports, node links, configuration, keys, registration, or tunnel protocol.
- The SSH password is accepted only on first use and stored in a local `0700`/`0600` Secret Store. Password values never enter VM records, jobs, logs, diagnostics, API responses, command arguments, or cloud-visible fields.
- For a managed node, recognized node listeners are selected by default while unknown-process listeners remain off until the user selects them. Deep-probe evidence can never silently expand the executable network-exposure plan.
- Local cache cleanup is an explicit CLI maintenance action. It defaults to dry-run, only removes allowlisted generated caches, and never includes VM records, jobs, node results, credentials, Playwright browsers, or the legacy archive.
- Authoritative documentation may record ports and sanitized outcomes, but it must not retain raw node links, live panel URLs, plaintext credentials, or private-key paths.

## Non-goals

- No hosted multi-user control plane.
- No automatic cloud deletion during migration.
- No load balancer, domain, HTTPS certificate, or Cloudflare automation in this version.
- No broad Google Cloud resource orchestration outside the instance workflow.
- No automatic disable, update, or deletion of external/shared firewall rules such as `ruzhan1` or `default-*`.
