#!/usr/bin/env node

const workflowKinds = new Set(["auto", "browser", "desktop", "connector", "cli"]);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function backendKind(name) {
  const value = normalized(name);
  if (!value || ["none", "unavailable", "unknown"].includes(value)) return "unavailable";
  if (/(browser|chrome|safari|playwright|web)/u.test(value)) return "browser";
  if (/(computer|desktop|macos|accessibility|ui[-_ ]?control)/u.test(value)) return "desktop";
  if (/(connector|mcp|api|gmail|slack|wecom|notion|drive|calendar|mail)/u.test(value)) return "connector";
  if (/(cli|shell|terminal|command)/u.test(value)) return "cli";
  return "other";
}

function inferWorkflowKind(application, requestedKind) {
  if (requestedKind && requestedKind !== "auto") return requestedKind;
  const value = normalized(application);
  if (/(chrome|safari|firefox|edge|browser|网页|浏览器)/u.test(value)) return "browser";
  if (/(terminal|iterm|终端|命令行)/u.test(value)) return "cli";
  if (/(gmail|slack|notion|drive|calendar|邮箱|日历)/u.test(value)) return "connector";
  return "desktop";
}

function compatibleKinds(workflowKind) {
  if (workflowKind === "browser") return new Set(["browser", "desktop", "connector"]);
  if (workflowKind === "connector") return new Set(["connector", "browser", "desktop"]);
  if (workflowKind === "cli") return new Set(["cli", "desktop"]);
  return new Set(["desktop", "connector", "cli"]);
}

function demoFor(kinds) {
  if (kinds.has("desktop")) {
    return {
      id: "textedit-changed-note",
      title: "让 AI 学会在 TextEdit 写入一段文字",
      durationSeconds: 45,
      application: "TextEdit",
      workflowKind: "desktop",
      demonstrationInput: "FlowOnce 第一次演示",
      replayInput: "FlowOnce 已经学会了",
      success: "TextEdit 文档中完整出现新的复现文字。",
      risk: "reversible"
    };
  }
  if (kinds.has("browser")) {
    return {
      id: "browser-changed-search",
      title: "让 AI 学会用不同关键词搜索",
      durationSeconds: 45,
      application: "当前浏览器",
      workflowKind: "browser",
      demonstrationInput: "FlowOnce 录制即技能",
      replayInput: "FlowOnce 自动蒸馏",
      success: "搜索结果页完整显示新的关键词。",
      risk: "read_only"
    };
  }
  if (kinds.has("connector")) {
    return {
      id: "connector-read-only-search",
      title: "让 AI 学会执行一次只读搜索",
      durationSeconds: 60,
      application: "当前可用连接器",
      workflowKind: "connector",
      success: "使用不同关键词返回一组可观察的搜索结果。",
      risk: "read_only"
    };
  }
  if (kinds.has("cli")) {
    return {
      id: "finder-file-search",
      title: "让 AI 学会查找不同名称的文件",
      durationSeconds: 45,
      application: "Finder",
      workflowKind: "cli",
      success: "使用不同文件名得到可观察的查找结果。",
      risk: "read_only"
    };
  }
  return null;
}

export function inspectReplayReadiness({
  application = "unknown",
  workflowKind = "auto",
  availableBackends = [],
  firstUse = false
} = {}) {
  if (!workflowKinds.has(workflowKind)) {
    throw new Error(`workflowKind must be one of: ${[...workflowKinds].join(", ")}`);
  }
  if (!Array.isArray(availableBackends) || availableBackends.some(item => typeof item !== "string")) {
    throw new Error("availableBackends must be an array of backend names.");
  }
  const inferredKind = inferWorkflowKind(application, workflowKind);
  const backends = [...new Set(availableBackends.map(item => item.trim()).filter(Boolean))]
    .map(name => ({ name, kind: backendKind(name) }))
    .filter(item => item.kind !== "unavailable");
  const compatible = compatibleKinds(inferredKind);
  const matched = backends.filter(item => compatible.has(item.kind));
  const kinds = new Set(backends.map(item => item.kind));
  const recommendedDemo = firstUse ? demoFor(kinds) : null;

  if (matched.length) {
    return {
      readiness: "ready",
      canPromiseReplay: true,
      application,
      workflowKind: inferredKind,
      matchedBackends: matched,
      recommendedDemo,
      nextAction: firstUse && recommendedDemo
        ? `优先用“${recommendedDemo.title}”完成第一次演示和换参数复现。`
        : "可以开始录制；生成后使用已匹配的后端换参数复现。"
    };
  }
  if (backends.length) {
    return {
      readiness: "partial",
      canPromiseReplay: false,
      application,
      workflowKind: inferredKind,
      availableBackends: backends,
      recommendedDemo,
      nextAction: recommendedDemo
        ? `当前目标暂不能保证复现。先用“${recommendedDemo.title}”完成第一次成功体验，仍可保存原目标稍后生成。`
        : "当前能力可以生成技能，但不能保证复现；录制前先启用适合目标应用的执行后端。"
    };
  }
  return {
    readiness: "blocked",
    canPromiseReplay: false,
    application,
    workflowKind: inferredKind,
    availableBackends: [],
    recommendedDemo: null,
    nextAction: "当前宿主没有可用的回放后端。不要让首次用户先完成长录制；先启用浏览器、连接器、CLI 或桌面控制能力。"
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [application = "unknown", workflowKind = "auto", ...availableBackends] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(inspectReplayReadiness({
    application,
    workflowKind,
    availableBackends,
    firstUse: true
  }), null, 2)}\n`);
}
