import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { querySettlementRecords } from "@red-cup-engineering/witness-journal-document-service";
import { startFilesystemWitnessJournalProviderProcess } from "@red-cup-engineering/witness-journal-document-service/filesystem-provider";

import { awaitFilesystemWitnessJournalProvider, observe } from "../scripts/opportunity-feed.mjs";
import {
  observeOpportunityFeed,
  OPPORTUNITY_FEED_CATEGORY,
  projectOpportunityFeedJsonValue,
} from "../src/opportunity-feed.mjs";

const observedAt = "2026-09-01T18:00:00.000Z";

test("package exposes the opportunity feed through a bare-path CLI target", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.bin["hive-fleet-opportunity-feed"], "scripts/opportunity-feed.mjs");
  assert.equal((await readFile(new URL("../scripts/opportunity-feed.mjs", import.meta.url), "utf8")).startsWith("#!/usr/bin/env node\n"), true);
});

function globalArbitrage() {
  return { schema: "aagaard.global-arbitrage-scan.v1", observedAt, status: "certified",
    certifyingProviders: ["provider-a", "provider-b"], providerKnowledge: { value: "true", unavailable: [{ provider: "provider-c", problem: "timeout" }] },
    opportunities: [
      { symbol: "DEC", pool: "SWAP.HIVE:DEC", policyAdmitted: true, policyRefusal: null,
        exact: { admitted: true, quote: { worstCaseProfitSwapHive: "0.01200000", optionalFee: undefined } } },
      { symbol: "SPS", pool: "SWAP.HIVE:SPS", policyAdmitted: false, policyRefusal: "worst-case edge below policy",
        exact: { admitted: true, quote: { worstCaseProfitSwapHive: "0.00010000" } } },
    ], refusal: null, credentialAccess: false, chainMutation: false, executionAdmissible: false };
}

function poolCycle() {
  return { kind: "aagaard.exact-pool-cycle-opportunity", observedAt, route: ["DEC", "BEE", "VOUCHER", "DEC"],
    decision: "refuse", refusal: "0.200 DEC lacks certified exit value", assay: { status: "uncertified",
      providerKnowledge: { value: "neither", unavailable: [{ provider: "pool-provider-c", problem: "503" }] } },
    credentialAccess: false, chainMutation: false, executionAdmissible: false };
}

function games() {
  const ranked = [
    { game: "dcity", action: "recover-closed-sim", benefitClass: "treasury-protection", admittedNow: false,
      refusal: "resource-credit-state-uncertified", rcDecision: "uncertified", evidence: "true", evidenceSummary: "two providers expose 91.000 SIM" },
    { game: "terracore", action: "claim-raid-exposed-scrap", benefitClass: "treasury-protection", admittedNow: true,
      refusal: null, rcDecision: "ready", evidence: "true", evidenceSummary: "official game state exposes 6.25000000 raid-exposed SCRAP" },
    { game: "holozing-rewards", action: "claim-pending-zing", benefitClass: "productive-state", admittedNow: true,
      refusal: null, rcDecision: "not-required", evidence: "true", evidenceSummary: "pending ZING is claimable" },
  ];
  return { schema: "aagaard.game-opportunity-plan.v1", observedAt, ranked,
    observations: {
      dcity: { before: { simBalance: "91.000", pending: undefined },
        plan: { kind: "ready", quote: { minimumSwapHive: "0.04000000", optionalFee: undefined } } },
      holozingRewards: { plan: { kind: "ready", minimumClaimZing: "2.500" } },
      terracore: { plan: { kind: "claim", amount: "6.25000000" } },
      unavailable: [{ game: "splinterlands", error: "maintenance" }],
    }, credentialAccess: false, chainMutation: false };
}

const providers = { globalArbitrage, poolCycle, games };

