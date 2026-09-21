# Console Architecture

## Runtime

`ui/server.js` starts a local HTTP server on `127.0.0.1:8787`, serves `ui/public`, and routes `/api/*` requests into `ui/server/app.js`.

The active frontend is:

- `ui/public/index.html`
- `ui/public/app.js`
- `ui/public/styles.css`
- `ui/public/lib/api-client.js`: normalizes JSON requests, AbortSignal forwarding, and structured public errors.
- `ui/public/lib/request-coordinator.js`: reuses matching in-flight reads and blocks stale context generations from committing.
- `ui/public/lib/task-workspace-controller.js`: owns durable task selection, newest-first history, and storage metadata without adding API routes.
- `ui/public/lib/action-readiness-view-model.js`: derives labels, enabled state, disabled reasons, and confirmation expectations for every visible action button.
- `ui/public/lib/function-integrity-registry.js`: static registry for every visible button's page, intent, surface, API references, write scope, and priority.
- `ui/public/lib/deployment-recognition-view-model.js`: renders compact Chinese deployment recognition state from local/cloud/guest/SSH evidence without exposing secrets.
- `ui/public/lib/diagnostic-focus-view-model.js`: chooses whether diagnostics should focus the selected resource or the selected task record, preventing unrelated task node evidence from appearing under a cloud-only selected instance.
- `ui/public/lib/operation-scenario-view-model.js`: classifies current context, doctor state, selected instance, preview, and task state into stable beginner scenarios.
- `ui/public/lib/operation-guidance-view-model.js`: retains the pure scenario recommendation model for QA; the overview no longer renders a separate proxy-action panel.
- `ui/public/lib/operation-hub-view-model.js`: groups existing buttons into setup, diagnosis, maintenance, deployment, and danger clusters without adding routes or actions.
- `ui/public/lib/diagnostic-summary-view-model.js`: creates redacted copy-safe diagnostic summaries from local UI state, doctor checks, task result, node result, and verification evidence.
- `ui/public/lib/evidence-timeline-view-model.js`: produces compact local evidence steps from doctor, task, verification, and node result state.
- `ui/public/lib/copy-text.js`: performs local text copy with clipboard API and textarea fallback; it does not call backend APIs.
- `ui/public/lib/network-exposure-view-model.js`: derives fresh eligible listener choices, local password status, preview expiry, and the single visible dialog step without retaining password values.
- `ui/public/lib/warp-egress-view-model.js`: derives the conditional WARP row, independent IPv4/IPv6/colo facts, evidence freshness, dynamic primary label, and sanitized reconnect result without retaining node URLs.
- `ui/public/lib/network-profile.js`: normalizes public IPv4 mode, Network Tier, NIC type, and static address names for both browser and server code, including node-mode fail-closed validation.

## Backend Modules

