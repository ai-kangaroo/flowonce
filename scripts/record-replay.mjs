#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRecorderService } from "./recorder-service.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [command, ...args] = process.argv.slice(2);

function usage() {
  process.stderr.write(`Usage:
  record-replay.mjs start
  record-replay.mjs status
  record-replay.mjs stop
  record-replay.mjs normalize <events.jsonl>
  record-replay.mjs compile <events.jsonl>
  record-replay.mjs validate <workflow.json> [--reviewed]
  record-replay.mjs generate <workflow.json> <output-parent> <skill-name> [--target portable|codex|codebuddy|qoder|qoderwork|workbuddy]
  record-replay.mjs host-config [portable|codex|codebuddy|qoder|qoderwork|workbuddy]
`);
}

if (!command || command === "help" || command === "--help") {
  usage();
  process.exit(command ? 0 : 2);
}

const service = createRecorderService({ root });
let result;
if (command === "start") result = await service.start({ requireLocalConsent: true });
else if (command === "status") result = await service.status();
else if (command === "stop") result = await service.stop();
else if (command === "normalize" || command === "compile") {
  if (args.length !== 1) { usage(); process.exit(2); }
  const script = command === "normalize" ? "normalize-recording.mjs" : "compile-workflow.mjs";
  process.stdout.write(execFileSync(process.execPath, [join(root, "scripts", script), args[0]], { encoding: "utf8" }));
  process.exit(0);
} else if (command === "generate") {
  if (args.length !== 3 && args.length !== 5) { usage(); process.exit(2); }
  process.stdout.write(execFileSync(process.execPath, [join(root, "scripts", "generate-skill.mjs"), ...args], { encoding: "utf8" }));
  process.exit(0);
} else if (command === "host-config") {
  if (args.length > 1) { usage(); process.exit(2); }
  process.stdout.write(execFileSync(process.execPath, [join(root, "scripts", "host-config.mjs"), ...args], { encoding: "utf8" }));
  process.exit(0);
} else if (command === "validate") {
  if (args.length < 1 || args.length > 2) { usage(); process.exit(2); }
  process.stdout.write(execFileSync(process.execPath, [join(root, "scripts", "validate-workflow.mjs"), ...args], { encoding: "utf8" }));
  process.exit(0);
} else {
  usage();
  process.exit(2);
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