test("unifies exact read-only opportunities while retaining incomparable classes and all gates", async () => {
  let recorded;
  const writer = async (input) => { recorded = input; return { id: "journal-record" }; };
  const { feed, journal } = await observeOpportunityFeed({ now: () => observedAt,
    providers: { globalArbitrage, poolCycle, games }, writer, env: {} });
  assert.equal(journal.id, "journal-record");
  assert.equal(recorded.category, OPPORTUNITY_FEED_CATEGORY);
  assert.strictEqual(recorded.record, feed);
  assert.deepEqual(feed.authority, { credentialAccess: false, chainMutation: false, signing: false, broadcasting: false, execution: false });
  assert.equal(feed.ordering.noScalarization, true);
  const arb = feed.candidates.find((candidate) => candidate.source === "global-arbitrage-scan");
  assert.equal(arb.worstCaseProfitSwapHive, "0.01200000");
  assert.equal(arb.resourceCost.status, "unpriced-resource-cost-model");
  assert.deepEqual(arb.providers, ["provider-a", "provider-b"]);
  assert.equal(feed.refusals.some((item) => item.source === "exact-pool-cycle-assay"), true);
  assert.equal(feed.refusals.some((item) => item.identity === "SWAP.HIVE:SPS"), true);
  assert.equal(feed.unknowns.some((item) => item.provider === "provider-c"), true);
  assert.equal(feed.unknowns.some((item) => item.provider === "pool-provider-c"), true);
  assert.equal(feed.unknowns.some((item) => item.provider === "splinterlands"), true);
  assert.equal(feed.unknowns.some((item) => item.provider === "terracore-exit"), true);
  assert.equal(feed.candidates.find((item) => item.identity === "dcity:recover-closed-sim").plan.quote.minimumSwapHive, "0.04000000");
  assert.equal(feed.candidates.find((item) => item.identity === "holozing-rewards:claim-pending-zing").plan.minimumClaimZing, "2.500");
  assert.equal(feed.candidates.find((item) => item.identity === "terracore:claim-raid-exposed-scrap").plan.amount, "6.25000000");
  assert.equal(Object.isFrozen(feed), true);
  assert.equal(Object.isFrozen(arb.sourceCandidate.exact.quote), true);
  assert.equal(Object.hasOwn(arb.sourceCandidate.exact.quote, "optionalFee"), false);
});

test("a supplied resourceCost provider prices global candidates instead of the static unpriced placeholder", async () => {
  const priced = { status: "priced", total: "0.00300000", credentialAccess: false, chainMutation: false,
    components: [
      { name: "Hive RC", amount: "0.00200000", unit: "SWAP.HIVE", witness: {} },
      { name: "signer", amount: "0.00050000", unit: "SWAP.HIVE", witness: {} },
      { name: "runner/paymaster", amount: "0.00050000", unit: "SWAP.HIVE", witness: {} },
    ] };
  const { feed } = await observeOpportunityFeed({ now: () => observedAt,
    providers: { ...providers, resourceCost: async () => priced }, writer: async () => ({ id: "journal-record" }), env: {} });
  const arb = feed.candidates.find((candidate) => candidate.source === "global-arbitrage-scan");
  assert.equal(arb.resourceCost.status, "priced");
  assert.equal(arb.resourceCost.total, "0.00300000");
  assert.equal(feed.evidence.resourceCost.value.total, "0.00300000");
});

test("JSON projection rejects non-JSON provider values with bounded paths", () => {
  const sparse = [];
  sparse.length = 1;
  for (const [value, reason] of [
    [{ nested: { amount: 1n } }, "bigint"],
    [{ nested: { amount: Number.NaN } }, "finite"],
    [{ nested: { amount: new Date(observedAt) } }, "non-plain object"],
    [{ nested: [undefined] }, "undefined array entry"],
    [{ nested: sparse }, "array hole"],
    [{ nested: Symbol("amount") }, "symbol"],
    [{ nested: () => 1 }, "function"],
  ]) {
    assert.throws(() => projectOpportunityFeedJsonValue(value), (error) => {
      assert.match(error.message, /^Aagaard opportunity-feed JSON value refused at \$\["nested"\](?:\["amount"\]|\[0\])?:/);
      assert.match(error.message, new RegExp(reason));
      assert.ok(error.message.length <= 500);
      return true;
    });
  }
});

