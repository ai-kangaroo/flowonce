#!/usr/bin/env node
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseReadiness } from "../scripts/verify-release-readiness.mjs";

const root = join(import.meta.dirname, "..");
const release = JSON.parse(await readFile(join(root, "release.json"), "utf8"));
const testRoot = await mkdtemp(join(tmpdir(), "flowonce-release-readiness."));
const dist = join(testRoot, "dist");
await mkdir(dist);

for (const architecture of ["Apple-Silicon", "Intel"]) {
  const basename = `FlowOnce-${release.version}-macOS-${architecture}`;
  const product = join(dist, basename, "Install FlowOnce.app", "Contents", "Resources", "payload", "product");
  await mkdir(product, { recursive: true });
  for (const relativePath of [
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
  ]) {
    const destination = join(product, relativePath);
    await mkdir(join(destination, ".."), { recursive: true });
    await cp(join(root, relativePath), destination);
  }
  const checksumLines = [];
  for (const extension of ["dmg", "zip"]) {
    const filename = `${basename}.${extension}`;
    const contents = `${architecture}-${extension}`;
    await writeFile(join(dist, filename), contents);
    checksumLines.push(`${createHash("sha256").update(contents).digest("hex")}  ${filename}`);
  }
  await writeFile(join(dist, `${basename}.sha256`), `${checksumLines.join("\n")}\n`);
}
const deliveredSkill = join(testRoot, "SKILL.md");
await cp(join(root, "skills", "record-and-replay-local", "SKILL.md"), deliveredSkill);
const passed = await verifyReleaseReadiness({ root, dist, skill: deliveredSkill });
if (!passed.ready || passed.checks.length !== 4) throw new Error("complete release was not accepted");

await writeFile(deliveredSkill, (await readFile(deliveredSkill, "utf8")).replace(`version: ${release.version}`, "version: 0.0.0"));
let mismatchRejected = false;
try {
  await verifyReleaseReadiness({ root, dist, skill: deliveredSkill });
} catch (error) {
  mismatchRejected = /Delivered Skill version/u.test(error.message);
}
if (!mismatchRejected) throw new Error("stale delivered Skill was not rejected");

await cp(join(root, "skills", "record-and-replay-local", "SKILL.md"), deliveredSkill);
const stalePackagedFile = join(
  dist,
  `FlowOnce-${release.version}-macOS-Intel`,
  "Install FlowOnce.app",
  "Contents",
  "Resources",
  "payload",
  "product",
  "scripts",
  "record-replay.mjs"
);
await writeFile(stalePackagedFile, "stale");
let stalePackageRejected = false;
try {
  await verifyReleaseReadiness({ root, dist, skill: deliveredSkill });
} catch (error) {
  stalePackageRejected = /Packaged runtime is stale/u.test(error.message);
}
if (!stalePackageRejected) throw new Error("stale package with matching version was not rejected");

process.stdout.write("Release readiness gate OK\n");