- `gcloud-runner.js`: executes gcloud as argument arrays with explicit context and location; ordinary transient reads are capped at three attempts while writes, SSH, permission/auth, not-found, timeout, and output-limit failures never retry.
- `network-error-classifier.js`: classifies and sanitizes proxy listener, proxy upstream, DNS, TLS, rate-limit, timeout, auth, and project-access failures.
- `proxy-inspector.js`: performs a one-second TCP check of the configured local proxy endpoint without changing proxy environment or controlling a proxy application.
- `account-service.js`: lists local gcloud configurations and accessible projects.
- `vm-record-store.js`: stores local VM JSON records under `.gcp-vm-console/records`.
- `cloud-inventory.js`: reads cloud VM snapshots, including external-IP Network Tier and NIC type, through structured gcloud output and falls back only to the exact account/project inventory snapshot when live reads fail.
- `inventory-snapshot-store.js`: stores allowlisted inventory fields under `.gcp-vm-console/cache/inventory` with atomic `0600` files, `0700` directories, seven-day retention, twenty-context limit, and malformed-file quarantine.
- `deployment-recognition.js`: pure recognition model for canonical deployment methods, evidence priority, confidence, managed state, warnings, and suggested next action.
- `guest-attributes-service.js`: read-only `gcloud compute instances get-guest-attributes` reader for the `gcp-vm-console` namespace; unavailable or permission-denied states are non-fatal warnings.
- `read-only-ssh-probe-runner.js`: executes only the fixed probe command through native `ssh` and an IAP `start-iap-tunnel --listen-on-stdin` ProxyCommand. It never invokes `gcloud compute ssh`, so diagnosis cannot provision project SSH metadata.
- `deployment-probe-service.js`: parses bounded service, port, file, process, container, version, config-summary, and BBR evidence from the metadata-safe SSH runner; SSH failure returns unverified evidence instead of mutating the VM.
- `change-planner.js`: builds classified change previews and fingerprints.
- `change-executor.js`: verifies preview fingerprints, validates or reserves matching regional static addresses, and creates VMs with one explicit `--network-interface` covering public-IP mode, Network Tier, and NIC type. A newly reserved address is retained and reported if VM creation fails; no compensating delete runs.
- `maintenance-service.js`: status, restart, and staged system update.
- `firewall-service.js`: reads project rules once per request scope and creates or updates only owner-marked rules for the same VM and project.
- `firewall-governance-service.js`: produces read-only project-level severity, ownership, source/target, affected-instance, and advisory gap data; it exposes no mutation method.
- `local-secret-store.js`: atomically stores the first-use SSH password under local `0700`/`0600` permissions and exposes configuration metadata only.
- `ssh-dual-entry-service.js`: configures one `sshd` with port-specific authentication, validates public 45400 before tightening IAP 22, and passes the password only through stdin.
- `network-exposure-policy.js`: selects only fresh external listeners, reserves SSH policy ports, chooses collision-free priorities and a unique instance tag, and creates the SHA-256 preview.
- `network-exposure-service.js`: revalidates and applies the preview in allow/tag/deny order, then disables only its owned deny if final connectivity verification fails.
- `ssh-connectivity-verifier.js`: separately verifies public TCP 45400 and the IAP TCP 22 network path.
- `warp-command-contract.js`: owns the only two allowed remote WARP contracts: sanitized status and one guarded disconnect/hold/connect cycle with exit recovery.
- `warp-ssh-runner.js`: runs those contracts through native SSH on the verified key port, resolves the trace target locally so IPv4/IPv6 selection is enforceable, permits read-only public-to-IAP fallback including an empty SSH 255 exit, caps output/time, redacts errors, and never accepts arbitrary remote commands or user arguments.
- `warp-egress-service.js`: enforces live `warp-svc`, CLI, loopback WarpProxy, matching Sing-box outbound, and affected-node evidence; it classifies one reconnect as changed, unchanged, restored, partial, or failed. An ambiguous reconnect transport is followed only by a read-only status check, and a second read failure becomes an explicit sanitized `warp_status_unconfirmed` result.
- `node-pipeline.js`: VM-only, Sing-Box-Plus, and 3X-UI deployment pipelines; custom SSH bootstrap retains IAP-only port 22 as a rescue path and verifies the requested port independently.
- `deployment-verifier.js`: read-only post-deployment checks for SSH, services, ports, BBR congestion control, qdisc, and firewall.
- `doctor-service.js`: read-only operational checks for local account/project, APIs, region/free-rule cache, inventory sync, and verification evidence.
- `legacy-migrator.js`: read-only migration from old local artifacts into VM records.
- `job-store.js`: schema-versioned local jobs under `.gcp-vm-console/jobs`, atomic `0600` writes, restart interruption recovery, legacy terminal-stage repair, retention, and malformed-record quarantine.
- `task-lock.js`: per-VM lock to block duplicate cloud writes.
- `router.js`: API routing only; no diff algorithm or shell string composition.
- `api-flow-registry.js`: static API boundary map for read, local-write, read-local-write, local-danger, and cloud-write flows.
- `single-flight.js`: server-side in-flight reuse for identical account, record, and cloud-inventory reads without TTL caching.
- `static-file-service.js`: path-safe static serving with ETag, Last-Modified, HEAD, Brotli/gzip, and immutable font caching.
- `http-runtime.js`: 1 MiB JSON body limit and sanitized public HTTP errors.
- `shutdown-controller.js`: stops accepting work and drains the local HTTP server for at most 15 seconds.
- `local-cleanup.js`: validates and removes only the explicit generated-cache whitelist; it rejects symlink escape before deleting anything.
- `scripts/runtime-revision.mjs`: hashes active server, frontend, and package manifest sources so the start script can distinguish a current process from a healthy stale process.

