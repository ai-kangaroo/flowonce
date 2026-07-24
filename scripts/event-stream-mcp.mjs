#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { createDoctorService } from "./doctor-service.mjs";
import { createRecorderService } from "./recorder-service.mjs";
import { createSkillTestService } from "./skill-test-service.mjs";
import { validateWorkflow } from "./workflow-validation.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.version ?? "")) {
  throw new Error("release.json must contain a valid semantic version.");
}
const recorder = createRecorderService({ root });
const skillTests = createSkillTestService();
const doctor = createDoctorService({ root });
const execFileAsync = promisify(execFile);
const elicitationTimeoutMs = 5 * 60 * 1000;
let clientCapabilities = {};
let nextServerRequestID = 100000;
const pendingServerRequests = new Map();
let pendingStart = null;
const jobs = new Map();
const jobsByKey = new Map();
const jobRoot = process.env.FLOWONCE_JOB_ROOT
  ?? (process.env.HOME
    ? join(process.env.HOME, "Library", "Application Support", "FlowOnce", "jobs")
    : join(tmpdir(), "flowonce-jobs"));

const emptyInputSchema = { type: "object", properties: {}, additionalProperties: false };
const toolDefinitions = {
  flowonce_doctor: {
    description: "Run the one-step FlowOnce local readiness check. Use when the user says initialize FlowOnce, asks whether installation is ready, or before the first recording. Checks installed versions, Accessibility permission, the MCP connection, and the host skill.",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          enum: ["auto", "codex", "codebuddy", "workbuddy", "qoder", "qoderwork", "portable"],
          description: "Current AI host. Use auto only when the host is unknown."
        }
      },
      additionalProperties: false
    }
  },
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
  recording_normalize_start: {
    description: "Start normalization as a background job and return immediately. Use this for real recordings or whenever the host may time out on a long MCP tool call. Poll flowonce_job_status with the returned jobID.",
    inputSchema: {
      type: "object",
      properties: {
        eventsPath: { type: "string", description: "Absolute path returned by event_stream_stop." },
        idempotencyKey: { type: "string", description: "Optional stable key. Repeated identical requests reuse the same job." }
      },
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
  workflow_compile_start: {
    description: "Start Workflow IR compilation as a background job and return immediately. Poll flowonce_job_status with the returned jobID.",
    inputSchema: {
      type: "object",
      properties: {
        eventsPath: { type: "string", description: "Absolute path returned by event_stream_stop." },
        idempotencyKey: { type: "string", description: "Optional stable key. Repeated identical requests reuse the same job." }
      },
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
  },
  skill_generate_start: {
    description: "Start skill generation as a background job and return immediately. Poll flowonce_job_status with the returned jobID. Repeated identical requests are idempotent within the MCP server session.",
    inputSchema: {
      type: "object",
      properties: {
        workflow: { type: "object", description: "Reviewed Workflow IR object." },
        outputParent: { type: "string", description: "Absolute directory in which to create the skill folder." },
        skillName: { type: "string", description: "Lowercase skill name; other characters are normalized to hyphens." },
        target: {
          type: "string",
          enum: ["portable", "codex", "codebuddy", "qoder", "qoderwork", "workbuddy"]
        },
        idempotencyKey: { type: "string", description: "Optional stable key. Repeated identical requests reuse the same job." }
      },
      required: ["workflow", "outputParent", "skillName"],
      additionalProperties: false
    }
  },
  flowonce_job_status: {
    description: "Return progress for a background normalize, compile, or generate job. Completed normalize/compile jobs return a local resultPath; completed generation jobs return the generated skill result.",
    inputSchema: {
      type: "object",
      properties: {
        jobID: { type: "string", description: "Job identifier returned by an asynchronous start tool." }
      },
      required: ["jobID"],
      additionalProperties: false
    }
  },
  skill_test_start: {
    description: "Prepare a safe post-generation test plan for a generated skill. FlowOnce does not drive the UI; the current agent host executes the skill with an available backend. Safe mode stops before likely external or irreversible actions.",
    inputSchema: {
      type: "object",
      properties: {
        skillPath: { type: "string", description: "Absolute generated skill directory returned by skill_generate." },
        inputs: {
          type: "object",
          description: "Test input values keyed by Workflow IR input name. Values are used for execution but are not persisted in the test plan.",
          additionalProperties: { type: "string" }
        },
        mode: {
          type: "string",
          enum: ["safe", "live"],
          description: "Safe stops before likely side effects; live executes the complete workflow after explicit confirmation."
        },
        backend: {
          type: "string",
          description: "Preflighted execution backend name, or auto when the host will choose one."
        },
        contextIsolation: {
          type: "string",
          enum: ["fresh", "current", "unknown"],
          description: "Whether the test will run in a fresh task/agent context."
        },
        liveConfirmed: {
          type: "boolean",
          description: "Set true only after the user explicitly confirms a live test containing external or irreversible actions."
        },
        previousRunID: {
          type: "string",
          description: "Optional prior failed or blocked run linked to this retry."
        }
      },
      required: ["skillPath"],
      additionalProperties: false
    }
  },
  skill_test_finish: {
    description: "Finish a prepared skill test, validate per-step evidence, save a local evaluation report, and return the next refinement action. For a safe checkpoint, pass outcome=passed, successObserved=false, and results only for the steps returned by skill_test_start; FlowOnce maps this to checkpoint_passed. Record a missing backend as outcome=blocked with failureCategory=backend_unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        runID: { type: "string", description: "Run identifier returned by skill_test_start." },
        outcome: { type: "string", enum: ["passed", "failed", "blocked", "cancelled"] },
        stepResults: {
          type: "array",
          items: {
            type: "object",
            properties: {
              stepID: { type: "string" },
              status: { type: "string", enum: ["passed", "failed", "blocked", "skipped"] },
              observation: { type: "string", description: "Short sanitized observation; never include raw test inputs or secrets." }
            },
            required: ["stepID", "status"],
            additionalProperties: false
          }
        },
        successObserved: { type: "boolean" },
        finalObservation: { type: "string" },
        failureCategory: {
          type: "string",
          enum: [
            "target_not_found", "backend_unavailable", "verification_failed", "input_binding",
            "app_state", "permission_denied", "user_cancelled", "unknown"
          ]
        },
        backend: { type: "string", description: "Actual connector, browser, API, CLI, or desktop UI backend used." },
        notes: { type: "string" }
      },
      required: ["runID", "outcome"],
      additionalProperties: false
    }
  },
  skill_test_status: {
    description: "Get the current or specified local skill-test plan and result without exposing test input values.",
    inputSchema: {
      type: "object",
      properties: {
        runID: { type: "string", description: "Optional run identifier. Omit for the latest run." }
      },
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
  const { stdout } = await execFileAsync(process.execPath, [join(root, "scripts", script), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
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
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const skillPath = stdout.trim();
    const generatedWorkflow = JSON.parse(await readFile(join(skillPath, "references", "workflow.json"), "utf8"));
    const packagePath = `${skillPath}.zip`;
    let hasPackage = false;
    try { await access(packagePath, fsConstants.F_OK); hasPackage = true; } catch {}
    return {
      skillPath,
      ...(hasPackage ? { packagePath } : {}),
      target,
      workflow: generatedWorkflow,
      test: {
        recommended: true,
        tool: "skill_test_start",
        defaultMode: "safe",
        instruction: "Run once with different inputs before reporting the skill as fully verified."
      }
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function publicJob(job) {
  const activity = {
    normalize: "organizing the recorded actions",
    compile: "building the reusable workflow",
    generate: "generating the skill"
  }[job.operation] ?? "processing the task";
  return {
    jobID: job.jobID,
    operation: job.operation,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.status === "queued" ? 0 : job.status === "running" ? 50 : 100,
    message: job.status === "queued"
      ? "Task queued."
      : job.status === "running"
        ? `FlowOnce is ${activity}…`
        : job.status === "completed"
          ? "Task completed."
          : "Task failed.",
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {})
  };
}

async function saveJob(job) {
  const directory = join(jobRoot, job.jobID);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "status.json"), `${JSON.stringify(publicJob(job), null, 2)}\n`, { mode: 0o600 });
}

async function executeJob(job, args) {
  job.status = "running";
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
  try {
    if (job.operation === "normalize" || job.operation === "compile") {
      const script = job.operation === "normalize" ? "normalize-recording.mjs" : "compile-workflow.mjs";
      const result = await runJSONScript(script, [args.eventsPath]);
      const resultPath = join(jobRoot, job.jobID, "result.json");
      await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      job.result = { resultPath };
    } else if (job.operation === "generate") {
      job.result = await generateSkill(args);
    } else {
      throw new Error(`Unsupported job operation: ${job.operation}`);
    }
    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = {
      code: error.code ?? "operation_failed",
      message: error.message || "FlowOnce background task failed."
    };
  }
  job.updatedAt = new Date().toISOString();
  await saveJob(job);
}

async function startJob(operation, input) {
  const { idempotencyKey, ...args } = input;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ operation, args }))
    .digest("hex");
  const key = idempotencyKey ? `${operation}:explicit:${idempotencyKey}` : `${operation}:auto:${fingerprint}`;
  const existingID = jobsByKey.get(key);
  if (existingID && jobs.has(existingID)) {
    const existing = jobs.get(existingID);
    if (existing.fingerprint !== fingerprint) {
      throw new Error("idempotencyKey was already used with different arguments.");
    }
    return { ...publicJob(existing), reused: true };
  }
  const now = new Date().toISOString();
  const job = {
    jobID: randomUUID().toUpperCase(),
    operation,
    status: "queued",
    fingerprint,
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.jobID, job);
  jobsByKey.set(key, job.jobID);
  await saveJob(job);
  setImmediate(() => { void executeJob(job, args); });
  return { ...publicJob(job), reused: false };
}

