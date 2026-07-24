#!/usr/bin/env node
import { inspectReplayReadiness } from "../scripts/replay-preflight.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const desktop = inspectReplayReadiness({
  application: "WeCom",
  availableBackends: ["computer-use"],
  firstUse: true
});
assert(desktop.readiness === "ready" && desktop.canPromiseReplay, "desktop backend was not accepted");
assert(desktop.recommendedDemo?.id === "textedit-changed-note", "desktop first-use demo is missing");

const browser = inspectReplayReadiness({
  application: "Google Chrome",
  availableBackends: ["browser-control"],
  firstUse: true
});
assert(browser.readiness === "ready" && browser.workflowKind === "browser", "browser workflow was not inferred");
assert(browser.recommendedDemo?.id === "browser-changed-search", "browser demo is missing");

const mismatch = inspectReplayReadiness({
  application: "WeCom",
  availableBackends: ["browser-control"],
  firstUse: true
});
assert(mismatch.readiness === "partial" && !mismatch.canPromiseReplay, "backend mismatch was not surfaced");
assert(mismatch.recommendedDemo?.id === "browser-changed-search", "mismatch did not route to a viable demo");

const blocked = inspectReplayReadiness({ application: "Finder", availableBackends: [] });
assert(blocked.readiness === "blocked" && !blocked.canPromiseReplay, "missing backend was not blocked");

process.stdout.write("Replay preflight contract OK\n");
