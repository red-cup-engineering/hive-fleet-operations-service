import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseOptions, planTouch } from "../scripts/hbd-savings-touch.mjs";
import { serializeOperation } from "../src/integrations/hive/waggle/serialize.mjs";

test("stale interest-bearing savings plans the fixed minimum touch", () => {
  const plan = planTouch({ savingsHbd: "14.452 HBD", liquidHbd: "0.007 HBD",
    lastInterestPayment: "2025-04-12T02:42:54.000Z", hbdInterestRateBps: 1000 }, Date.parse("2026-07-22T04:00:00.000Z"));
  assert.equal(plan.kind, "touch"); assert.equal(plan.amount, "0.001 HBD");
  assert.deepEqual(parseOptions(["--account", "michael561"]), { account: "michael561", keyFile: "", executeOne: false });
});

test("native transfer_from_savings is implemented at operation id 33", () => {
  const bytes = serializeOperation(["transfer_from_savings", { from: "michael561", request_id: 108346077,
    to: "michael561", amount: "16.298 HBD", memo: "aagaard:hbd-savings-exit:v1" }]);
  assert.equal(bytes[0], 33); assert.ok(bytes.length > 40);
});

test("broadcaster admits only exact self-directed HBD savings exits", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const run = (fields: Record<string, unknown>, overrides: Record<string, unknown> = {}): Promise<string> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] }); let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("close", () => resolve(stderr));
    child.stdin.end(JSON.stringify({ account: "michael561", role: "active", lane: "savings-exit", target: "michael561",
      keyFile: "/missing/active.wif", operation: ["transfer_from_savings", fields], ...overrides }));
  });
  const valid = { from: "michael561", request_id: 108346077, to: "michael561", amount: "16.298 HBD", memo: "aagaard:hbd-savings-exit:v1" };
  assert.match(await run(valid), /cannot read key file/);
  assert.match(await run({ ...valid, to: "attacker" }), /savings exit/);
  assert.match(await run({ ...valid, amount: "16.298 HIVE" }), /savings exit/);
  assert.match(await run({ ...valid, memo: "" }), /savings exit/);
});
