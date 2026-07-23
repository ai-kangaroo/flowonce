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

FlowOnce 是一个 **macOS 桌面操作录制引擎**。你演示一遍操作，AI 自动把操作流编译成一个可复用的 Skill，后续只需一句话就能自动回放。整个过程发生在本机，数据不上传云端。

## 快速开始

**新手 30 秒上手**：安装 → 说"帮我录一个 XX 操作" → 执行操作 → 回来说"录好了" → AI 自动生成技能。

### 开场白示例（直接复制使用）

```
✅ "帮我录一个在企业微信里批量发消息的操作流程"
✅ "帮我录一个在浏览器里导出 CSV 并发送邮件的操作"
✅ "我演示一遍 PR 提交流程，你帮我生成一个自动化技能"
```

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

> **Privacy**: 录制数据全生命周期说明：
> - **录制时**：事件流以 JSONL 格式写入系统临时目录（`$TMPDIR/flowonce/`），不截图、不录音、不访问剪切板
> - **编译时**：Agent 读取事件文件进行 Workflow IR 编译，原始 JSONL 和编译产物均存储在本地
> - **生成后**：原始事件流在会话结束后自动清理；生成的 Skill 文件不含任何录制原始数据
> - **全程**：无上传逻辑，无遥测上报，无后端服务器，数据不离开本机
>
> FlowOnce requires macOS Accessibility permission only to observe and replay UI actions — the same permission used by VoiceOver and other assistive technologies. You can revoke it anytime in System Settings → Privacy & Security → Accessibility.

## 能力边界说明

FlowOnce 专注于 **macOS 桌面操作录制与技能生成**，以下清晰定义它能做什么、需要什么、不做什么。

### ✅ 擅长处理

1. **录制 macOS GUI 操作**：浏览器、IM（企业微信/微信/飞书/钉钉）、编辑器（VS Code/CodeBuddy/Qoder）、终端、Finder、系统设置等任何使用标准 Accessibility API 的应用
2. **跨应用编排**：自动捕获窗口切换、应用激活事件，生成完整的多应用操作流
3. **编译为可复用技能**：将事件流编译为结构化 Workflow IR，生成可在不同主机上回放的便携 Skill
4. **语义化 UI 定位**：用 Accessibility role/title/identifier 定位控件，而非坐标，保证跨分辨率回放稳定性
5. **多平台技能生成**：支持 portable / workbuddy / codex 三种 target 格式
6. **命令行独立使用**：脱离 MCP 主机可直接用 CLI 录制和回放

### ⚠️ 需要提供

1. **安装了 FlowOnce 的 macOS 主机**：需自行下载安装（[GitHub Release](https://github.com/ai-kangaroo/flowonce/releases) 或 [SkillHub](https://skillhub.cn/skills/flowonce)）
2. **录制目标应用**：需在录制前打开并准备好要操作的应用（如已登录的企业微信、已打开的目标网页）
3. **明确的业务流程**：录制前想清楚要演示的操作步骤，避免录制中频繁犹豫和撤销

### ❌ 超出范围（附替代方案）

1. **非 macOS 平台录制**：FlowOnce 依赖 macOS Accessibility API，不支持 Windows 或 Linux → 各平台用对应的桌面自动化工具（Windows: Power Automate，Linux: xdotool）
2. **全屏独占游戏或 3D 渲染窗口录制**：Accessibility 树不可用 → 用屏幕录制工具
3. **语音或音频操作**：引擎不处理音频输入 → 用 macOS 听写或第三方语音控制工具
4. **云端部署或远程执行**：录制和回放必须在本地 macOS 机器上 → 远程场景用 SSH 脚本或 Ansible
5. **帮你编写 Skill 内容**：只负责录制和编译，不代写 Skill 业务逻辑 → 用 skill-creator 创建新技能

## 触发路由

FlowOnce 根据用户意图自动路由到对应流程：

| 用户说（中文） | 用户说（English） | 路由流程 | 说明 |
|------|------|------|------|
| "帮我录一个 XX 操作" / "录个流程" | "Record a workflow" / "Record me doing X" | → Record | 录制新操作流 |
| "录好了" / "录完了" / "停止了" | "Done recording" / "Finished" / "I'm back" | → Interpret | 停止录制并编译 |
| 提到 FlowOnce 但不确定状态 | "FlowOnce" / "record" / "replay" | → Environment Check | 先检查安装状态 |
| "回放之前录的 XX" | "Replay the X skill" / "Run the recorded skill" | → 使用已生成的 Skill | 不经过录制流程 |
| "帮我检查安装状态" / "MCP 工具不可用" | "Check if FlowOnce is installed" | → Environment Check → Install guide | 引导安装 |

## 受众说明

| 用户类型 | 如何使用 |
|---------|---------|
| **个人开发者** | 直接触发录制，生成技能后个人使用。最简路径：安装 → 录制 → 自动生成 → 一句话回放 |
| **团队用户** | 一人录制标准操作流，生成 portable 技能后分享给团队。其他成员安装 FlowOnce 后直接加载技能文件即可回放 |
| **企业 IT / 运维** | 用 CLI 模式（`node scripts/record-replay.mjs`）集成到自动化管道，无需 MCP 主机。支持命令行录制和回放验证 |
| **Skill 创作者** | 将 FlowOnce 作为技能生产工具——录制 macOS 操作 → 编译 Workflow IR → 审查优化 → 生成并发布到 SkillHub |

### 定制化使用

可在触发时传入以下参数：

- **生成平台**：录制后指定 `target: portable`（默认，跨平台通用）/ `target: workbuddy`（含上传包）/ `target: codex`（含 OpenAI 元数据）
- **回放后端**：生成技能时选择执行后端——优先专用 connector/API/CLI，其次语义浏览器自动化，最后原生 UI 控制
- **严格模式**：`"完整审查"` → Agent 在审查 Workflow IR 时逐步骤确认，不跳过任何有歧义的地方
- **快速模式**：`"快速生成"` → Agent 假设演示的操作流正确，跳过详细审查直接生成技能

## 安全性约束

- **本地优先**：所有录制数据存储在本地临时目录，不包含上传逻辑，无遥测，无后端服务器
- **敏感信息保护**：审查 Workflow IR 时必须将密码、Token、验证码、金融标识、个人身份信息替换为命名占位符（`{{PASSWORD}}`、`{{API_TOKEN}}` 等）
- **权限最小化**：仅请求 macOS Accessibility 权限（与 VoiceOver 等辅助功能同级），不请求屏幕录制、麦克风、摄像头权限
- **禁止行为**：
  - 禁止将录制数据上传到任何云服务
  - 禁止在生成的 Skill 中硬编码真实密码 / Token / 身份证号 / 银行卡号
  - 禁止引导用户分享他人账号密码
  - 禁止在 Skill 中包含个人身份信息（手机号、邮箱、地址）
  - 禁止伪造用户身份执行自动化操作

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
- **卸载**：删除 `~/Applications/FlowOnce.app` 和 `~/.codebuddy/skills/record-and-replay-local/`（或对应主机的技能目录）

## 参考文档

- `references/anti-patterns.md` — 6 类常见错误做法 + 改进对比案例 + 禁忌清单
- `references/faq-deep.md` — 深度 FAQ（20 题，覆盖工具兼容/录制细节/安全隐私/运维管理/故障深入）
