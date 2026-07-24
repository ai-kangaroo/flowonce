#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
const expected = release.version;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/^\d+\.\d+\.\d+$/.test(expected), "release.json must contain a semantic version");

for (const relativePath of ["scripts/Info.plist", "scripts/Installer-Info.plist"]) {
  const plist = await readFile(join(root, relativePath), "utf8");
  const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
  assert(match, `${relativePath} is missing CFBundleShortVersionString`);
  assert(match[1] === "__FLOWONCE_VERSION__", `${relativePath} must source its version from release.json at build time`);
  assert(plist.includes("<string>FlowOnce</string>") || plist.includes("<string>Install FlowOnce</string>"), `${relativePath} does not use the FlowOnce brand`);
}

const mcp = await readFile(join(root, "scripts/event-stream-mcp.mjs"), "utf8");
assert(mcp.includes('version: release.version'), "event-stream-mcp.mjs must source its version from release.json");

const builtPlist = await readFile(join(root, "bin", "FlowOnce.app", "Contents", "Info.plist"), "utf8");
const builtVersion = builtPlist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
assert(builtVersion?.[1] === expected, `built FlowOnce.app version ${builtVersion?.[1]} does not match release ${expected}`);

const skillUI = await readFile(join(root, "skills", "record-and-replay-local", "agents", "openai.yaml"), "utf8");
assert(skillUI.includes('display_name: "FlowOnce"'), "skill display name is not FlowOnce");
assert(skillUI.includes('value: "record-and-replay-local"'), "skill MCP dependency does not use the compatibility ID");
for (const relativePath of ["README.md", "docs/guides/user-guide.md"]) {
  const document = await readFile(join(root, relativePath), "utf8");
  assert(document.includes("FlowOnce"), `${relativePath} is missing the FlowOnce brand`);
}

const readme = await readFile(join(root, "README.md"), "utf8");
assert(readme.includes(`version-${expected}-blue`), `README.md badge does not match release ${expected}`);
const skill = await readFile(join(root, "skills", "record-and-replay-local", "SKILL.md"), "utf8");
const skillVersion = skill.match(/^\s{2}version:\s*([^\s]+)$/m);
assert(skillVersion, "SKILL.md metadata is missing its version");
assert(skillVersion[1] === expected, `SKILL.md version ${skillVersion[1]} does not match release ${expected}`);

process.stdout.write(`Brand and version consistency OK (FlowOnce ${expected})\n`);
