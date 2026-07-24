#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillTestService } from "../scripts/skill-test-service.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "flowonce-skill-test."));
const outputParent = join(directory, "skills");
const evaluationRoot = join(directory, "evaluations");
const workflow = JSON.parse(await readFile(join(root, "tests", "fixtures", "reviewed-workflow.json"), "utf8"));
const service = createSkillTestService({ evaluationRoot });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const skillPath = execFileSync(process.execPath, [
  join(root, "scripts", "generate-skill.mjs"),
  join(root, "tests", "fixtures", "reviewed-workflow.json"),
  outputParent,
  "flowonce-testable-skill"
], { encoding: "utf8" }).trim();

const missing = await service.start({ skillPath });
assert(!missing.ready && missing.status === "needs_input", "test start accepted missing required inputs");

const started = await service.start({
  skillPath,
  inputs: { text: "different test value" },
  backend: "semantic-test-backend",
  contextIsolation: "fresh"
});
assert(started.ready && started.evaluationScope === "full", "safe test did not prepare a full run");
assert(started.execution.steps.length === workflow.steps.length, "test plan lost workflow steps");
const savedPlan = await readFile(join(evaluationRoot, started.runID, "plan.json"), "utf8");
assert(!savedPlan.includes("different test value"), "test plan persisted a raw input value");

const passed = await service.finish({
  runID: started.runID,
  outcome: "passed",
  backend: "semantic-test-backend",
  successObserved: true,
  finalObservation: "The expected document state was observed.",
  stepResults: started.execution.steps.map(step => ({
    stepID: step.stepID,
    status: "passed",
    observation: "Expected state observed."
  }))
});
assert(passed.verdict === "passed" && !passed.retryRecommended, "full run did not pass");
const latestPassed = await service.status({});
assert(latestPassed.result?.verdict === "passed", "latest status did not return the completed run");
let duplicateFinishRejected = false;
try {
  await service.finish({
    runID: started.runID,
    outcome: "cancelled",
    backend: "semantic-test-backend"
  });
} catch (error) {
  duplicateFinishRejected = error.message.includes("already passed");
}
assert(duplicateFinishRejected, "completed evaluation report could be overwritten");

const failedStart = await service.start({
  skillPath,
  inputs: { text: "another test value" },
  backend: "semantic-test-backend"
});
const token = `ghp_${"A".repeat(30)}`;
const failed = await service.finish({
  runID: failedStart.runID,
  outcome: "failed",
  backend: "semantic-test-backend",
  failureCategory: "target_not_found",
  stepResults: [{
    stepID: failedStart.execution.steps[0].stepID,
    status: "failed",
    observation: `Target was not found; diagnostic token ${token}`
  }]
});
assert(failed.retryRecommended && failed.recommendation.includes("stable role"), "failed run did not recommend refinement");
const savedFailure = await readFile(failed.reportPath, "utf8");
assert(!savedFailure.includes(token) && savedFailure.includes("<redacted-token>"), "evaluation report did not redact a common token");

const retry = await service.start({
  skillPath,
  inputs: { text: "retry value" },
  backend: "semantic-test-backend",
  previousRunID: failedStart.runID
});
assert(retry.attempt === 2, "retry was not linked to the previous run");
await service.finish({
  runID: retry.runID,
  outcome: "failed",
  backend: "semantic-test-backend",
  failureCategory: "verification_failed",
  stepResults: [{
    stepID: retry.execution.steps[0].stepID,
    status: "failed",
    observation: "Expected state was not observable."
  }]
});
const finalRetry = await service.start({
  skillPath,
  inputs: { text: "final retry value" },
  backend: "semantic-test-backend",
  previousRunID: retry.runID
});
assert(finalRetry.attempt === 3, "second automatic retry did not use attempt three");
await service.finish({
  runID: finalRetry.runID,
  outcome: "failed",
  backend: "semantic-test-backend",
  failureCategory: "verification_failed",
  stepResults: [{
    stepID: finalRetry.execution.steps[0].stepID,
    status: "failed",
    observation: "Expected state was still not observable."
  }]
});
const retryLimit = await service.start({
  skillPath,
  inputs: { text: "must not auto-run" },
  backend: "semantic-test-backend",
  previousRunID: finalRetry.runID
});
assert(!retryLimit.ready && retryLimit.status === "retry_limit", "automatic retry limit was not enforced");

const riskyWorkflow = {
  ...workflow,
  goal: "Enter provided text and send it",
  steps: [
    ...workflow.steps,
    {
      id: "send_message",
      action: "submit",
      description: "Send the external message",
      application: { name: "Example Messenger", bundleIdentifier: "com.example.messenger" },
      target: { role: "AXButton", title: "Send" },
      safety: { requiresConfirmation: true, category: "external_message" },
      verify: { required: true, observation: "Confirm the message appears in the conversation." }
    }
  ]
};
const riskyWorkflowPath = join(directory, "risky-workflow.json");
await writeFile(riskyWorkflowPath, `${JSON.stringify(riskyWorkflow, null, 2)}\n`);
const riskySkillPath = execFileSync(process.execPath, [
  join(root, "scripts", "generate-skill.mjs"),
  riskyWorkflowPath,
  outputParent,
  "flowonce-risky-skill"
], { encoding: "utf8" }).trim();
const riskySkill = await readFile(join(riskySkillPath, "SKILL.md"), "utf8");
assert(riskySkill.includes("Ask for explicit confirmation before this external_message action."), "generated skill lost step safety");

