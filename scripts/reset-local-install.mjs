#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const confirmation = "--yes-delete-without-backup";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = resolve(process.env.FLOWONCE_RESET_HOME ?? homedir());
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));

if (!process.argv.slice(2).includes(confirmation)) {
  process.stderr.write(`This permanently deletes the installed FlowOnce app, engine, controller skills, temporary state, host MCP entries, and Accessibility permission.\nRe-run with ${confirmation} to continue.\n`);
  process.exit(2);
}
if (process.platform !== "darwin") throw new Error("FlowOnce local reset only supports macOS.");
if (!home || home === "/" || home === "/Users") throw new Error(`Refusing unsafe home path: ${home}`);

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findCodexExecutable() {
  return [
    process.env.RECORD_REPLAY_CODEX_BIN,
    join(home, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
    join(home, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex"
  ].filter(Boolean).find(candidate => {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 5000 });
    return !result.error && result.status === 0;
  });
}

const installedRoot = join(home, "Library", "Application Support", "FlowOnce", "current");
const installedNode = join(installedRoot, "runtime", "bin", "node");
const installedCLI = join(installedRoot, "scripts", "record-replay.mjs");
if (await exists(installedNode) && await exists(installedCLI)) {
  const status = spawnSync(installedNode, [installedCLI, "status"], { encoding: "utf8", timeout: 5000 });
  if (status.status === 0) {
    const value = JSON.parse(status.stdout);
    if (value.isRecording) throw new Error("An active FlowOnce recording exists. Stop or cancel it before resetting.");
  }
}

const codex = findCodexExecutable();
if (codex) {
  const current = spawnSync(codex, ["mcp", "get", "record-and-replay-local", "--json"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
    timeout: 5000
  });
  if (current.status === 0) {
    const removed = spawnSync(codex, ["mcp", "remove", "record-and-replay-local"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
      timeout: 5000
    });
    if (removed.status !== 0) throw new Error(`Cannot remove Codex MCP entry: ${removed.stderr || removed.stdout}`);
  }
}

for (const configPath of [
  join(home, ".codebuddy", ".mcp.json"),
  join(home, ".codebuddy", "mcp.json"),
  join(home, ".codebuddy.json"),
  join(home, ".workbuddy", "mcp.json"),
  join(home, ".qoder", "settings.json"),
  join(home, ".qoderwork", "mcp.json")
]) {
  if (!(await exists(configPath))) continue;
  const document = JSON.parse(await readFile(configPath, "utf8"));
  if (!document?.mcpServers?.["record-and-replay-local"]) continue;
  delete document.mcpServers["record-and-replay-local"];
  const temporary = `${configPath}.flowonce-reset-${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, configPath);
}

for (const target of [
  join(home, "Applications", "FlowOnce.app"),
  join(home, "Applications", "Record & Replay Local.app"),
  join(home, "Library", "Application Support", "FlowOnce"),
  join(home, ".codex", "skills", "flowonce"),
  join(home, ".codex", "skills", "record-and-replay-local"),
  join(home, ".codebuddy", "skills", "flowonce"),
  join(home, ".codebuddy", "skills", "record-and-replay-local"),
  join(home, ".qoder", "skills", "flowonce"),
  join(home, ".qoder", "skills", "record-and-replay-local"),
  join(home, ".qoderwork", "skills", "flowonce"),
  join(home, ".qoderwork", "skills", "record-and-replay-local"),
  join(tmpdir(), "record-and-replay-local")
]) {
  await rm(target, { recursive: true, force: true });
}

const permissionReset = spawnSync("/usr/bin/tccutil", ["reset", "Accessibility", "local.record-and-replay"], {
  encoding: "utf8",
  timeout: 5000
});
if (permissionReset.status !== 0) {
  throw new Error(`Cannot reset FlowOnce Accessibility permission: ${permissionReset.stderr || permissionReset.stdout}`);
}

const installed = spawnSync(join(root, "scripts", "install-local.sh"), ["codex"], {
  cwd: root,
  env: { ...process.env, HOME: home },
  encoding: "utf8",
  timeout: 120000
});
process.stdout.write(installed.stdout);
process.stderr.write(installed.stderr);
if (installed.status !== 0) throw new Error(`Fresh FlowOnce ${release.version} installation failed.`);

process.stdout.write("FlowOnce was reset without backups and freshly installed for Codex.\n");
