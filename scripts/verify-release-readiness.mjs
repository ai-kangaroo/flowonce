#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = { root, dist: null, skill: null };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--root", "--dist", "--skill"].includes(key) || !argv[index + 1]) {
      throw new Error("Usage: verify-release-readiness.mjs [--root path] [--dist path] [--skill SKILL.md]");
    }
    options[key.slice(2)] = resolve(argv[index + 1]);
    index += 1;
  }
  return options;
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function skillVersion(source) {
  return source.match(/^\s{2}version:\s*([^\s]+)$/m)?.[1]
    ?? source.match(/^version:\s*([^\s]+)$/m)?.[1]
    ?? null;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function verifyChecksumFile(dist, checksumPath) {
  const source = await readFile(checksumPath, "utf8");
  for (const line of source.trim().split(/\r?\n/u)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/iu);
    if (!match) throw new Error(`Invalid checksum line in ${checksumPath}: ${line}`);
    const target = join(dist, match[2]);
    if (!await exists(target)) throw new Error(`Checksum target is missing: ${target}`);
    if (await sha256(target) !== match[1].toLowerCase()) throw new Error(`Checksum mismatch: ${target}`);
  }
}

const packagedSourceFiles = [
  "release.json",
  "scripts/compile-workflow.mjs",
  "scripts/doctor-service.mjs",
  "scripts/event-stream-mcp.mjs",
  "scripts/generate-skill.mjs",
  "scripts/host-config.mjs",
  "scripts/install-distribution.mjs",
  "scripts/journey-service.mjs",
  "scripts/normalize-recording.mjs",
  "scripts/replay-preflight.mjs",
  "scripts/record-replay.mjs",
  "scripts/recorder-service.mjs",
  "scripts/skill-install-service.mjs",
  "scripts/skill-test-service.mjs",
  "scripts/validate-workflow.mjs",
  "scripts/workflow-validation.mjs",
  "scripts/workflow-summary.mjs",
  "skills/record-and-replay-local/SKILL.md",
  "skills/record-and-replay-local/scripts/flowonce-bootstrap.sh"
];

async function verifyPackagedSource(rootPath, productPath) {
  for (const relativePath of packagedSourceFiles) {
    const source = join(rootPath, relativePath);
    const packaged = join(productPath, relativePath);
    if (!await exists(packaged)) throw new Error(`Packaged runtime file is missing: ${packaged}`);
    if (await sha256(source) !== await sha256(packaged)) {
      throw new Error(`Packaged runtime is stale: ${relativePath}`);
    }
  }
}

export async function verifyReleaseReadiness(input = {}) {
  const options = { root, dist: null, skill: null, ...input };
  const release = JSON.parse(await readFile(join(options.root, "release.json"), "utf8"));
  const version = release.version;
  if (!/^\d+\.\d+\.\d+$/u.test(version ?? "")) throw new Error("release.json must contain a semantic version.");
  const sourceSkillPath = join(options.root, "skills", "record-and-replay-local", "SKILL.md");
  const sourceSkill = await readFile(sourceSkillPath, "utf8");
  if (skillVersion(sourceSkill) !== version) throw new Error("Repository Skill version does not match release.json.");
  const readme = await readFile(join(options.root, "README.md"), "utf8");
  if (!readme.includes(`version-${version}-blue`)) throw new Error("README version badge does not match release.json.");

  const checks = [
    { id: "source_version", status: "pass", detail: `Repository surfaces agree on ${version}.` }
  ];
  if (options.skill) {
    const deliveredVersion = skillVersion(await readFile(options.skill, "utf8"));
    if (deliveredVersion !== version) {
      throw new Error(`Delivered Skill version ${deliveredVersion ?? "missing"} does not match release ${version}.`);
    }
    checks.push({ id: "delivered_skill", status: "pass", detail: `Delivered Skill is ${version}.` });
  }
  if (options.dist) {
    for (const architecture of ["Apple-Silicon", "Intel"]) {
      const basename = `FlowOnce-${version}-macOS-${architecture}`;
      for (const extension of ["dmg", "zip", "sha256"]) {
        const path = join(options.dist, `${basename}.${extension}`);
        if (!await exists(path)) throw new Error(`Missing ${architecture} release artifact: ${path}`);
      }
      await verifyChecksumFile(options.dist, join(options.dist, `${basename}.sha256`));
      await verifyPackagedSource(
        options.root,
        join(options.dist, basename, "Install FlowOnce.app", "Contents", "Resources", "payload", "product")
      );
      checks.push({ id: `artifacts_${architecture}`, status: "pass", detail: `${architecture} assets and checksums are complete.` });
    }
  }
  return {
    ready: true,
    version,
    checks,
    nextAction: options.dist && options.skill
      ? "Source, both Mac architectures, and the delivered Skill are synchronized."
      : "Run again with --dist and --skill before publishing to verify delivered artifacts."
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const result = await verifyReleaseReadiness(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
