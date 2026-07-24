#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDoctorService, formatDoctorReport } from "../scripts/doctor-service.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const testRoot = await mkdtemp(join(tmpdir(), "flowonce-doctor."));
const root = join(testRoot, "source");
const home = join(testRoot, "home");
const current = join(home, "Library", "Application Support", "FlowOnce", "current");
const app = join(home, "Applications", "FlowOnce.app");
const executable = join(app, "Contents", "MacOS", "RecordAndReplayLocal");
const skill = join(home, ".codex", "skills", "record-and-replay-local", "SKILL.md");

await mkdir(join(root, "scripts"), { recursive: true });
await mkdir(join(current, "runtime", "bin"), { recursive: true });
await mkdir(join(current, "scripts"), { recursive: true });
await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
await mkdir(join(home, ".codex", "skills", "record-and-replay-local"), { recursive: true });
await writeFile(join(root, "release.json"), '{"version":"0.3.3"}\n');
await writeFile(join(current, "release.json"), '{"version":"0.3.3"}\n');
await writeFile(join(current, "runtime", "bin", "node"), "");
await writeFile(join(current, "scripts", "event-stream-mcp.mjs"), "");
await writeFile(join(app, "Contents", "Info.plist"), `
<key>CFBundleShortVersionString</key>
<string>0.3.3</string>
`);
await writeFile(executable, "#!/bin/sh\n");
await chmod(executable, 0o755);
await writeFile(skill, "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.3\n---\n");

const readyService = createDoctorService({
  root,
  home,
  platform: "darwin",
  accessibilityProbe: probeApp => ({
    trusted: probeApp === app,
    available: true
  }),
  mcpProbe: async () => ({ configured: true })
});
const ready = await readyService.inspect({ host: "codex" });
assert(ready.ready && ready.status === "ready", "doctor did not accept a ready installation");
assert(formatDoctorReport(ready).includes("可以开始录制"), "doctor summary is not user-friendly");

await writeFile(skill, "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.2\n---\n");
const stale = await readyService.inspect({ host: "codex" });
assert(!stale.ready && stale.checks.some(item => item.id === "skill" && item.status === "fail"), "doctor missed a stale host skill");
assert(stale.nextAction.includes("版本一致"), "doctor did not provide a single recovery action");

const aliasSkill = join(home, ".codex", "skills", "flowonce", "SKILL.md");
await mkdir(join(home, ".codex", "skills", "flowonce"), { recursive: true });
await writeFile(skill, "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.3\n---\n");
await writeFile(aliasSkill, "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.3\n---\n");
const duplicate = await readyService.inspect({ host: "codex" });
assert(duplicate.ready && duplicate.checks.some(item => item.id === "skill" && item.status === "warn" && item.message.includes("2 份")), "doctor did not handle aligned duplicate FlowOnce skills");
await writeFile(aliasSkill, "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.1\n---\n");
const conflictingDuplicate = await readyService.inspect({ host: "codex" });
assert(!conflictingDuplicate.ready && conflictingDuplicate.checks.some(item => item.id === "skill" && item.status === "fail"), "doctor missed conflicting duplicate FlowOnce skills");

const permissionService = createDoctorService({
  root,
  home,
  platform: "darwin",
  accessibilityProbe: () => ({ trusted: false, available: true }),
  mcpProbe: async () => ({ configured: true })
});
await rm(join(home, ".codex", "skills", "flowonce"), { recursive: true });
await writeFile(skill, "---\nname: record-and-replay-local\nmetadata:\n  version: 0.3.3\n---\n");
const permission = await permissionService.inspect({ host: "codex" });
assert(!permission.ready && permission.checks.some(item => item.id === "accessibility" && item.status === "fail"), "doctor missed Accessibility permission");
assert(permission.nextAction.includes("辅助功能"), "doctor did not explain Accessibility recovery");

process.stdout.write("FlowOnce doctor contract OK\n");
