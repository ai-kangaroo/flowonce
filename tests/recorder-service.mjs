#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecorderService } from "../scripts/recorder-service.mjs";

const root = await mkdtemp(join(tmpdir(), "record-replay-service."));
const stateRoot = join(root, "state");
const collectorApp = join(root, "Fake Collector.app");
const executable = join(collectorApp, "Contents", "MacOS", "RecordAndReplayLocal");
const missingService = createRecorderService({
  stateRoot: join(root, "missing-state"),
  collectorApp: join(root, "Missing.app"),
  useLaunchServices: false
});
const missing = await missingService.start();
if (!missing.setupRequired || !missing.canAutoFix || missing.automaticAction?.type !== "run_bootstrap") {
  throw new Error("missing recorder did not route to automatic bootstrap");
}
await mkdir(join(collectorApp, "Contents", "MacOS"), { recursive: true });
await writeFile(executable, `#!/usr/bin/env node
import { access, appendFile, mkdir, rm, writeFile } from "node:fs/promises";
const [session, maxDuration, consentFlag] = process.argv.slice(2);
await mkdir(session, { recursive: true });
if (consentFlag === "--require-local-consent" && process.env.FAKE_COLLECTOR_MODE === "decline") {
  await writeFile(session + "/consent.json", JSON.stringify({ action: "decline" }));
  process.exit(3);
}
const startedAt = new Date().toISOString();
const eventsPath = session + "/events.jsonl";
const metadataPath = session + "/session.json";
if (process.env.FAKE_COLLECTOR_MODE === "permission-required") {
  const endedAt = new Date().toISOString();
  await writeFile(metadataPath, JSON.stringify({ id: session.split("/").pop(), startedAt, endedAt, endReason: "accessibility_permission_required", eventsPath, accessibilityTrusted: false }));
  process.exit(0);
}
await writeFile(eventsPath, JSON.stringify({ kind: "session.started", timestamp: startedAt }) + "\\n");
await writeFile(metadataPath, JSON.stringify({ id: session.split("/").pop(), startedAt, eventsPath, accessibilityTrusted: true }));
await writeFile(session + "/heartbeat", "alive");
const timer = setInterval(async () => {
  try {
    await access(session + "/stop");
    const endedAt = new Date().toISOString();
    await appendFile(eventsPath, JSON.stringify({ kind: "session.ended", timestamp: endedAt, endReason: "recording_controls_stopped" }) + "\\n");
    await writeFile(metadataPath, JSON.stringify({ id: session.split("/").pop(), startedAt, endedAt, endReason: "recording_controls_stopped", eventsPath, accessibilityTrusted: true }));
    await rm(session + "/heartbeat", { force: true });
    clearInterval(timer);
    process.exit(0);
  } catch {
    await writeFile(session + "/heartbeat", "alive");
  }
}, 25);
`);
await chmod(executable, 0o755);

const service = createRecorderService({ root, stateRoot, collectorApp, maxDurationSeconds: 30, useLaunchServices: false });
process.env.FAKE_COLLECTOR_MODE = "decline";
let declined = false;
try { await service.start({ requireLocalConsent: true }); } catch (error) { declined = error.message.includes("denied"); }
if (!declined) throw new Error("native consent decline was not reported");
if ((await readdir(stateRoot)).length !== 0) throw new Error("failed start left active state or session data");

process.env.FAKE_COLLECTOR_MODE = "permission-required";
const permission = await service.start({ requireLocalConsent: false });
if (permission.isRecording || !permission.permissionRequired || permission.endReason !== "accessibility_permission_required" || !permission.permissionInstructions?.includes("turn it off and back on")) {
  throw new Error("Accessibility permission setup was not reported as a discarded session");
}
if ((await readdir(permission.sessionDirectoryPath)).includes("events.jsonl")) throw new Error("permission setup retained an event stream");

process.env.FAKE_COLLECTOR_MODE = "accept";
const [first, second] = await Promise.all([
  service.start({ requireLocalConsent: false }),
  service.start({ requireLocalConsent: false })
]);
if (!first.isRecording || first.sessionID !== second.sessionID) throw new Error("concurrent service starts did not share one session");
const stopped = await service.stop();
if (stopped.isRecording || stopped.endReason !== "recording_controls_stopped") throw new Error("service stop did not converge to ended metadata");
process.stdout.write("Recorder service contract OK\n");
