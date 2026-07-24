#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
const evaluationRoot = await mkdtemp(join(tmpdir(), "record-replay-mcp-evaluations."));
const jobRoot = await mkdtemp(join(tmpdir(), "record-replay-mcp-jobs."));
const child = spawn(process.execPath, [join(root, "scripts", "event-stream-mcp.mjs")], {
  cwd: root,
  env: { ...process.env, FLOWONCE_EVALUATION_ROOT: evaluationRoot, FLOWONCE_JOB_ROOT: jobRoot },
  stdio: ["pipe", "pipe", "inherit"]
});
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextID = 1;
lines.on("line", line => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
});

function request(method, params = {}) {
  const id = nextID++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const initialized = await request("initialize", { protocolVersion: "2025-06-18" });
  assert(initialized.serverInfo.name === "record-and-replay-local", "wrong server name");
  assert(initialized.serverInfo.version === release.version, "MCP server version does not match release.json");
  assert(initialized.capabilities.prompts, "prompt capability missing");
  const listed = await request("tools/list");
  const names = listed.tools.map(tool => tool.name).sort();
  assert(JSON.stringify(names) === JSON.stringify([
    "event_stream_start", "event_stream_status", "event_stream_stop", "recording_normalize",
    "recording_normalize_start",
    "flowonce_doctor",
    "flowonce_job_status",
    "skill_generate", "skill_generate_start", "skill_test_finish", "skill_test_start", "skill_test_status",
    "workflow_compile", "workflow_compile_start", "workflow_validate"
  ].sort()), `unexpected tools: ${names.join(", ")}`);
  for (const tool of listed.tools) {
    assert(tool.inputSchema.additionalProperties === false, `${tool.name} schema is not closed`);
  }
  const prompts = await request("prompts/list");
  assert(prompts.prompts.length === 1 && prompts.prompts[0].name === "record_workflow", "record_workflow prompt missing");
  const prompt = await request("prompts/get", { name: "record_workflow", arguments: { goal: "Prepare a report" } });
  const promptText = prompt.messages[0].content.text;
  assert(promptText.includes("target=portable"), "prompt does not prefer portable generation");
  assert(!promptText.includes("Codex") && !promptText.includes("ChatGPT"), "prompt is vendor-coupled");

  const workflow = JSON.parse(await readFile(join(root, "tests", "fixtures", "reviewed-workflow.json"), "utf8"));
  const validation = await request("tools/call", { name: "workflow_validate", arguments: { workflow, reviewed: true } });
  const validationValue = JSON.parse(validation.content[0].text);
  assert(validationValue.valid && validationValue.errors.length === 0, "reviewed workflow did not validate through MCP");
  const outputParent = await mkdtemp(join(tmpdir(), "record-replay-mcp-contract."));
  const generated = await request("tools/call", {
    name: "skill_generate",
    arguments: { workflow, outputParent, skillName: "mcp-portable-demo", target: "portable" }
  });
  const generatedValue = JSON.parse(generated.content[0].text);
  assert(generatedValue.skillPath === join(outputParent, "mcp-portable-demo"), "MCP generated unexpected skill path");
  assert(generatedValue.target === "portable", "MCP changed portable target");
  assert(generatedValue.test?.tool === "skill_test_start", "MCP did not recommend the post-generation test");

  const asyncStartedAt = Date.now();
  const asynchronous = await request("tools/call", {
    name: "skill_generate_start",
    arguments: {
      workflow,
      outputParent,
      skillName: "mcp-async-demo",
      target: "portable",
      idempotencyKey: "mcp-contract-generation"
    }
  });
  const asynchronousValue = JSON.parse(asynchronous.content[0].text);
  assert(Date.now() - asyncStartedAt < 2_000, "asynchronous generation did not return promptly");
  const duplicate = await request("tools/call", {
    name: "skill_generate_start",
    arguments: {
      workflow,
      outputParent,
      skillName: "mcp-async-demo",
      target: "portable",
      idempotencyKey: "mcp-contract-generation"
    }
  });
  const duplicateValue = JSON.parse(duplicate.content[0].text);
  assert(duplicateValue.jobID === asynchronousValue.jobID && duplicateValue.reused, "async generation was not idempotent");
  let asynchronousStatus;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await request("tools/call", {
      name: "flowonce_job_status",
      arguments: { jobID: asynchronousValue.jobID }
    });
    asynchronousStatus = JSON.parse(response.content[0].text);
    if (["completed", "failed"].includes(asynchronousStatus.status)) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert(asynchronousStatus.status === "completed", `async generation failed: ${asynchronousStatus.error?.message ?? "timeout"}`);
  assert(asynchronousStatus.result.skillPath === join(outputParent, "mcp-async-demo"), "async generation returned wrong result");

  const testStarted = await request("tools/call", {
    name: "skill_test_start",
    arguments: {
      skillPath: generatedValue.skillPath,
      inputs: { text: "different test value" },
      backend: "semantic-test-backend",
      contextIsolation: "fresh"
    }
  });
  const testStartedValue = JSON.parse(testStarted.content[0].text);
  assert(testStartedValue.ready && testStartedValue.evaluationScope === "full", "MCP did not prepare a full skill test");
  const testFinished = await request("tools/call", {
    name: "skill_test_finish",
    arguments: {
      runID: testStartedValue.runID,
      outcome: "passed",
      backend: "semantic-test-backend",
      successObserved: true,
      finalObservation: "The expected document state was observed.",
      stepResults: testStartedValue.execution.steps.map(step => ({
        stepID: step.stepID,
        status: "passed",
        observation: "Expected state observed."
      }))
    }
  });
  const testFinishedValue = JSON.parse(testFinished.content[0].text);
  assert(testFinishedValue.verdict === "passed", "MCP did not complete the skill test");
  process.stdout.write("MCP portable contract OK\n");
} finally {
  child.stdin.end();
}
