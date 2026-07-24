# Security Policy

## Supported versions

Security updates are applied to the latest commit on the `main` branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
**Report a vulnerability** feature in the repository Security tab so the
details can be handled privately.

Please include the affected endpoint or component, reproduction steps,
potential impact, and any suggested mitigation. Do not include real LINE
access tokens, channel secrets, passwords, personal data, or production
database contents in a report.

## Secret handling

Store production credentials with Cloudflare Workers Secrets. Never commit
`.env`, `.dev.vars`, exported database files, or credentials to Git.
