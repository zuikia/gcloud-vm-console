# Changelog

[简体中文](CHANGELOG.zh-CN.md) · English

## 0.2.1 — 2026-09-22

- Stop maintenance and node deployment writes unless the live VM is confirmed
  `RUNNING`; unknown or stopped instances now fail closed in the UI and API.
- Remove 3X-UI installer passwords and API tokens from node results, VM records,
  task history, and the browser; retain only a non-secret availability marker.
- Sanitize legacy records and job results when they are read or persisted.
- Clarify the local API trust boundary, filesystem-only secret protection,
  SSH fingerprint limitation, SSH metadata side effects, and root installer
  supply-chain risks in the bilingual security documentation.
- Add a CI badge and regression coverage for credential boundaries and stopped
  instance maintenance.

## 0.2.0 — 2026-09-21

- Protect context switching from stale project responses and clear old VM data
  before a newly selected project becomes active.
- Execute custom startup scripts through a temporary Compute Engine metadata
  file, with a 64 KiB limit and no node-deployment pipeline rerun.
- Mark unsupported edits to existing VMs as preview-only so the UI cannot claim
  that an in-place or replacement change was executed.
- Add a loopback Origin allowlist and sanitize execute errors returned by the
  local API.
- Validate 3X-UI panel ports and versions before any remote command or firewall
  operation.
- Add bilingual onboarding notes, a Node.js engine declaration, and release
  documentation for the next public iteration.

## 0.1.0 — baseline

- Initial public GCP VM Console baseline with bilingual UI, safety previews, and
  mock-data verification flows.