## Runtime Optimization Boundary

Boot uses four request waves: health; jobs, local SSH password status, and accounts; projects; then one parallel context snapshot containing records, cloud inventory, regions, free rules, and Doctor. `request-coordinator.js` uses generation tokens and AbortController so a stale project response cannot replace the current context. Server-side single-flight coalesces identical concurrent reads but does not cache results after completion.

`刷新数据` commits the complete context snapshot. `刷新清单` has a narrower owner and reads only records, cloud inventory, and Doctor. Both commit each affected root region once; route changes remain network-free and SSH-free.

WARP status is never part of boot, refresh, route, or selection work. `管理` only opens local state. `重新检测` performs one fixed read and persists sanitized `observed.warp`; confirmed reconnect performs one guarded remote cycle, writes one persistent Job, and updates the same local evidence.

Static HTML, JavaScript, and CSS use `no-cache` revalidation with ETag and Last-Modified. Text assets above 1 KiB prefer Brotli and fall back to gzip; WOFF2 is not recompressed. The frontend loads one IBM Plex Sans WOFF2 and delegates CJK glyphs to platform fonts.

`/api/health` returns the revision computed when the process starts. `scripts/start-ui.sh` computes the expected revision from disk and reuses port 8787 only when mode, capabilities, and revision all match; source changes therefore trigger a graceful project-process restart without touching unrelated listeners.

HTTP JSON bodies above 1 MiB return 413 and invalid JSON returns 400. gcloud reads default to 60 seconds, read-only SSH probes to 120 seconds, ordinary writes to 180 seconds, and explicitly classified deployment/system-update work to 30 minutes. stdout and stderr are each capped at 4 MiB. Only retryable ordinary reads use the fixed 500 ms and 1500 ms waits; the maximum is three attempts.

Successful live inventory reads atomically refresh the exact configuration/account/project snapshot. A transient live failure may return that context's sanitized cache with `meta.source=cache`; the frontend preserves same-context memory if even the cache API is unavailable. Cache or memory mode invalidates executable previews and disables create/configure, execute, deploy, restart, system update, network-exposure preview, and network-exposure apply. Server-side restart, system-update, node-deploy, and network-exposure routes also require a fresh project inventory read before the first cloud write.

`npm --prefix ui run cleanup:local` is dry-run by default. `--apply` may remove generated `ui/output`, npm caches, and reproducible Playwright HOME build caches. It cannot target Playwright browsers, `.gcp-vm-console/records`, jobs, node results, credentials, or the legacy archive.

## API Summary

- `GET /api/health`
- `GET /api/accounts`
- `GET /api/projects`
- `GET /api/vm-records`
- `GET /api/cloud-instances`
- `POST /api/cloud-instances/adoption-preview`
- `POST /api/cloud-instances/adopt-local`
- `GET /api/regions`
- `GET /api/free-rules`
- `GET /api/doctor`
- `GET /api/jobs`
- `GET /api/local-security/ssh-auth`
- `PUT /api/local-security/ssh-auth`
- `POST /api/free-rules/calibrate`
- `POST /api/vm-records`
- `POST /api/vm-records/:id/preview`
- `POST /api/vm-records/:id/execute`
- `POST /api/vm-records/:id/network-exposure/preview`
- `POST /api/vm-records/:id/network-exposure/apply`
- `POST /api/vm-records/:id/warp/status`
- `POST /api/vm-records/:id/warp/reconnect`
- `POST /api/vm-records/:id/maintenance/status`
- `POST /api/vm-records/:id/maintenance/restart`
- `POST /api/vm-records/:id/maintenance/system-update`
- `POST /api/vm-records/:id/nodes/deploy`
- `POST /api/vm-records/:id/verify`
- `DELETE /api/vm-records/:id`

## API Flow Registry

`ui/server/api-flow-registry.js` classifies every active endpoint by method, normalized path, purpose, write scope, confirmation expectation, and expected service. Frontend function references are also method-qualified, so `GET /api/vm-records` cannot be confused with `POST /api/vm-records`. `ui/test/api-flow-registry.test.mjs` reverse-checks every direct and record-scoped Router endpoint. WARP status is a read-plus-local-evidence flow; WARP reconnect is the only additional confirmed remote-service write and does not create or mutate Google Cloud resources.

