#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const eventsPath = process.argv[2];
if (!eventsPath) {
  process.stderr.write("Usage: compile-workflow.mjs <events.jsonl>\n");
  process.exit(2);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const normalized = JSON.parse(execFileSync(process.execPath, [join(root, "scripts", "normalize-recording.mjs"), eventsPath], { encoding: "utf8" }));
const inputs = [];
let inputIndex = 0;
const usedInputNames = new Set();

function timeDeltaMs(prevTimestamp, currentTimestamp) {
  if (!prevTimestamp || !currentTimestamp) return null;
  const prev = Date.parse(prevTimestamp);
  const current = Date.parse(currentTimestamp);
  if (Number.isNaN(prev) || Number.isNaN(current)) return null;
  const delta = current - prev;
  if (delta < 0 || delta > 300000) return null;
  return delta;
}

function targetLabel(target = {}) {
  const parts = [];
  if (target.title) parts.push(`"${target.title}"`);
  if (target.role) parts.push(`[${target.role}]`);
  if (target.identifier) parts.push(`#${target.identifier}`);
  return parts.join(" ") || "UI element";
}

function uniqueInputName(base) {
  let name = base;
  let suffix = 2;
  while (usedInputNames.has(name)) {
    name = `${base}_${suffix}`;
    suffix += 1;
  }
  usedInputNames.add(name);
  return name;
}

function inferInputName(action, index) {
  if (action.redacted) {
    const context = JSON.stringify({
      identifier: action.target?.identifier,
      title: action.target?.title
    }).toLowerCase();
    if (/(password|passwd|passcode|密码|口令)/u.test(context)) return uniqueInputName("password");
    if (/(token|api.?key|access.?key|令牌|密钥)/u.test(context)) return uniqueInputName("api_token");
    return uniqueInputName(`sensitive_input_${index}`);
  }
  const targetContext = [
    action.target?.identifier,
    action.target?.title,
    action.target?.role
  ].filter(Boolean).join(" ").toLowerCase();
  const rules = [
    ["search_term", /(search|query|keyword|搜索|关键词|查询)/u],
    ["recipient", /(recipient|contact|member|group|chat|conversation|收件人|联系人|群聊|会话)/u],
    ["message", /(message|composer|chat.?input|消息|正文|发送内容)/u],
    ["email_address", /(e-?mail|邮箱|邮件地址)/u],
    ["subject", /(subject|主题|标题)/u],
    ["file_path", /(\b(?:file|folder|path|filename)\b|文件|目录|路径)/u],
    ["url", /(\b(?:url|website)\b|address.?bar|网址|链接|地址栏)/u],
    ["date", /(\bdate\b|日期)/u],
    ["time", /(\btime\b|时间)/u],
    ["amount", /(\b(?:amount|price|money)\b|金额|价格)/u],
    ["name", /(\bname\b|姓名|名称)/u]
  ];
  for (const [name, pattern] of rules) {
    if (pattern.test(targetContext)) return uniqueInputName(name);
  }
  const applicationContext = `${action.application?.name ?? ""} ${action.application?.bundleIdentifier ?? ""}`.toLowerCase();
  if (/textedit|文本编辑/u.test(applicationContext) && /AXTextArea/iu.test(action.target?.role ?? "")) {
    return uniqueInputName("text");
  }
  if (/(wecom|wechat|slack|teams|messages|企业微信|微信|飞书|钉钉)/u.test(applicationContext)
    && /AXTextArea|AXTextField/iu.test(action.target?.role ?? "")) return uniqueInputName("message");
  return uniqueInputName(`text_input_${index}`);
}

function verifyFor(action) {
  const label = targetLabel(action.target);
  switch (action.type) {
    case "click":
      return {
        required: true,
        observation: `Confirm that clicking ${label} produced the expected result (dialog appeared, view changed, or button state toggled).`
      };
    case "submit":
      return {
        required: true,
        observation: `Confirm that submitting via ${label} completed (next screen loaded, dialog dismissed, or form processed).`
      };
    case "input_text": {
      return {
        required: true,
        kind: "value_equals",
        observation: `Read the complete semantic value of ${label} and require an exact match with the requested input. Re-focus and retype if it differs.`
      };
    }
    case "shortcut": {
      const purpose = action.key?.startsWith("super+") ? `the command "${action.key}" was invoked` : `the shortcut "${action.key}" was triggered`;
      return {
        required: true,
        observation: `Verify that ${purpose} (e.g., copied text, opened dialog, or toggled state).`
      };
    }
    case "scroll":
      return {
        required: true,
        observation: `Confirm the content scrolled as expected (list moved, page scrolled, or visible region changed).`
      };
    case "drag":
      return {
        required: true,
        observation: `Confirm that dragging ${label} completed (element moved, resize handle adjusted, or file dropped).`
      };
    default:
      return {
        required: true,
        observation: `Confirm the expected UI state change after this action.`
      };
  }
}

function descriptionFor(action, index) {
  const label = targetLabel(action.target);
  const app = action.application?.name || "the app";
  switch (action.type) {
    case "click":
      return `Click on ${label} in ${app}`;
    case "submit":
      return `Submit the form or confirm via ${label} in ${app}`;
    case "input_text": {
      const value = action.redacted ? "sensitive value" : (action.value ? `"${action.value}"` : "text");
      return `Enter ${value} into ${label} in ${app}`;
    }
    case "shortcut":
      return `Press "${action.key}" in ${app}`;
    case "scroll":
      return `Scroll (dx=${action.deltaX ?? 0}, dy=${action.deltaY ?? 0}) on ${label} in ${app}`;
    case "drag":
      return `Drag from (${action.from?.x}, ${action.from?.y}) to (${action.to?.x}, ${action.to?.y}) on ${label} in ${app}`;
    default:
      return `Step ${index + 1} in ${app}`;
  }
}

const steps = normalized.actions.map((action, index) => {
  const prevAction = index > 0 ? normalized.actions[index - 1] : null;
  const timingMs = timeDeltaMs(prevAction?.timestamp, action.timestamp);

  const step = {
    id: `step_${index + 1}`,
    action: action.type,
    description: descriptionFor(action, index),
    application: action.application ? {
      name: action.application.name,
      bundleIdentifier: action.application.bundleIdentifier
    } : undefined,
    window: action.window,
    target: action.target,
    fallback: action.fallback,
    verify: verifyFor(action)
  };

  if (timingMs !== null && timingMs >= 0) {
    step.timingHintMs = timingMs;
  }

  if (action.type === "input_text") {
    inputIndex += 1;
    const name = inferInputName(action, inputIndex);
    inputs.push({
      name,
      type: "string",
      required: true,
      sensitive: Boolean(action.redacted),
      demonstratedValue: action.redacted ? undefined : action.value,
      inference: "candidate",
      semanticRole: name.replace(/_\d+$/u, ""),
      confidence: name.startsWith("text_input_") || name.startsWith("sensitive_input_") ? "low" : "high"
    });
    step.value = `{{${name}}}`;
    step.verify = {
      ...step.verify,
      expected: step.value
    };
  }
  if (action.type === "shortcut") {
    step.key = action.key;
    step.keyCode = action.keyCode;
    step.modifiers = action.modifiers;
  }
  if (action.type === "scroll") {
    step.deltaX = action.deltaX;
    step.deltaY = action.deltaY;
  }
  if (action.type === "drag") {
    step.from = action.from;
    step.to = action.to;
    step.button = action.button;
  }
  return step;
});

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  status: "draft",
  source: normalized.source,
  goal: null,
  applications: normalized.applications,
  inputs,
  preconditions: ["Required applications are installed and accessible."],
  steps,
  success: { description: null, requiresVerification: true },
  safety: {
    confirmBefore: ["external_message", "delete", "financial_action", "system_setting_change"],
    neverPersistSensitiveValues: true
  },
  compilerNotes: [
    "Infer and replace the null goal and success description before generating a skill.",
    "Rename candidate inputs based on their semantic purpose.",
    "Remove incidental demonstration actions and coordinate-only fallbacks where stable targets exist.",
    "Mark each external message, deletion, financial action, system-setting change, or overwrite of existing content with step.safety.requiresConfirmation=true and its safety category.",
    "Timing hints are derived from the original recording; the replay agent may adjust wait times if the UI responds faster or slower."
  ]
}, null, 2)}\n`);
