#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateWorkflow } from "./workflow-validation.mjs";

const [path, mode] = process.argv.slice(2);
if (!path) {
  process.stderr.write("Usage: validate-workflow.mjs <workflow.json> [--reviewed]\n");
  process.exit(2);
}
const workflow = JSON.parse(await readFile(path, "utf8"));
const errors = validateWorkflow(workflow, { requireReviewed: mode === "--reviewed" });
if (errors.length) {
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exit(1);
}
process.stdout.write("Workflow is valid\n");
