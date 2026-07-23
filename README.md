# FlowOnce

[![Version](https://img.shields.io/badge/version-0.3.3-blue)](https://github.com/ai-kangaroo/flowonce/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/ai-kangaroo/flowonce)
[![Hosts](https://img.shields.io/badge/hosts-CodeBuddy%20%7C%20WorkBuddy%20%7C%20Qoder%20%7C%20QoderWork%20%7C%20Codex-orange)](https://skillhub.cn/skills/flowonce)

**演示一次，随处复用。** FlowOnce 让 AI 看你做一遍，把 macOS 工作流录制为可复用、可换参数、跨宿主的 Agent 技能。

> No prompt engineering. Just show once, run anywhere.

---

## Quick Start

1. 下载安装包：[GitHub Releases](https://github.com/ai-kangaroo/flowonce/releases/latest/download/FlowOnce-macOS-Apple-Silicon.dmg)
2. 双击 **Install FlowOnce.app**
3. 在 **系统设置 → 隐私与安全性 → 辅助功能** 中启用 `FlowOnce.app`
4. 重启 AI 主机，说：`请用 FlowOnce 学习我接下来的操作`

📖 **普通用户请阅读 [中文使用手册](./docs/guides/user-guide.md)**（无需编程或终端）

❓ **遇到问题？查看 [常见问题 FAQ](./docs/guides/faq.md)**

---

## Features

| 特性 | 说明 |
|------|------|
| 语义录制 | macOS Accessibility API 捕获语义事件，非坐标重放 |
| 隐私优先 | 全程本地，敏感值强制占位符化，物理上无法写入技能包 |
| 人机确认 | 生成前必须人工确认，AI 是学徒不是黑盒 |
| 逐步验证 | 每个关键动作自动注入验证点，状态不符即停 |
| 跨宿主 | 一次录制，CodeBuddy / WorkBuddy / Qoder / QoderWork / Codex 通用 |

## How It Works

```
录制 → 语义归一化 → 编译 Workflow IR → 人机确认 → 校验生成技能
```

1. **录制**：用户在 macOS 上正常操作，FlowOnce 捕获 Accessibility 事件流
2. **归一化**：原始事件聚合为语义动作（点击、输入、快捷键等）
3. **编译**：生成宿主无关的 Workflow IR（草案）
4. **确认**：AI 拿草案找用户确认参数、验收标准、无关动作
5. **生成**：校验通过后生成可安装的 Agent 技能包

## Installation

### 一键安装（推荐）

下载 DMG → 双击 **Install FlowOnce.app** → 授予辅助功能权限 → 重启 AI 主机

[⬇️ 下载最新版](https://github.com/ai-kangaroo/flowonce/releases/latest/download/FlowOnce-macOS-Apple-Silicon.dmg)

### 开发者安装（无 DMG）

```sh
git clone https://github.com/ai-kangaroo/flowonce.git
cd flowonce
./scripts/build.sh
./scripts/install-recorder.sh

# 查看各主机 MCP 配置
node scripts/record-replay.mjs host-config codebuddy
```

## Usage

录制工作流：
```
1. 说：「请用 FlowOnce 学习我接下来的操作」
2. 说：「我准备好了，开始录制」
3. 正常操作 Mac
4. 点击悬浮窗 Stop，说：「我操作完了」
5. 确认 AI 的草案，生成并安装技能
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
```

## Trust & Safety

- 原始事件流**全程本地**，不上传云端
- 密码、Token、验证码等敏感值**编译期强制替换为占位符**
- 录制需**明确授权**，单次上限 30 分钟，Cancel 即丢弃
- 涉及删除、发消息、财务操作时，执行前**必须人工二次确认**

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
