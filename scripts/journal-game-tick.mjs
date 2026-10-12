#!/usr/bin/env node
// Runs one game-play script and appends exactly one JSON line to a journal
// file no matter how the tick ends, so an unattended timer's outcomes
// (claimed, battled, planted, or "nothing to do this tick") are always
// machine-readable, never just prose on stderr. It never changes the
// child's own exit code: a systemd timer still sees a failed tick as failed.
//
//   node journal-game-tick.mjs --journal <path> --game <name> --account <name> -- <command> [args...]

import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

function fail(message) {
  process.stderr.write(`journal-game-tick: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { journal: "", game: "", account: "", command: [] };
  let index = 0;
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") { options.command = argv.slice(index + 1); break; }
    const take = () => { const v = argv[index + 1]; if (!v) fail(`${arg} requires a value`); index += 1; return v; };
    if (arg === "--journal") options.journal = take();
    else if (arg === "--game") options.game = take();
    else if (arg === "--account") options.account = take();
    else fail(`unknown argument ${arg}`);
  }
  if (!options.journal) fail("--journal is required");
  if (!options.game) fail("--game is required");
  if (options.command.length === 0) fail("a command is required after --");
  return options;
}

function runChild(command) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: stderr + String(error) }));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { code, stdout, stderr } = await runChild(options.command);
  let outcome;
  try { outcome = JSON.parse(stdout.trim()); } catch { outcome = null; }
  const line = {
    recordedAt: new Date().toISOString(),
    game: options.game,
    account: options.account,
    exitCode: code,
    ...(outcome !== null ? { outcome } : { noOpReason: stderr.trim() || stdout.trim() || `exited ${code} with no output` }),
  };
  mkdirSync(dirname(options.journal), { recursive: true });
  appendFileSync(options.journal, `${JSON.stringify(line)}\n`);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = code;
}

main();
