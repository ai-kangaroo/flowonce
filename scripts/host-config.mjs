#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const host = process.argv[2] ?? "portable";
const hosts = {
  portable: {
    skillInstall: "Import the generated skill folder with the host's Skill manager.",
    mcpConfigPath: "Use the host's user-level MCP settings."
  },
  codex: {
    skillInstall: join(homedir(), ".codex", "skills", "<skill-name>"),
    mcpConfigPath: "Install the optional Codex plugin adapter, or add the server in Codex MCP settings."
  },
  codebuddy: {
    skillInstall: join(homedir(), ".codebuddy", "skills", "<skill-name>"),
    mcpConfigPath: join(homedir(), ".codebuddy", ".mcp.json")
  },
  qoder: {
    skillInstall: join(homedir(), ".qoder", "skills", "<skill-name>"),
    mcpConfigPath: join(homedir(), ".qoder", "settings.json")
  },
  qoderwork: {
    skillInstall: join(homedir(), ".qoderwork", "skills", "<skill-name>"),
    mcpConfigPath: "Add the server from QoderWork's MCP settings."
  },
  workbuddy: {
    skillInstall: "Open Skills > Add Skill > Upload Skill and select the generated skill package.",
    mcpConfigPath: join(homedir(), ".workbuddy", "mcp.json")
  }
};

if (!hosts[host]) {
  throw new Error(`Unsupported host: ${host}. Expected one of: ${Object.keys(hosts).join(", ")}`);
}

process.stdout.write(`${JSON.stringify({
  host,
  requirements: ["macOS", "Node.js 18 or newer", "FlowOnce.app Accessibility permission"],
  mcpConfigPath: hosts[host].mcpConfigPath,
  mcp: {
    mcpServers: {
      "record-and-replay-local": {
        command: process.execPath,
        args: [join(root, "scripts", "event-stream-mcp.mjs")]
      }
    }
  },
  skillInstall: hosts[host].skillInstall,
  prompt: "Use FlowOnce to learn my workflow and turn it into a portable reusable skill."
}, null, 2)}\n`);
