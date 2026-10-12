# Verification

**TL;DR:** A disposable copy passes all six required checks with 20 fixture tests.

<!-- wtfm:revision -->
> Documents **v0.1.0** (`4fd8f3e+dirty`) · Doc revision **1** · Updated 2026-10-11
> Latest change: Git distribution and clean-copy verification documented
<!-- /wtfm:revision -->

This proves the build and simulated-host behavior, not every OpenCode client or platform.

## Current checks

| Check | Observed result |
| --- | --- |
| Clean dependency install | Pass: `npm ci --offline --ignore-scripts --no-audit --no-fund` |
| Typecheck | Pass: `npm run typecheck` |
| Fixture tests | Pass: `npm test`, 20 tests |
| Build | Pass: `npm run build` |
| Root entrypoint | Pass: `npm run test:entrypoint` |
| Package dry run | Pass: `npm pack --dry-run` |
| Production dependency audit | 0 vulnerabilities: `npm audit --omit=dev --audit-level=moderate` |

Verification uses Linux, Node.js 22, Bun 1.4.2, the locked dependency graph, a temporary
home, and an isolated network namespace. Install uses cached registry packages.
No live Executor credential is supplied. `.wtfm.yaml` defines commands and timeouts.
The separate advisory check queries the npm registry; it covers production dependencies only.

The tests cover manifest integrity, binary and Unicode data, safe paths, duplicate
catalog IDs, read-only transport, registration, permission-denial fixtures, concurrent
hydration, offline reuse, refresh/cache races, cleanup retries, and credential files.

## Live-host scope

An earlier T3 Code smoke test activated the pre-rename plugin, exposed qualified
skills and commands, and loaded selected remote instructions. That result does not
verify every client control, current catalog, SDK version, or platform.

The renamed plugin's build and simulated host are verified here. A full stock-host
integration suite is not included. The GitHub workflow runs the local checks but
does not contact Executor or test T3 Code's frontend.

## Documentation migration

The README now starts with Git installation and a data-flow diagram. Configuration
and task details also appear in the user guide. Implementation details are in the
maintenance guide. The HTTP-versus-MCP rationale is preserved. Initial review notes
remain in `AUDIT.md`; change history is in `CHANGELOG.md`.

No screenshots are captured: the plugin has no standalone UI. Static secret and
infrastructure checks are reported in [security-audit.md](security-audit.md).
