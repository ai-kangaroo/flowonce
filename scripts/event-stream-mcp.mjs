#!/usr/bin/env node
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { createRecorderService } from "./recorder-service.mjs";
import { validateWorkflow } from "./workflow-validation.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.version ?? "")) {
  throw new Error("release.json must contain a valid semantic version.");
}
const recorder = createRecorderService({ root });
const execFileAsync = promisify(execFile);
const elicitationTimeoutMs = 5 * 60 * 1000;
let clientCapabilities = {};
let nextServerRequestID = 100000;
const pendingServerRequests = new Map();
let pendingStart = null;

const emptyInputSchema = { type: "object", properties: {}, additionalProperties: false };
const toolDefinitions = {
  event_stream_start: {
    description: "Start recording the user's macOS actions for up to 30 minutes. Ask the user to say they are ready before calling. If Accessibility permission is missing, return permissionRequired=true plus recovery instructions without retaining an event stream. If a recording is already active, return that session instead of starting another one.",
    inputSchema: emptyInputSchema
  },
  event_stream_status: {
    description: "Get the current or most recent recording status, including metadata and event-stream paths.",
    inputSchema: emptyInputSchema
  },
  event_stream_stop: {
    description: "Stop the active recording and retain its event stream. Call only after the user says the demonstrated workflow is complete.",
    inputSchema: emptyInputSchema
  },
  recording_normalize: {
    description: "Convert a retained raw recording event stream into a compact semantic action view. Raw JSONL remains the primary evidence.",
    inputSchema: {
      type: "object",
      properties: { eventsPath: { type: "string", description: "Absolute path returned by event_stream_stop." } },
      required: ["eventsPath"],
      additionalProperties: false
    }
  },
  workflow_compile: {
    description: "Compile a retained raw event stream into a draft, portable Workflow IR. Review the draft, set its goal and success condition, rename inputs, and remove incidental actions before generation.",
    inputSchema: {
      type: "object",
      properties: { eventsPath: { type: "string", description: "Absolute path returned by event_stream_stop." } },
      required: ["eventsPath"],
      additionalProperties: false
    }
  },
  workflow_validate: {
    description: "Validate portable Workflow IR before generating a reusable skill.",
    inputSchema: {
      type: "object",
      properties: {
        workflow: { type: "object", description: "Workflow IR object to validate." },
        reviewed: { type: "boolean", description: "Require reviewed status and safety guarantees." }
      },
      required: ["workflow"],
      additionalProperties: false
    }
  },
  skill_generate: {
    description: "Generate a reusable SKILL.md package from reviewed Workflow IR. Portable is the default; codex adds OpenAI UI metadata, and workbuddy also creates an uploadable zip.",
    inputSchema: {
      type: "object",
      properties: {
        workflow: { type: "object", description: "Reviewed Workflow IR object." },
        outputParent: { type: "string", description: "Absolute directory in which to create the skill folder." },
        skillName: { type: "string", description: "Lowercase skill name; other characters are normalized to hyphens." },
        target: {
          type: "string",
          enum: ["portable", "codex", "codebuddy", "qoder", "qoderwork", "workbuddy"],
          description: "Optional host packaging target. Portable is the default."
        }
      },
      required: ["workflow", "outputParent", "skillName"],
      additionalProperties: false
    }
  }
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function supportsElicitation() {
  return Object.prototype.hasOwnProperty.call(clientCapabilities, "elicitation");
}

function requestClient(method, params) {
  const id = nextServerRequestID++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingServerRequests.delete(id);
      reject(new Error(`${method} timed out.`));
    }, elicitationTimeoutMs);
    pendingServerRequests.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); }
    });
  });
}

async function requestRecordingApproval() {
  if (!supportsElicitation()) return "native";
  const result = await requestClient("elicitation/create", {
    mode: "form",
    message: "Allow FlowOnce to record your actions on your Mac?\n\nFlowOnce will capture mouse clicks, text you type, and the content in windows you interact with until you press Stop (up to 30 minutes). You can cancel any time.",
    requestedSchema: { type: "object", properties: {}, additionalProperties: false }
  });
  if (result?.action === "accept") return "mcp";
  if (result?.action === "decline") throw new Error("FlowOnce approval denied via MCP elicitation.");
  throw new Error("FlowOnce approval cancelled via MCP elicitation.");
}

async function startOnce() {
  const current = await recorder.status();
  if (current.isRecording) return current;
  const approvalMode = await requestRecordingApproval();
  return recorder.start({ requireLocalConsent: approvalMode === "native" });
}

async function start() {
  if (pendingStart) return pendingStart;
  pendingStart = startOnce();
  try { return await pendingStart; } finally { pendingStart = null; }
}

async function runJSONScript(script, args) {
  const { stdout } = await execFileAsync(process.execPath, [join(root, "scripts", script), ...args], { encoding: "utf8" });
  return JSON.parse(stdout);
}

