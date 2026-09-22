# Security policy

[简体中文](SECURITY.zh-CN.md) · English

## Scope

GCP VM Console is a local operator console. It can invoke `gcloud`, SSH,
and user-provided startup or deployment scripts against infrastructure chosen
by the operator.

Only use it with Google Cloud projects, VM instances, networks, and hosts that
you own or are authorized to administer. Do not use the project to scan,
probe, or modify third-party infrastructure.

## Reporting a vulnerability

Please do not open a public issue containing credentials, private keys, live
node links, project identifiers, public IPs tied to a private deployment, or
reproduction steps that would change a cloud resource.

Until a private security contact is published, report suspected issues through
a private GitHub security advisory or contact the maintainer directly. Include
the affected version, a minimal reproduction using mock data where possible,
and the impact. Allow time for a fix before public disclosure.

## Credential and data rules

- Never commit gcloud credentials, service-account keys, SSH private keys,
  tokens, passwords, node links, or local runtime state.
- Keep `.gcp-vm-console/` outside version control.
- Use fake projects, reserved documentation IP ranges, and mock runners in
  tests and examples.
- Review generated logs, screenshots, and task records before sharing them.
- Cloud writes should remain behind the application's preview, fingerprint,
  confirmation, and task-lock boundaries.

## Important local-trust limitations

- The loopback API has no user authentication. Any process running as the same
  user can call it; browser confirmation is a safety UX boundary, not an
  authorization boundary. Keep port 8787 bound to loopback and protect the
  workstation.
- The local Secret Store uses restricted filesystem permissions (normally
  `0700` directories and `0600` files); it is not an encrypted vault. Protect
  backups, sync folders, and the host account accordingly.
- Read-only SSH probes currently do not persist host-key verification. Use a
  trusted network and verify the reported fingerprint through an independent
  channel before relying on probe results.
- Optional Sing-Box-Plus and 3X-UI adapters fetch upstream installer scripts
  and execute them as `root`. Treat them as experimental, review the scripts
  and upstream revisions before use, and do not use them on production hosts
  without your own supply-chain controls.
- `gcloud compute ssh` may create or refresh Google Cloud SSH metadata before a
  remote write. Review the preview and project/instance metadata changes when
  enabling SSH-based operations.
- Custom startup script text is intentionally copied into the local record,
  API responses, and Compute Engine metadata. Never put passwords, tokens, or
  private keys in that script.

3X-UI installer credentials are consumed only to record that credentials were
generated; current versions do not persist the password or API token in VM
records, task results, or the browser view. Existing records are sanitized when
they are read or saved.
