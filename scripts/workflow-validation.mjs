const supportedActions = new Set(["click", "drag", "input_text", "submit", "shortcut", "scroll"]);
const safetyCategories = new Set(["external_message", "delete", "financial_action", "system_setting_change", "file_overwrite", "unknown"]);

export function validateWorkflow(workflow, { requireReviewed = false } = {}) {
  const errors = [];
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return ["workflow must be an object"];
  if (workflow.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (requireReviewed && workflow.status !== "reviewed") errors.push("status must be reviewed");
  if (!workflow.goal || typeof workflow.goal !== "string" || !workflow.goal.trim()) errors.push("goal must be a non-empty string");
  else if (workflow.goal.length > 500 || /[\r\n]/.test(workflow.goal)) errors.push("goal must be a single line of at most 500 characters");
  if (!workflow.success?.description || typeof workflow.success.description !== "string" || !workflow.success.description.trim()) errors.push("success.description must be a non-empty string");
  if (requireReviewed && workflow.success?.requiresVerification !== true) errors.push("success.requiresVerification must be true");
  if (!Array.isArray(workflow.inputs)) errors.push("inputs must be an array");
  if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) errors.push("steps must be a non-empty array");

  const inputNames = new Set();
  for (const [index, input] of (Array.isArray(workflow.inputs) ? workflow.inputs : []).entries()) {
    if (!input?.name || typeof input.name !== "string") errors.push(`inputs[${index}].name must be a non-empty string`);
    else if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.name)) errors.push(`inputs[${index}].name must use lowercase letters, digits, and underscores`);
    else if (inputNames.has(input.name)) errors.push(`duplicate input name: ${input.name}`);
    else inputNames.add(input.name);
    if (input?.type !== "string") errors.push(`inputs[${index}].type must be string`);
    if (typeof input?.required !== "boolean") errors.push(`inputs[${index}].required must be boolean`);
    if (typeof input?.sensitive !== "boolean") errors.push(`inputs[${index}].sensitive must be boolean`);
    if (input?.sensitive && input.demonstratedValue !== undefined) errors.push(`inputs[${index}] must not persist a demonstrated value when sensitive`);
  }

  const stepIDs = new Set();
  for (const [index, step] of (Array.isArray(workflow.steps) ? workflow.steps : []).entries()) {
    if (!step?.id || typeof step.id !== "string") errors.push(`steps[${index}].id must be a non-empty string`);
    else if (stepIDs.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
    else stepIDs.add(step.id);
    if (!supportedActions.has(step?.action)) errors.push(`steps[${index}].action is unsupported: ${step?.action}`);
    if (!step?.application?.name && !step?.application?.bundleIdentifier) errors.push(`steps[${index}].application must identify an app`);
    if (step?.action === "drag" && (![step.from?.x, step.from?.y, step.to?.x, step.to?.y].every(Number.isFinite))) {
      errors.push(`steps[${index}] drag coordinates must be finite numbers`);
    }
    if (step?.action === "shortcut" && (!step.key || typeof step.key !== "string")) errors.push(`steps[${index}].key must be a semantic key string`);
    if (step?.safety !== undefined) {
      if (!step.safety || typeof step.safety !== "object" || Array.isArray(step.safety)) {
        errors.push(`steps[${index}].safety must be an object`);
      } else {
        if (typeof step.safety.requiresConfirmation !== "boolean") {
          errors.push(`steps[${index}].safety.requiresConfirmation must be boolean`);
        }
        if (step.safety.requiresConfirmation === true && !safetyCategories.has(step.safety.category)) {
          errors.push(`steps[${index}].safety.category is invalid`);
        }
      }
    }
    if (typeof step?.value === "string") {
      for (const match of step.value.matchAll(/\{\{([^{}]+)\}\}/g)) {
        if (!inputNames.has(match[1])) errors.push(`steps[${index}].value references unknown input: ${match[1]}`);
      }
    }
  }
  if (requireReviewed && workflow.safety?.neverPersistSensitiveValues !== true) errors.push("safety.neverPersistSensitiveValues must be true");
  return errors;
}
