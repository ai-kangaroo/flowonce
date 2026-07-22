#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const eventsPath = process.argv[2];
if (!eventsPath) {
  process.stderr.write("Usage: compile-workflow.mjs <events.jsonl>\n");
  process.exit(2);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const normalized = JSON.parse(execFileSync(process.execPath, [join(root, "scripts", "normalize-recording.mjs"), eventsPath], { encoding: "utf8" }));
const inputs = [];
let inputIndex = 0;

const steps = normalized.actions.map((action, index) => {
  const step = {
    id: `step_${index + 1}`,
    action: action.type,
    application: action.application ? {
      name: action.application.name,
      bundleIdentifier: action.application.bundleIdentifier
    } : undefined,
    window: action.window,
    target: action.target,
    fallback: action.fallback
  };
  if (action.type === "input_text") {
    inputIndex += 1;
    const name = action.redacted ? `sensitive_input_${inputIndex}` : `text_input_${inputIndex}`;
    inputs.push({
      name,
      type: "string",
      required: true,
      sensitive: Boolean(action.redacted),
      demonstratedValue: action.redacted ? undefined : action.value,
      inference: "candidate"
    });
    step.value = `{{${name}}}`;
  }
  if (action.type === "shortcut") {
    step.key = action.key;
    step.keyCode = action.keyCode;
    step.modifiers = action.modifiers;
  }
  if (action.type === "scroll") {
    step.deltaX = action.deltaX;
    step.deltaY = action.deltaY;
  }
  if (action.type === "drag") {
    step.from = action.from;
    step.to = action.to;
    step.button = action.button;
  }
  if (action.type === "click" || action.type === "submit") {
    step.verify = { required: true, observation: "Confirm the expected UI state change after this action." };
  }
  return step;
});

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  status: "draft",
  source: normalized.source,
  goal: null,
  applications: normalized.applications,
  inputs,
  preconditions: ["Required applications are installed and accessible."],
  steps,
  success: { description: null, requiresVerification: true },
  safety: {
    confirmBefore: ["external_message", "delete", "financial_action", "system_setting_change"],
    neverPersistSensitiveValues: true
  },
  compilerNotes: [
    "Infer and replace the null goal and success description before generating a skill.",
    "Rename candidate inputs based on their semantic purpose.",
    "Remove incidental demonstration actions and coordinate-only fallbacks where stable targets exist."
  ]
}, null, 2)}\n`);
