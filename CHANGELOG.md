# Changelog

All notable changes to FlowOnce will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Add the host-neutral `skill_test_start`, `skill_test_finish`, and `skill_test_status` evaluation protocol
- Default post-generation evaluation to a safe checkpoint before likely external or irreversible actions
- Persist sanitized local test reports without storing raw test input values
- Link failed attempts and provide category-specific refinement recommendations
- Add standalone CLI commands and automated coverage for full, failed, retry, checkpoint, and confirmed-live test paths
- Add `flowonce_doctor` and `record-replay.mjs doctor` for one-step local readiness checks
- Add a one-command local source installer for development validation
- Add asynchronous, idempotent MCP jobs for recording normalization, Workflow IR compilation, and skill generation

### Changed
- Require the FlowOnce skill workflow to test generated skills with different inputs before calling them fully verified
- Clarify that FlowOnce prepares and records evaluations while the current agent host performs the actual workflow
- Synchronize an existing SkillHub `flowonce` skill alias during local installation while preserving its platform metadata
- Make first-run documentation distinguish the controller Skill from the required native recorder
- Make generated skills reuse an already-correct app state, verify complete Unicode input, trigger real search updates, and re-locate dynamic UI elements
- Keep safe message tests running through complete draft preparation and stop only before the actual submit action

### Fixed
- Package referenced Skill documentation with the native installer
- Detect mismatched App, engine, Skill versions, missing permissions, and conflicting duplicate Skill installs before recording
- Normalize common evaluation failure-category aliases instead of rejecting the entire test report
- Increase MCP child-process output capacity for large real-world recordings
## [0.3.3] - 2026-07-23

### Added
- Quick Example section in SKILL.md for first-time users
- Troubleshooting / 常见问题 section covering installation, recording, and skill generation
- Privacy notice clarifying all data stays local
- SkillHub 一键安装提示 for domestic users
- Intel (x64) 版本构建支持，Release 同时提供 Apple Silicon + Intel 双架构
- CONTRIBUTING.md 增加 TRACE 自检流程作为发布前质量闸门

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