async function generateSkill({ workflow, outputParent, skillName, target = "portable" }) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "record-replay-mcp-generate."));
  const workflowPath = join(temporaryDirectory, "workflow.json");
  try {
    await writeFile(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
    const { stdout } = await execFileAsync(process.execPath, [
      join(root, "scripts", "generate-skill.mjs"),
      workflowPath,
      outputParent,
      skillName,
      "--target",
      target
    ], { encoding: "utf8" });
    const skillPath = stdout.trim();
    const generatedWorkflow = JSON.parse(await readFile(join(skillPath, "references", "workflow.json"), "utf8"));
    const packagePath = `${skillPath}.zip`;
    let hasPackage = false;
    try { await access(packagePath, fsConstants.F_OK); hasPackage = true; } catch {}
    return { skillPath, ...(hasPackage ? { packagePath } : {}), target, workflow: generatedWorkflow };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function callTool(name, args = {}) {
  let value;
  if (name === "event_stream_start") value = await start();
  else if (name === "event_stream_status") value = await recorder.status();
  else if (name === "event_stream_stop") value = await recorder.stop();
  else if (name === "recording_normalize") value = await runJSONScript("normalize-recording.mjs", [args.eventsPath]);
  else if (name === "workflow_compile") value = await runJSONScript("compile-workflow.mjs", [args.eventsPath]);
  else if (name === "workflow_validate") {
    const errors = validateWorkflow(args.workflow, { requireReviewed: args.reviewed === true });
    value = { valid: errors.length === 0, errors };
  } else if (name === "skill_generate") value = await generateSkill(args);
  if (!value) throw new Error(`Unknown tool: ${name}`);
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function recordWorkflowPrompt(goal) {
  const goalLine = goal ? ` The user's stated goal is: ${goal}` : "";
  return `Help the user demonstrate a macOS workflow and turn it into a reusable skill.${goalLine}\n\n` +
    "1. Explain what will be recorded and wait until the user explicitly says they are ready.\n" +
    "2. Call event_stream_start. If permissionRequired=true, relay permissionInstructions, explain that the setup session was discarded, and wait for the user to grant Accessibility access before starting fresh. If FlowOnce already appears enabled, the user must turn it off and back on once. Otherwise let the user perform the workflow and press Stop or return when finished. Do not poll.\n" +
    "3. Call event_stream_stop after the user says the workflow is complete. Treat cancellation as discarded.\n" +
    "4. Use recording_normalize for a compact view and workflow_compile for draft Workflow IR. Review raw evidence when context is missing.\n" +
    "5. Set a concrete goal and verifiable success condition, rename candidate inputs, remove incidental actions, redact sensitive values, and set status to reviewed.\n" +
    "6. Call workflow_validate with reviewed=true. Fix every error.\n" +
    "7. Call skill_generate with target=portable by default. Use target=workbuddy inside WorkBuddy to create an uploadable zip, or target=codex only when OpenAI-specific UI metadata is wanted.\n" +
    "8. Explain how to import the generated SKILL.md folder into the current host and verify one replay with different inputs.";
}

async function handleMessage(request) {
  if (request.method === undefined && request.id !== undefined) {
    const pending = pendingServerRequests.get(request.id);
    if (!pending) return;
    pendingServerRequests.delete(request.id);
    request.error ? pending.reject(new Error(request.error.message ?? "MCP client request failed.")) : pending.resolve(request.result);
    return;
  }
  if (request.method === "notifications/initialized") return;
  try {
    let result;
    if (request.method === "initialize") {
      clientCapabilities = request.params?.capabilities ?? {};
      result = {
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {}, prompts: { listChanged: false } },
        serverInfo: { name: "record-and-replay-local", version: release.version }
      };
    } else if (request.method === "tools/list") {
      result = { tools: Object.entries(toolDefinitions).map(([name, definition]) => ({ name, ...definition })) };
    } else if (request.method === "tools/call") {
      result = await callTool(request.params?.name, request.params?.arguments ?? {});
    } else if (request.method === "prompts/list") {
      result = {
        prompts: [{
          name: "record_workflow",
          description: "Record a demonstrated macOS workflow and create a portable reusable skill.",
          arguments: [{ name: "goal", description: "Optional short description of the workflow to learn.", required: false }]
        }]
      };
    } else if (request.method === "prompts/get") {
      if (request.params?.name !== "record_workflow") throw new Error(`Unknown prompt: ${request.params?.name}`);
      result = {
        description: "Record and package a reusable workflow",
        messages: [{ role: "user", content: { type: "text", text: recordWorkflowPrompt(request.params?.arguments?.goal) } }]
      };
    } else {
      throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
    }
    if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: error.code ?? -32000, message: error.message } });
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  void handleMessage(request);
});
