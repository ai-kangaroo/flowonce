# 贡献指南

感谢你对 FlowOnce 的兴趣！本文档帮助你快速参与项目。

## 开发环境

### 前置要求

- macOS（录制引擎依赖 Accessibility API）
- Node.js 18+
- Xcode Command Line Tools

### 本地搭建

```sh
git clone https://github.com/ai-kangaroo/flowonce.git
cd flowonce

# 构建原生录制器
./scripts/build.sh
./scripts/install-recorder.sh

# 验证安装
node scripts/record-replay.mjs help
```

### 运行测试

```sh
./scripts/test.sh
```

## 贡献流程

1. **Fork** 仓库并创建分支：`git checkout -b feat/your-feature`
2. **开发**：保持改动聚焦，一个 PR 只做一件事
3. **测试**：确保 `./scripts/test.sh` 通过
4. **TRACE 自检**：SKILL.md 发生重大修改时，运行 TRACE 五维度自检（见下方）
5. **提交**：使用清晰的 commit message
6. **PR**：填写 PR 模板，说明改动内容和原因

### TRACE 自检（发布前质量闸门）

每次修改 `skills/record-and-replay-local/SKILL.md` 核心内容后，必须先通过 TRACE 五维度自检，确保全部 20 项达标（≥5.0）后再推送更新到 SkillHub。

**触发方式**：
```
对 /Users/acho/IdeaProjects/flowonce/skills/record-and-replay-local/SKILL.md 做全量 TRACE 自检
```

**一句话流程**：读取 SKILL.md → 对照20个检查项逐项打分 → 找出 <5.0 的子项 → 修改 → 重打分 → 全部 5.0 才结束。

**五维度速查**：

| 维度 | 核心问题 | 关键检查项 |
|------|---------|-----------|
| **T·Trust** | 能不能放心用？ | 国内适配、安全性、边界透明、数据隐私 |
| **R·Reliability** | 能不能稳定用？ | 异常处理、功能完善、运行稳定、降级兜底 |
| **A·Adaptability** | 该不该在这个场景用？ | 边界定义、触发精确度、受众广度、定制化 |
| **C·Convention** | 能不能被理解？ | 渐进式披露、结构清晰、反模式说明、FAQ 深度 |
| **E·Effectiveness** | 是否真正解决问题？ | 输出准确性、内容完整度、创造力增值、开箱即用 |

详细评分标准见 skill-trace-checker 的 `references/trace-criteria-detail.md`。

### Commit 规范

```
<type>: <description>

[optional body]
```

类型：`feat`（新功能）、`fix`（修复）、`docs`（文档）、`refactor`（重构）、`chore`（杂项）

### 代码风格

- JavaScript：遵循现有风格，使用双引号，无分号
- Shell：POSIX 兼容，`#!/bin/sh`
- 文档：中英双语，英文为主，用户文档用中文

## 目录结构

```
scripts/          构建脚本和核心工具链
skills/           技能定义文件（SKILL.md + agents/）
docs/
  images/         文档配图（演示截图等）
  guides/         用户手册（user-guide.md、faq.md）
  share/          公众号草稿（不纳入 git）
tests/            可公开复现的测试与合成 fixtures
bin/              构建产物
dist/             分发制品（DMG、ZIP 等）
```

## 安全约束

- **禁止**在代码、文档、测试中硬编码 API Key、Token 或密码
- **禁止**在生成的技能包中包含敏感个人信息
- 录制的事件流是本地文件，不要添加任何上传逻辑

## 行为准则

参与本项目请保持友善和尊重。骚扰、歧视或人身攻击不可接受。

## License

提交的代码将在 [MIT License](./LICENSE) 下发布。
