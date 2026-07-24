#!/usr/bin/env node
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJourneyService } from "../scripts/journey-service.mjs";

const directory = await mkdtemp(join(tmpdir(), "flowonce-journey."));
const path = join(directory, "journey.json");
const service = createJourneyService({ path, now: () => new Date("2026-07-24T00:00:00.000Z") });
await service.record("recording_started");
await service.record("replay_passed");
await service.record("replay_passed");
const status = await service.status();
if (status.counts["recording_started:passed"] !== 1) throw new Error("journey count is wrong");
if (status.counts["second_successful_replay:passed"] !== 1) throw new Error("second successful replay was not derived");
const source = await readFile(path, "utf8");
if (/input|recipient|message content|window title/iu.test(source)) throw new Error("journey file contains disallowed content fields");
process.stdout.write("Local journey metrics OK\n");