test("turns thrown and over-authorized providers into visible unknowns without losing the feed", async () => {
  const { feed } = await observeOpportunityFeed({ now: () => observedAt, writer: async () => ({ id: "recorded" }), env: {}, providers: {
    globalArbitrage: async () => { throw new Error("offline"); },
    poolCycle: async () => ({ credentialAccess: true, chainMutation: false }),
    games,
  } });
  assert.equal(feed.unknowns.some((item) => item.source === "global-arbitrage-scan" && item.problem === "offline"), true);
  assert.equal(feed.unknowns.some((item) => item.source === "exact-pool-cycle-assay" && /did not prove/.test(item.problem)), true);
  assert.equal(feed.candidates.some((item) => item.identity === "terracore:claim-raid-exposed-scrap"), true);
});

test("keeps an explicit remote WitnessJournal provider unchanged", async () => {
  const env = Object.freeze({ WITNESS_JOURNAL_RDF_AGENT: "https://journal.example.test/.well-known/agent-card.json" });
  let started = false;
  let received;
  const result = await observe({ env, providers,
    startFilesystemProvider: async () => { started = true; throw new Error("must not start"); },
    observeFeed: async (options) => { received = options; return "remote-result"; } });
  assert.equal(result, "remote-result");
  assert.equal(started, false);
  assert.strictEqual(received.env, env);
  assert.strictEqual(received.providers, providers);
});

test("persists a local opportunity feed across filesystem-provider restart and query", async () => {
  const root = await mkdtemp(join(tmpdir(), "aagaard-witness-journal-"));
  try {
    const result = await observe({ env: { AAGAARD_WITNESS_JOURNAL_ROOT: root }, providers, now: () => observedAt });
    assert.equal(result.feed.authority.credentialAccess, false);
    assert.equal(result.feed.authority.chainMutation, false);

    const restarted = await startFilesystemWitnessJournalProviderProcess({ root, host: "127.0.0.1", port: 0 });
    try {
      await awaitFilesystemWitnessJournalProvider(restarted.agentCardUrl);
      const records = await querySettlementRecords(OPPORTUNITY_FEED_CATEGORY, { agentUrl: restarted.agentCardUrl });
      assert.equal(records.length, 1);
      assert.deepEqual(records[0], result.feed);
      assert.equal(Object.hasOwn(records[0].evidence.globalArbitrage.value.opportunities[0].exact.quote, "optionalFee"), false);
      assert.equal(Object.hasOwn(records[0].evidence.games.value.observations.dcity.before, "pending"), false);
    } finally {
      await restarted.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to run without a remote agent or explicit local root", async () => {
  await assert.rejects(observe({ env: {}, providers }), /WITNESS_JOURNAL_RDF_AGENT or AAGAARD_WITNESS_JOURNAL_ROOT/);
});

test("closes the local provider after operation success and failure", async () => {
  for (const failure of [null, new Error("operation failed")]) {
    let closes = 0;
    let receivedEnv;
    const startFilesystemProvider = async (options) => {
      assert.deepEqual(options, { root: "/explicit/journal", host: "127.0.0.1", port: 0 });
      return { agentCardUrl: "http://127.0.0.1:49152/.well-known/agent-card.json",
        close: async () => { closes += 1; } };
    };
    const observeFeed = async ({ env }) => {
      receivedEnv = env;
      if (failure) throw failure;
      return "local-result";
    };
    const operation = observe({
      env: { AAGAARD_WITNESS_JOURNAL_ROOT: "/explicit/journal", HIVE_ACTIVE_KEY: "must-not-pass" },
      providers,
      startFilesystemProvider,
      readyFilesystemProvider: async () => {},
      observeFeed,
    });
    if (failure) await assert.rejects(operation, failure);
    else assert.equal(await operation, "local-result");
    assert.deepEqual(receivedEnv, { WITNESS_JOURNAL_RDF_AGENT: "http://127.0.0.1:49152/.well-known/agent-card.json" });
    assert.equal(closes, 1);
  }
});
