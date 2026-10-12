# Changelog

All notable changes are documented here. This project follows Keep a Changelog.

## [Unreleased]

### Added

- Standalone OpenCode V2 plugin for live Executor skill catalogs and on-demand bundles.
- Qualified native skills and slash commands, plus verified remote-file tools.
- Integrity checks, protected credential-file support, and location-scoped cache storage.
- Git-based installation, user and implementation guides, and security documentation.

### Changed

- Renamed the package, plugin ID, repository folder, and virtual skill root to SkillBridge.
- Kept `executor-org-*`, `executor-user-*`, `executor_skill_load`, and `executor_skill_file` names stable.

### Security

- Refresh warnings no longer print exception messages from remote validation failures.
- Credential-file validation and reading use the same opened file handle.

### Fixed

- Refresh cleanup cannot delete a newly hydrated revision's cached bundle.
- Cache cleanup retries survive persistence and registry reload failures.
- Duplicate qualified skill IDs are rejected before registration.
