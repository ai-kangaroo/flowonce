# Changelog

All notable changes to FlowOnce will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-07-23

### Added
- Quick Example section in SKILL.md for first-time users
- Troubleshooting / 常见问题 section covering installation, recording, and skill generation
- Privacy notice clarifying all data stays local
- SkillHub 一键安装提示 for domestic users

### Fixed
- Publish the reproducible test suite and synthetic fixtures with the repository
- Align application, installer, MCP server, README, and skill versions with `release.json`
- Remove stale version-test references to retired plugin files and use the current user-guide path
- Package `docs/guides/user-guide.md` in release artifacts

## [0.3.2] - 2026-07-22

### Added
- GitHub `latest/download/` fixed links for unversioned DMG/ZIP assets
- Explicit download URLs in SKILL.md, docs/guides/user-guide.md, and README.md
- Unversioned `FlowOnce-macOS-<arch>.dmg/.zip` copies generated during build

### Fixed
- Download links now point to `github.com/ai-kangaroo/flowonce/releases` instead of ambiguous paths

## [0.3.1] - 2026-07-22

### Added
- Initial public release
- macOS recorder via Accessibility API
- Stdio MCP server (`event_stream_*`, `recording_normalize`, `workflow_compile`, `workflow_validate`, `skill_generate`)
- Portable Workflow IR (host-agnostic)
- One-click DMG installer with bundled Node runtime
- Multi-host support: CodeBuddy, WorkBuddy, Qoder, QoderWork, Codex
- Standalone CLI (`node scripts/record-replay.mjs`)
- Privacy-first design: local-only event streams, sensitive value redaction, mandatory human review
- Chinese user guide (`docs/guides/user-guide.md`)
