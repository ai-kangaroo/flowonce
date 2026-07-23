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

function timeDeltaMs(prevTimestamp, currentTimestamp) {
  if (!prevTimestamp || !currentTimestamp) return null;
  const prev = Date.parse(prevTimestamp);
  const current = Date.parse(currentTimestamp);
  if (Number.isNaN(prev) || Number.isNaN(current)) return null;
  const delta = current - prev;
  if (delta < 0 || delta > 300000) return null;
  return delta;
}

function targetLabel(target = {}) {
  const parts = [];
  if (target.title) parts.push(`"${target.title}"`);
  if (target.role) parts.push(`[${target.role}]`);
  if (target.identifier) parts.push(`#${target.identifier}`);
  return parts.join(" ") || "UI element";
}

function verifyFor(action) {
  const label = targetLabel(action.target);
  switch (action.type) {
    case "click":
      return {
        required: true,
        observation: `Confirm that clicking ${label} produced the expected result (dialog appeared, view changed, or button state toggled).`
      };
    case "submit":
      return {
        required: true,
        observation: `Confirm that submitting via ${label} completed (next screen loaded, dialog dismissed, or form processed).`
      };
    case "input_text": {
      const value = action.redacted ? "[redacted]" : (action.value ? `"${action.value}"` : "the entered text");
      return {
        required: true,
        observation: `Verify that ${label} contains ${value}. Re-focus and retype if the value was not set.`
      };
    }
    case "shortcut": {
      const purpose = action.key?.startsWith("super+") ? `the command "${action.key}" was invoked` : `the shortcut "${action.key}" was triggered`;
      return {
        required: true,
        observation: `Verify that ${purpose} (e.g., copied text, opened dialog, or toggled state).`
      };
    }
    case "scroll":
      return {
        required: true,
        observation: `Confirm the content scrolled as expected (list moved, page scrolled, or visible region changed).`
      };
    case "drag":
      return {
        required: true,
        observation: `Confirm that dragging ${label} completed (element moved, resize handle adjusted, or file dropped).`
      };
    default:
      return {
        required: true,
        observation: `Confirm the expected UI state change after this action.`
      };
  }
}

function descriptionFor(action, index) {
  const label = targetLabel(action.target);
  const app = action.application?.name || "the app";
  switch (action.type) {
    case "click":
      return `Click on ${label} in ${app}`;
    case "submit":
      return `Submit the form or confirm via ${label} in ${app}`;
    case "input_text": {
      const value = action.redacted ? "sensitive value" : (action.value ? `"${action.value}"` : "text");
      return `Enter ${value} into ${label} in ${app}`;
    }
    case "shortcut":
      return `Press "${action.key}" in ${app}`;
    case "scroll":
      return `Scroll (dx=${action.deltaX ?? 0}, dy=${action.deltaY ?? 0}) on ${label} in ${app}`;
    case "drag":
      return `Drag from (${action.from?.x}, ${action.from?.y}) to (${action.to?.x}, ${action.to?.y}) on ${label} in ${app}`;
    default:
      return `Step ${index + 1} in ${app}`;
  }
}

const steps = normalized.actions.map((action, index) => {
  const prevAction = index > 0 ? normalized.actions[index - 1] : null;
  const timingMs = timeDeltaMs(prevAction?.timestamp, action.timestamp);

  const step = {
    id: `step_${index + 1}`,
    action: action.type,
    description: descriptionFor(action, index),
    application: action.application ? {
      name: action.application.name,
      bundleIdentifier: action.application.bundleIdentifier
    } : undefined,
    window: action.window,
    target: action.target,
    fallback: action.fallback,
    verify: verifyFor(action)
  };

  if (timingMs !== null && timingMs >= 0) {
    step.timingHintMs = timingMs;
  }

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
    "Remove incidental demonstration actions and coordinate-only fallbacks where stable targets exist.",
    "Timing hints are derived from the original recording; the replay agent may adjust wait times if the UI responds faster or slower."
  ]
}, null, 2)}\n`);
