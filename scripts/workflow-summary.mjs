#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const safetyLabels = {
  external_message: "对外发送",
  delete: "删除内容",
  financial_action: "付款或交易",
  system_setting_change: "修改系统设置",
  file_overwrite: "覆盖已有文件",
  unknown: "重要操作"
};

function inputLabel(input) {
  const labels = {
    search_term: "搜索关键词",
    recipient: "目标联系人或会话",
    message: "消息内容",
    email_address: "邮箱地址",
    subject: "主题",
    file_path: "文件或路径",
    url: "网址",
    date: "日期",
    time: "时间",
    amount: "金额",
    name: "名称",
    text: "文字内容",
    password: "密码",
    api_token: "访问令牌"
  };
  return labels[input.semanticRole] ?? labels[input.name] ?? input.name;
}

export function summarizeWorkflow(workflow) {
  if (!workflow || typeof workflow !== "object") throw new Error("workflow must be an object.");
  const applications = [...new Set((workflow.steps ?? [])
    .map(step => step.application?.name)
    .filter(Boolean))];
  const confirmations = [...new Set((workflow.steps ?? [])
    .filter(step => step.safety?.requiresConfirmation)
    .map(step => safetyLabels[step.safety.category] ?? safetyLabels.unknown))];
  const lowConfidenceInputs = (workflow.inputs ?? [])
    .filter(input => input.confidence === "low")
    .map(input => input.name);
  return {
    title: `我学会了：${workflow.goal || "这项操作"}`,
    applications,
    variableInputs: (workflow.inputs ?? []).map(input => ({
      name: input.name,
      label: inputLabel(input),
      required: input.required === true,
      sensitive: input.sensitive === true,
      confidence: input.confidence ?? "reviewed"
    })),
    confirmations,
    success: workflow.success?.description || "需要补充一个可观察的成功标准。",
    lowConfidenceInputs,
    needsUserClarification: lowConfidenceInputs.length > 0 || !workflow.goal || !workflow.success?.description,
    userMessage: lowConfidenceInputs.length
      ? `我只需要确认这些可能变化的内容：${lowConfidenceInputs.join("、")}。其余步骤会自动处理。`
      : "如果这张卡片与您的目标一致，无需逐步确认；FlowOnce 将直接生成并试跑。"
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("Usage: workflow-summary.mjs <workflow.json>\n");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(summarizeWorkflow(JSON.parse(await readFile(path, "utf8"))), null, 2)}\n`);
}
