#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseVersion = JSON.parse(await readFile(join(root, "release.json"), "utf8")).version;
const testRoot = await mkdtemp(join(tmpdir(), "record-replay-installer."));
const payload = join(testRoot, "payload");
const product = join(payload, "product");
const skillSource = join(product, "skills", "record-and-replay-local");
await mkdir(join(product, "bin"), { recursive: true });
await mkdir(join(product, "scripts"), { recursive: true });
await mkdir(skillSource, { recursive: true });
await mkdir(join(payload, "runtime", "bin"), { recursive: true });
await mkdir(join(payload, "skill-packages"), { recursive: true });
await cp(join(root, "bin", "FlowOnce.app"), join(product, "bin", "FlowOnce.app"), { recursive: true });
await cp(join(root, "scripts", "event-stream-mcp.mjs"), join(product, "scripts", "event-stream-mcp.mjs"));
await cp(join(root, "skills", "record-and-replay-local", "SKILL.md"), join(skillSource, "SKILL.md"));
await cp(join(root, "skills", "record-and-replay-local", "references"), join(skillSource, "references"), { recursive: true });
await cp(process.execPath, join(payload, "runtime", "bin", "node"), { dereference: true });
await chmod(join(payload, "runtime", "bin", "node"), 0o755);
await writeFile(join(payload, "skill-packages", "FlowOnce-Controller.zip"), "test-package");
await writeFile(join(payload, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  name: "FlowOnce",
  version: "0.3.0-test",
  architecture: process.arch
}, null, 2)}\n`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(path) {
  try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
}

function runInstaller(home, hosts, environment = {}) {
  const result = spawnSync(process.execPath, [
    join(root, "scripts", "install-distribution.mjs"),
    "--payload", payload,
    "--home", home,
    "--hosts", hosts,
    "--no-system-detect",
    "--json"
  ], { encoding: "utf8", env: { ...process.env, ...environment } });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "installer failed");
  return JSON.parse(result.stdout);
}

const home = join(testRoot, "home");
await mkdir(join(home, ".codebuddy"), { recursive: true });
await mkdir(join(home, ".qoder"), { recursive: true });
await mkdir(join(home, ".workbuddy"), { recursive: true });
await mkdir(join(home, "Applications"), { recursive: true });
await cp(join(root, "bin", "FlowOnce.app"), join(home, "Applications", "Record & Replay Local.app"), { recursive: true });
await writeFile(join(home, ".codebuddy", "mcp.json"), `{
  // Preserve existing settings and URLs containing comment-like text.
  "theme": "dark",
  "literal": "https://example.com/a,//,}",
  "mcpServers": {
    "existing": { "command": "existing-tool", },
  },
}
`);
await writeFile(join(home, ".qoder", "settings.json"), `${JSON.stringify({ permissions: { allow: ["existing"] } }, null, 2)}\n`);

const first = runInstaller(home, "auto");
assert(JSON.stringify(first.configuredHosts) === JSON.stringify(["codebuddy", "workbuddy", "qoder"]), "wrong configured hosts");
assert(first.warnings.some(value => value.includes("Optional WorkBuddy enhancement")), "missing WorkBuddy optional upload notice");
const codeBuddyConfig = JSON.parse(await readFile(join(home, ".codebuddy", "mcp.json"), "utf8"));
assert(codeBuddyConfig.theme === "dark", "CodeBuddy setting was lost");
assert(codeBuddyConfig.literal === "https://example.com/a,//,}", "JSONC string was corrupted");
assert(codeBuddyConfig.mcpServers.existing.command === "existing-tool", "existing MCP server was lost");
assert(codeBuddyConfig.mcpServers["record-and-replay-local"].command.includes("/current/runtime/bin/node"), "stable MCP node path missing");
assert(!(await readdir(join(home, ".codebuddy"))).includes(".mcp.json"), "installer shadowed the active legacy CodeBuddy config");
const qoderConfig = JSON.parse(await readFile(join(home, ".qoder", "settings.json"), "utf8"));
assert(qoderConfig.permissions.allow[0] === "existing", "Qoder settings were lost");
assert(qoderConfig.mcpServers["record-and-replay-local"], "Qoder MCP server missing");
const workBuddyConfig = JSON.parse(await readFile(join(home, ".workbuddy", "mcp.json"), "utf8"));
assert(workBuddyConfig.mcpServers["record-and-replay-local"], "WorkBuddy MCP server missing");
assert(await readFile(join(home, ".codebuddy", "skills", "record-and-replay-local", "SKILL.md"), "utf8"), "CodeBuddy skill missing");
assert(await readFile(join(home, ".codebuddy", "skills", "record-and-replay-local", "references", "faq-deep.md"), "utf8"), "CodeBuddy skill references missing");
assert(await readFile(join(home, ".qoder", "skills", "record-and-replay-local", "SKILL.md"), "utf8"), "Qoder skill missing");
assert(await readFile(join(home, "Library", "Application Support", "FlowOnce", "share", "FlowOnce-Controller.zip"), "utf8") === "test-package", "WorkBuddy package missing");
assert((await readFile(join(home, "Applications", "FlowOnce.app", "Contents", "Info.plist"), "utf8")).includes("local.record-and-replay"), "recorder app missing or wrong identity");
assert(!(await exists(join(home, "Applications", "Record & Replay Local.app"))), "legacy recorder app was not migrated");
assert(first.legacyRecorderBackup && await exists(first.legacyRecorderBackup), "legacy recorder backup missing");

runInstaller(home, "codebuddy,workbuddy,qoder");
const idempotentConfig = JSON.parse(await readFile(join(home, ".codebuddy", "mcp.json"), "utf8"));
assert(Object.keys(idempotentConfig.mcpServers).sort().join(",") === "existing,record-and-replay-local", "reinstall duplicated MCP entries");
assert((await readdir(join(home, ".codebuddy"))).some(name => name.startsWith("mcp.json.backup-")), "configuration backup missing");
assert(!(await readdir(join(home, "Applications"))).some(name => name.startsWith("FlowOnce.app.backup-")), "recorder backup cluttered Applications");

const codexHome = join(testRoot, "codex-home");
const fakeCodex = join(testRoot, "fake-codex.sh");
const codexLog = join(testRoot, "codex.log");
await mkdir(join(codexHome, ".codex"), { recursive: true });
await mkdir(join(codexHome, ".codex", "skills", "flowonce"), { recursive: true });
await writeFile(join(codexHome, ".codex", "skills", "flowonce", "SKILL.md"), "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.2\n---\n");
await writeFile(join(codexHome, ".codex", "skills", "flowonce", "_meta.json"), '{"source":"skillhub"}\n');
await writeFile(fakeCodex, `#!/bin/sh
printf '%s\\n' "$*" >> "${codexLog}"
if [ "$*" = "mcp get event-stream --json" ]; then
  printf '%s\\n' '{"transport":{"args":["./scripts/event-stream-mcp.mjs"],"cwd":"/tmp/plugins/record-and-replay-local/version/."}}'
