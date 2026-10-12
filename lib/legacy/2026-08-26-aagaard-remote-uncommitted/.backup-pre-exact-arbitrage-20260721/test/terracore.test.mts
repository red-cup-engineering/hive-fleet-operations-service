import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerraCoreClient,
  parseTerraCorePlayer,
  planTerraCoreActions,
  terraCoreBattleIntent,
  terraCoreClaimIntent,
} from "../src/integrations/terracore/terracore.adapter.ts";

const PLAYER = JSON.stringify({
  username: "michael561",
  scrap: 68.8801328125,
  health: 10,
  damage: 180,
  defense: 170,
  engineering: 14,
  minerate: 0.0003255208333333333,
  attacks: 1,
  maxAttacks: 1,
  lastclaim: 1775819735940,
  lastBattle: 1784592711814,
});

test("TerraCore player parsing preserves monetary source lexemes", () => {
  const state = parseTerraCorePlayer(PLAYER, "2026-07-21T12:00:00.000Z");
  assert.equal(state.account, "michael561");
  assert.equal(state.scrap, "68.8801328125");
  assert.equal(state.mineRate, "0.0003255208333333333");
  assert.equal(state.engineering, 14);
  assert.equal(state.lastClaimMs, 1775819735940);
});

test("TerraCore parser refuses duplicate exact-amount fields", () => {
  const duplicate = PLAYER.replace('"scrap":68.8801328125', '"scrap":68.8801328125,"scrap":70');
  assert.throws(() => parseTerraCorePlayer(duplicate), /exactly once/);
});

test("TerraCore exact amount scanner ignores nested and quoted lookalikes", () => {
  const adversarial = PLAYER.replace(
    '"lastBattle":1784592711814',
    '"note":"\\\"scrap\\\":999","nested":{"scrap":888},"lastBattle":1784592711814',
  );
  assert.equal(parseTerraCorePlayer(adversarial).scrap, "68.8801328125");
});

test("TerraCore claim intent truncates, never rounds up, at token precision", () => {
  const intent = terraCoreClaimIntent("michael561", "68.8801328199");
  assert.deepEqual(intent.operation, ["custom_json", {
    required_auths: [],
    required_posting_auths: ["michael561"],
    id: "terracore_claim",
    json: '{"amount":"68.88013281"}',
  }]);
  assert.equal(intent.approvedForBroadcast, false);
  assert.throws(() => terraCoreClaimIntent("michael561", "0.000000009"), /must be positive/);
});

test("TerraCore action policy proposes a locked claim and refuses unevidenced battle selection", () => {
  const state = parseTerraCorePlayer(PLAYER, "2026-07-21T12:00:00.000Z");
  const plan = planTerraCoreActions(state);
  assert.equal(plan.locked, true);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0]?.amount, "68.88013281");
  assert.match(plan.refusals[0]?.reason ?? "", /target-selection/);
});

test("TerraCore battle codec validates both accounts and remains locked", () => {
  const intent = terraCoreBattleIntent("michael561", "valid-target");
  assert.equal(intent.operation[1].id, "terracore_battle");
  assert.equal(intent.operation[1].json, '{"target":"valid-target"}');
  assert.equal(intent.approvedForBroadcast, false);
  assert.throws(() => terraCoreBattleIntent("michael561", "michael561"), /must differ/);
  assert.throws(() => terraCoreBattleIntent("michael561", "BAD"), /invalid Hive battle target/);
});

test("TerraCore client binds the requested account to the response", async () => {
  const reads: string[] = [];
  const client = createTerraCoreClient({
    endpoint: "https://example.invalid/",
    now: () => new Date("2026-07-21T12:00:00.000Z"),
    fetchImpl: async (input) => {
      reads.push(String(input));
      return new Response(PLAYER, { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const state = await client.readPlayer("michael561");
  assert.equal(state.observedAt, "2026-07-21T12:00:00.000Z");
  assert.deepEqual(reads, ["https://example.invalid/player/michael561"]);
  await assert.rejects(() => client.readPlayer("other-user"), /returned michael561/);
});
