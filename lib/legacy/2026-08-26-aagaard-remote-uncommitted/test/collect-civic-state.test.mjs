import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";
import { startRwilProviderProcess } from "@emsenn/rwil-rdf-services/test-provider";
import { collectAagaardCivicState } from "../src/collect-civic-state.mjs";

test("Aagaard emits separate balances, proposals, executions, votes, and staleness", async () => {
  const root = mkdtempSync(join(tmpdir(), "aagaard-civic-")); const rwil = await startRwilProviderProcess();
  const tick = { kind: "aagaard.fleet-tick", ts: "2026-07-19T06:05:00.000Z", running: true, live: false, enabled: ["voting", "trading"], accounts: [{ account: "alpha", voting: { votesPlanned: 2, votesBroadcast: 1, votesSkipped: 1, execution: { errors: 0 } }, trading: { mode: "propose-only", hive: "2.500 HIVE", hbd: "0.750 HBD", tradesPlanned: 1, tradesExecuted: 0, lpPlanned: 0, lpExecuted: 0, savingsExecuted: false } }] };
  await recordSettlementRecord({ agentUrl: rwil.agentCardUrl, root: join(root, "data"), nodeId: "aagaard", settlement: "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d", actor: "urn:ame:aagaard", category: "aagaard.fleet-tick", recordedAt: tick.ts, record: tick });
  const report = collectAagaardCivicState({ period: "2026-07-19T06:00:00.000Z", recordedAt: "2026-07-19T06:10:00.000Z", root });
  const claims = new Map(report.object.claims.map((claim) => [claim.claimId, claim]));
  assert.equal(claims.get("economy/liquid-hive-observed").economic.currencyOrUnit, "HIVE");
  assert.equal(claims.get("economy/liquid-hbd-observed").economic.currencyOrUnit, "HBD");
  assert.notEqual(claims.get("economy/trades-planned").claimId, claims.get("economy/trades-executed").claimId);
  assert.notEqual(claims.get("politics/hive-votes-planned").claimId, claims.get("politics/hive-votes-broadcast").claimId);
  assert.match(claims.get("civic/source-observation-age").measurement.amount, /^\d+$/u);
  assert.equal(report.object.claims.every((claim) => /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(claim.provenance[0])), true);
  await rwil.close(); rmSync(root, { recursive: true, force: true });
});
