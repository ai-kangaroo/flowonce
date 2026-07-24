import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { validateWorkflow } from "./workflow-validation.mjs";

const testModes = new Set(["safe", "live"]);
const contextIsolationModes = new Set(["fresh", "current", "unknown"]);
const outcomes = new Set(["passed", "failed", "blocked", "cancelled"]);
const stepStatuses = new Set(["passed", "failed", "blocked", "skipped"]);
const failureCategories = new Set([
  "target_not_found",
  "backend_unavailable",
  "verification_failed",
  "input_binding",
  "app_state",
  "permission_denied",
  "user_cancelled",
  "unknown"
]);

const riskPatterns = [
  {
    category: "external_message",
    pattern: /(?:发送|发布|提交评论|发邮件|发消息|群消息|\b(?:send|publish|post|email|message|invite)\b)/iu
  },
  {
    category: "delete",
    pattern: /(?:删除|移除|清空|永久删除|\b(?:delete|remove|trash|erase|purge)\b)/iu
  },
  {
    category: "financial_action",
    pattern: /(?:付款|支付|转账|购买|下单|退款|\b(?:pay|purchase|checkout|transfer|refund)\b)/iu
  },
  {
    category: "system_setting_change",
    pattern: /(?:系统设置|隐私与安全|修改权限|\b(?:system settings|privacy|permission|configuration)\b)/iu
  },
  {
    category: "file_overwrite",
    pattern: /(?:覆盖(?:文件|已有内容)|替换现有|\b(?:overwrite|replace existing)\b)/iu
  }
];

function assertString(value, label, { optional = false, maxLength = 4000 } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  if (value.length > maxLength) throw new Error(`${label} must be at most ${maxLength} characters.`);
}

function safeText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value
    .slice(0, maxLength)
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted-token>")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "<redacted-token>")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "<redacted-token>")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "<redacted-token>")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "<redacted-number>");
}

function workflowFingerprint(workflow) {
  return createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
}

function stepRisk(step) {
  const hasExplicitSafety = Object.prototype.hasOwnProperty.call(step?.safety ?? {}, "requiresConfirmation")
    || Object.prototype.hasOwnProperty.call(step?.risk ?? {}, "requiresConfirmation");
  const explicit = step?.safety?.requiresConfirmation === true || step?.risk?.requiresConfirmation === true;
  const explicitCategory = step?.safety?.category ?? step?.risk?.category;
  if (explicit) return { category: explicitCategory || "unknown", source: "workflow" };
  // A reviewed workflow's explicit safe decision takes precedence over wording
  // heuristics. This avoids treating "clear the search field" as data deletion.
  if (hasExplicitSafety) return null;
  // Entering text is not itself an external action. The submit/send step is the
  // safety boundary, which lets safe tests verify a complete draft.
  if (["input_text", "focus", "open", "navigate", "scroll", "wait", "read", "verify"].includes(step?.action)) {
    return null;
  }
  const text = JSON.stringify({
    action: step?.action,
    description: step?.description,
    target: step?.target,
    verify: step?.verify
  });
  for (const candidate of riskPatterns) {
    if (candidate.pattern.test(text)) return { category: candidate.category, source: "heuristic" };
  }
  return null;
}

function recommendationFor(category) {
  switch (category) {
    case "target_not_found":
      return "Refresh the UI state and strengthen the failed step with a stable role, identifier, title, or text target before regenerating the skill.";
    case "backend_unavailable":
      return "Bind the workflow to an installed connector, browser controller, API, CLI, or desktop UI backend before retrying.";
    case "verification_failed":
      return "Replace the failed verification with a concrete observable state and regenerate the skill.";
    case "input_binding":
      return "Review the workflow inputs and step placeholders, then retry with different test values.";
    case "app_state":
      return "Add or correct preconditions so the target application starts from a known state.";
    case "permission_denied":
      return "Grant only the required host or application permission, then start a new test run.";
    case "user_cancelled":
      return "No automatic retry is needed; start another test only when the user is ready.";
    default:
      return "Inspect the failed step evidence, refine the Workflow IR, regenerate the skill, and run one fresh-context retry.";
  }
}

function normalizeFailureCategory(value) {
  if (failureCategories.has(value)) return value;
  const aliases = new Map([
    ["ui_state_unverifiable", "verification_failed"],
    ["state_unverifiable", "verification_failed"],
    ["assertion_failed", "verification_failed"],
    ["element_not_found", "target_not_found"],
    ["target_missing", "target_not_found"],
    ["missing_backend", "backend_unavailable"],
    ["permission", "permission_denied"],
    ["cancelled", "user_cancelled"]
  ]);
  return aliases.get(value) ?? "unknown";
}

