#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [releasePath, outputPath, architecture, nodeVersion] = process.argv.slice(2);
if (!releasePath || !outputPath || !architecture || !nodeVersion) {
  process.stderr.write("Usage: create-release-manifest.mjs <release.json> <output.json> <architecture> <node-version>\n");
  process.exit(2);
}
const release = JSON.parse(await readFile(releasePath, "utf8"));
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.version ?? "")) {
  throw new Error("release.json must contain a valid semantic version.");
}
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  name: "FlowOnce",
  version: release.version,
  architecture,
  nodeVersion,
  minimumMacOSVersion: "14.0",
  supportedHosts: ["CodeBuddy", "WorkBuddy", "Qoder", "Codex"],
  installedComponents: ["native-recorder", "stdio-mcp", "portable-skill", "bundled-node-runtime"]
}, null, 2)}\n`);
