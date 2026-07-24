#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function exists(path) {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function versionFromSkill(source) {
  return source.match(/^\s{2}version:\s*([^\s]+)$/m)?.[1]
    ?? source.match(/^version:\s*([^\s]+)$/m)?.[1]
    ?? null;
}

export async function verifyFirstRunAcceptance({
  home,
  skillPath,
  startedAt,
  finishedAt = new Date().toISOString(),
  maxSeconds = 120
}) {
  if (!home || !skillPath || !startedAt) throw new Error("home, skillPath, and startedAt are required.");
  const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
  const recorder = join(home, "Applications", "FlowOnce.app", "Contents", "MacOS", "RecordAndReplayLocal");
  const cli = join(home, "Library", "Application Support", "FlowOnce", "bin", "flowonce");
  const checks = [];
  checks.push({
    id: "recorder_installed",
    status: await exists(recorder) ? "pass" : "fail",
    message: "FlowOnce recorder is installed in the stable user path."
  });
  checks.push({
    id: "cli_installed",
    status: await exists(cli) ? "pass" : "fail",
    message: "Stable FlowOnce CLI is installed."
  });
  let deliveredVersion = null;
  try {
    deliveredVersion = versionFromSkill(await readFile(resolve(skillPath), "utf8"));
  } catch {}
  checks.push({
    id: "skill_synced",
    status: deliveredVersion === release.version ? "pass" : "fail",
    message: deliveredVersion === release.version
      ? `Delivered Skill matches ${release.version}.`
      : `Delivered Skill ${deliveredVersion ?? "missing"} does not match ${release.version}.`
  });

  let doctor = null;
  if (await exists(cli)) {
    const result = spawnSync(cli, ["doctor", "portable", "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
      timeout: 15_000
    });
    try {
      doctor = JSON.parse(result.stdout);
    } catch {}
  }
  const accessibilityCheck = doctor?.checks?.find(check => check.id === "accessibility");
  const doctorAcceptanceReady = doctor?.ready === true && accessibilityCheck?.status === "pass";
  checks.push({
    id: "doctor_ready",
    status: doctorAcceptanceReady ? "pass" : "fail",
    message: doctorAcceptanceReady
      ? "Recorder, runtime, Skill, and Accessibility permission are ready."
      : accessibilityCheck?.status !== "pass"
        ? `Accessibility permission was not explicitly verified${accessibilityCheck?.status ? ` (${accessibilityCheck.status})` : ""}.`
        : `FlowOnce doctor is not ready${doctor?.issueCode ? `: ${doctor.issueCode}` : "."}`
  });

  const elapsedSeconds = Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
  checks.push({
    id: "time_to_ready",
    status: Number.isFinite(elapsedSeconds) && elapsedSeconds <= maxSeconds ? "pass" : "fail",
    message: `First-run readiness took ${Number.isFinite(elapsedSeconds) ? Math.round(elapsedSeconds) : "unknown"} seconds; target is ${maxSeconds}.`
  });
  const ready = checks.every(check => check.status === "pass");
  return {
    ready,
    version: release.version,
    elapsedSeconds,
    checks,
    nextAction: ready
      ? "Clean-Mac first-run acceptance passed. Continue with one changed-input demo and require a full replay pass."
      : "Fix the first failing check and repeat this acceptance run from a clean macOS user account."
  };
}

function parseArgs(argv) {
  const options = { maxSeconds: 120 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--home", "--skill", "--started-at", "--finished-at", "--max-seconds"].includes(key) || !argv[index + 1]) {
      throw new Error("Usage: verify-first-run-acceptance.mjs --home path --skill SKILL.md --started-at ISO [--finished-at ISO] [--max-seconds 120]");
    }
    const value = argv[index + 1];
    if (key === "--home") options.home = resolve(value);
    else if (key === "--skill") options.skillPath = resolve(value);
    else if (key === "--started-at") options.startedAt = value;
    else if (key === "--finished-at") options.finishedAt = value;
    else options.maxSeconds = Number(value);
    index += 1;
  }
  return options;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const result = await verifyFirstRunAcceptance(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}
