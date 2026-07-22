import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createRecorderService(options = {}) {
  const root = options.root;
  const installedCollectorApp = join(process.env.HOME ?? "", "Applications", "FlowOnce.app");
  const bundledCollectorApp = join(root, "bin", "FlowOnce.app");
  const collectorApp = options.collectorApp ?? process.env.RECORD_REPLAY_APP_PATH ?? installedCollectorApp;
  const collectorExecutable = join(collectorApp, "Contents", "MacOS", "RecordAndReplayLocal");
  const stateRoot = options.stateRoot ?? process.env.RECORD_REPLAY_STATE_ROOT ?? join(tmpdir(), "record-and-replay-local");
  const activePath = join(stateRoot, "active.json");
  const maxDurationSeconds = options.maxDurationSeconds ?? 1800;
  const useLaunchServices = options.useLaunchServices ?? (process.platform === "darwin" && process.env.RECORD_REPLAY_HEADLESS !== "1");
  let pendingStart = null;

  async function exists(path) {
    try { await access(path, fsConstants.F_OK); return true; } catch { return false; }
  }

  async function readJSON(path) {
    try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
  }

  function publicStatus(session, isRecording) {
    if (!session) return { isRecording: false, maxDurationSeconds };
    const { pid, ...visible } = session;
    const permissionRequired = session.endReason === "accessibility_permission_required";
    return {
      ...visible,
      isRecording,
      maxDurationSeconds,
      sessionID: session.id,
      ...(permissionRequired ? {
        permissionRequired: true,
        permissionInstructions: "In System Settings > Privacy & Security > Accessibility, enable FlowOnce.app. If it already appears enabled, turn it off and back on once. Then start a new recording; this setup attempt was discarded."
      } : {})
    };
  }

  async function currentSession() {
    const active = await readJSON(activePath);
    if (!active) return { session: null, isRecording: false };
    const metadata = await readJSON(active.metadataPath);
    let heartbeatFresh = false;
    try {
      const heartbeat = await stat(join(active.sessionDirectoryPath, "heartbeat"));
      heartbeatFresh = Date.now() - heartbeat.mtimeMs < 4000;
    } catch {}
    const isRecording = !(metadata?.endedAt) && heartbeatFresh && await exists(active.eventsPath);
    if (!isRecording && !metadata && !(await exists(active.sessionDirectoryPath))) {
      await rm(activePath, { force: true });
      return { session: null, isRecording: false };
    }
    return { session: { ...active, ...(metadata ?? {}) }, isRecording };
  }

  async function startOnce({ requireLocalConsent = true } = {}) {
    await mkdir(stateRoot, { recursive: true });
    const current = await currentSession();
    if (current.isRecording) return publicStatus(current.session, true);
    if (!(await exists(collectorExecutable))) {
      const hint = await exists(join(bundledCollectorApp, "Contents", "MacOS", "RecordAndReplayLocal"))
        ? "Run scripts/install-recorder.sh once."
        : "Run scripts/build.sh and scripts/install-recorder.sh once.";
      throw new Error(`Missing installed native recorder at ${collectorApp}. ${hint}`);
    }

    const id = randomUUID().toUpperCase();
    const sessionDirectoryPath = join(stateRoot, id);
    const session = {
      id,
      startedAt: new Date().toISOString(),
      sessionDirectoryPath,
      metadataPath: join(sessionDirectoryPath, "session.json"),
      eventsPath: join(sessionDirectoryPath, "events.jsonl")
    };
    await mkdir(sessionDirectoryPath, { recursive: true });
    const args = [sessionDirectoryPath, String(maxDurationSeconds)];
    if (requireLocalConsent) args.push("--require-local-consent");
    const launchCommand = useLaunchServices ? "/usr/bin/open" : collectorExecutable;
    const launchArgs = useLaunchServices ? ["-W", "-n", collectorApp, "--args", ...args] : args;
    const child = spawn(launchCommand, launchArgs, { detached: true, stdio: "ignore" });
    let collectorExit = null;
    child.once("exit", (code, signal) => { collectorExit = { code, signal }; });
    child.once("error", error => { collectorExit = { error }; });
    child.unref();
    await writeFile(activePath, JSON.stringify(session, null, 2));

    let consent = null;
    let terminalMetadata = null;
    for (let i = 0; i < 6000 && !(await exists(join(sessionDirectoryPath, "heartbeat"))); i += 1) {
      consent = await readJSON(join(sessionDirectoryPath, "consent.json"));
      if (consent?.action && consent.action !== "accept") break;
      terminalMetadata = await readJSON(session.metadataPath);
      if (terminalMetadata?.endedAt) break;
      if (collectorExit) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    async function cleanupFailedStart() {
      await rm(activePath, { force: true });
      await rm(sessionDirectoryPath, { recursive: true, force: true });
    }
    if (consent?.action === "decline") {
      await cleanupFailedStart();
      throw new Error("FlowOnce approval denied in the native consent dialog.");
    }
    terminalMetadata ??= await readJSON(session.metadataPath);
    if (terminalMetadata?.endReason === "accessibility_permission_required") {
      return publicStatus({ ...session, ...terminalMetadata }, false);
    }
    if (collectorExit) {
      await cleanupFailedStart();
      if (collectorExit.error) throw new Error(`The native recorder could not start: ${collectorExit.error.message}`);
      throw new Error(`The native recorder exited before becoming ready (code ${collectorExit.code ?? "unknown"}, signal ${collectorExit.signal ?? "none"}).`);
    }
    const launched = await currentSession();
    if (!launched.isRecording) {
      await cleanupFailedStart();
      throw new Error("The native recorder did not become ready.");
    }
    return publicStatus(launched.session ?? session, true);
  }

  async function start(options = {}) {
    if (pendingStart) return pendingStart;
    pendingStart = startOnce(options);
    try { return await pendingStart; } finally { pendingStart = null; }
  }

  async function status() {
    await mkdir(stateRoot, { recursive: true });
    const current = await currentSession();
    return publicStatus(current.session, current.isRecording);
  }

  async function stop() {
    const current = await currentSession();
    if (!current.session || !current.isRecording) return publicStatus(current.session, false);
    await writeFile(join(current.session.sessionDirectoryPath, "stop"), "");
    for (let i = 0; i < 60; i += 1) {
      const metadata = await readJSON(current.session.metadataPath);
      if (metadata?.endedAt) return publicStatus({ ...current.session, ...metadata }, false);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return publicStatus(current.session, false);
  }

  return { start, status, stop };
}
