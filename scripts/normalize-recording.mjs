#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const eventsPath = process.argv[2];
if (!eventsPath) {
  process.stderr.write("Usage: normalize-recording.mjs <events.jsonl>\n");
  process.exit(2);
}

const lines = (await readFile(eventsPath, "utf8")).split("\n").filter(Boolean);
const events = lines.map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error(`Invalid JSON on line ${index + 1}`); }
});
const permissionCheck = events.findLast(event => event.kind === "permissions.checked");
if (permissionCheck?.accessibilityTrusted === false) {
  throw new Error("Recording is unusable because FlowOnce did not have macOS Accessibility permission. Grant permission and record the workflow again.");
}

const recorderBundle = "local.record-and-replay";
const actions = [];
const activeInputs = new Map();
const pendingEdits = new Map();
const currentWindows = new Map();
const lastSelectionValues = new Map();

function targetKey(event) {
  const app = event.app?.bundleIdentifier ?? "unknown";
  const target = event.target ?? {};
  const frame = target.frame ?? {};
  if (target.identifier) return [app, "identifier", target.identifier].join("|");
  if (target.title) return [app, "semantic", target.role, target.title].join("|");
  return [app, "frame", target.role, frame.x, frame.y, frame.width, frame.height].join("|");
}

function stableTarget(target = {}) {
  const result = {};
  for (const key of ["identifier", "role", "subrole", "title", "frame"]) {
    const value = target[key];
    if (value !== undefined && value !== "") result[key] = value;
  }
  return result;
}

