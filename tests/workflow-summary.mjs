#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeWorkflow } from "../scripts/workflow-summary.mjs";

const workflow = JSON.parse(await readFile(join(import.meta.dirname, "fixtures", "reviewed-workflow.json"), "utf8"));
workflow.inputs[0].semanticRole = "text";
workflow.inputs[0].confidence = "high";
const summary = summarizeWorkflow(workflow);
if (summary.title !== `我学会了：${workflow.goal}`) throw new Error("summary title is incorrect");
if (summary.variableInputs[0]?.label !== "文字内容") throw new Error("semantic input label is missing");
if (summary.needsUserClarification) throw new Error("reviewed high-confidence workflow requested clarification");
process.stdout.write("Workflow summary card OK\n");