Read endpoints and read-only POST probes must not mutate cloud resources. Local-write endpoints may save local JSON records, job evidence, free-rule cache, or adoption records, but must not call gcloud write commands. The local-sensitive-write endpoint may write only the Secret Store and never returns the password. Cloud-write endpoints remain behind existing UI confirmation and server task-lock/fingerprint boundaries. No cloud delete endpoint is defined.

`POST /api/vm-records/:id/execute` is also the sole owner of static-address reservation. The preview exposes `ensure-static-address` before `create-vm`; execution lists matching addresses, fails closed on region, tier, type, or occupancy conflicts, creates only the named regional address when absent, and then creates the VM. No separate address-management route or button exists.

## Local Data Boundary

A VM record is local state. Removing it does not touch Google Cloud. Cloud resource deletion is intentionally separate and remains in the dangerous flow.

`GET /api/doctor` is read-only. It summarizes local gcloud/account/project, API, rule cache, inventory, SSH, firewall, BBR, and node verification evidence, and it does not change action confirmation policy or create a cloud write path.

The overview's visible next step is route-only and owned by `#overviewNextAction`; diagnosis remains on the instance page. The retained operation-guidance model and the active diagnostic-summary model are frontend-only and add no API endpoints or cloud write paths. Diagnostic focus is route-aware: resource pages show only evidence belonging to the selected instance, while the task page can focus the selected task's matching local record.

The deployment form preserves a valid selected region, otherwise choosing the explicit low-cost default `us-west1` instead of the first alphabetical catalog entry. The zone helper displays a compact availability count because the adjacent native select already owns the complete zone list.

The task workspace keeps logs and history full width. On desktop, progress and preview share a compact context column while the selected result receives the wider column. Diagnostic/evidence and node/firewall payloads remain in the existing DOM and API flow but are closed native disclosures by default; changing the selected task closes stale disclosures without deleting result data.

Scenario classification, evidence timeline, and copy fallback are frontend-only. They do not add API endpoints, cloud write paths, credentials, or deletion behavior.

`observed.warp` stores only capability booleans, connection/mode/protocol/tier, validated proxy port, validated IPv4/IPv6/colo, affected-node names/count, timestamps, sanitized attempt errors, and sanitized reconnect snapshots. Raw remote output, registration/account/device IDs, licenses, keys, key paths, credentials, configuration, and node URLs are excluded from API responses, jobs, logs, and diagnostics.

## Local Job History Boundary

`GET /api/jobs` remains read-only and returns persistent local jobs plus sanitized storage counters. There are no job delete, export, restore, or retry endpoints. The visible running log remains browser-session state and is not written to disk.

Job files are stored one per task with directory mode `0700` and file mode `0600`. Terminal jobs are retained for at most 30 days and at most 200 records. Raw node links may remain inside their local task result so the existing UI can recover them after restart, but they are excluded from public diagnostics, cloud-visible fields, and ordinary service logs.

At startup, valid terminal jobs are restored without cloud or SSH requests. Persisted `queued` or `running` jobs become `interrupted`, append a local restart-recovery stage, and release their stale lock ownership. `interrupted` means the local process ended before it could persist a terminal result; it does not assert that the cloud operation failed, and no operation is resumed automatically.

Older terminal records may contain an active stage from versions that finished the task without terminalizing its stages. Startup rewrites only those stage statuses to the task's existing terminal status, preserves timestamps/results/errors, and performs no cloud or SSH action.

Malformed task files are moved to a local quarantine directory. Only sanitized counts are exposed to the UI; raw contents, filenames, and parse errors are not returned by the API.

## External Instance Recognition Boundary

Deployment method is canonicalized as one of `vm_only`, `singbox_plus`, `three_x_ui`, `custom_startup`, `external_custom`, or `unmanaged_unknown`.

Persisted user/local intent remains protected unless a current high/medium-confidence SSH probe identifies a different supported runtime. Without persisted intent, recognition selects the highest scored evidence and uses source priority only as a tie-breaker; high-confidence live SSH evidence therefore outranks medium-confidence cloud labels/metadata. A cloud-only VM without sufficient evidence remains `unmanaged_unknown`; it is not defaulted to `vm_only`.

