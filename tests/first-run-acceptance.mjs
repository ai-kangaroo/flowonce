#!/usr/bin/env node
import { chmod, cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyFirstRunAcceptance } from "../scripts/verify-first-run-acceptance.mjs";

const root = join(import.meta.dirname, "..");
const home = await mkdtemp(join(tmpdir(), "flowonce-first-run."));
const recorder = join(home, "Applications", "FlowOnce.app", "Contents", "MacOS", "RecordAndReplayLocal");
const cli = join(home, "Library", "Application Support", "FlowOnce", "bin", "flowonce");
await mkdir(join(recorder, ".."), { recursive: true });
await writeFile(recorder, "#!/bin/sh\nexit 0\n");
await chmod(recorder, 0o755);
await mkdir(join(cli, ".."), { recursive: true });
await writeFile(cli, "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true,\"status\":\"ready\",\"checks\":[{\"id\":\"accessibility\",\"status\":\"pass\"}]}'\n");
await chmod(cli, 0o755);
const skill = join(home, "SKILL.md");
await cp(join(root, "skills", "record-and-replay-local", "SKILL.md"), skill);

const passed = await verifyFirstRunAcceptance({
  home,
  skillPath: skill,
  startedAt: "2026-07-24T00:00:00.000Z",
  finishedAt: "2026-07-24T00:01:30.000Z"
});
if (!passed.ready) throw new Error("valid clean-Mac acceptance was rejected");

await writeFile(cli, "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true,\"status\":\"ready\",\"checks\":[{\"id\":\"accessibility\",\"status\":\"warn\"}]}'\n");
const ambiguousPermission = await verifyFirstRunAcceptance({
  home,
  skillPath: skill,
  startedAt: "2026-07-24T00:00:00.000Z",
  finishedAt: "2026-07-24T00:01:30.000Z"
});
if (ambiguousPermission.ready || ambiguousPermission.checks.find(check => check.id === "doctor_ready")?.status !== "fail") {
  throw new Error("ambiguous Accessibility permission was accepted");
}
await writeFile(cli, "#!/bin/sh\nprintf '%s\\n' '{\"ready\":true,\"status\":\"ready\",\"checks\":[{\"id\":\"accessibility\",\"status\":\"pass\"}]}'\n");

const slow = await verifyFirstRunAcceptance({
  home,
  skillPath: skill,
  startedAt: "2026-07-24T00:00:00.000Z",
  finishedAt: "2026-07-24T00:03:00.000Z"
});
if (slow.ready || slow.checks.find(check => check.id === "time_to_ready")?.status !== "fail") {
  throw new Error("slow first-run acceptance was not surfaced");
}

process.stdout.write("First-run acceptance contract OK\n");