function semanticKey(keyboard = {}) {
  const special = new Map([
    [36, "Return"], [48, "Tab"], [51, "BackSpace"], [53, "Escape"],
    [117, "Delete"], [123, "Left"], [124, "Right"], [125, "Down"], [126, "Up"]
  ]);
  let key = special.get(keyboard.keyCode);
  const characters = keyboard.charactersIgnoringModifiers;
  if (!key && typeof characters === "string" && characters.length === 1 && /[ -~]/.test(characters)) key = characters.toLowerCase();
  if (!key) key = `keycode_${keyboard.keyCode}`;
  const modifiers = keyboard.modifiers ?? 0;
  const parts = [];
  if (modifiers & (1 << 18)) parts.push("ctrl");
  if (modifiers & (1 << 19)) parts.push("alt");
  if (modifiers & (1 << 20)) parts.push("super");
  if (modifiers & (1 << 17)) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

function mayChangeTextValue(key) {
  return key === "BackSpace" || key === "Delete" || ["v", "x", "z"].some(suffix => key.startsWith("super+") && key.endsWith(`+${suffix}`));
}

function flushInput(key) {
  const input = activeInputs.get(key);
  if (!input) return;
  activeInputs.delete(key);
  const observedValue = input.value || input.typed;
  if (!observedValue && !input.redacted) return;
  actions.push({
    type: "input_text",
    timestamp: input.timestamp,
    application: input.application,
    window: input.window,
    target: input.target,
    value: input.redacted ? "{{sensitive_input}}" : observedValue,
    redacted: input.redacted
  });
}

for (const event of events) {
  if (event.app?.bundleIdentifier === recorderBundle) continue;
  const key = targetKey(event);
  const appKey = event.app?.bundleIdentifier;
  if (event.kind === "window.changed") {
    if (appKey) currentWindows.set(appKey, { title: event.window?.title ?? "" });
    continue;
  }
  const window = appKey ? currentWindows.get(appKey) : undefined;

  if (event.kind === "keyboard.text_input") {
    pendingEdits.delete(key);
    const current = activeInputs.get(key) ?? {
      timestamp: event.timestamp,
      application: event.app,
      window,
      target: stableTarget(event.target),
      typed: "",
      value: "",
      redacted: false
    };
    current.typed += event.keyboard?.text ?? "";
    current.redacted ||= Boolean(event.keyboard?.redacted);
    activeInputs.set(key, current);
    continue;
  }

  if (event.kind === "selection.changed") {
    const value = event.target?.value;
    const editable = event.target?.role === "AXTextArea" || event.target?.role === "AXTextField" || event.target?.role === "AXSecureTextField";
    const previousValue = lastSelectionValues.get(key);
    if (editable && typeof value === "string") lastSelectionValues.set(key, value);
    if (activeInputs.has(key)) {
      const current = activeInputs.get(key);
      if (typeof value === "string" && value !== "<redacted>") current.value = value;
      if (value === "<redacted>") current.redacted = true;
      pendingEdits.delete(key);
      continue;
    }
    const pending = pendingEdits.get(key);
    const elapsed = pending ? Date.parse(event.timestamp) - Date.parse(pending.timestamp) : Infinity;
    if (pending && elapsed >= 0 && elapsed <= 1500 && typeof value === "string") {
      const actionIndex = actions.indexOf(pending.action);
      if (actionIndex >= 0) actions.splice(actionIndex, 1);
      const redacted = value === "<redacted>" || Boolean(event.target?.secure);
      actions.push({
        type: "input_text",
        timestamp: event.timestamp,
        application: event.app,
        window,
        target: stableTarget(event.target),
        value: redacted ? "{{sensitive_input}}" : value,
        redacted,
        derivedFrom: pending.key
      });
      pendingEdits.delete(key);
      continue;
    }
    if (pending && elapsed > 1500) pendingEdits.delete(key);
    if (editable && typeof value === "string" && previousValue !== undefined && previousValue !== value) {
      const redacted = value === "<redacted>" || Boolean(event.target?.secure);
      actions.push({
        type: "input_text",
        timestamp: event.timestamp,
        application: event.app,
        window,
        target: stableTarget(event.target),
        value: redacted ? "{{sensitive_input}}" : value,
        redacted,
        derivedFrom: "accessibility_value"
      });
      continue;
    }
  }

  if (event.kind === "mouse.click") {
    pendingEdits.clear();
    for (const inputKey of [...activeInputs.keys()]) flushInput(inputKey);
    actions.push({
      type: "click",
      timestamp: event.timestamp,
      application: event.app,
      window,
      target: stableTarget(event.target),
      fallback: event.mouse ? { x: event.mouse.x, y: event.mouse.y, button: event.mouse.button } : undefined
    });
    continue;
  }

  if (event.kind === "mouse.drag") {
    pendingEdits.clear();
    for (const inputKey of [...activeInputs.keys()]) flushInput(inputKey);
    actions.push({
      type: "drag",
      timestamp: event.timestamp,
      application: event.app,
      window,
      target: stableTarget(event.target),
      from: { x: event.mouse?.fromX, y: event.mouse?.fromY },
      to: { x: event.mouse?.toX, y: event.mouse?.toY },
      button: event.mouse?.button
    });
    continue;
  }

  if (event.kind === "keyboard.submit") {
    pendingEdits.clear();
    flushInput(key);
    actions.push({
      type: "submit",
      timestamp: event.timestamp,
      application: event.app,
      window,
      target: stableTarget(event.target)
    });
    continue;
  }

  if (event.kind === "keyboard.shortcut") {
    for (const inputKey of [...activeInputs.keys()]) flushInput(inputKey);
    const normalizedKey = semanticKey(event.keyboard);
    const action = {
      type: "shortcut",
      timestamp: event.timestamp,
      application: event.app,
      window,
      target: stableTarget(event.target),
      key: normalizedKey,
      keyCode: event.keyboard?.keyCode,
      modifiers: event.keyboard?.modifiers
    };
    actions.push(action);
    if (mayChangeTextValue(normalizedKey)) pendingEdits.set(key, { action, key: normalizedKey, timestamp: event.timestamp });
    continue;
  }

  if (event.kind === "mouse.scroll") {
    pendingEdits.clear();
    for (const inputKey of [...activeInputs.keys()]) flushInput(inputKey);
    const previous = actions.at(-1);
    const target = stableTarget(event.target);
    const sameTarget = previous?.type === "scroll"
      && previous.application?.bundleIdentifier === event.app?.bundleIdentifier
      && JSON.stringify(previous.target) === JSON.stringify(target);
    const elapsed = sameTarget ? Date.parse(event.timestamp) - Date.parse(previous.timestamp) : Infinity;
    if (sameTarget && elapsed >= 0 && elapsed <= 500) {
      previous.deltaX += event.mouse?.deltaX ?? 0;
      previous.deltaY += event.mouse?.deltaY ?? 0;
      continue;
    }
    actions.push({
      type: "scroll",
      timestamp: event.timestamp,
      application: event.app,
      window,
      target,
      deltaX: event.mouse?.deltaX ?? 0,
      deltaY: event.mouse?.deltaY ?? 0,
      fallback: event.mouse ? { x: event.mouse.x, y: event.mouse.y } : undefined
    });
  }
}

for (const key of [...activeInputs.keys()]) flushInput(key);
actions.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

const sessionStart = events.find(event => event.kind === "session.started")?.timestamp;
const sessionEnd = events.findLast(event => event.kind === "session.ended");
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  source: eventsPath,
  session: { startedAt: sessionStart, endedAt: sessionEnd?.timestamp, endReason: sessionEnd?.endReason },
  applications: [...new Map(actions.filter(action => action.application).map(action => [action.application.bundleIdentifier, action.application])).values()],
  actions
}, null, 2)}\n`);
