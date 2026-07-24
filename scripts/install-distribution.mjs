#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const supportedHosts = ["codebuddy", "workbuddy", "qoder", "codex"];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function parseArguments(argv) {
  const options = {
    payload: resolve(scriptDirectory, "..", ".."),
    home: homedir(),
    hosts: "auto",
    json: false,
    systemDetect: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--payload" || argument === "--home" || argument === "--hosts") {
      if (!argv[index + 1]) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = argv[index + 1];
      index += 1;
    } else if (argument === "--json") options.json = true;
    else if (argument === "--no-system-detect") options.systemDetect = false;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.payload = resolve(options.payload);
  options.home = resolve(options.home);
  return options;
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function stripJsonCommentsAndTrailingCommas(source) {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") { lineComment = false; withoutComments += character; }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index += 1; }
      else if (character === "\n") withoutComments += character;
      continue;
    }
    if (inString) {
      withoutComments += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; withoutComments += character; continue; }
    if (character === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
    withoutComments += character;
  }
  let output = "";
  inString = false;
  escaped = false;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; output += character; continue; }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/.test(withoutComments[lookahead] ?? "")) lookahead += 1;
      if (withoutComments[lookahead] === "}" || withoutComments[lookahead] === "]") continue;
    }
    output += character;
  }
  return output;
}

function parseJsonc(source, path) {
  try { return JSON.parse(stripJsonCommentsAndTrailingCommas(source.replace(/^\uFEFF/, ""))); }
  catch (error) { throw new Error(`Cannot safely update invalid JSON/JSONC at ${path}: ${error.message}`); }
}

async function atomicWrite(path, contents, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.record-replay-${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { mode });
  await chmod(temporaryPath, mode);
  await rename(temporaryPath, path);
}

async function mergeMcpConfig(path, server) {
  const hadExisting = await exists(path);
  let document = {};
  let backupPath;
  if (hadExisting) {
    const original = await readFile(path, "utf8");
    document = parseJsonc(original, path);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error(`MCP configuration root must be an object: ${path}`);
    }
    backupPath = `${path}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await writeFile(backupPath, original, { mode: 0o600 });
  }
  if (!document.mcpServers || typeof document.mcpServers !== "object" || Array.isArray(document.mcpServers)) {
    document.mcpServers = {};
  }
  document.mcpServers["record-and-replay-local"] = server;
  await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`);
  return { path, ...(backupPath ? { backupPath } : {}) };
}

async function replaceOwnedDirectory(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const staging = `${destination}.installing-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true, dereference: true });
  let backupPath;
  if (await exists(destination)) {
    backupPath = `${destination}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await rename(destination, backupPath);
  }
  await rename(staging, destination);
  return backupPath;
}

async function detectHosts(home, systemDetect) {
  const candidates = {
    codebuddy: [join(home, ".codebuddy"), join(home, "Applications", "CodeBuddy.app")],
    workbuddy: [join(home, ".workbuddy"), join(home, "Applications", "WorkBuddy.app")],
    qoder: [join(home, ".qoder"), join(home, "Applications", "Qoder.app")],
    codex: [join(home, ".codex"), join(home, "Applications", "ChatGPT.app"), join(home, "Applications", "Codex.app")]
  };
  if (systemDetect) {
    candidates.codebuddy.push("/Applications/CodeBuddy.app");
    candidates.workbuddy.push("/Applications/WorkBuddy.app");
    candidates.qoder.push("/Applications/Qoder.app");
    candidates.codex.push("/Applications/ChatGPT.app", "/Applications/Codex.app");
  }
  const detected = [];
  for (const host of supportedHosts) {
    if ((await Promise.all(candidates[host].map(exists))).some(Boolean)) detected.push(host);
  }
  return detected;
}

