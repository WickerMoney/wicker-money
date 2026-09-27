# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

The preferred channel is GitHub private vulnerability reporting: open this
repository's **Security** tab and choose **Report a vulnerability**.

If that is not available, email
[support@wicker.money](mailto:support@wicker.money). This mailbox forwards to the
maintainer.

Include what you found, the version or image tag you tested, and steps to
reproduce. Please leave real financial data, tokens and secrets out of your
report.

## Supported versions

Wicker Money is pre-1.0. Only the latest release is supported. Fixes are not
backported to older versions.

## What to expect

This project has a single maintainer. Reports are handled on a best-effort
basis, and I aim to acknowledge a report within 7 days. That is a target, not a
commitment.

## Scope

In scope:

- The self-hosted app (`apps/api`, `apps/web`)
- The bundled plugins (`plugins/*`)
- The plugin SDK (`@wickermoney/plugin-sdk`) and UI kit (`@wickermoney/ui-kit`)
- The container image (`ghcr.io/wickermoney/wicker-money`)

Particularly interesting, because the design leans on them:

- Anything that lets one user read or modify another user's rows (tenant
  isolation is enforced with PostgreSQL row-level security).
- A plugin reaching a table or endpoint its manifest never requested.
- Authentication, session and refresh-token handling.

Out of scope:

- Deployments that run in production over plain HTTP with `COOKIE_SECURE=false`.
  The app warns about this at startup; put it behind HTTPS instead.
- Instances left with `REGISTRATION_ENABLED=true` on a network you do not
  control. That setting is deliberate and documented.
- Vulnerabilities in third-party plugins (see below).

## Things worth knowing

- Financial data is sensitive. Please keep it out of issues, logs and reports.
- Third-party plugin install is not supported. Plugin isolation does not exist
  yet, so plugin code runs fully trusted. Do not run plugin code you have not
  reviewed.
