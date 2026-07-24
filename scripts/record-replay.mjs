#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDoctorService, formatDoctorReport } from "./doctor-service.mjs";
import { createRecorderService } from "./recorder-service.mjs";
import { createSkillTestService } from "./skill-test-service.mjs";

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
  record-replay.mjs test-start <skill-directory> <inputs.json> [--mode safe|live] [--backend <name>] [--context fresh|current|unknown] [--live-confirmed] [--previous-run <id>]
  record-replay.mjs test-finish <run-id> <result.json>
  record-replay.mjs test-status [run-id]
  record-replay.mjs doctor [auto|codex|codebuddy|workbuddy|qoder|qoderwork|portable] [--json]
  record-replay.mjs host-config [portable|codex|codebuddy|qoder|qoderwork|workbuddy]
`);
}

if (!command || command === "help" || command === "--help") {
  usage();
  process.exit(command ? 0 : 2);
}

const service = createRecorderService({ root });
const skillTests = createSkillTestService();
const doctor = createDoctorService({ root });
let result;
if (command === "doctor") {
  const json = args.includes("--json");
  const positional = args.filter(value => value !== "--json");
  if (positional.length > 1 || args.some(value => value.startsWith("--") && value !== "--json")) {
    usage();
    process.exit(2);
  }
  result = await doctor.inspect({ host: positional[0] ?? "auto" });
  if (!json) {
    process.stdout.write(formatDoctorReport(result));
    process.exit(result.ready ? 0 : 1);
  }
} else if (command === "start") result = await service.start({ requireLocalConsent: true });
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
} else if (command === "test-start") {
  if (args.length < 2) { usage(); process.exit(2); }
  const [skillPath, inputsPath, ...options] = args;
  const startOptions = {
    skillPath,
    inputs: JSON.parse(await readFile(inputsPath, "utf8"))
  };
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === "--live-confirmed") startOptions.liveConfirmed = true;
    else if (["--mode", "--backend", "--context", "--previous-run"].includes(option)) {
      const value = options[index + 1];
      if (!value) { usage(); process.exit(2); }
      if (option === "--mode") startOptions.mode = value;
      else if (option === "--backend") startOptions.backend = value;
      else if (option === "--context") startOptions.contextIsolation = value;
      else startOptions.previousRunID = value;
      index += 1;
    } else {
      usage();
      process.exit(2);
    }
  }
  result = await skillTests.start(startOptions);
} else if (command === "test-finish") {
  if (args.length !== 2) { usage(); process.exit(2); }
  const [runID, resultPath] = args;
  const testResult = JSON.parse(await readFile(resultPath, "utf8"));
  result = await skillTests.finish({ ...testResult, runID });
} else if (command === "test-status") {
  if (args.length > 1) { usage(); process.exit(2); }
  result = await skillTests.status(args[0] ? { runID: args[0] } : {});
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
