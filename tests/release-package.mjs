#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";

const payload = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  process.stderr.write("Usage: release-package.mjs <payload-directory>\n");
  process.exit(2);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function run(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(stderr || stdout || `exit ${code}`)));
  });
}

const manifest = JSON.parse(await readFile(join(payload, "manifest.json"), "utf8"));
assert(manifest.schemaVersion === 1 && manifest.version, "release manifest invalid");
assert(manifest.name === "FlowOnce", "release manifest brand is wrong");
assert(manifest.architecture === process.arch, "release architecture does not match test machine");
const bundledNode = join(payload, "runtime", "bin", "node");
const installer = join(payload, "product", "scripts", "install-distribution.mjs");
const nodeVersion = (await run(bundledNode, ["--version"])).stdout.trim();
assert(nodeVersion === manifest.nodeVersion, "bundled Node version does not match manifest");

const installerExecutable = resolve(payload, "..", "..", "MacOS", "RecordAndReplayInstaller");
assert(await exists(installerExecutable), "native installer wrapper is missing");
const wrapperHome = await mkdtemp(join(tmpdir(), "record-replay-wrapper-home."));
await mkdir(join(wrapperHome, ".codebuddy"), { recursive: true });
const wrapperResult = await run(installerExecutable, [], {
  env: {
    ...process.env,
    RECORD_REPLAY_INSTALL_HOME: wrapperHome,
    RECORD_REPLAY_INSTALL_HOSTS: "auto",
    RECORD_REPLAY_INSTALL_NO_SYSTEM_DETECT: "1",
    RECORD_REPLAY_INSTALL_NO_UI: "1"
  }
});
assert(wrapperResult.stdout.includes("Configured hosts: codebuddy"), "native installer wrapper did not configure the detected host");
assert(await exists(join(wrapperHome, ".codebuddy", ".mcp.json")), "native installer wrapper did not write MCP configuration");

const home = await mkdtemp(join(tmpdir(), "record-replay-release-home."));
for (const directory of [".codebuddy", ".workbuddy", ".qoder"]) await mkdir(join(home, directory), { recursive: true });
const installed = JSON.parse((await run(bundledNode, [
  installer,
  "--payload", payload,
  "--home", home,
  "--hosts", "codebuddy,workbuddy,qoder",
  "--no-system-detect",
  "--json"
])).stdout);
assert(installed.version === manifest.version, "installed version does not match release");
assert(await exists(installed.recorderApp), "recorder app was not installed");
const recorderRequirement = await run("/usr/bin/codesign", ["-d", "-r-", installed.recorderApp]);
assert(`${recorderRequirement.stdout}${recorderRequirement.stderr}`.includes('designated => identifier "local.record-and-replay"'), "installed recorder lost its stable designated requirement");
assert(await exists(join(home, ".codebuddy", "skills", "record-and-replay-local", "SKILL.md")), "portable skill was not installed");
assert(!(await exists(join(home, ".codebuddy", "skills", "record-and-replay-local", "agents", "openai.yaml"))), "portable skill contains Codex-only metadata");

const installedRoot = installed.installRoot;
const installedNode = join(installedRoot, "current", "runtime", "bin", "node");
const installedMcp = join(installedRoot, "current", "scripts", "event-stream-mcp.mjs");
const mcp = spawn(installedNode, [installedMcp], { stdio: ["pipe", "pipe", "inherit"] });
const lines = readline.createInterface({ input: mcp.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextID = 1;
lines.on("line", line => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});
function request(method, params = {}) {
  const id = nextID++;
  mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
}
const initialized = await request("initialize", { protocolVersion: "2025-06-18" });
assert(initialized.serverInfo.name === "record-and-replay-local", "installed MCP server identity is wrong");
const tools = await request("tools/list");
assert(tools.tools.length === 7, "installed MCP tool surface is incomplete");
const prompts = await request("prompts/list");
assert(prompts.prompts.some(prompt => prompt.name === "record_workflow"), "installed MCP prompt is missing");
mcp.stdin.end();

const session = await mkdtemp(join(tmpdir(), "record-replay-release-recorder."));
const recorderExecutable = join(installed.recorderApp, "Contents", "MacOS", "RecordAndReplayLocal");
const recorder = spawn(recorderExecutable, [session, "30"], {
  env: { ...process.env, RECORD_REPLAY_HEADLESS: "1" },
  stdio: "ignore"
});
for (let index = 0; index < 50 && !(await exists(join(session, "heartbeat"))); index += 1) {
  await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
}
assert(await exists(join(session, "heartbeat")), "installed native recorder did not start");
await writeFile(join(session, "cancel"), "");
await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error("installed native recorder did not stop")), 5000);
  recorder.on("exit", () => { clearTimeout(timer); resolvePromise(); });
});
assert(!(await exists(join(session, "events.jsonl"))), "cancelled installed recording retained events");

const permissionSession = await mkdtemp(join(tmpdir(), "record-replay-release-permission."));
await run(recorderExecutable, [permissionSession, "30"], {
  env: { ...process.env, RECORD_REPLAY_HEADLESS: "1", RECORD_REPLAY_FORCE_ACCESSIBILITY_UNTRUSTED: "1" }
});
assert(!(await exists(join(permissionSession, "events.jsonl"))), "permission setup retained an installed event stream");
const permissionMetadata = JSON.parse(await readFile(join(permissionSession, "session.json"), "utf8"));
assert(permissionMetadata.endReason === "accessibility_permission_required", "installed recorder did not classify missing permission");

process.stdout.write("Self-contained release package OK\n");
