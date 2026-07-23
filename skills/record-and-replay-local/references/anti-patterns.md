# 反模式与常见错误

以下是 FlowOnce 使用中常见的错误做法及其改进方案。

## 反模式 1：授权错误路径

### ❌ 错误做法

用户将 Accessibility 权限授予 `bin/flowonce-recorder` 或插件目录下的二进制文件。

**后果**：录制引擎永远无法启动，陷入"已授权仍报权限错误"的循环。

### ✅ 正确做法

始终授权 **`~/Applications/FlowOnce.app`**（安装器创建的稳定副本）。安装时引导用户：

> 在 System Settings → Privacy & Security → Accessibility 中，点击 +，导航到 `~/Applications/`，选择 `FlowOnce.app`。

### 原理

macOS 的 Accessibility 权限绑定到应用的代码签名和路径。`bin/` 下的版本是构建产物，每次重新编译后签名变化，权限立即失效。`~/Applications/FlowOnce.app` 是安装器写入的稳定副本，签名不变。

---

## 反模式 2：权限循环中反复重试

### ❌ 错误做法

发现 `permissionRequired: true` 或 `accessibilityTrusted: false` 后，不引导用户授权，而是反复调用 `event_stream_start` 重试。

**后果**：每次重试产生一个新的废弃会话，浪费资源，用户困惑。

### ✅ 正确做法

```
1. 读取 start 返回的 permissionInstructions
2. 明确告知用户需要授权的具体路径
3. 确认 FlowOnce 自动丢弃了权限会话（不调用 stop）
4. 等用户授权完成后，起一次全新的记录会话
```

---

## 反模式 3：从权限会话生成技能

### ❌ 错误做法

忽略 `accessibilityTrusted: false` 标志，直接读取 `eventsPath`，发现里面有事件就试图生成技能。

**后果**：生成一个只包含系统权限弹窗的无效技能，后续无法正常回放。

### ✅ 正确做法

```javascript
// 读取元数据时检查状态
if (metadata.recording_controls_cancelled || metadata.accessibility_permission_required) {
  // 废弃该会话，不调用 skill_generate
  return "本次录制会话已因权限/取消而废弃，请授权后重新录制。";
}
```

---

## 反模式 4：在生成的技能中硬编码敏感数据

### ❌ 错误做法

录制过程中捕获了密码、Token、一次性验证码、银行卡号等敏感信息，直接写入生成的 Skill。

**后果**：生成的技能包一旦分享或泄漏，敏感信息随之暴露。

### ✅ 正确做法

审查 Workflow IR 时，将所有敏感值替换为命名占位符：

| 敏感类型 | 占位符格式 |
|---------|-----------|
| 密码 | `{{USER_PASSWORD}}` |
| API Token | `{{API_TOKEN}}` |
| 手机号 | `{{USER_PHONE}}` |
| 验证码 | `{{OTP_CODE}}` |

---

## 反模式 5：生成技能含坐标硬编码

### ❌ 错误做法

`skill_generate` 时保留原始鼠标点击坐标（`x: 342, y: 517`）。

**后果**：窗口大小、屏幕分辨率变化后技能完全失效。

### ✅ 正确做法

用语义目标替代坐标：

```
❌ "click at (342, 517)"
✅ "click the 'Submit' button (role: button, title: '提交')"
```

---

## 反模式 6：录制速度过快导致回放不稳定

### ❌ 错误做法

快速连续点击，上一个 UI 状态还未稳定就触发下一个操作。

**后果**：回放时出现"元素未找到"、"超时"等错误。

### ✅ 正确做法

- 每步操作后等待 UI 状态稳定（如进度条消失、新窗口完全加载）
- 如果步骤较长，录制时保持自然节奏
- 回放时启用自动等待（大多数回放引擎默认开启）

---

## 禁忌清单

| 禁止行为 | 说明 |
|---------|------|
| 硬编码 API Key/Token/密码 | 用占位符替代 |
| 授权 `bin/` 下的二进制 | 只授权 `~/Applications/FlowOnce.app` |
| 从废弃会话生成技能 | 检查 `accessibility_permission_required` 标志 |
| 坐标回放 | 用语义目标（role/title/identifier） |
| 录制速度过快 | 等待每步 UI 稳定 |
| 在技能包中包含个人文件路径 | 抽象为参数化输入 |
| 向第三方上传录制数据 | 全部本地处理 |
