#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
const child = spawn(process.execPath, [join(root, "scripts", "event-stream-mcp.mjs")], {
  cwd: root,
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
    "skill_generate", "workflow_compile", "workflow_validate"
  ]), `unexpected tools: ${names.join(", ")}`);
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
  process.stdout.write("MCP portable contract OK\n");
} finally {
  child.stdin.end();
}
