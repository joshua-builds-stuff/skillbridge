# Security

**TL;DR:** Keep Executor tokens outside the repository and protect OpenCode's plugin storage. Native skill permissions gate disclosure to the model; they do not prevent prior bundle retrieval or caching.

<!-- wtfm:revision -->
> Documents **v0.1.0** (`4fd8f3e+dirty`) · Doc revision **1** · Updated 2026-10-11
> Latest change: Git distribution and clean-copy verification documented
<!-- /wtfm:revision -->

## Credentials and transport

- Use a read-only Executor credential with the narrowest required workspace or subject access.
- Prefer an absolute `apiKeyFile` path outside the checkout. The file contains only the token and belongs to the OpenCode service user.
- Set mode `0600` on POSIX. The plugin rejects relative paths, non-regular files, group/world access, and a different owner where POSIX ownership checks are available.
- Alternatively, supply `EXECUTOR_SKILLS_API_KEY` in the OpenCode backend's environment. Never store token values in JSON, Git, issues, or logs.
- If both credential options exist, `apiKeyFile` wins. Restart or reload the backend after rotation; credentials are captured at setup.
- Windows does not use the POSIX mode check. Protect the token file with the service account's access controls; this is not a verified Windows support claim.

The plugin sends authenticated GET requests to the configured Executor origin. HTTPS is required by default. Redirects are refused. Do not enable `allowInsecureHttp` outside a trusted test environment. The origin cannot contain credentials, a path, query, or fragment.

## Permissions are not retrieval gates

The custom `executor_skill_load` and `executor_skill_file` tools call the host's native skill executor before returning content. Its permission checks remain in effect.

However, hydration happens first. The native tool's public `execute.before` hook also runs before its permission check. A denied call can therefore download, verify, and cache a whole bundle. Prompt-selected skills can also hydrate during prompt preparation. Do not rely on native skill denial to block network retrieval or prevent cache storage.

Restrict the Executor credential and backend access when content must not reach the host at all.

## Cache and revocation

Catalog metadata and verified bundles persist in OpenCode plugin storage. Cache partitions include a fingerprint of the endpoint and credential, not the token value. This is separation, not encryption.

Protect the backend's persistent data and backups. Activation removes superseded endpoint/credential partitions from the plugin's location-scoped storage, but does not erase backups or copies elsewhere. Previously cached revisions can load offline. Revoking server access does not erase cached content or immediately prove its current authorization.

Per-bundle limits do not bound the total cache or concurrent downloads. No aggregate
memory or disk quota is enforced. Limit catalog access and monitor host resources.
Keep the token file's parent directory trusted; POSIX file checks do not protect
against a compromised service account or privileged local user.

Use the host's documented storage-management procedure when removing sensitive cached content. There is no cache-management command supplied by this plugin.

Startup and catalog refresh reconcile stored bundle keys with the active catalog.
This recovers stale cleanup work after a restart. Storage failures can still delay
deletion. Cleanup does not remove backups, or expire authorized offline revisions.

## Remote content and integrity

The plugin validates catalog schemas, manifest paths, revisions, byte counts, and SHA-256 digests. It rejects duplicate or unsafe manifest paths, missing `SKILL.md`, invalid base64, stale bundles, and oversized data. Limits include 2048 files and 64 MiB per bundle, 512 KiB for `SKILL.md`, and 96 MiB per HTTP response.

These checks detect corruption and inconsistent data. They do not authenticate content independently of the configured server or make remote instructions trustworthy. A compromised trusted endpoint can serve a matching malicious manifest and bundle.

Remote transport, JSON, schema, and integrity diagnostics omit response fragments
and remote filenames. This applies to plugin-generated errors, not to all host,
storage-provider, or third-party logs.

Treat remote skills as instructions from their publisher, not as security policy. Review risky instructions before following them. Bundles are not materialized as local directories. Virtual `/skillbridge/...` paths are display paths. Scripts are reference data; the plugin does not install or automatically execute them. An agent can still choose other tools in response to remote instructions, subject to the host's controls.

## Scope and verification

SkillBridge is an OpenCode V2 plugin, not a T3 Code frontend plugin. It does not change OpenCode or Executor permissions. The declared SDK peer range is not a tested version or platform matrix.

Disposable-copy build and 29 fixture tests pass. Historical T3 Code smoke evidence
predates the rename and is not a guarantee for a new installation. See
[docs/security-audit.md](docs/security-audit.md),
[docs/verification.md](docs/verification.md), and [CHANGELOG.md](CHANGELOG.md).

## Report a vulnerability

Do not post credentials, private skill content, or exploit details in a public issue. If the repository offers GitHub private vulnerability reporting, use **Security → Report a vulnerability**. Otherwise, open a non-sensitive issue requesting a private reporting channel before sharing details.

Include the affected revision, host and runtime versions, impact, and a minimal reproduction with synthetic data. No response-time guarantee or supported-version matrix is established here.
