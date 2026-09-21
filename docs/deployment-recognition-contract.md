# Deployment Recognition Contract

## Scope

GCP VM Console is gcloud-only. Deployment recognition is a read-first layer for cloud-only or manually managed instances. It does not create, stop, restart, delete, deploy, update firewall rules, or mutate cloud labels/metadata/guest attributes.

## Canonical Methods

| Method | Meaning | Recognition UI |
| --- | --- | --- |
| `vm_only` | Instance only; no proxy/node software managed by console | 只开实例 |
| `singbox_plus` | Console-managed or externally detected Sing-Box-Plus style deployment | Sing-Box-Plus |
| `three_x_ui` | Console-managed or externally detected 3X-UI deployment | 3X-UI |
| `custom_startup` | User-provided startup script; node semantics are not inferred | 自定义脚本 |
| `external_custom` | Manually managed software that does not match known pipelines | 外部自定义 |
| `unmanaged_unknown` | Cloud-only VM with insufficient evidence | 未识别 |

Cloud-only instances with no evidence must remain `unmanaged_unknown`. They must not be defaulted to `vm_only`.

## Evidence Arbitration

Persisted user-confirmed or local intent remains the owner when current runtime evidence agrees. A current high/medium-confidence SSH deep probe may override a different stale persisted conclusion without rewriting the desired method. Without persisted intent, candidates are selected by score; source order is only a tie-breaker: user confirmation, local record, Guest Attributes, SSH deep probe, SSH probe, cloud label, cloud metadata, firewall evidence, and optional OS inventory.

The evidence set includes safe local intent, Guest Attributes, cloud labels/metadata, SSH desired/actual/fallback port, service activity, systemd units, bounded process summaries, listening ports, known file markers, Docker summaries, version hints, safe config summaries, BBR, and read-only firewall exposure. A high-scoring live SSH result must outrank a medium cloud label even when both name the same method.

Conflicts between evidence sources must create a warning and require manual confirmation before local adoption.

## Scoring Rules

Recognition returns `score`, `candidates`, `probes`, `evidence`, `warnings`, and `suggestedAction`.

- Local record or user-confirmed adoption: high confidence, score floor 90; if deep probe sees conflicting active proxy services, keep the local method but show a conflict warning and require manual choice for adoption.
- Guest Attributes with safe method/schema/time/service summary: high confidence, score floor 85.
- Cloud labels/metadata: medium confidence, normally score 50-70 until supported by probe evidence.
- 3X-UI candidate evidence:
  - `x-ui` service active: +35
  - `x-ui` or Xray known file marker: +20
  - `x-ui` or Xray process: +15
  - Docker image/name containing `3x-ui` or `x-ui`: +25
  - TCP listener owned by `x-ui`/`xray` or paired with x-ui evidence: +10
  - Xray inbound protocol config summary: +15
- Sing-Box candidate evidence:
  - `sing-box` service active: +35
  - `sing-box` binary or `/etc/sing-box/config.json`: +20
  - `sing-box` process: +15
  - Docker image/name containing `sing-box`: +25
  - sing-box JSON inbound summary: +20
  - UDP listener owned by `sing-box` or paired with sing-box evidence: +10
- Port-only evidence is `external_custom` with low confidence. It must never become medium or high confidence by itself.
- Multiple active primary proxy services such as `x-ui` and `sing-box` become `external_custom` or conflict, not a forced single method.
- `vm_only` is valid only from local/user-confirmed state, or after a successful deep probe finds no known proxy service, process, container, config marker, or related firewall exposure.

## Safe Cloud Markers

Future console-created desired state may include:

- Labels: `managed_by=gcp-vm-console`, `gvc_managed=true`, `gvc_deploy_method=<method>`.
- Metadata: `gvc-record-schema=1`, `gvc-deploy-method=<method>`, `gcp-vm-console-startup-script-hash=<hash>`.

These are non-secret hints only. They are not a credential store and are not enough to expose links or panel credentials.

## Guest Attributes

The allowed namespace is `gcp-vm-console`. Accepted values are low-volume status hints such as method, schema version, verified time, link count, ports summary, and service summary.

Never store:

- raw `vless://`, `vmess://`, `hy2://`, `hysteria2://`, `tuic://`, `ss://`, or `trojan://` links;
- panel passwords;
- private keys;
- bearer tokens;
- proxy credentials.

Guest Attributes unavailable, disabled, or permission denied must be a warning, not a fatal recognition error.

## API Boundaries

`POST /api/cloud-instances/adoption-preview`

- Reads cloud inventory, Guest Attributes, metadata-safe SSH deep probe evidence, and read-only firewall exposure evidence.
- Returns identity, cloud instance, guest attributes, SSH probe, firewall probe, and recognition.
- Performs no cloud writes and no local adoption writes.
- SSH transport is native `ssh` with a `gcloud compute start-iap-tunnel --listen-on-stdin` ProxyCommand. `gcloud compute ssh` is not allowed because it may add or refresh project SSH metadata.

`POST /api/cloud-instances/adopt-local`

- Writes a local VM record only.
- Requires `userConfirmedMethod` for unknown, low-confidence, conflicting, or unsupported recognition.
- Rejects recognition evidence containing raw links, passwords, private keys, tokens, or credentials.
- Saves adoption provenance under `record.migration.adoption`.

## UI Contract

The instance detail surface shows a compact recognition card with method, source, confidence, score, managed state, SSH port status, BBR status, firewall status, service summary, safe evidence groups, warnings, and one next action.

Deep evidence must be bounded:

- top row: method badge, confidence, score, last probe time;
- fact row: SSH, BBR, firewall, services;
- default evidence body: at most a short wrapped chip set and two grouped summaries;
- long process/container/config summaries live in an `展开证据` disclosure;
- long values wrap or truncate inside the selected detail panel and never widen the instance table.

Buttons:

- `智能诊断`: chooses read-only recognition for cloud-only instances or verification for local records.
- `接管本地`: local write only, confirmation required.
- `手动指定部署方式`: used when evidence is incomplete or conflicting.

Task results, diagnostic summaries, and evidence timelines may show recognition method/source/confidence. They must not include raw evidence values that look like node links or credentials.

## Verification

Use fake runner and local temp data for automatic tests. Required test surfaces:

- `ui/test/deployment-recognition.test.mjs`
- `ui/test/cloud-inventory.test.mjs`
- `ui/test/guest-attributes-service.test.mjs`
- `ui/test/deployment-probe-service.test.mjs`
- `ui/test/server-app.test.mjs`
- `ui/test/deployment-recognition-view-model.test.mjs`
- `ui/test/action-policy.test.mjs`
- `ui/test/action-readiness-view-model.test.mjs`
- `ui/test/gcloud-only-ui-structure.test.mjs`
- `ui/test/task-view-model.test.mjs`
- `ui/test/diagnostic-summary-view-model.test.mjs`
- `ui/test/evidence-timeline-view-model.test.mjs`

The full gate remains:

```bash
npm --prefix ui run check
UI_AUDIT_SCREENSHOTS=1 npm --prefix ui run audit:layout
```
