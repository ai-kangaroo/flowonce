# FlowOnce

[![Version](https://img.shields.io/badge/version-0.4.0-blue)](https://github.com/ai-kangaroo/flowonce/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/ai-kangaroo/flowonce)
[![Hosts](https://img.shields.io/badge/hosts-CodeBuddy%20%7C%20WorkBuddy%20%7C%20Qoder%20%7C%20QoderWork%20%7C%20Codex-orange)](https://skillhub.cn/skills/flowonce)

**演示一次，随处复用。** FlowOnce 让 AI 看你做一遍，把 macOS 工作流录制为可复用、可换参数、跨宿主的 Agent 技能。

> No prompt engineering. Just show once, run anywhere.

---

## Quick Start

1. 从 [SkillHub](https://skillhub.cn/skills/flowonce) 安装 FlowOnce Skill
2. 直接说：`请用 FlowOnce 学习我接下来的操作`
3. 首次使用时，FlowOnce 自动选择、下载、校验并准备本地引擎
4. 免费预览版按 macOS 提示“仍要打开”一次，再开启一次“辅助功能”权限，然后开始演示

第一次体验无需选择芯片、配置 MCP、打开终端或重新创建对话。生成后 FlowOnce 会自动安装技能，并用变化后的安全参数复现一次；这次成功复现才算完成首次体验。

📖 **普通用户请阅读 [中文使用手册](./docs/guides/user-guide.md)**（无需编程或终端）

❓ **遇到问题？查看 [常见问题 FAQ](./docs/guides/faq.md)**

---

## Features

| 特性 | 说明 |
|------|------|
| 语义录制 | macOS Accessibility API 捕获语义事件，非坐标重放 |
| 隐私优先 | 全程本地，敏感值强制占位符化，物理上无法写入技能包 |
| 置信度审查 | 高置信度推断自动采用，只把会改变结果的低置信度问题集中问一次 |
| 逐步验证 | 每个关键动作自动注入验证点，状态不符即停 |
| 自动试跑 | 生成后默认安全试跑，记录逐步证据；安全试跑失败时自动修订并最多重试两轮 |
| 长任务不假失败 | 归一化、编译和生成使用后台 Job，立即返回进度；相同请求自动复用，避免 MCP 超时后重复生成 |
| 首次自举 | Skill 自动选择架构、下载、校验和准备本地引擎；免费预览版只保留“仍要打开”和辅助功能两次 macOS 强制确认 |
| Aha 验证 | 生成后自动安装，并用变化后的安全参数复现一次；不把“生成文件”误报为成功 |
| 回放预检 | 录制前确认当前宿主具备适合目标应用的执行后端；不能保证复现时提前说明并推荐可成功的首次体验 |
| 语义蒸馏 | 自动把输入识别为搜索词、联系人、消息、文件路径等，并为文本输入生成精确值断言 |
| 蒸馏摘要卡 | 只向小白展示学会的目标、可变内容、确认边界和成功标准；仅在低置信度时提一个合并问题 |
| 本地 Aha 漏斗 | 只在本机记录阶段、状态、耗时和错误码，不记录用户内容，也不自动上传 |
| 跨宿主 | 一次录制，CodeBuddy / WorkBuddy / Qoder / QoderWork / Codex 通用 |

## How It Works

```
录制 → 语义归一化 → 编译 Workflow IR → 人机确认 → 生成 → 安全试跑 → 评测修订
```

1. **录制**：用户在 macOS 上正常操作，FlowOnce 捕获 Accessibility 事件流
2. **归一化**：原始事件聚合为语义动作（点击、输入、快捷键等）
3. **编译**：生成宿主无关的 Workflow IR（草案）
4. **审查**：自动采用高置信度推断，只集中确认会实质改变结果的低置信度问题
5. **生成**：校验通过后生成可安装的 Agent 技能包
6. **试跑**：宿主使用不同参数执行生成的技能；默认停在外部发送、删除、付款、覆盖已有内容等动作之前
7. **评测**：保存逐步结果；安全试跑失败时按证据修订并最多自动重试两轮

## Installation

### 一键安装（推荐）

从 SkillHub 安装控制 Skill，之后直接说“帮我录一个操作”。Skill 会运行自带的 bootstrap，自动选择架构并校验安装包。免费预览版用户只需完成 macOS 不允许代操作的“仍要打开”和辅助功能授权。

免费预览包使用 ad-hoc 签名，bootstrap 在执行前验证对应 Release 的 SHA-256 和代码签名完整性。若 Gatekeeper 阻止启动，bootstrap 会打开 macOS 官方的单 App 例外页面；不要关闭 Gatekeeper 或运行 `xattr`。未来正式版仍以 Developer ID 签名和 Apple 公证为发布标准。

### 手动安装（自动准备不可用时）

[⬇️ Apple Silicon](https://github.com/ai-kangaroo/flowonce/releases/latest/download/FlowOnce-macOS-Apple-Silicon.dmg) · [⬇️ Intel](https://github.com/ai-kangaroo/flowonce/releases/latest/download/FlowOnce-macOS-Intel.dmg)

### 开发者安装（无 DMG）

```sh
git clone https://github.com/ai-kangaroo/flowonce.git
cd flowonce
./scripts/install-local.sh codex

# 查看各主机 MCP 配置
node scripts/record-replay.mjs host-config codebuddy

# 一次检查版本、录制器、辅助功能权限、MCP 与 Skill
node scripts/record-replay.mjs doctor codex

# 录制前确认当前宿主能否复现目标操作
node scripts/record-replay.mjs preflight "Google Chrome" browser browser-control
node scripts/record-replay.mjs summarize /path/to/reviewed-workflow.json
node scripts/record-replay.mjs journey-status

# 仅用于本地开发：无备份清理旧安装并全新安装到 Codex
node scripts/reset-local-install.mjs --yes-delete-without-backup
```

### 正式发布验收

公开包必须同时包含 Apple Silicon 与 Intel，并通过签名、公证、Gatekeeper、自包含载荷和 SHA-256 检查：

```sh
FLOWONCE_PUBLIC_RELEASE=1 \
RECORD_REPLAY_SIGN_IDENTITY="Developer ID Application: ..." \
RECORD_REPLAY_NOTARY_PROFILE="flowonce-notary" \
scripts/build-distribution.sh dist

scripts/verify-public-release.sh dist

node scripts/verify-release-readiness.mjs \
  --dist dist \
  --skill /path/to/exported-skillhub/SKILL.md

# 在干净 macOS 用户账号完成授权后，验证两分钟首次就绪目标
node scripts/verify-first-run-acceptance.mjs \
  --home "$HOME" \
  --skill /path/to/exported-skillhub/SKILL.md \
  --started-at 2026-07-24T10:00:00+08:00
```

Intel 包需在 x86_64/Rosetta 构建环境中使用 x64 Node 重复运行构建命令。发布同步闸门会拒绝仓库、双架构安装包和交付 Skill 版本不一致。只有两个检查都完整通过后，才能先发布 GitHub `v0.4.0` Release，再更新 SkillHub Skill。

## Usage

录制工作流：
```
1. 说：「请用 FlowOnce 学习我接下来的操作」
2. 首次使用时按提示完成系统授权
3. FlowOnce 先确认当前宿主具备适合目标应用的回放能力
4. 说：「我准备好了，开始录制」
5. 正常操作 Mac，完成后回来说：「录好了」
6. FlowOnce 自动整理、生成、安装并进行安全试跑
7. FlowOnce 自动换一组安全参数完成首次复现；复现成功即到达 Aha 时刻
```

使用技能：
```
新建对话，告诉 AI 要做什么，并提供本次的参数值即可。
```

### Standalone CLI

无需 AI 主机，直接命令行操作：

```sh
node scripts/record-replay.mjs start
node scripts/record-replay.mjs stop
node scripts/record-replay.mjs normalize /path/to/events.jsonl
node scripts/record-replay.mjs compile /path/to/events.jsonl
node scripts/record-replay.mjs generate /path/to/workflow.json /output skill-name --target portable
node scripts/record-replay.mjs test-start /output/skill-name /path/to/test-inputs.json --backend <backend>
node scripts/record-replay.mjs test-finish <run-id> /path/to/test-result.json
node scripts/record-replay.mjs test-status [run-id]
node scripts/record-replay.mjs doctor [host]
```

## Trust & Safety

- 原始事件流**全程本地**，不上传云端
- 首次 bootstrap 仅从官方 GitHub Release 下载安装包和校验文件，不上传设备信息或录制内容；免费预览版会校验 SHA-256 和 ad-hoc 代码签名完整性
- 密码、Token、验证码等敏感值**编译期强制替换为占位符**
- 录制需**明确授权**，单次上限 30 分钟，Cancel 即丢弃
- 涉及删除、发消息、财务操作时，执行前**必须人工二次确认**
- 安全试跑默认在外部或不可逆动作前停止；评测报告不保存测试输入值

详见 [安全策略](./SECURITY.md)。

## Contributing

欢迎贡献代码、报告问题或提出建议！

- [贡献指南](./CONTRIBUTING.md)
- [行为准则](./CODE_OF_CONDUCT.md)
- [报告 Bug](https://github.com/ai-kangaroo/flowonce/issues/new?assignees=&labels=bug&template=bug_report.md)
- [请求功能](https://github.com/ai-kangaroo/flowonce/issues/new?assignees=&labels=enhancement&template=feature_request.md)

## Changelog

详见 [CHANGELOG.md](./CHANGELOG.md)。

## License

[MIT](./LICENSE) © FlowOnce Contributors
