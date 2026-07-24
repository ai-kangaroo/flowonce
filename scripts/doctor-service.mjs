import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const supportedHosts = ["codex", "codebuddy", "workbuddy", "qoder", "qoderwork"];

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJSON(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readPlistVersion(path) {
  try {
    const source = await readFile(path, "utf8");
    return source.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readSkillVersion(path) {
  try {
    const source = await readFile(path, "utf8");
    return source.match(/^\s{2}version:\s*([^\s]+)$/m)?.[1]
      ?? source.match(/^version:\s*([^\s]+)$/m)?.[1]
      ?? null;
  } catch {
    return null;
  }
}

function check(id, status, message, details = {}) {
  return { id, status, message, ...details };
}

function findCodexExecutable(home) {
  const candidates = [
    process.env.RECORD_REPLAY_CODEX_BIN,
    join(home, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
    join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex"
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

async function detectHost(home) {
  const candidates = [
    ["codex", join(home, ".codex")],
    ["codebuddy", join(home, ".codebuddy")],
    ["workbuddy", join(home, ".workbuddy")],
    ["qoder", join(home, ".qoder")],
    ["qoderwork", join(home, ".qoderwork")]
  ];
  for (const [host, path] of candidates) {
    if (await exists(path)) return host;
  }
  return "portable";
}

function skillPathsForHost(home, host) {
  let skillRoot;
  if (host === "codex") skillRoot = join(home, ".codex", "skills");
  else if (host === "codebuddy") skillRoot = join(home, ".codebuddy", "skills");
  else if (host === "qoder") skillRoot = join(home, ".qoder", "skills");
  else if (host === "qoderwork") skillRoot = join(home, ".qoderwork", "skills");
  else return [];
  return [
    join(skillRoot, "record-and-replay-local", "SKILL.md"),
    join(skillRoot, "flowonce", "SKILL.md")
  ];
}

async function configuredFromJSON(path) {
  const document = await readJSON(path);
  return Boolean(document?.mcpServers?.["record-and-replay-local"]);
}

async function defaultMcpProbe({ home, host }) {
  if (host === "codex") {
    const executable = findCodexExecutable(home);
    if (!executable) return { configured: false, reason: "Codex CLI was not found." };
    const result = spawnSync(executable, ["mcp", "get", "record-and-replay-local", "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
      timeout: 5000
    });
    return {
      configured: result.status === 0,
      reason: result.status === 0 ? undefined : "Codex does not report the FlowOnce MCP server."
    };
  }
  if (host === "codebuddy") {
    for (const path of [
      join(home, ".codebuddy", ".mcp.json"),
      join(home, ".codebuddy", "mcp.json"),
      join(home, ".codebuddy.json")
    ]) {
      if (await configuredFromJSON(path)) return { configured: true };
    }
    return { configured: false, reason: "CodeBuddy MCP configuration was not found." };
  }
  if (host === "workbuddy") {
    const configured = await configuredFromJSON(join(home, ".workbuddy", "mcp.json"));
    return { configured, reason: configured ? undefined : "WorkBuddy MCP configuration was not found." };
  }
  if (host === "qoder") {
    const configured = await configuredFromJSON(join(home, ".qoder", "settings.json"));
    return { configured, reason: configured ? undefined : "Qoder MCP configuration was not found." };
  }
  return { configured: false, reason: "This host requires manual MCP configuration." };
}

async function defaultAccessibilityProbe(app) {
  const probeRoot = await mkdtemp(join(tmpdir(), "flowonce-accessibility."));
  const resultPath = join(probeRoot, "result.json");
  try {
    const child = spawn("/usr/bin/open", ["-n", app, "--args", "--check-accessibility", resultPath], {
      detached: true,
      stdio: "ignore"
    });
    let launchError = null;
    child.once("error", error => { launchError = error; });
    child.unref();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (launchError) return { trusted: false, available: false };
      try {
        const parsed = JSON.parse(await readFile(resultPath, "utf8"));
        return { trusted: parsed.accessibilityTrusted === true, available: true };
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    return { trusted: false, available: false };
  } finally {
    await rm(probeRoot, { recursive: true, force: true });
  }
}

export function formatDoctorReport(report) {
  const symbols = { pass: "✅", warn: "⚠️", fail: "❌" };
  const lines = [`FlowOnce 本地自检：${report.ready ? "可以开始录制" : "需要处理"}`];
  for (const item of report.checks) lines.push(`${symbols[item.status]} ${item.message}`);
  lines.push(`下一步：${report.nextAction}`);
  return `${lines.join("\n")}\n`;
}

export function createDoctorService(options = {}) {
  const root = options.root;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const accessibilityProbe = options.accessibilityProbe ?? defaultAccessibilityProbe;
  const mcpProbe = options.mcpProbe ?? defaultMcpProbe;

  return {
    async inspect(input = {}) {
      const requestedHost = input.host ?? "auto";
      if (requestedHost !== "auto" && requestedHost !== "portable" && !supportedHosts.includes(requestedHost)) {
        throw new Error(`Unsupported host: ${requestedHost}. Expected auto, portable, or one of: ${supportedHosts.join(", ")}`);
      }
      const host = requestedHost === "auto" ? await detectHost(home) : requestedHost;
      const release = await readJSON(join(root, "release.json"));
      const sourceVersion = release?.version ?? null;
      const installRoot = join(home, "Library", "Application Support", "FlowOnce");
      const currentRoot = join(installRoot, "current");
      const installedRelease = await readJSON(join(currentRoot, "release.json"));
      let installedVersion = installedRelease?.version ?? null;
      if (!installedVersion) {
        try {
          installedVersion = (await readlink(currentRoot)).split("/").filter(Boolean).at(-1) ?? null;
        } catch {}
      }
      const recorderApp = join(home, "Applications", "FlowOnce.app");
      const recorderExecutable = join(recorderApp, "Contents", "MacOS", "RecordAndReplayLocal");
      const appVersion = await readPlistVersion(join(recorderApp, "Contents", "Info.plist"));
      const runtimePath = join(currentRoot, "runtime", "bin", "node");
      const serverPath = join(currentRoot, "scripts", "event-stream-mcp.mjs");
      const hostSkillPaths = skillPathsForHost(home, host);
      const skillInstallations = [];
      for (const path of hostSkillPaths) {
        const version = await readSkillVersion(path);
        if (version) skillInstallations.push({ path, version });
      }
      const skillVersion = skillInstallations.length === 1 ? skillInstallations[0].version : null;
      const checks = [];

      checks.push(platform === "darwin"
        ? check("platform", "pass", "当前系统是 macOS。")
        : check("platform", "fail", "FlowOnce 录制仅支持 macOS。"));

      if (!(await exists(recorderExecutable))) {
        checks.push(check("recorder", "fail", `未找到录制器：${recorderApp}`));
      } else if (sourceVersion && appVersion === sourceVersion) {
        checks.push(check("recorder", "pass", `录制器已安装，版本 ${appVersion}。`, { version: appVersion }));
      } else {
        checks.push(check("recorder", "fail", `录制器版本 ${appVersion ?? "未知"}，需要 ${sourceVersion ?? "当前"}。`, { version: appVersion }));
      }

      if (!(await exists(runtimePath)) || !(await exists(serverPath))) {
        checks.push(check("runtime", "fail", "本地 MCP 运行时或服务文件不完整。"));
      } else if (sourceVersion && installedVersion === sourceVersion) {
        checks.push(check("runtime", "pass", `本地引擎已安装，版本 ${installedVersion}。`, { version: installedVersion }));
      } else {
        checks.push(check("runtime", "fail", `本地引擎版本 ${installedVersion ?? "未知"}，需要 ${sourceVersion ?? "当前"}。`, { version: installedVersion }));
      }

      if (await exists(recorderExecutable)) {
        const accessibility = await accessibilityProbe(recorderApp);
        if (!accessibility.available) {
          checks.push(check("accessibility", "warn", "无法自动读取辅助功能权限；开始录制时会再次检查。"));
        } else if (accessibility.trusted) {
          checks.push(check("accessibility", "pass", "FlowOnce 已获得辅助功能权限。"));
        } else {
          checks.push(check("accessibility", "fail", "FlowOnce 尚未获得辅助功能权限。"));
        }
      }

      if (input.mcpAvailable === true) {
        checks.push(check("mcp", "pass", `当前 ${host} 会话已经连接 FlowOnce MCP。`));
      } else if (host === "portable") {
        checks.push(check("mcp", "warn", "未指定 AI 宿主，无法确认 MCP 是否已连接。"));
      } else {
        const mcp = await mcpProbe({ home, host });
        checks.push(mcp.configured
          ? check("mcp", "pass", `${host} 已配置 FlowOnce MCP。`)
          : check("mcp", "fail", mcp.reason ?? `${host} 尚未配置 FlowOnce MCP。`));
      }

      if (hostSkillPaths.length === 0) {
        checks.push(check("skill", "warn", `${host} 使用自己的技能导入方式，请在宿主内确认 FlowOnce Skill 已加载。`));
      } else if (skillInstallations.length > 1) {
        const versions = new Set(skillInstallations.map(item => item.version));
        const aligned = versions.size === 1 && versions.has(sourceVersion);
        checks.push(check(
          "skill",
          aligned ? "warn" : "fail",
          aligned
            ? `${host} 同时存在 ${skillInstallations.length} 份同版本 FlowOnce Skill；当前可用，后续可清理重复入口。`
            : `${host} 同时存在 ${skillInstallations.length} 份不同版本的 FlowOnce Skill，可能产生错误触发。`,
          { installations: skillInstallations }
        ));
      } else if (sourceVersion && skillVersion === sourceVersion) {
        checks.push(check("skill", "pass", `${host} 已安装 FlowOnce Skill ${skillVersion}。`, { path: skillInstallations[0].path, version: skillVersion }));
      } else {
        checks.push(check("skill", "fail", `${host} 的 FlowOnce Skill 版本 ${skillVersion ?? "未安装"}，需要 ${sourceVersion ?? "当前"}。`, { path: skillInstallations[0]?.path, version: skillVersion }));
      }

      const failures = checks.filter(item => item.status === "fail");
      const ready = failures.length === 0;
      let nextAction = "说“我准备好了，开始录制”。";
      if (failures.some(item => ["recorder", "runtime", "skill"].includes(item.id))) {
        nextAction = `重新运行 FlowOnce ${sourceVersion ?? "当前版本"} 安装器，使录制器、引擎和 Skill 版本一致。`;
      } else if (failures.some(item => item.id === "accessibility")) {
        nextAction = `在“系统设置 → 隐私与安全性 → 辅助功能”中启用 ${recorderApp}，然后重新运行自检。`;
      } else if (failures.some(item => item.id === "mcp")) {
        nextAction = "重新运行安装器并完全退出后重启 AI 宿主，再运行自检。";
      }

      return {
        ready,
        status: ready ? "ready" : "needs_attention",
        host,
        sourceVersion,
        installedVersion,
        appVersion,
        skillVersion,
        skillInstallations,
        checks,
        nextAction
      };
    }
  };
}
