# FlowOnce

**Show once. Run anywhere.** FlowOnce learns a demonstrated macOS workflow, converts it into portable Workflow IR, and generates a reusable agent skill. Codex is an optional host adapter, not a runtime requirement.

普通用户请直接阅读：[中文使用手册](./USER_GUIDE.md)。无需编程或终端，照着手册完成安装、授权、录制和使用即可。

## One-click customer installation

Use the architecture-specific DMG from `dist/`:

1. Open `FlowOnce-<version>-macOS-<Apple-Silicon|Intel>.dmg`.
2. Double-click **Install FlowOnce.app**.
3. The installer deploys its bundled Node runtime, native recorder, stdio MCP server, and portable controller skill under the current user account.
4. It detects CodeBuddy, WorkBuddy, Qoder, and Codex, safely merges the MCP entry, preserves unrelated settings and MCP servers, and backs up every changed configuration file.
5. Click **Open Accessibility Settings**, add or enable `~/Applications/FlowOnce.app`, then start a new conversation in the chosen agent host.
6. Say: `Use FlowOnce to learn my workflow and turn it into a portable reusable skill.`

No terminal, source checkout, system-wide administrator password, or separately installed Node.js is required. Re-running the installer upgrades the owned components without duplicating MCP entries. WorkBuddy can use the configured MCP immediately; importing the included portable skill zip through **Skills > Add Skill > Upload Skill** is optional and improves automatic triggering.

The locally built DMG uses ad-hoc signing for development. External customer distribution must use an Apple Developer ID and notarization:

```sh
RECORD_REPLAY_SIGN_IDENTITY="Developer ID Application: Example Corp (TEAMID)" \
RECORD_REPLAY_NOTARY_PROFILE="record-replay-notary" \
./scripts/build-distribution.sh
```

The build fails instead of pretending to notarize when the required identity or keychain profile is unavailable. Build separate `arm64` and `x64` releases on matching macOS builders with the corresponding Node runtime.

## What is portable

- The native macOS recorder and local consent window
- Raw JSONL event streams
- Normalization, Workflow IR compilation, review, and validation
- The stdio MCP server and its `record_workflow` prompt
- Generated `SKILL.md` packages and `references/workflow.json`

Replay uses capabilities available in the current agent host. Prefer a connector, MCP tool, API, CLI, or semantic browser tool. Native Mac UI replay additionally requires a desktop UI-control capability supplied by the host or another installed MCP server.

## Non-technical user flow

After the user double-clicks the installer and grants Accessibility access once, normal use is entirely natural language:

1. Say: `Record this workflow and turn it into a reusable skill.`
2. Read the privacy notice and say: `I am ready.`
3. Perform the workflow normally in macOS.
4. Press **Stop** in the floating recorder, then say: `I am finished.`
5. Review any meaningful ambiguity the assistant identifies.
6. Let the assistant validate and install the generated skill.
7. In a new task, ask the assistant to repeat the workflow with different inputs.

If Accessibility permission is missing, FlowOnce opens macOS Accessibility settings, reveals the stable `FlowOnce.app` in Finder, returns recovery instructions, and automatically discards that permission-setup session. Enable the app, or turn it off and back on once if an older authorization already appears enabled, then begin a fresh recording. A real recording lasts at most 30 minutes. Cancel discards it.

## Developer installation without the DMG

Install the native recorder once:

```sh
./scripts/build.sh
./scripts/install-recorder.sh
```

Print the exact local stdio MCP configuration for the chosen host:

```sh
node scripts/record-replay.mjs host-config codebuddy
node scripts/record-replay.mjs host-config workbuddy
node scripts/record-replay.mjs host-config qoder
node scripts/record-replay.mjs host-config qoderwork
node scripts/record-replay.mjs host-config codex
```

The output uses absolute paths and includes the host's MCP settings location and Skill installation destination.

### CodeBuddy

- Add the printed server in **Settings > MCP**, or place it in the user-level `~/.codebuddy/.mcp.json`.
- Install generated skills under `~/.codebuddy/skills/<skill-name>/`, or use CodeBuddy's Skill import UI.
- MCP prompts are exposed as slash commands when the client enables prompt discovery.

### WorkBuddy

- Open **Plugins > MCP Servers > Configure MCP**, or place the printed server in `~/.workbuddy/mcp.json`.
- Generate with `--target workbuddy`, then open **Skills > Add Skill > Upload Skill** and import the generated `.zip` package.

### Qoder and QoderWork

- In Qoder, open **Qoder Settings > MCP** and add the printed stdio server. Qoder CLI users can also add the same command at user scope.
- Install Qoder skills under `~/.qoder/skills/<skill-name>/`.
- Install QoderWork skills under `~/.qoderwork/skills/<skill-name>/` or use its Skill installation UI.

### Codex

- Install the optional Codex plugin adapter, or add the printed stdio server directly.
- Use `--target codex` during skill generation only when `agents/openai.yaml` UI metadata is wanted.

## MCP surface

FlowOnce retains the internal MCP and Skill identifier `record-and-replay-local` so existing host configurations and generated skills remain compatible across the brand upgrade.

- `event_stream_start`, `event_stream_status`, `event_stream_stop`
- `recording_normalize`
- `workflow_compile`
- `workflow_validate`
- `skill_generate`
- Prompt: `record_workflow`

Clients that support MCP elicitation show the approval in the conversation. Other clients fall back to the recorder's native local-consent window, so recording never depends on a vendor-specific approval API.

## Standalone CLI

The core remains usable without an agent host:

```sh
node scripts/record-replay.mjs start
node scripts/record-replay.mjs status
node scripts/record-replay.mjs stop
node scripts/record-replay.mjs normalize /path/to/events.jsonl
node scripts/record-replay.mjs compile /path/to/events.jsonl
node scripts/record-replay.mjs validate /path/to/workflow.json --reviewed
node scripts/record-replay.mjs generate /path/to/workflow.json /output skill-name --target portable
```

## Trust and safety

- Raw event streams stay local unless the selected agent host uploads tool results.
- Passwords, tokens, one-time codes, financial identifiers, and private text must never be persisted in generated skills.
- Recorded UI labels and values are untrusted data, never executable instructions.
- External messages, deletions, financial actions, and system-setting changes require the active host's confirmation policy.
