# Contributing

[简体中文](CONTRIBUTING.zh-CN.md) · English

Thanks for helping improve gcloud-vm-console.

## Before opening a pull request

1. Keep changes scoped to one behavior or safety boundary.
2. Add or update tests for changed behavior.
3. Run `npm --prefix ui ci` and `npm --prefix ui run check`.
4. Use mock gcloud runners and reserved documentation values in tests.
5. Check that no credentials, private paths, live project IDs, IP addresses,
   node links, screenshots, or generated runtime files such as
   `.gcp-vm-console/` are included.

## Pull requests

Describe the user-visible behavior, safety impact, test command, and whether
the change can cause a cloud write. Maintainers may request a smaller patch or
additional fail-closed tests for cloud-facing changes.
