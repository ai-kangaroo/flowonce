#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkflow } from "../scripts/workflow-validation.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = await mkdtemp(join(tmpdir(), "record-replay-semantic."));
const path = join(dir, "events.jsonl");
const app = { name: "Example", bundleIdentifier: "com.example.app" };
const target = { role: "AXTextField", identifier: "query", frame: { x: 1, y: 2, width: 3, height: 4 } };
const secureTarget = { role: "AXSecureTextField", identifier: "password", frame: { x: 5, y: 6, width: 7, height: 8 } };
const axTarget = { role: "AXTextArea", identifier: "ax-direct", frame: { x: 9, y: 10, width: 11, height: 12 } };
const events = [
  { kind: "session.started", timestamp: "2026-01-01T00:00:00.000Z" },
  { kind: "window.changed", timestamp: "2026-01-01T00:00:00.500Z", app, window: { title: "Example Window" }, ax: { mode: "fullTree", text: "AXWindow Example" } },
  { kind: "keyboard.text_input", timestamp: "2026-01-01T00:00:01.000Z", app, target, keyboard: { text: "你" } },
  { kind: "keyboard.text_input", timestamp: "2026-01-01T00:00:02.000Z", app, target, keyboard: { text: "好" } },
  { kind: "keyboard.submit", timestamp: "2026-01-01T00:00:03.000Z", app, target },
  { kind: "keyboard.shortcut", timestamp: "2026-01-01T00:00:04.000Z", app, target, keyboard: { keyCode: 8, modifiers: 1048576, charactersIgnoringModifiers: "c" } },
  { kind: "mouse.scroll", timestamp: "2026-01-01T00:00:05.000Z", app, target, mouse: { x: 10, y: 20, deltaX: 0, deltaY: -12 } },
  { kind: "mouse.scroll", timestamp: "2026-01-01T00:00:05.200Z", app, target, mouse: { x: 10, y: 20, deltaX: 0, deltaY: -8 } },
  { kind: "mouse.drag", timestamp: "2026-01-01T00:00:05.500Z", app, target, mouse: { button: 0, fromX: 10, fromY: 20, toX: 30, toY: 40 } },
  { kind: "keyboard.text_input", timestamp: "2026-01-01T00:00:06.000Z", app, target: secureTarget, keyboard: { text: "<redacted>", redacted: true } },
  { kind: "keyboard.submit", timestamp: "2026-01-01T00:00:07.000Z", app, target: secureTarget },
  { kind: "keyboard.shortcut", timestamp: "2026-01-01T00:00:07.200Z", app, target, keyboard: { keyCode: 9, modifiers: 1048576, charactersIgnoringModifiers: "v" } },
  { kind: "selection.changed", timestamp: "2026-01-01T00:00:07.300Z", app, target: { ...target, value: "pasted text" } },
  { kind: "selection.changed", timestamp: "2026-01-01T00:00:07.400Z", app, target: { ...axTarget, value: "" } },
  { kind: "selection.changed", timestamp: "2026-01-01T00:00:07.500Z", app, target: { ...axTarget, value: "AX direct value" } },
  { kind: "session.ended", timestamp: "2026-01-01T00:00:08.000Z", endReason: "recording_controls_stopped" }
];
await writeFile(path, `${events.map(event => JSON.stringify(event)).join("\n")}\n`);

const normalized = JSON.parse(execFileSync(process.execPath, [join(root, "scripts", "normalize-recording.mjs"), path], { encoding: "utf8" }));
if (normalized.actions[0]?.type !== "input_text" || normalized.actions[0]?.value !== "你好") {
  throw new Error("typed-text fallback was not preserved");
}
if (normalized.actions[0]?.window?.title !== "Example Window") throw new Error("window context was not preserved");
if (normalized.actions[1]?.type !== "submit") throw new Error("submit action was not preserved");
if (normalized.actions[2]?.type !== "shortcut" || normalized.actions[2]?.key !== "super+c") throw new Error("shortcut action was not normalized");
if (normalized.actions[3]?.type !== "scroll" || normalized.actions[3]?.deltaY !== -20) throw new Error("scroll actions were not coalesced");
if (normalized.actions[4]?.type !== "drag" || normalized.actions[4]?.to?.x !== 30) throw new Error("drag action was not preserved");
if (normalized.actions[5]?.value !== "{{sensitive_input}}" || !normalized.actions[5]?.redacted) throw new Error("sensitive input was not redacted");
if (normalized.actions[7]?.type !== "input_text" || normalized.actions[7]?.value !== "pasted text" || normalized.actions[7]?.derivedFrom !== "super+v") {
  throw new Error("paste was not reduced to the observed final value");
}
if (normalized.actions[8]?.value !== "AX direct value" || normalized.actions[8]?.derivedFrom !== "accessibility_value") {
  throw new Error("direct Accessibility value change was not normalized");
}

const workflow = JSON.parse(execFileSync(process.execPath, [join(root, "scripts", "compile-workflow.mjs"), path], { encoding: "utf8" }));
if (workflow.inputs[0]?.demonstratedValue !== "你好") throw new Error("compiled input lost the demonstrated value");
if (workflow.steps[0]?.value !== "{{text_input_1}}") throw new Error("compiled input placeholder is invalid");
if (workflow.steps[0]?.window?.title !== "Example Window") throw new Error("compiled workflow lost window context");
if (workflow.steps[2]?.key !== "super+c" || workflow.steps[3]?.deltaY !== -20) throw new Error("compiled workflow lost action details");
if (workflow.steps[4]?.action !== "drag" || workflow.steps[4]?.from?.y !== 20) throw new Error("compiled workflow lost drag details");
if (!workflow.inputs[1]?.sensitive || workflow.inputs[1]?.demonstratedValue !== undefined) throw new Error("compiled workflow leaked sensitive input");
if (workflow.inputs[2]?.demonstratedValue !== "pasted text") throw new Error("compiled workflow lost pasted input");
if (workflow.inputs[3]?.demonstratedValue !== "AX direct value") throw new Error("compiled workflow lost direct Accessibility input");
const unsafeReviewed = {
  ...workflow,
  status: "reviewed",
  goal: "Test workflow",
  success: { description: "Expected state is visible.", requiresVerification: true },
  safety: { ...workflow.safety, neverPersistSensitiveValues: true },
  inputs: workflow.inputs.map((input, index) => index === 1 ? { ...input, demonstratedValue: "secret" } : input)
};
if (!validateWorkflow(unsafeReviewed, { requireReviewed: true }).some(error => error.includes("must not persist"))) {
  throw new Error("workflow validation accepted a persisted sensitive value");
}
const untrustedPath = join(dir, "untrusted-events.jsonl");
await writeFile(untrustedPath, `${JSON.stringify({ kind: "permissions.checked", accessibilityTrusted: false })}\n${JSON.stringify({ kind: "mouse.click", mouse: { x: 1, y: 2 } })}\n`);
const untrusted = spawnSync(process.execPath, [join(root, "scripts", "normalize-recording.mjs"), untrustedPath], { encoding: "utf8" });
if (untrusted.status === 0 || !untrusted.stderr.includes("did not have macOS Accessibility permission")) {
  throw new Error("semantic pipeline accepted an untrusted recording");
}
process.stdout.write("Semantic pipeline OK\n");