const safeRiskTest = await service.start({
  skillPath: riskySkillPath,
  inputs: { text: "safe checkpoint value" },
  backend: "semantic-test-backend",
  mode: "safe"
});
assert(safeRiskTest.evaluationScope === "checkpoint", "safe mode did not stop before a risky step");
assert(safeRiskTest.stopBeforeStepID === "send_message", "safe mode chose the wrong checkpoint");
assert(safeRiskTest.checkpointReason === "external_message", "safe mode did not expose the checkpoint risk");
const checkpoint = await service.finish({
  runID: safeRiskTest.runID,
  outcome: "passed",
  backend: "semantic-test-backend",
  successObserved: false,
  finalObservation: "The message was prepared but not sent.",
  stepResults: safeRiskTest.execution.steps.map(step => ({
    stepID: step.stepID,
    status: "passed",
    observation: "Safe checkpoint state observed."
  }))
});
assert(checkpoint.verdict === "checkpoint_passed", "safe checkpoint was reported as a full pass");

const draftMessageWorkflow = {
  ...workflow,
  goal: "Prepare and send a message",
  steps: [
    {
      ...workflow.steps[0],
      id: "clear_search",
      action: "input_text",
      description: "Clear the search field and enter a target",
      safety: { requiresConfirmation: false }
    },
    {
      ...workflow.steps[0],
      id: "prepare_message",
      action: "input_text",
      description: "Enter the complete group message",
      safety: { requiresConfirmation: false }
    },
    {
      id: "submit_message",
      action: "submit",
      description: "Send the external message",
      application: { name: "Example Messenger", bundleIdentifier: "com.example.messenger" },
      target: { role: "AXButton", title: "Send" },
      safety: { requiresConfirmation: true, category: "external_message" },
      verify: { required: true, observation: "Confirm the message appears." }
    }
  ]
};
const draftMessageWorkflowPath = join(directory, "draft-message-workflow.json");
await writeFile(draftMessageWorkflowPath, `${JSON.stringify(draftMessageWorkflow, null, 2)}\n`);
const draftMessageSkillPath = execFileSync(process.execPath, [
  join(root, "scripts", "generate-skill.mjs"),
  draftMessageWorkflowPath,
  outputParent,
  "flowonce-draft-message-skill"
], { encoding: "utf8" }).trim();
const draftMessageTest = await service.start({
  skillPath: draftMessageSkillPath,
  inputs: { text: "Unicode 测试 https://example.com 🚀" },
  backend: "semantic-test-backend",
  mode: "safe"
});
assert(draftMessageTest.stopBeforeStepID === "submit_message", "safe mode stopped before drafting the message");
assert(
  JSON.stringify(draftMessageTest.execution.steps.map(step => step.stepID))
    === JSON.stringify(["clear_search", "prepare_message"]),
  "safe mode did not include all safe draft steps"
);

const normalizedFailure = await service.finish({
  runID: draftMessageTest.runID,
  outcome: "blocked",
  backend: "semantic-test-backend",
  failureCategory: "ui_state_unverifiable",
  stepResults: [{
    stepID: "prepare_message",
    status: "blocked",
    observation: "The exact draft state was not observable."
  }]
});
assert(normalizedFailure.failureCategory === "verification_failed", "failure category alias was not normalized");

const unconfirmedLive = await service.start({
  skillPath: riskySkillPath,
  inputs: { text: "live value" },
  backend: "semantic-test-backend",
  mode: "live"
});
assert(!unconfirmedLive.ready && unconfirmedLive.status === "needs_confirmation", "live risky test bypassed confirmation");
const confirmedLive = await service.start({
  skillPath: riskySkillPath,
  inputs: { text: "live value" },
  backend: "semantic-test-backend",
  mode: "live",
  liveConfirmed: true
});
assert(confirmedLive.ready && confirmedLive.evaluationScope === "full", "confirmed live test was not prepared");
const liveFailed = await service.finish({
  runID: confirmedLive.runID,
  outcome: "failed",
  backend: "semantic-test-backend",
  failureCategory: "verification_failed",
  stepResults: [{
    stepID: "send_message",
    status: "failed",
    observation: "The post-send state could not be verified."
  }]
});
assert(!liveFailed.retryRecommended && liveFailed.nextAction.includes("Do not retry automatically"), "live failure allowed an unsafe automatic retry");

process.stdout.write("Skill test loop OK\n");
