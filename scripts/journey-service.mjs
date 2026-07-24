import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const allowedStages = new Set([
  "readiness_checked",
  "replay_preflighted",
  "recording_started",
  "recording_completed",
  "skill_generated",
  "skill_installed",
  "replay_started",
  "replay_passed",
  "replay_checkpoint_passed",
  "replay_blocked",
  "second_successful_replay"
]);
const allowedStatuses = new Set(["passed", "failed", "blocked"]);

async function readJSON(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export function createJourneyService(options = {}) {
  const path = resolve(options.path
    ?? process.env.FLOWONCE_JOURNEY_PATH
    ?? join(homedir(), "Library", "Application Support", "FlowOnce", "journey", "journey.json"));
  const now = options.now ?? (() => new Date());

  async function record(stage, { status = "passed", errorCode, durationMs } = {}) {
    if (!allowedStages.has(stage)) throw new Error(`Unsupported journey stage: ${stage}`);
    if (!allowedStatuses.has(status)) throw new Error(`Unsupported journey status: ${status}`);
    if (errorCode !== undefined && (typeof errorCode !== "string" || !/^[a-z0-9_]{1,80}$/u.test(errorCode))) {
      throw new Error("errorCode must be a short machine-readable code.");
    }
    if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs < 0)) {
      throw new Error("durationMs must be a non-negative number.");
    }
    const current = await readJSON(path) ?? {
      schemaVersion: 1,
      privacy: "local_aggregate_only",
      createdAt: now().toISOString(),
      counts: {},
      recent: []
    };
    const key = `${stage}:${status}`;
    current.counts[key] = (current.counts[key] ?? 0) + 1;
    const event = {
      stage,
      status,
      at: now().toISOString(),
      ...(errorCode ? { errorCode } : {}),
      ...(durationMs !== undefined ? { durationMs: Math.round(durationMs) } : {})
    };
    current.recent = [...(current.recent ?? []), event].slice(-100);
    const successfulReplays = current.counts["replay_passed:passed"] ?? 0;
    if (stage === "replay_passed" && status === "passed" && successfulReplays === 2) {
      current.counts["second_successful_replay:passed"] = 1;
      current.recent.push({ stage: "second_successful_replay", status: "passed", at: event.at });
      current.recent = current.recent.slice(-100);
    }
    current.updatedAt = event.at;
    await atomicWrite(path, current);
    return { recorded: true, stage, status, path };
  }

  async function status() {
    const current = await readJSON(path);
    return current
      ? { found: true, path, ...current }
      : { found: false, path, privacy: "local_aggregate_only", counts: {}, recent: [] };
  }

  return { record, status, path };
}