fi
exit 0
`);
await chmod(fakeCodex, 0o755);
runInstaller(codexHome, "codex", { RECORD_REPLAY_CODEX_BIN: fakeCodex });
const loggedCommands = await readFile(codexLog, "utf8");
assert(loggedCommands.includes("mcp remove record-and-replay-local"), "Codex old MCP entry was not reconciled");
assert(loggedCommands.includes("mcp remove event-stream"), "Codex legacy duplicate MCP entry was not removed");
assert(loggedCommands.includes("mcp add record-and-replay-local --"), "Codex MCP server was not added");
assert(await readFile(join(codexHome, ".codex", "skills", "record-and-replay-local", "SKILL.md"), "utf8"), "Codex skill missing");
assert((await readFile(join(codexHome, ".codex", "skills", "flowonce", "SKILL.md"), "utf8")).includes(`version: ${releaseVersion}`), "SkillHub alias was not synchronized");
assert(await readFile(join(codexHome, ".codex", "skills", "flowonce", "_meta.json"), "utf8"), "SkillHub alias metadata was not preserved");

const invalidHome = join(testRoot, "invalid-home");
await mkdir(join(invalidHome, ".qoder"), { recursive: true });
const invalidPath = join(invalidHome, ".qoder", "settings.json");
await writeFile(invalidPath, "{ invalid json");
const invalid = spawnSync(process.execPath, [
  join(root, "scripts", "install-distribution.mjs"),
  "--payload", payload,
  "--home", invalidHome,
  "--hosts", "qoder",
  "--no-system-detect"
], { encoding: "utf8" });
assert(invalid.status !== 0 && invalid.stderr.includes("Cannot safely update invalid JSON/JSONC"), "invalid configuration was not rejected");
assert(await readFile(invalidPath, "utf8") === "{ invalid json", "invalid configuration was modified");

process.stdout.write("One-click installer contract OK\n");
