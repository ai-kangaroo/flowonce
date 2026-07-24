import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const supportedHosts = ["codex", "codebuddy", "qoder", "qoderwork", "workbuddy"];

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function skillRootForHost(home, host) {
  if (host === "codex") return join(home, ".codex", "skills");
  if (host === "codebuddy") return join(home, ".codebuddy", "skills");
  if (host === "qoder") return join(home, ".qoder", "skills");
  if (host === "qoderwork") return join(home, ".qoderwork", "skills");
  return null;
}

async function detectHosts(home) {
  const detected = [];
  for (const host of supportedHosts) {
    const root = join(home, `.${host}`);
    if (await exists(root)) detected.push(host);
  }
  return detected;
}

async function readGeneratedWorkflow(skillPath) {
  try {
    const workflow = JSON.parse(await readFile(join(skillPath, "references", "workflow.json"), "utf8"));
    return workflow?.schemaVersion === 1 && typeof workflow.goal === "string" ? workflow : null;
  } catch {
    return null;
  }
}

async function readSkillName(skillPath) {
  const source = await readFile(join(skillPath, "SKILL.md"), "utf8");
  const name = source.match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1] ?? basename(skillPath);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) {
    throw new Error("Generated skill name must contain only lowercase letters, digits, and hyphens.");
  }
  return name;
}

async function assertNoSymlinks(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) throw new Error("Generated skill must not contain symbolic links.");
    if (info.isDirectory()) await assertNoSymlinks(entryPath);
  }
}

export function createSkillInstallService(options = {}) {
  const home = options.home ?? homedir();

  return {
    async install(input = {}) {
      const skillPath = resolve(input.skillPath ?? "");
      if (!input.skillPath || !(await exists(join(skillPath, "SKILL.md")))) {
        throw new Error("skillPath must point to a generated skill directory.");
      }
      const workflow = await readGeneratedWorkflow(skillPath);
      if (!workflow) throw new Error("Only a FlowOnce-generated skill with references/workflow.json can be installed automatically.");
      await assertNoSymlinks(skillPath);

      let host = input.host ?? "auto";
      if (host !== "auto" && !supportedHosts.includes(host)) {
        throw new Error(`Unsupported host: ${host}.`);
      }
      const detectedHosts = await detectHosts(home);
      if (host === "auto") {
        if (detectedHosts.length === 1) host = detectedHosts[0];
        else {
          return {
            installed: false,
            status: "host_required",
            detectedHosts,
            nextAction: detectedHosts.length
              ? "请让当前 AI 助手使用自己的宿主名称再次自动安装。"
              : "当前没有检测到支持自动安装的 AI 助手。"
          };
        }
      }

      if (host === "workbuddy") {
        return {
          installed: false,
          status: "manual_import_required",
          host,
          packagePath: await exists(`${skillPath}.zip`) ? `${skillPath}.zip` : null,
          nextAction: "在 WorkBuddy 的 Skills > Add Skill > Upload Skill 中选择生成的技能包。"
        };
      }

      const skillName = await readSkillName(skillPath);
      const destinationRoot = skillRootForHost(home, host);
      const destination = join(destinationRoot, skillName);
      if (resolve(destination) === skillPath) {
        return {
          installed: true,
          status: "already_installed",
          host,
          skillName,
          skillPath: destination,
          nextUsePrompt: `以后可以直接说：“请用‘${workflow.goal}’技能执行这次任务。”`
        };
      }

      if (await exists(destination) && !(await readGeneratedWorkflow(destination))) {
        return {
          installed: false,
          status: "name_conflict",
          host,
          skillName,
          destination,
          nextAction: `当前宿主已有同名的非 FlowOnce 技能“${skillName}”，请换一个名称后生成。`
        };
      }

      await mkdir(destinationRoot, { recursive: true });
      const staging = join(destinationRoot, `.${skillName}.flowonce-installing-${process.pid}`);
      await rm(staging, { recursive: true, force: true });
      await cp(skillPath, staging, { recursive: true, dereference: false });

      let backupPath;
      if (await exists(destination)) {
        const backupRoot = join(home, "Library", "Application Support", "FlowOnce", "skill-backups", host);
        await mkdir(backupRoot, { recursive: true });
        backupPath = join(backupRoot, `${skillName}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
        await rename(destination, backupPath);
      }
      try {
        await rename(staging, destination);
      } catch (error) {
        if (backupPath && !(await exists(destination))) await rename(backupPath, destination);
        await rm(staging, { recursive: true, force: true });
        throw error;
      }

      return {
        installed: true,
        status: "installed",
        host,
        skillName,
        skillPath: destination,
        ...(backupPath ? { backupPath } : {}),
        nextUsePrompt: `以后可以直接说：“请用‘${workflow.goal}’技能执行这次任务。”`
      };
    }
  };
}