`POST /api/cloud-instances/adoption-preview` is read-only. It reads cloud inventory, safe Guest Attributes, metadata-safe SSH evidence, and one project firewall list, then returns confidence-scored recognition plus a sanitized firewall-governance assessment. It does not write labels, metadata, guest attributes, firewall rules, services, or local records. Local-record verification uses the same metadata-safe probe before persisting its local job/verification result.

For managed records, the verification contract derives required public ports from saved node links or the saved 3X-UI panel first. Extra listeners discovered from the process remain diagnostic evidence but do not become firewall repair actions. External/manual records without a usable saved result may fall back to bounded process-owned listeners.

The allowlisted live acceptance flow treats a failed firewall read as a sanitized `blocked` result. It does not convert missing firewall evidence into drift or infer a safe firewall state from stale data.

`POST /api/cloud-instances/adopt-local` writes a local JSON record only after user confirmation or sufficient recognition. It never mutates the cloud VM. Conflicting, unknown, or low-confidence evidence requires `userConfirmedMethod`. Raw node links, panel passwords, private keys, tokens, and credentials are rejected from recognition evidence before saving.

Future console-created VM desired state may include only non-secret markers: `managed_by`, `gvc_managed`, `gvc_deploy_method`, `gvc-record-schema`, `gvc-deploy-method`, and startup script hash. Raw links or credentials are never written to cloud-visible fields.

## Firewall Governance Boundary

Smart diagnosis classifies every project firewall rule as `critical`, `high`, `warning`, or `safe`, and as `console_owned` or `external`. Findings include source ranges/tags, target tags or redacted service-account counts, and affected instance names. Full service-account values, metadata, raw gcloud output, credentials, and startup scripts are not persisted in governance results.

The Router merges critical/high project findings into the selected verification result. This changes the effective firewall check and overall verification to `partial` unless the base verification already failed; it does not schedule an external-rule mutation or replace the node result.

External/shared rules, including `ruzhan1` and `default-*`, produce manual-review guidance only. They can never become an `ownedAction`, and the runtime contains no external disable/delete/update command path.

The old `/firewall/apply-owned` endpoint is retired and returns 404. `POST /api/vm-records/:id/network-exposure/preview` accepts only selected listener identities and recomputes the complete policy server-side. It requires a live inventory, a configured local password version, listener evidence no older than 15 minutes, a collision-free unique tag, and safe allow/deny priorities. Unknown ports or uncertain live state fail closed.

`POST /api/vm-records/:id/network-exposure/apply` accepts only the stored SHA-256 fingerprint and is protected by typed confirmation, persistent Job creation, cache-mode lockout, live-state revalidation, and the per-VM task lock. TCP 22 is always retained for IAP `35.235.240.0/20`; TCP 45400 is always retained for public key access. External rules never enter the write list.

Execution first ensures console-owned allow rules, prepares a disabled console-owned deny, and adds the selected instance's unique tag. It then configures both SSH listeners, proves 45400 before tightening port 22, independently rechecks public 45400, enables deny, and finally verifies public 45400 plus the IAP 22 path. Missing RUNNING state, tags, network, valid priorities, or a collision with an external rule name makes the preview non-executable before any SSH or firewall write. A final failure disables only the deny owned by this task. It never deletes rules or tags and never mutates external/shared rules.

## Local SSH Secret Boundary

`PUT /api/local-security/ssh-auth` accepts the first-use password in the JSON request body and writes it only to `.gcp-vm-console/secrets/ssh-auth.json` using an atomic temporary file, directory mode `0700`, and file mode `0600`. `GET` and `PUT` responses contain only `configured`, a random version ID, and update time.

The password is passed to the remote `chpasswd` process through stdin. It is excluded from argv, VM records, preview fingerprints, jobs, logs, diagnostics, API responses, and cloud-visible labels/metadata. The remote SSH user must be non-root and the managed OpenSSH configuration keeps `PermitRootLogin no`.

## Legacy Boundary

Old IaC and generated result files are isolated under `.gcp-vm-console/legacy-iac-archive/`. Runtime code does not execute them.
