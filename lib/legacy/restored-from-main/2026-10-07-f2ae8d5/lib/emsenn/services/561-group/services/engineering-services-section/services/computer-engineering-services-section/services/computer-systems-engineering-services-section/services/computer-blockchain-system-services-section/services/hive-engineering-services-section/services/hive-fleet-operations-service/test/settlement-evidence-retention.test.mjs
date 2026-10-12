import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { witnessChainAct, claimsOf } from "../src/core/journal.mjs";

const root = mkdtempSync(join(tmpdir(), "hive-settlement-evidence-"));
try {
  const event = {
    hbdSavingsTouchSchema: "aagaard.hbd-savings-touch.v1",
    eventId: "urn:fixture:savings-touch",
    account: "fixture-account",
    transactionId: "a".repeat(40),
    recordedAt: "2026-10-05T00:00:00.000Z",
    receipt: {
      status: "interest-confirmed",
      amount: "12345678901234567890.001 HBD",
      observations: [{ node: "https://fixture.invalid", block: 42 }],
      policy: { retryAllowed: false, authority: "active" },
    },
  };
  assert.equal(witnessChainAct(root, "fixture.savings", event.recordedAt, event), event);
  assert.deepEqual(claimsOf(root, "fixture.savings"), [event]);
  assert.throws(() => witnessChainAct(root, "fixture.savings", event.recordedAt, null), TypeError);
  assert.equal(claimsOf(root, "fixture.savings").length, 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