async function jobStatus(jobID) {
  if (typeof jobID !== "string" || !/^[A-F0-9-]+$/.test(jobID)) throw new Error("jobID is invalid.");
  const job = jobs.get(jobID);
  if (job) return publicJob(job);
  try {
    return JSON.parse(await readFile(join(jobRoot, jobID, "status.json"), "utf8"));
  } catch {
    throw new Error(`Unknown FlowOnce job: ${jobID}`);
  }
}

async function callTool(name, args = {}) {
  let value;
  if (name === "flowonce_doctor") value = await doctor.inspect({ host: args.host ?? "auto", mcpAvailable: true });
  else if (name === "event_stream_start") value = await start();
  else if (name === "event_stream_status") value = await recorder.status();
  else if (name === "event_stream_stop") value = await recorder.stop();
  else if (name === "recording_normalize") value = await runJSONScript("normalize-recording.mjs", [args.eventsPath]);
  else if (name === "recording_normalize_start") value = await startJob("normalize", args);
  else if (name === "workflow_compile") value = await runJSONScript("compile-workflow.mjs", [args.eventsPath]);
  else if (name === "workflow_compile_start") value = await startJob("compile", args);
  else if (name === "workflow_validate") {
    const errors = validateWorkflow(args.workflow, { requireReviewed: args.reviewed === true });
    value = { valid: errors.length === 0, errors };
  } else if (name === "skill_generate") value = await generateSkill(args);
  else if (name === "skill_generate_start") value = await startJob("generate", args);
  else if (name === "flowonce_job_status") value = await jobStatus(args.jobID);
  else if (name === "skill_test_start") value = await skillTests.start(args);
  else if (name === "skill_test_finish") value = await skillTests.finish(args);
  else if (name === "skill_test_status") value = await skillTests.status(args);
  if (!value) throw new Error(`Unknown tool: ${name}`);
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function recordWorkflowPrompt(goal) {
  const goalLine = goal ? ` The user's stated goal is: ${goal}` : "";
  return `Help the user demonstrate a macOS workflow and turn it into a reusable skill.${goalLine}\n\n` +
    "1. Call flowonce_doctor with the current host. If ready=false, present its single nextAction and stop until the user completes it.\n" +
    "2. Explain what will be recorded and wait until the user explicitly says they are ready.\n" +
    "3. Call event_stream_start. If permissionRequired=true, relay permissionInstructions, explain that the setup session was discarded, and wait for the user to grant Accessibility access before starting fresh. If FlowOnce already appears enabled, the user must turn it off and back on once. Otherwise let the user perform the workflow and press Stop or return when finished. Do not poll.\n" +
    "4. Call event_stream_stop after the user says the workflow is complete. Treat cancellation as discarded.\n" +
    "5. Use recording_normalize_start and workflow_compile_start for real recordings, polling flowonce_job_status until each completes; this avoids host timeouts. Read each returned local resultPath. Use the synchronous variants only for known-small fixtures. Review raw evidence when context is missing.\n" +
    "6. Set a concrete goal and verifiable success condition, rename candidate inputs, remove incidental actions, redact sensitive values, and set status to reviewed.\n" +
    "7. Call workflow_validate with reviewed=true. Fix every error.\n" +
    "8. Call skill_generate_start with a stable idempotencyKey and target=portable by default, then poll flowonce_job_status. Use target=workbuddy inside WorkBuddy to create an uploadable zip, or target=codex only when OpenAI-specific UI metadata is wanted.\n" +
    "9. After generation, call skill_test_start with different test inputs. Use mode=safe by default; use live only after explicit confirmation for external or irreversible actions.\n" +
    "10. Execute the generated skill with an actually available backend, preferably in a fresh task or isolated agent. Record sanitized evidence for every evaluated step.\n" +
    "11. Call skill_test_finish. If a safe-mode test fails during the current creation task, refine the reviewed Workflow IR, regenerate, and retry at most twice. Never auto-retry a live test because its side effect may already have occurred. Treat checkpoint_passed as safe partial verification, not a full live pass.\n" +
    "12. Report the evaluation verdict and explain how to import the generated SKILL.md folder into the current host.";
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
