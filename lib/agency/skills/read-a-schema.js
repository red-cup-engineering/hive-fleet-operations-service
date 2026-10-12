#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(import.meta.resolve("@red-cup-engineering/json-schema-services-section/read-a-schema"));
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

