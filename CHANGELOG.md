# Changelog

[简体中文](CHANGELOG.zh-CN.md) · English

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
