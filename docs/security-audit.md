# Security audit data: skillbridge

**TL;DR:** Static secret, workflow, and lockfile checks report no findings.
This is not a security certification; see [verification.md](verification.md) for test scope.

Documents **v0.1.0** · Collected 2026-10-11

> This page lists what automated checks observed. It is not a penetration test or a guarantee. Secret values are never shown.

## Summary

- High: **0**
- Medium: **0**
- Low: **0**

## Checks performed

- Text files scanned for secret-like strings: 19
- Security policy (`SECURITY.md`): present
- GitHub Actions workflows reviewed: 1
- Lockfiles: package.json: package-lock.json

## Findings

No findings from the static checks.

## Dependency audit

Not run. Re-run with `--run-audits` to query ecosystem advisory databases (uses the network).

## Reporting a vulnerability

See [the security policy](../SECURITY.md). Do not post credentials or private skill
content in public issues.