function defaultEvaluationRoot() {
  const home = process.env.HOME;
  return home
    ? join(home, "Library", "Application Support", "FlowOnce", "evaluations")
    : join(tmpdir(), "flowonce-evaluations");
}

async function atomicWriteJSON(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

export function createSkillTestService(options = {}) {
  const evaluationRoot = resolve(options.evaluationRoot ?? process.env.FLOWONCE_EVALUATION_ROOT ?? defaultEvaluationRoot());
  const now = options.now ?? (() => new Date());

  async function readJSON(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  }

  async function readPlan(runID) {
    assertString(runID, "runID", { maxLength: 128 });
    if (!/^[A-F0-9-]+$/.test(runID)) throw new Error("runID is invalid.");
    const runDirectory = join(evaluationRoot, runID);
    const plan = await readJSON(join(runDirectory, "plan.json"));
    if (!plan) throw new Error(`Unknown skill test run: ${runID}`);
    return { runDirectory, plan };
  }

  async function start({
    skillPath,
    inputs = {},
    mode = "safe",
    backend = "auto",
    contextIsolation = "fresh",
    liveConfirmed = false,
    previousRunID
  } = {}) {
    assertString(skillPath, "skillPath");
    if (!testModes.has(mode)) throw new Error("mode must be safe or live.");
    assertString(backend, "backend", { maxLength: 200 });
    if (!contextIsolationModes.has(contextIsolation)) {
      throw new Error("contextIsolation must be fresh, current, or unknown.");
    }
    if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
      throw new Error("inputs must be an object.");
    }

    const absoluteSkillPath = resolve(skillPath);
    const workflowPath = join(absoluteSkillPath, "references", "workflow.json");
    const workflow = await readJSON(workflowPath);
    if (!workflow) throw new Error(`Missing generated workflow at ${workflowPath}`);
    const validationErrors = validateWorkflow(workflow, { requireReviewed: true });
    if (validationErrors.length) throw new Error(`Generated workflow is not testable:\n- ${validationErrors.join("\n- ")}`);

    const knownInputs = new Map(workflow.inputs.map(input => [input.name, input]));
    const unknownInputNames = Object.keys(inputs).filter(name => !knownInputs.has(name));
    if (unknownInputNames.length) {
      return {
        ready: false,
        status: "needs_input",
        unknownInputs: unknownInputNames,
        expectedInputs: [...knownInputs.keys()]
      };
    }
    for (const [name, value] of Object.entries(inputs)) {
      if (typeof value !== "string") throw new Error(`inputs.${name} must be a string.`);
    }
    const missingInputs = workflow.inputs
      .filter(input => input.required && !(input.name in inputs))
      .map(input => ({ name: input.name, sensitive: input.sensitive === true }));
    if (missingInputs.length) {
      return {
        ready: false,
        status: "needs_input",
        missingInputs,
        message: `Provide ${missingInputs.map(input => input.name).join(", ")} once, then FlowOnce can run the test automatically.`
      };
    }

    const risks = workflow.steps
      .map((step, index) => ({ step, stepID: step.id, index, risk: stepRisk(step) }))
      .filter(item => item.risk)
      .map(item => ({
        stepID: item.stepID,
        index: item.index,
        ...item.risk,
        description: safeText(item.step.description ?? `${item.step.action} in ${item.step.application?.name ?? "the target app"}`, 500),
        target: {
          ...(item.step.target?.role ? { role: item.step.target.role } : {}),
          ...(item.step.target?.identifier ? { identifier: item.step.target.identifier } : {}),
          ...(item.step.target?.title ? { title: safeText(item.step.target.title, 300) } : {})
        }
      }));
    if (mode === "live" && risks.length && liveConfirmed !== true) {
      return {
        ready: false,
        status: "needs_confirmation",
        risks,
        message: "A live test may perform external or irreversible actions. Ask the user for explicit confirmation, then call skill_test_start again with liveConfirmed=true."
      };
    }

    let previousPlan = null;
    if (previousRunID) {
      previousPlan = (await readPlan(previousRunID)).plan;
      if (!["failed", "blocked"].includes(previousPlan.status)) {
        throw new Error("previousRunID must refer to a failed or blocked run.");
      }
      if ((previousPlan.attempt ?? 1) >= 3) {
        return {
          ready: false,
          status: "retry_limit",
          previousRunID,
          message: "Automatic retry limit reached. Keep the failure report and ask the user before starting another independent test."
        };
      }
    }
    const firstRisk = mode === "safe" ? risks[0] : null;
    const evaluationSteps = firstRisk ? workflow.steps.slice(0, firstRisk.index) : workflow.steps;
    const createdAt = now().toISOString();
    const runID = randomUUID().toUpperCase();
    const runDirectory = join(evaluationRoot, runID);
    const reportPath = join(runDirectory, "result.json");
    const plan = {
      schemaVersion: 1,
      runID,
      status: "ready",
      createdAt,
      updatedAt: createdAt,
      skillName: basename(absoluteSkillPath),
      skillPath: absoluteSkillPath,
      workflowPath,
      workflowFingerprint: workflowFingerprint(workflow),
      mode,
      contextIsolation,
      backend,
      attempt: (previousPlan?.attempt ?? 0) + 1,
      ...(previousRunID ? { previousRunID } : {}),
      inputBindings: workflow.inputs.map(input => ({
        name: input.name,
        provided: input.name in inputs,
        sensitive: input.sensitive === true
      })),
      risks,
      evaluationScope: firstRisk ? "checkpoint" : "full",
      ...(firstRisk ? { stopBeforeStepID: firstRisk.stepID } : {}),
      evaluationStepIDs: evaluationSteps.map(step => step.id),
      successCriteria: workflow.success.description
    };
    await mkdir(evaluationRoot, { recursive: true, mode: 0o700 });
    await chmod(evaluationRoot, 0o700);
    await mkdir(runDirectory, { recursive: true, mode: 0o700 });
    await chmod(runDirectory, 0o700);
    await atomicWriteJSON(join(runDirectory, "plan.json"), plan);
    await atomicWriteJSON(join(evaluationRoot, "latest.json"), { runID, updatedAt: createdAt });

    return {
      ready: true,
      status: "ready",
      runID,
      reportPath,
      mode,
      attempt: plan.attempt,
      contextIsolation,
      backend,
      evaluationScope: plan.evaluationScope,
      ...(firstRisk ? {
        stopBeforeStepID: firstRisk.stepID,
        checkpointReason: firstRisk.category
      } : {}),
      execution: {
        skillPath: absoluteSkillPath,
        inputNames: workflow.inputs.map(input => input.name),
        steps: evaluationSteps.map(step => ({
          stepID: step.id,
          action: step.action,
          description: step.description ?? `${step.action} in ${step.application?.name ?? "the target app"}`,
          verify: step.verify?.observation ?? "Confirm the expected state change."
        })),
        successCriteria: workflow.success.description,
        instructions: [
          "Use the exact input values supplied to skill_test_start; do not write them into the evaluation report.",
          contextIsolation === "fresh"
            ? "Run the generated skill in a fresh task or isolated agent when the host supports it."
            : "Run the generated skill in the current context and report that isolation was unavailable.",
          backend === "auto"
            ? "Choose an actually available connector, browser, API, CLI, or semantic desktop backend and report its name in skill_test_finish."
            : `Use the preflighted backend: ${backend}.`,
          firstRisk
            ? `Stop before ${firstRisk.stepID}; verify the safe checkpoint without performing the ${firstRisk.category} action.`
            : "Execute all planned steps and verify the final success criteria.",
          firstRisk
            ? "When finishing a checkpoint test, report outcome=passed, successObserved=false, and step results only for the execution.steps returned here. Do not add the stopped risky step as skipped."
            : "When finishing a full passed test, report outcome=passed and successObserved=true.",
          "Do not include passwords, tokens, personal data, or raw input values in step observations."
        ]
      }
    };
  }

  async function finish({
    runID,
    outcome,
    stepResults = [],
    successObserved = false,
    finalObservation = "",
    failureCategory = "unknown",
    backend,
    notes = ""
  } = {}) {
    const { runDirectory, plan } = await readPlan(runID);
    if (plan.status !== "ready") throw new Error(`Skill test run ${runID} is already ${plan.status}.`);
    if (!outcomes.has(outcome)) throw new Error("outcome must be passed, failed, blocked, or cancelled.");
    if (!Array.isArray(stepResults)) throw new Error("stepResults must be an array.");
    const normalizedFailureCategory = normalizeFailureCategory(failureCategory);
    assertString(finalObservation, "finalObservation", { optional: outcome !== "passed" });
    assertString(notes, "notes", { optional: true });
    assertString(backend ?? plan.backend, "backend", { maxLength: 200 });

    const allowedStepIDs = new Set(plan.evaluationStepIDs);
    const seenStepIDs = new Set();
    const normalizedStepResults = stepResults.map((result, index) => {
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error(`stepResults[${index}] must be an object.`);
      }
      if (!allowedStepIDs.has(result.stepID)) throw new Error(`Unknown evaluated step: ${result.stepID}`);
      if (seenStepIDs.has(result.stepID)) throw new Error(`Duplicate step result: ${result.stepID}`);
      seenStepIDs.add(result.stepID);
      if (!stepStatuses.has(result.status)) throw new Error(`Invalid status for step ${result.stepID}.`);
      assertString(result.observation, `stepResults[${index}].observation`, { optional: result.status === "skipped" });
      return {
        stepID: result.stepID,
        status: result.status,
        observation: safeText(result.observation)
      };
    });

    if (outcome === "passed") {
      const missingResults = plan.evaluationStepIDs.filter(stepID => !seenStepIDs.has(stepID));
      if (missingResults.length) throw new Error(`Passed test is missing step results: ${missingResults.join(", ")}`);
      const nonPassing = normalizedStepResults.filter(result => result.status !== "passed");
      if (nonPassing.length) throw new Error("Passed test cannot contain failed, blocked, or skipped evaluated steps.");
      if (plan.evaluationScope === "full" && successObserved !== true) {
        throw new Error("A full passed test must observe the workflow success criteria.");
      }
    }
    if (outcome === "failed" && !normalizedStepResults.some(result => result.status === "failed")) {
      throw new Error("A failed test must identify at least one failed step.");
    }

    const completedAt = now().toISOString();
    const verdict = outcome === "passed" && plan.evaluationScope === "checkpoint"
      ? "checkpoint_passed"
      : outcome;
    const actualBackend = backend ?? plan.backend;
    if (outcome === "passed" && actualBackend === "auto") {
      throw new Error("A passed test must report the actual execution backend.");
    }
    const retryRecommended = (outcome === "failed" || outcome === "blocked") && plan.mode !== "live";
    const result = {
      schemaVersion: 1,
      runID,
      skillName: plan.skillName,
      workflowFingerprint: plan.workflowFingerprint,
      attempt: plan.attempt,
      mode: plan.mode,
      contextIsolation: plan.contextIsolation,
      evaluationScope: plan.evaluationScope,
      backend: actualBackend,
      outcome,
      verdict,
      completedAt,
      stepResults: normalizedStepResults,
      successObserved: successObserved === true,
      finalObservation: safeText(finalObservation),
      ...(outcome === "failed" || outcome === "blocked" ? {
        failureCategory: normalizedFailureCategory,
        recommendation: recommendationFor(normalizedFailureCategory)
      } : {}),
      retryRecommended,
      notes: safeText(notes)
    };
    await atomicWriteJSON(join(runDirectory, "result.json"), result);
    await atomicWriteJSON(join(runDirectory, "plan.json"), {
      ...plan,
      status: verdict,
      updatedAt: completedAt,
      completedAt
    });
    await atomicWriteJSON(join(evaluationRoot, "latest.json"), { runID, updatedAt: completedAt });
    return {
      runID,
      reportPath: join(runDirectory, "result.json"),
      verdict,
      retryRecommended,
      ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
      ...(result.recommendation ? { recommendation: result.recommendation } : {}),
      nextAction: verdict === "passed"
        ? "The generated skill passed a full execution test and is ready for use."
        : verdict === "checkpoint_passed"
          ? "The safe checkpoint passed. Offer a user-confirmed live test only if full side-effect verification is necessary."
          : retryRecommended
            ? "Refine the reviewed Workflow IR, regenerate the skill, and start one fresh-context retry linked with previousRunID."
            : plan.mode === "live" && (outcome === "failed" || outcome === "blocked")
              ? "Do not retry automatically because the live side effect may already have occurred. Ask the user to inspect the target state."
              : "No retry was started."
    };
  }

  async function status({ runID } = {}) {
    let selectedRunID = runID;
    if (!selectedRunID) {
      const latest = await readJSON(join(evaluationRoot, "latest.json"));
      if (!latest?.runID) return { found: false, status: "none" };
      selectedRunID = latest.runID;
    }
    const { runDirectory, plan } = await readPlan(selectedRunID);
    const result = await readJSON(join(runDirectory, "result.json"));
    return {
      found: true,
      runID: selectedRunID,
      reportPath: join(runDirectory, "result.json"),
      plan,
      ...(result ? { result } : {})
    };
  }

  return { start, finish, status, evaluationRoot };
}
