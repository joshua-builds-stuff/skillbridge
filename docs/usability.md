# Using SkillBridge

**TL;DR:** Build a Git checkout and load its absolute directory in your OpenCode V2 backend configuration. Select a qualified Executor skill, then use the file tool for its remote references.

<!-- wtfm:revision -->
> Documents **v0.1.0** (`6cc4c67+dirty`) · Doc revision **2** · Updated 2026-10-11
> Latest change: Verified privacy fixes, cache recovery, and sanitized diagnostics
<!-- /wtfm:revision -->

## What you can do

- List organization and personal skills visible to your Executor credential.
- Load instructions only when a skill is used.
- Read text or binary references from a verified bundle.
- Reuse a previously loaded revision when Executor is offline.

## Before you start

You need Git, Node.js 22 or later, npm, an OpenCode V2 backend, and access to Executor's native skill API. Use a read-only credential for the intended workspace or subject. Bun is only needed for the test suite.

SkillBridge is an **OpenCode V2 plugin**, not a T3 Code plugin. If you use T3 Code, find the configuration loaded by its actual OpenCode backend. A client-only setting cannot load the plugin into a separate server.

The SDK peer range `@opencode/plugin >=2.0.17 <3` is declared, not verified across every version. No all-platform compatibility claim is made.

## Get started

1. Follow [Install from Git](../README.md#install-from-git).
2. Restart or reload the backend with the plugin configuration.
3. Check the host's skill interface for `executor-org-<name>` or `executor-user-<name>`.
4. Select one visible skill or invoke its registered command.
5. Review the native permission prompt, if the host presents one.

Expected result: the backend loads verified instructions for the selected skill. Exact picker controls depend on your client. SkillBridge does not provide a generic `/skills` command.

Build and fixture checks pass from a disposable copy. This is not a newly verified
end-to-end client installation. A historical T3 Code smoke test listed skills and
hydrated one skill before the rename. See the [verification record](verification.md).

## Load a skill

1. Choose a qualified ID from the current catalog.
2. Use its native selection control or command, such as `/executor-org-<name>`.

Alternatively, ask the agent to call `executor_skill_load` with:

```json
{ "skill": "executor-org-<name>" }
```

Expected result: the instructions enter the session through the host's native skill permission mechanism. Local skills are not replaced.

## Read a reference file

1. Load the skill.
2. Find the reference path in the bundled-file list.
3. Ask the agent to call `executor_skill_file` with that exact path.

```json
{
  "skill": "executor-org-<name>",
  "path": "references/guide.md"
}
```

Expected result: a JSON result includes `path`, `digest`, `size`, `content`, and `encoding`. Text uses `utf8`; binary uses `base64`. The first read can fetch the entire bundle, not only that file.

Do not read `/skillbridge/executor-org-name/remote.md` with filesystem tools. That path is virtual. Bundles remain remote source data with verified cache copies, not installed directories. Scripts are not automatically run.

## Change or rotate credentials

1. Keep the new token outside the checkout and configuration JSON.
2. Update the protected token file or the server's `EXECUTOR_SKILLS_API_KEY` environment variable.
3. Restart or reload the backend.

Expected result: setup captures the new credential and removes superseded cache partitions from the plugin's location-scoped storage. `apiKeyFile` overrides `apiKeyEnv`. Protect cached content even after revoking API access.

## Work offline

1. Load the required skill revision while Executor is reachable.
2. Keep the backend's persistent plugin storage.
3. Use the same endpoint and credential configuration offline.

Expected result: a matching verified cached revision can load. Catalog metadata alone is not enough; an uncached bundle fails. Offline state does not guarantee that a skill remains authorized or current on the server.

## Troubleshooting

These cases come from source validation and test fixtures, not a complete client-specific support matrix.

| Symptom | Check | Action |
| --- | --- | --- |
| Credential setup error | Server environment and file options | Supply the token to the backend, not only the client. |
| `apiKeyFile` rejected | Absolute path, regular file, POSIX owner and mode | Use a service-owned file outside the repo with mode `0600`. |
| URL rejected | Origin, scheme, embedded credentials | Use an HTTPS origin without path, query, or fragment. |
| HTTP 401 or 403 | Credential validity and Executor access | Correct the credential or its scope; reload the backend. |
| Skill not found | Exact qualified ID and catalog visibility | Use an ID from the current catalog. |
| File absent from manifest | Exact relative path | Use a listed bundle path, not a local or virtual filesystem path. |
| Integrity or changed-revision error | Current bundle and catalog agreement | Allow catalog refresh; correct inconsistent source data. |
| Offline load fails | Matching verified bundle cache | Reconnect and load the skill revision first. |
| Permission denied | Host skill policy | Review the host policy; do not bypass it. Retrieval may already have happened. |
| Duplicate Executor entries | Built-in Executor import also enabled | Choose one import mechanism unless duplicates are intentional. |

If no entries appear, check that the actual backend loaded the built plugin directory and can reach Executor. The plugin does not add a separate status screen or remote/offline badges.

Remote errors use fixed messages instead of response fragments or private filenames.
Include the error category or HTTP status in a report, not private bundle contents.
Stale bundle cleanup runs on startup and refresh. If storage fails, cleanup retries;
this does not remove backups or revoke otherwise valid offline cached revisions.

## Security and help

Host permissions control disclosure, **not whether a bundle is downloaded or cached**. Treat the cache as sensitive data. Trust the Executor endpoint and review remote instructions before following them. Digest verification checks bytes, not intent.

Read [SECURITY.md](../SECURITY.md) and the [security audit](security-audit.md). For non-sensitive problems, [open an issue](https://github.com/joshua-builds-stuff/skillbridge/issues). Include versions, the failure message, and redacted configuration. Do not include tokens, private skill content, or sensitive cache files.

For changes, see [CHANGELOG.md](../CHANGELOG.md). For internals, see [implementation.md](implementation.md).
