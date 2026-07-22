# Changelog

All notable changes to FlowOnce will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.2] - 2026-07-22

### Added
- GitHub `latest/download/` fixed links for unversioned DMG/ZIP assets
- Explicit download URLs in SKILL.md, USER_GUIDE.md, and README.md
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
- Chinese user guide (`USER_GUIDE.md`)