async function codeBuddyConfigPath(home) {
  const candidates = [
    join(home, ".codebuddy", ".mcp.json"),
    join(home, ".codebuddy", "mcp.json"),
    join(home, ".codebuddy.json")
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return candidates[0];
}

function parseHosts(requested, detected) {
  if (requested === "auto") return detected;
  if (requested === "all") return [...supportedHosts];
  const hosts = [...new Set(requested.split(",").map(value => value.trim()).filter(Boolean))];
  for (const host of hosts) {
    if (!supportedHosts.includes(host)) throw new Error(`Unsupported host: ${host}`);
  }
  return hosts;
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
    try {
      const result = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (!result.error && result.status === 0) return candidate;
    } catch {}
  }
  const which = spawnSync("/usr/bin/which", ["codex"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

function configureCodexMcp(home, server) {
  const executable = findCodexExecutable(home);
  if (!executable) return { warning: "Codex was detected, but its CLI was unavailable; install the skill or add the MCP server manually." };
  const environment = { ...process.env, HOME: home };
  const legacy = spawnSync(executable, ["mcp", "get", "event-stream", "--json"], { env: environment, encoding: "utf8" });
  if (legacy.status === 0) {
    try {
      const configuration = JSON.parse(legacy.stdout);
      const args = configuration.transport?.args ?? [];
      const cwd = configuration.transport?.cwd ?? "";
      const isLegacyFlowOnce = args.some(value => /(?:^|\/)event-stream-mcp\.mjs$/.test(value)) && /record-and-replay-local/.test(cwd);
      if (isLegacyFlowOnce) spawnSync(executable, ["mcp", "remove", "event-stream"], { env: environment, encoding: "utf8" });
    } catch {}
  }
  spawnSync(executable, ["mcp", "remove", "record-and-replay-local"], { env: environment, encoding: "utf8" });
  const result = spawnSync(executable, ["mcp", "add", "record-and-replay-local", "--", server.command, ...server.args], {
    env: environment,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Codex MCP configuration failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  return { command: executable };
}

async function isFlowOnceSkill(path) {
  try {
    const source = await readFile(join(path, "SKILL.md"), "utf8");
    return /^name:\s*record-and-replay-local\s*$/m.test(source);
  } catch {
    return false;
  }
}

async function syncSkillAlias(source, destination) {
  if (!(await isFlowOnceSkill(destination))) return null;
  await cp(join(source, "SKILL.md"), join(destination, "SKILL.md"));
  const sourceReferences = join(source, "references");
  const destinationReferences = join(destination, "references");
  if (await exists(sourceReferences)) {
    await rm(destinationReferences, { recursive: true, force: true });
    await cp(sourceReferences, destinationReferences, { recursive: true });
  }
  return destination;
}

async function installSkill(source, destination, aliases = []) {
  const backupPath = await replaceOwnedDirectory(source, destination);
  const syncedAliases = [];
  for (const alias of aliases) {
    if (alias === destination) continue;
    const synced = await syncSkillAlias(source, alias);
    if (synced) syncedAliases.push(synced);
  }
  return { path: destination, ...(backupPath ? { backupPath } : {}), ...(syncedAliases.length ? { syncedAliases } : {}) };
}

async function migrateLegacyRecorder(home, installRoot) {
  const legacyPath = join(home, "Applications", "Record & Replay Local.app");
  if (!(await exists(legacyPath))) return {};
  let plist = "";
  try { plist = await readFile(join(legacyPath, "Contents", "Info.plist"), "utf8"); } catch {}
  if (!/<key>CFBundleIdentifier<\/key>\s*<string>local\.record-and-replay<\/string>/.test(plist)) {
    return { warning: `An unrelated app already uses the legacy path ${legacyPath}; it was left unchanged.` };
  }
  const backupRoot = join(installRoot, "migration-backups");
  await mkdir(backupRoot, { recursive: true });
  const backupPath = join(backupRoot, `Record & Replay Local-${new Date().toISOString().replace(/[:.]/g, "-")}.app`);
  await rename(legacyPath, backupPath);
  return { backupPath };
}

async function install(options) {
  const manifestPath = join(options.payload, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")) {
    throw new Error(`Invalid release manifest: ${manifestPath}`);
  }
  const productSource = join(options.payload, "product");
  const nodeSource = join(options.payload, "runtime", "bin", "node");
  const skillSource = join(productSource, "skills", "record-and-replay-local");
  for (const required of [productSource, nodeSource, skillSource]) {
    if (!(await exists(required))) throw new Error(`Release payload is incomplete: ${required}`);
  }

  const installRoot = join(options.home, "Library", "Application Support", "FlowOnce");
  const versionsRoot = join(installRoot, "versions");
  const versionDirectory = join(versionsRoot, manifest.version);
  await mkdir(versionsRoot, { recursive: true });
  const staging = join(versionsRoot, `.${manifest.version}.installing-${process.pid}`);
  await rm(staging, { recursive: true, force: true });
  await cp(productSource, staging, { recursive: true, dereference: true });
  await mkdir(join(staging, "runtime", "bin"), { recursive: true });
  await cp(nodeSource, join(staging, "runtime", "bin", "node"), { dereference: true });
  await chmod(join(staging, "runtime", "bin", "node"), 0o755);
  if (await exists(versionDirectory)) await rm(versionDirectory, { recursive: true, force: true });
  await rename(staging, versionDirectory);

  const currentLink = join(installRoot, "current");
  const nextLink = join(installRoot, `.current-${process.pid}`);
  await unlink(nextLink).catch(() => {});
  await symlink(join("versions", manifest.version), nextLink);
  await rename(nextLink, currentLink).catch(async error => {
    if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
    await unlink(currentLink);
    await rename(nextLink, currentLink);
  });

  const recorderSource = join(versionDirectory, "bin", "FlowOnce.app");
  const recorderDestination = join(options.home, "Applications", "FlowOnce.app");
  let recorderBackup = await replaceOwnedDirectory(recorderSource, recorderDestination);
  if (recorderBackup) {
    const backupRoot = join(installRoot, "migration-backups");
    await mkdir(backupRoot, { recursive: true });
    const archivedBackup = join(backupRoot, `FlowOnce-${new Date().toISOString().replace(/[:.]/g, "-")}.app`);
    await rename(recorderBackup, archivedBackup);
    recorderBackup = archivedBackup;
  }
  const legacyRecorder = await migrateLegacyRecorder(options.home, installRoot);
  const detectedHosts = await detectHosts(options.home, options.systemDetect);
  const hosts = parseHosts(options.hosts, detectedHosts);
  const server = {
    command: join(currentLink, "runtime", "bin", "node"),
    args: [join(currentLink, "scripts", "event-stream-mcp.mjs")]
  };
  const configured = {};
  const warnings = [];
  if (legacyRecorder.warning) warnings.push(legacyRecorder.warning);

  for (const host of hosts) {
    if (host === "codebuddy") {
      configured.codebuddy = {
        mcp: await mergeMcpConfig(await codeBuddyConfigPath(options.home), server),
        skill: await installSkill(
          skillSource,
          join(options.home, ".codebuddy", "skills", "record-and-replay-local"),
          [join(options.home, ".codebuddy", "skills", "flowonce")]
        )
      };
    } else if (host === "workbuddy") {
      const mcp = await mergeMcpConfig(join(options.home, ".workbuddy", "mcp.json"), server);
      const packageSource = join(options.payload, "skill-packages", "FlowOnce-Controller.zip");
      const packageDestination = join(installRoot, "share", "FlowOnce-Controller.zip");
      await mkdir(dirname(packageDestination), { recursive: true });
      await cp(packageSource, packageDestination);
      configured.workbuddy = { mcp, skillPackage: packageDestination };
      warnings.push(`Optional WorkBuddy enhancement: import ${packageDestination} from Skills > Add Skill > Upload Skill for stronger automatic triggering. The MCP tools are already configured.`);
    } else if (host === "qoder") {
      configured.qoder = {
        mcp: await mergeMcpConfig(join(options.home, ".qoder", "settings.json"), server),
        skill: await installSkill(
          skillSource,
          join(options.home, ".qoder", "skills", "record-and-replay-local"),
          [join(options.home, ".qoder", "skills", "flowonce")]
        )
      };
    } else if (host === "codex") {
      const mcp = configureCodexMcp(options.home, server);
      if (mcp.warning) warnings.push(mcp.warning);
      configured.codex = {
        mcp,
        skill: await installSkill(
          skillSource,
          join(options.home, ".codex", "skills", "record-and-replay-local"),
          [join(options.home, ".codex", "skills", "flowonce")]
        )
      };
    }
  }
  if (hosts.length === 0) warnings.push("No supported agent host was detected. Re-run the installer after installing CodeBuddy, WorkBuddy, Qoder, or Codex.");

  const installedVersions = (await readdir(versionsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => entry.name)
    .sort()
    .reverse();
  for (const obsolete of installedVersions.slice(2)) {
    if (obsolete !== manifest.version) await rm(join(versionsRoot, obsolete), { recursive: true, force: true });
  }

  return {
    product: manifest.name ?? "FlowOnce",
    version: manifest.version,
    architecture: manifest.architecture,
    installRoot,
    recorderApp: recorderDestination,
    ...(recorderBackup ? { recorderBackup } : {}),
    ...(legacyRecorder.backupPath ? { legacyRecorderBackup: legacyRecorder.backupPath } : {}),
    detectedHosts,
    configuredHosts: hosts,
    configured,
    warnings,
    nextPrompt: "Use FlowOnce to learn my workflow and turn it into a portable reusable skill."
  };
}

const options = parseArguments(process.argv.slice(2));
try {
  const result = await install(options);
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`Installed ${result.product} ${result.version}.\n`);
    process.stdout.write(`Configured hosts: ${result.configuredHosts.join(", ") || "none"}.\n`);
    for (const warning of result.warnings) process.stdout.write(`Attention: ${warning}\n`);
    process.stdout.write(`Next, grant Accessibility access to ${result.recorderApp}, then ask your assistant: ${result.nextPrompt}\n`);
  }
} catch (error) {
  process.stderr.write(`Installation failed: ${error.message}\n`);
  process.exit(1);
}
