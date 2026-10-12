// signer — hands one write request to the fleet's one signer (scripts/hive-broadcast.mjs), on this
// machine or over ssh on the host that holds the account's keys, and reads back its answer:
// { status: "broadcast", id } or { status: "refused", datum, reason }. A signer that exits
// nonzero attempted a broadcast whose outcome is unknown; that rejects, and must not be retried.
import { spawn } from "node:child_process";

const SIGNER = new URL("../../scripts/hive-broadcast.mjs", import.meta.url);
// Where a host keeps its materialized signer release.
export const SIGNER_RELEASE = "/home/emsenn/561-group/releases/hive-fleet-signer-current";

/** Run the signer with `request` on stdin, locally or on `host` (default HIVE_SIGNER_HOST). */
export function runSigner(request, { host = process.env.HIVE_SIGNER_HOST || undefined, timeoutMs = 120_000 } = {}) {
  const [command, args] = host
    ? ["ssh", ["-T", "-o", "BatchMode=yes", host, "sh", "-lc", `cd ${SIGNER_RELEASE} && exec node scripts/hive-broadcast.mjs`]]
    : [process.execPath, [SIGNER.pathname]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`signer timed out after ${timeoutMs}ms; outcome unknown`)); }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(stderr.trim() || `signer exited ${code}; outcome unknown`)); return; }
      let answer;
      try { answer = JSON.parse(stdout); } catch { reject(new Error("signer answered with invalid JSON; outcome unknown")); return; }
      if (answer?.status === "refused" || (answer?.status === "broadcast" && /^[0-9a-f]{40}$/.test(String(answer.id ?? "")))) resolve(answer);
      else reject(new Error("signer answered without a status or canonical transaction id; outcome unknown"));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

/** Run the signer and return its broadcast answer; a refusal throws with the signer's reason. */
export async function submitToSigner(request, options) {
  const answer = await runSigner(request, options);
  if (answer.status === "refused") throw Object.assign(new Error(`signer refused (${answer.datum}): ${answer.reason}`), { refusal: answer });
  return answer;
}
