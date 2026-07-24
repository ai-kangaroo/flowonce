#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillInstallService } from "../scripts/skill-install-service.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testRoot = await mkdtemp(join(tmpdir(), "flowonce-skill-install."));
const home = join(testRoot, "home");
const output = join(testRoot, "generated");
await mkdir(join(home, ".codex", "skills"), { recursive: true });
await mkdir(output, { recursive: true });

execFileSync(process.execPath, [
  join(root, "scripts", "generate-skill.mjs"),
  join(root, "tests", "fixtures", "reviewed-workflow.json"),
  output,
  "aha-demo",
  "--target",
  "portable"
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const service = createSkillInstallService({ home });
const skillPath = join(output, "aha-demo");
const first = await service.install({ skillPath, host: "codex" });
assert(first.installed && first.status === "installed", "generated skill was not installed");
assert(first.nextUsePrompt.includes("以后可以直接说"), "install result did not provide a beginner-friendly next-use prompt");
const installedPath = join(home, ".codex", "skills", "aha-demo");
assert((await readFile(join(installedPath, "SKILL.md"), "utf8")).includes("# Enter provided text in a TextEdit document"), "installed skill content is wrong");

await writeFile(join(installedPath, "previous-version.txt"), "old");
const second = await service.install({ skillPath, host: "codex" });
assert(second.installed && second.backupPath, "reinstall did not preserve the previous generated skill");
assert(await readFile(join(second.backupPath, "previous-version.txt"), "utf8") === "old", "generated skill backup was lost");

const conflictPath = join(home, ".codex", "skills", "conflicting-skill");
await mkdir(conflictPath, { recursive: true });
await writeFile(join(conflictPath, "SKILL.md"), "---\nname: conflicting-skill\n---\n");
execFileSync(process.execPath, [
  join(root, "scripts", "generate-skill.mjs"),
  join(root, "tests", "fixtures", "reviewed-workflow.json"),
  output,
  "conflicting-skill",
  "--target",
  "portable"
]);
const conflict = await service.install({ skillPath: join(output, "conflicting-skill"), host: "codex" });
assert(!conflict.installed && conflict.status === "name_conflict", "installer overwrote a non-FlowOnce skill");

await symlink("/tmp", join(skillPath, "unsafe-link"));
let rejectedSymlink = false;
try {
  await service.install({ skillPath, host: "codex" });
} catch (error) {
  rejectedSymlink = error.message.includes("symbolic links");
}
assert(rejectedSymlink, "installer accepted a generated skill containing a symbolic link");

process.stdout.write("Generated skill auto-install OK\n");
