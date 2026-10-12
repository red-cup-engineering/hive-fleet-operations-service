import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";
import { startRwilProviderProcess } from "@emsenn/rwil-rdf-services/test-provider";
import { collectAagaardColonyActivity } from "../src/collect-colony-activity.mjs";

const account = (hive, hbd, tradesPlanned = 0, tradesExecuted = 0, votesPlanned = 0, votesBroadcast = 0) => ({ trading: { hive: `${hive} HIVE`, hbd: `${hbd} HBD`, tradesPlanned, tradesExecuted, lpExecuted: 0 }, voting: { votesPlanned, votesBroadcast } });
test("derives interval actions and stocks from one typed fleet-tick history", async () => {
  const root = mkdtempSync(join(tmpdir(), "aagaard-pulse-")); const dataRoot = join(root, "data"); const rwil = await startRwilProviderProcess();
  const ticks = [
    { ts: "2026-07-20T01:00:00.000Z", accounts: [account("1.250", "0.500"), account("2.750", "1.500")] },
    { ts: "2026-07-20T01:59:00.000Z", accounts: [account("0", "0", 9)] },
    { ts: "2026-07-20T02:10:00.000Z", accounts: [account("0", "0", 2, 1, 3, 1)] }
  ];
  try {
    for (const tick of ticks) await recordSettlementRecord({ agentUrl: rwil.agentCardUrl, root: dataRoot, nodeId: "aagaard", settlement: "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d", actor: "urn:ame:aagaard", category: "aagaard.fleet-tick", recordedAt: tick.ts, record: tick });
    const pulse = await collectAagaardColonyActivity({ window: { fromExclusive: "2026-07-20T02:00:00.000Z", toInclusive: "2026-07-20T03:00:00.000Z", baseline: false }, recordedAt: "2026-07-20T03:00:00.000Z", dataRoot });
    assert.equal(pulse.events.length, 2);
    assert.match(pulse.events.find((event) => event.domain === "economy").summary, /2 trades were proposed, 1 trades executed/u);
    assert.equal(pulse.stocks.find((stock) => stock.unit === "HIVE").amount, "0");
    assert.equal(pulse.stocks.find((stock) => stock.unit === "HIVE").status, "observed");
  } finally {
    await rwil.close(); rmSync(root, { recursive: true, force: true });
  }
});
