# 深度 FAQ

覆盖边缘场景、工具兼容、安全合规等深度问题。

## 工具兼容

**Q1：FlowOnce 支持录制哪些 macOS 应用？**

任何使用标准 macOS Accessibility API 的原生或 Electron 应用。包括但不限于：Chrome/Safari 等浏览器、企业微信/微信/飞书/钉钉等 IM、VS Code/CodeBuddy/Qoder 等编辑器、终端/Terminal、Finder、系统设置面板等。

**不支持的场景**：全屏独占游戏、Metal/OpenGL 渲染窗口、部分 Java 应用（需单独配置 Accessibility 开关）。

**Q2：录制的技能能在 Windows/Linux 上回放吗？**

不能。FlowOnce 的事件流基于 macOS Accessibility + Core Graphics 生成，技能中的 UI 定位逻辑（role/title/axid）是 macOS 特有的。跨平台回放需要为每个平台重新录制。

**Q3：能否同时录制多个应用窗口的切换操作？**

可以。录制引擎自动跟踪所有活跃应用，窗口切换事件（`app_activate`）会被正常捕获并编入 Workflow IR。

**Q4：FlowOnce 与其他桌面自动化工具（如 AppleScript、Automator）的对比？**

| 维度 | FlowOnce | AppleScript | Automator |
|------|----------|-------------|-----------|
| 学习成本 | 零（录制即技能） | 需学习脚本语法 | 低（可视化编排） |
| 应用支持 | 所有（Accessibility 层） | 仅支持脚本化的应用 | 有限 |
| 跨应用编排 | 原生支持 | 需手动编写 | 有限 |
| 输出形式 | 可分享的 AI Skill | 脚本文件 | 工作流文件 |
| 适用场景 | AI 辅助操作 | 自动化运维 | 批量文件处理 |

**Q5：安装 FlowOnce 后影响系统性能吗？**

仅录制期间有轻微影响（事件采集模块常驻 30-50MB 内存）。不录制时后台零占用。

---

## 录制细节

**Q6：30 分钟录制限制能延长吗？**

不能。这是设计上限，旨在保持事件流大小可控和回放稳定性。超过 30 分钟的复杂工作流应拆分为多个独立录制，每个录制生成一个子技能，再通过编排技能串联。

**Q7：录制过程中可以暂停吗？**

不支持暂停。如需中场休息，建议停止当前录制、生成阶段性技能，然后重新录制下一段。

**Q8：外接显示器 + 笔记本内屏多屏环境下能正常录制吗？**

可以，但回放依赖录制的屏幕布局。如果录制时使用外接显示器（2560×1440），回放时切换到笔记本内屏（1512×982），窗口可能不在预期位置。建议在目标分辨率下录制。

**Q9：录制时网络不稳定会影响结果吗？**

不会。录制引擎不依赖网络，所有事件在本地采集和存储。但如果录制的操作本身涉及网络（如打开网页），回放时需要网络可用。

---

## 安全与隐私

**Q10：录制的内容是否会上传到云端？**

**不会。** FlowOnce 没有上传逻辑，没有遥测，没有后端服务器。所有事件流以本地 JSONL 文件存储在临时目录，录制结束后由 Agent 读取并处理。

**Q11：录制的 JSONL 文件包含什么数据？**

- 鼠标事件（点击位置、移动轨迹）
- 键盘事件（按键序列，不含 IME 组合态）
- 应用切换事件（app PID、bundle identifier、窗口标题）
- Accessibility 树快照（控件 role、title、value、层级关系）

**不包含**：屏幕截图、音频、剪切板明文、iCloud 数据。

**Q12：敏感信息如何保护？**

录制原始终身不离开本机。生成技能时，Agent 负责审查 Workflow IR 并将密码/Token/验证码等替换为命名占位符（`{{PASSWORD}}`）。参见 [anti-patterns 反模式 4](anti-patterns.md#反模式-4在生成的技能中硬编码敏感数据)。

**Q13：如何确保生成的技能不包含隐私信息？**

在调用 `skill_generate` 前，检查 Workflow IR 的每个 `input` 字段。如果发现以下模式，替换为占位符：

| 模式 | 占位符 |
|------|--------|
| 邮箱地址 | `{{USER_EMAIL}}` |
| 手机号 | `{{USER_PHONE}}` |
| 身份证号 | `{{ID_NUMBER}}` |
| 密码 | `{{USER_PASSWORD}}` |
| 银行卡号 | `{{BANK_CARD}}` |

---

## 运维管理

**Q14：如何升级 FlowOnce？**

重新运行安装器即可。安装器会自动覆盖旧版 App 和 MCP 配置，已生成的技能文件不受影响。

```bash
# 开发者从本地源码
./scripts/install-local.sh codex

# SkillHub 仅安装控制器 Skill
skillhub install flowonce --dir ~/.codebuddy/skills/
```

**Q15：如何完全卸载？**

删除以下 3 个位置即可彻底移除：

```bash
rm -rf ~/Applications/FlowOnce.app          # 录制引擎
rm -rf ~/.codebuddy/skills/record-and-replay-local/  # 技能定义
rm -rf ~/.codebuddy/automations/flowonce/   # 自动化配置（如有）
```

**Q16：升级后旧版生成的技能还能用吗？**

能。生成的技能是独立的 `SKILL.md` 文件，不受 FlowOnce 本体版本影响。如果新版 FlowOnce 修改了 MCP API，只需重新录制并重新生成技能。

**Q17：多个 AI 主机（CodeBuddy + Qoder + Codex）共用一套 FlowOnce 需要怎么配置？**

安装器会自动写入 CodeBuddy、WorkBuddy、Qoder 和 Codex 的 MCP 配置。QoderWork 需在其 MCP 设置中手动添加。如果手动维护：

```bash
node scripts/record-replay.mjs host-config codebuddy   # CodeBuddy
node scripts/record-replay.mjs host-config qoder       # Qoder
node scripts/record-replay.mjs host-config codex       # Codex
```

每个主机启动时会加载对应的 MCP 配置，都指向同一套 ``~/Applications/FlowOnce.app`` 引擎。

---

## 故障深入

**Q18：录制引擎崩溃后事件流还能用吗？**

如果崩溃前至少有一帧事件写入，`eventsPath` 中的 JSONL 可部分读取。但 `workflow_compile` 会报告不完整错误。建议重新录制完整流程。

**Q19：生成的技能回放卡住不动了怎么排查？**

1. 确认 UI 元素在屏幕上可见（未被其他窗口遮挡）
2. 检查窗口标题或 role 是否变化（应用更新可能导致 UI 树变化）
3. 如果原录制速度过快，尝试 re-record with slower pace
4. 查看技能文件中是否有坐标硬编码（坐标回放失败率高）

**Q20：MCP 工具安装后仍不可调用？**

常见原因：

| 症状 | 原因 | 解决 |
|------|------|------|
| 新安装后不可见 | 主机未完全重启 | `Cmd+Q` 彻底退出后重新打开 |
| 更新后不可见 | MCP 配置缓存 | 手动重启主机 |
| 始终不可见 | MCP 配置路径错误 | `node scripts/record-replay.mjs host-config <host>` 确认路径 |
