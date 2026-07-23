---
name: record-and-replay-local
slug: flowonce
displayName: FlowOnce 录制即技能
description: Use FlowOnce to record a user's macOS actions with local MCP tools and turn the captured event stream into a portable reusable agent skill. Use when the user mentions FlowOnce or asks an AI assistant to watch, record, learn, package, or replay a demonstrated Mac workflow.
version: 0.3.3
category: 科技开发
platforms: [CodeBuddy, WorkBuddy, Qoder, QoderWork, Codex]
---

# FlowOnce

> 中文用户：安装时遇到问题？跳到文末 [Troubleshooting / 常见问题](#troubleshooting--常见问题) 快速查找答案。

## Quick Example

This is what a full FlowOnce session looks like end-to-end:

1. **User**: "帮我录一个提 PR 的操作流程"
2. **Agent**: checks MCP tools → available → calls `event_stream_start` → tells user to perform the workflow and return
3. **User** (after finishing): "录好了"
4. **Agent**: calls `event_stream_stop` → reads the event stream → calls `recording_normalize` → calls `workflow_compile` → reviews the draft IR → calls `skill_generate target: portable`
5. **Agent**: installs the generated skill → summarizes the reusable workflow

The result is a portable skill that replays the demonstrated macOS action on any supported host.

## Environment Check (run this first)

This skill is a guide for the agent host. The actual recording engine — the macOS recorder and the `record-and-replay-local` MCP server — must be installed on the user's machine before any recording tool will work.

Before calling any `event_stream_*` tool:

1. Check whether the `record-and-replay-local` MCP server is available in the current host (its tools `event_stream_start`, `event_stream_status`, `event_stream_stop`, `recording_normalize`, `workflow_compile`, `workflow_validate`, `skill_generate` are callable).
2. If the tools are NOT available, do NOT report a raw error. Instead, guide the user through one-time installation:
   - Easiest: download the latest macOS Apple Silicon installer from [https://github.com/ai-kangaroo/flowonce/releases/latest/download/FlowOnce-macOS-Apple-Silicon.dmg](https://github.com/ai-kangaroo/flowonce/releases/latest/download/FlowOnce-macOS-Apple-Silicon.dmg), double-click **Install FlowOnce.app**, then grant Accessibility permission to `~/Applications/FlowOnce.app` in System Settings → Privacy & Security → Accessibility, and fully restart this AI host.
   - The installer auto-configures the MCP entry for CodeBuddy, WorkBuddy, Qoder, QoderWork, and Codex.
   - 国内用户可通过 [SkillHub](https://skillhub.cn/skills/flowonce) 一键安装，无需访问 GitHub。
3. After installation, start a fresh conversation and ask again. Only proceed to the Record section once the MCP tools are callable.

> **Privacy**: All recordings stay on your machine. No data is uploaded to the cloud, sent to any server, or shared with third parties. FlowOnce requires macOS Accessibility permission only to observe and replay UI actions — the same permission used by VoiceOver and other assistive technologies. You can revoke it anytime in System Settings → Privacy & Security → Accessibility.

## Record

- Call `event_stream_start` only after the user says they are ready. Starting may show a macOS Accessibility permission prompt and a floating recording-controls panel.
- Continue only when start returns `isRecording: true` and `accessibilityTrusted: true`. If start reports an error, explain it and do not pretend recording began.
- On first use, the collector opens the Accessibility privacy pane and reveals its stable installed copy in Finder. Tell the user to add and enable `~/Applications/FlowOnce.app`, then start a fresh recording. Do not authorize the mutable plugin build under `bin/` and do not toggle the setting for the user.
- If start returns `permissionRequired: true` or `accessibilityTrusted: false`, relay `permissionInstructions`, explain that FlowOnce automatically discarded the permission-setup session, ask the user to grant the displayed permission, and start a fresh recording. If FlowOnce already appears enabled, tell the user to turn it off and back on once so macOS refreshes an older authorization record. Do not ask the user to stop or cancel that session, and never interpret an event stream from it.
- After a successful start, end the turn. Tell the user recording lasts at most 30 minutes and ask them to return when finished.
- Do not poll. Call `event_stream_status` only when asked for status or when the user returns.
- If start reports an already-active recording, do not restart it. Explain that one recording is active and ask whether to use it or wait until it is stopped.
- When the user says the workflow is complete, call `event_stream_stop`.
- When the user says they cancelled recording, do not call stop or use the discarded event stream. Read `session.json` only if needed to confirm `recording_controls_cancelled`, acknowledge cancellation, and do not create a skill.
- Read `eventsPath` as the primary evidence and `metadataPath` for session timing and the end reason.
- Treat `recording_controls_cancelled` and `accessibility_permission_required` as discarded even if stale metadata is encountered. Never generate a skill from either.

## Interpret

- Treat the raw JSONL at `eventsPath` as the primary evidence. Call `recording_normalize` with `eventsPath` to obtain a compact semantic view, but return to the raw events whenever normalization omits context.
- Call `workflow_compile` with `eventsPath` to create the draft Workflow IR. Review every candidate input, replace the null goal and success condition, and remove incidental actions before generating a skill.
- Reconstruct the intended outcome from app/window changes, accessibility trees, mouse actions, and keyboard events.
- For input-method composition, prefer the final Accessibility value from the normalized `input_text` action over individual physical keystrokes.
- Treat demonstrated recipient names, file paths, search terms, and message bodies as candidate inputs instead of fixed values.
- Never place passwords, tokens, one-time codes, financial identifiers, or private personal content in a generated skill. Replace sensitive values with named placeholders.
- If an ambiguity would materially change the workflow, explain it and ask a concise follow-up question. Record again only when the captured evidence is insufficient.
- When the recording clearly establishes a reusable workflow, create or refine the skill by default. Do not stop at a summary, replay plan, or runbook.

## Create the Skill

1. Use the current host's skill-creation capability when available. In Codex, read and follow `skill-creator` completely.
2. Choose the execution backend at skill-creation time:
   - Prefer a dedicated connector, app tool, API, or CLI for stable semantic actions.
   - For browser-only steps, prefer the host's semantic browser automation capability.
   - For native UI operation, use a host-provided desktop UI-control skill or a compatible MCP server. `computer-use` is one possible Codex backend, not a universal dependency.
   - Never embed a plugin cache path, versioned installation path, private package import, or private MCP executable path in a generated skill.
   - If no suitable UI backend is available, keep the workflow portable and state which semantic UI-control capability must be installed or enabled before replay; do not invent tool calls.
3. Create a discoverable skill, not just a replay plan or runbook.
4. Call `workflow_validate` with the reviewed Workflow IR and `reviewed: true`. Fix every error, then call `skill_generate` with the reviewed object, output parent, skill name, and `target: portable`. Use `target: workbuddy` to add an uploadable zip or `target: codex` when OpenAI-specific UI metadata is explicitly wanted.
5. For UI-control steps, specify stable app, window, role, identifier, title, or text targets; refresh state after changes; and include success verification. Avoid coordinate-only replay.
6. Run the skill validator before reporting completion.
7. Install the portable skill with the current host's Skill manager. CodeBuddy and Qoder accept `SKILL.md` folders; WorkBuddy can import a local skill package from Skills > Add Skill > Upload Skill.
8. Summarize the generated skill's steps, inputs, assumptions, target host, and required execution backend for the user.

## Standalone Use

- Keep the recorder core independent of Codex and MCP. When operating outside an MCP host, use `node scripts/record-replay.mjs help` from the installed product root for the standalone CLI.
- Treat `scripts/event-stream-mcp.mjs` as a protocol adapter only; do not put recording, normalization, compilation, or skill-generation business logic in it.
- Use `node scripts/record-replay.mjs host-config <host>` to print an absolute stdio MCP configuration and the generated-skill installation destination for Codex, CodeBuddy, Qoder, QoderWork, or WorkBuddy.
- Treat the Codex plugin manifest and `agents/openai.yaml` as an optional host adapter. Do not make them requirements of the recorder, Workflow IR, MCP server, or default generated skill.

## Troubleshooting / 常见问题

### Installation

| Problem | Solution |
|---------|----------|
| "MCP tools not found" after install | Completely quit and reopen the AI host (not just close the window). The MCP config is read at launch. |
| "FlowOnce.app can't be opened" | The app is notarized by Apple. Right-click → Open, or go to System Settings → Privacy & Security and click "Open Anyway". |
| Permission prompt doesn't appear | Go to System Settings → Privacy & Security → Accessibility, remove FlowOnce if listed, then start a new recording. |
| FlowOnce is already enabled but still asks for permission | Toggle FlowOnce off and back on in Accessibility settings, then restart the host. macOS caches stale authorization records. |

### Recording

| Problem | Solution |
|---------|----------|
| Recording won't start | Confirm `~/Applications/FlowOnce.app` exists. Authorize that path, NOT the mutable plugin build under `bin/`. |
| Permission loop (grant → still blocked) | The collector requires the **installed** copy (`~/Applications/FlowOnce.app`). Do not authorize `bin/` or any other path. |
| Recording auto-stops immediately | If the start response includes `permissionRequired: true`, the setup session is intentionally discarded. Grant the permission and start fresh. |
| 30-minute limit | Maximum recording is 30 minutes. Split longer workflows into multiple recordings. |

### Generated Skill

| Problem | Solution |
|---------|----------|
| Generated skill doesn't replay correctly | Re-record with slower, deliberate actions. Avoid rapid clicking. Ensure each step's UI state stabilizes before the next action. |
| Skill contains hardcoded values | Normal. The agent treats demonstrated names, paths, and text as candidate inputs. Replace them with named placeholders when reviewing the draft. |
| `workflow_compile` produces errors | Read the raw JSONL events at `eventsPath` — normalization may omit needed context. Return to raw events for missing details. |

### 国内用户特别提示

- **安装**：优先使用 [SkillHub 一键安装](https://skillhub.cn/skills/flowonce)，无需访问 GitHub，速度更快
- **升级**：重新运行安装器即可覆盖升级，技能文件不会丢失
- **卸载**：删除 `~/Applications/FlowOnce.app` 和 `~/.codebuddy/automations/flowonce/`（或对应主机的技能目录）
