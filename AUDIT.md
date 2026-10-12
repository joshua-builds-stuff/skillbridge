# SkillBridge review notes

**TL;DR:** These are historical review notes. Use the current guides and verification

<!-- wtfm:revision -->
> Documents **v0.1.0** (`4fd8f3e+dirty`) · Doc revision **1** · Updated 2026-10-11
> Latest change: Git distribution and clean-copy verification documented
<!-- /wtfm:revision -->

record for the renamed package.

This file preserves the initial review of the standalone plugin. Current setup
instructions are in [README.md](README.md). Current observed security checks
are in [docs/security-audit.md](docs/security-audit.md).

## Outcome

The package is a standalone OpenCode plugin. It does not import OpenCode core code or require changes to OpenCode or Executor. It reads Executor's native, authenticated skill API and registers qualified skills through public plugin transforms. This is necessary because the public plugin MCP context does not expose a configured server's `skills/list`, `skills/get`, or `resources/read` methods.

The review fixed the release-blocking issues found in the draft:

- Added the root `index.js` entrypoint required when OpenCode loads a local plugin directory.
- Made refresh reconciliation retry-safe after persistence or registry reload failures.
- Prevented stale bundles from winning a refresh-versus-hydration race.
- Deduplicated concurrent and repeated first-use downloads.
- Added practical instruction, metadata, path, manifest, transport, and base64 validation limits.
- Combined plugin-lifecycle and invocation cancellation.
- Captured credentials consistently and added an owner-only `apiKeyFile` option for isolated services.
- Pruned stale cached bundles and preserved verified in-memory content when persistence fails.
- Normalized nested native-tool results so Code Mode can execute `executor_skill_load`.
- Added a standalone package and a virtual skill root. The package and plugin
  are now named `skillbridge`; skill IDs and tool names remain qualified by Executor.

## Historical validation

- `npm run typecheck`: pass
- `npm test`: 12 pass, 0 fail
- `npm run build`: pass
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities
- `npm pack --dry-run`: pass; eight intended files in the package
- Live T3 Code activation: plugin active
- Live catalog and command registration succeeded in the original T3 Code test.
- On-demand hydration loaded verified instructions from Executor native storage.

These results predate the SkillBridge rename. Catalog size and personal skill
visibility depend on the current Executor credential. They are not fixed product guarantees.

## Audit pillars

| Pillar | Grade | Notes |
| --- | --- | --- |
| Dead code and assets | A | Small package; shipped files are all intentional. |
| Dependency health | A | One runtime dependency; production audit clean. |
| Security | B+ | HTTPS by default, redirect refusal, bounded responses, digest verification, safe paths, read-only API. Cached skill content remains sensitive host data. |
| Performance | B+ | Catalog-only startup, lazy bundles, serialized polling, in-flight deduplication. A 401-entry catalog is large but worked in T3 Code. |
| Error handling | B+ | Verified offline cache and retry-safe reconciliation. Warnings are sanitized but intentionally concise. |
| Duplication | A | Transport, validation, and registration concerns are separated without excess abstraction. |
| Architecture | A- | Public plugin APIs only. Direct HTTP is an explicit portability tradeoff forced by the public MCP surface. |
| Type safety | A- | Strict TypeScript and Zod validation at the remote boundary. |
| Testing | B+ | Good fixture coverage plus a live host smoke test; automated stock-host CI remains desirable. |
| Configuration | A- | Environment or protected file credentials; no secret values in plugin configuration. |
| Documentation | A- | Installation, behavior, security, cache, MCP limitation, and host caveats documented. |
| Build and release | B+ | Verified prepack gate and clean tarball; automated multi-version CI is still recommended before publishing. |

## Remaining release recommendations

1. Add CI against the minimum supported and latest OpenCode V2 plugin SDK versions.
2. Add a black-box stock-OpenCode activation test with a contract-faithful fake Executor endpoint.
3. Add explicit refresh/deletion/failure-retry race tests to complement the reviewed implementation.
4. Verify changes against a real OpenCode host as well as the fixture tests.
