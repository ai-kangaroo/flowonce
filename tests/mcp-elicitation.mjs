#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function runScenario(action, startMode = "single") {
const stateRoot = await mkdtemp(join(tmpdir(), `record-replay-elicitation-${action}.`));
const child = spawn(process.execPath, [join(root, "scripts", "event-stream-mcp.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    RECORD_REPLAY_STATE_ROOT: stateRoot,
    RECORD_REPLAY_APP_PATH: join(root, "bin", "FlowOnce.app"),
    RECORD_REPLAY_HEADLESS: "1"
  },
  stdio: ["pipe", "pipe", "inherit"]
});
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
let elicitationSeen = false;
let elicitationCount = 0;
let startResult;
let secondStartResult;
let stopResult;

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

const finished = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("elicitation test timed out")), 5000);
  lines.on("line", line => {
    const message = JSON.parse(line);
    if (message.method === "elicitation/create") {
      elicitationSeen = true;
      elicitationCount += 1;
      if (!message.params?.message?.includes("Allow FlowOnce to record")) reject(new Error("missing FlowOnce approval message"));
      send({ jsonrpc: "2.0", id: message.id, result: { action } });
      return;
    }
    if (message.id === 2) {
      startResult = message;
      if (startMode === "concurrent") {
        if (!secondStartResult) return;
      }
      if (action === "accept" && message.result) {
        if (startMode === "sequential") {
          send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "event_stream_start", arguments: {} } });
          return;
        }
        send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "event_stream_stop", arguments: {} } });
        return;
      }
      clearTimeout(timer);
      resolve();
    }
    if (message.id === 4) {
      secondStartResult = message;
      if (!startResult) return;
      if (action === "accept" && message.result) {
        send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "event_stream_stop", arguments: {} } });
      } else {
        clearTimeout(timer);
        resolve();
      }
      return;
    }
    if (message.id === 3) {
      stopResult = message;
      clearTimeout(timer);
      resolve();
    }
  });
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} } } });
send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "event_stream_start", arguments: {} } });
if (startMode === "concurrent") send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "event_stream_start", arguments: {} } });
await finished;
child.stdin.end();
if (!elicitationSeen) throw new Error("server did not request MCP elicitation");
if (elicitationCount !== 1) throw new Error(`expected one elicitation, saw ${elicitationCount}`);
if (action === "decline" || action === "cancel") {
  const expected = action === "decline" ? "denied via MCP elicitation" : "cancelled via MCP elicitation";
  if (!startResult?.error?.message?.includes(expected)) throw new Error(`${action} did not reject recording start`);
  if ((await readdir(stateRoot)).length !== 0) throw new Error(`${action} left recording state on disk`);
} else {
  const started = JSON.parse(startResult?.result?.content?.[0]?.text ?? "null");
  const secondStarted = startMode !== "single" ? JSON.parse(secondStartResult?.result?.content?.[0]?.text ?? "null") : started;
  const stopped = JSON.parse(stopResult?.result?.content?.[0]?.text ?? "null");
  if (!started?.isRecording) throw new Error("accepted recording did not start");
  if (startMode !== "single" && secondStarted?.sessionID !== started.sessionID) throw new Error(`${startMode} starts did not share one session`);
  if (stopped?.isRecording || stopped?.endReason !== "recording_controls_stopped") throw new Error("accepted recording did not stop cleanly");
}
process.stdout.write(`MCP elicitation ${action} OK\n`);
}

await runScenario("decline");
await runScenario("cancel");
await runScenario("accept");
await runScenario("accept", "concurrent");
await runScenario("accept", "sequential");
