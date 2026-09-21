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
