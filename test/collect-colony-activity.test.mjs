import assert from "node:assert/strict";
import test from "node:test";

import { deriveCborNi } from "@red-cup-engineering/cbor-services-section";
import { recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";
import { startWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/test-provider";

import { collectAagaardColonyActivity } from "../src/collect-colony-activity.mjs";

test("projects settled fleet ticks through the declared WitnessJournal provider", async (context) => {
  const journal = await startWitnessJournalProviderProcess();
  context.after(() => journal.close());
  const tick = { ts: "2026-09-05T18:00:00.000Z", accounts: [{ trading: { hive: "2.500 HIVE", hbd: "0.250 HBD", tradesPlanned: 1, tradesExecuted: 1, lpExecuted: 0 }, voting: { votesPlanned: 2, votesBroadcast: 1 } }] };
  await recordSettlementRecord({ agentUrl: journal.agentCardUrl, settlement: "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d", actor: "urn:ame:aagaard", category: "aagaard.fleet-tick", recordedAt: tick.ts, record: tick });
  const pulse = await collectAagaardColonyActivity({ agentUrl: journal.agentCardUrl, recordedAt: "2026-09-05T18:05:00.000Z", window: { fromExclusive: "2026-09-05T17:00:00.000Z", toInclusive: "2026-09-05T19:00:00.000Z" } });
  assert.equal(pulse.events.length, 2);
  assert.equal(pulse.stocks.find((stock) => stock.id === "fleet-liquid-hive").amount, "2.5");
  assert.equal(pulse.stocks[0].evidence[0], deriveCborNi({ value: tick }).uri);
});
