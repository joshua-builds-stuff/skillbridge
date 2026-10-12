# Security audit data: skillbridge

**TL;DR:** Current static secret, workflow, and lockfile checks report no findings.

<!-- wtfm:revision -->
> Documents **v0.1.0** (`6cc4c67+dirty`) · Doc revision **2** · Updated 2026-10-11
> Latest change: Verified privacy fixes, cache recovery, and sanitized diagnostics
<!-- /wtfm:revision -->

See [verification.md](verification.md) for the 29-test verification scope and limits.

Documents **v0.1.0** · Collected 2026-10-11

> This page lists what automated checks observed. It is not a penetration test or a guarantee. Secret values are never shown.

## Summary

- High: **0**
- Medium: **0**
- Low: **0**

## Checks performed

- Text files scanned for secret-like strings: 20
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

## Privacy review scope

Current-file checks do not cover commit identities, all GitHub logs, live private
skills, or actual host storage. Historical author/committer identity remains in Git
and existing Actions metadata. New commits use a GitHub noreply identity; this does
not erase public copies of earlier metadata.

Regression tests cover cleanup recovery after restart and remote-error redaction.
Offline cache authorization and native permission-before-disclosure boundaries
remain as documented in the security policy.
