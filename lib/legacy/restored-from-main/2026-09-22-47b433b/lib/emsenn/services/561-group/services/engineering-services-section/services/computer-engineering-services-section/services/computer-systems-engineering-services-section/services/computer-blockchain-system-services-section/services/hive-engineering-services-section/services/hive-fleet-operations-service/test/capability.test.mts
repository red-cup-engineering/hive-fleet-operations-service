import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";


import { HONEY_SWAP_ACCOUNT, WRAP_MEMO } from "../src/integrations/hive-engine/hiveEngineOps.mjs";

import {
  DEFAULT_POSTS,
  aagaardParityReport,
  capabilityReport,
  createAagaardRuntime,
  createHiveBroadcastCommand,
  createHiveClient,
  createHiveEngineClient,
  createOperatorAuth,
  dispositionIncentiveNomination,
  ensureStore,
  enterpriseTradingPlanDigest,
  executeTrading,
  fleetWitnessDigest,
  isLocked,
  listIncentiveNominations,
  loadAagaardConfig,
  mergeWalletState,
  planGaming,
  planIncentives,
  planTrades,
  planVotes,
  readAlphaRadar,
  readLockedDrafts,
  readSubstrateSnapshots,
  postCandidateFromHive,
  type HiveWriteBoundary,
  type EnterpriseTradingAuthorization,
  type TradingPlan,
  type WalletActor,
  type WalletChainState,
} from "../src/index.mts";

function sigmundAuthorization(plan: TradingPlan, nowMs = Date.now()): EnterpriseTradingAuthorization {
  return Object.freeze({
    kind: "agrodao.hive-enterprise-execution-authorization.v1",
    issuer: "urn:ame:sigmund-hive-arbitrage-enterprise",
    consumer: "urn:ame:aagaard",
    account: "sigmund-vexler",
    lane: "arbitrage",
    actions: Object.freeze(["trade" as const, "trade-bundle" as const]),
    decisionId: `sha256:${"c".repeat(64)}`,
    observationId: "ni:///sha-256;test-fleet-observation",
    planDigest: enterpriseTradingPlanDigest(plan),
    validFrom: new Date(nowMs - 1_000).toISOString(),
    expiresAt: new Date(nowMs + 4 * 60_000).toISOString(),
  });
}

test("trading admission cannot raise the independent curation vote ceiling", () => {
  const config = loadAagaardConfig();
  const trader = config.wallets.find((wallet) => wallet.account === "sigmund-vexler");
  assert.equal(trader?.tradingLive, true);
  assert.equal(trader?.risk.maxVoteWeightBps, 5000);
  assert.ok(config.wallets.every((wallet) => wallet.risk.maxVoteWeightBps >= 100 && wallet.risk.maxVoteWeightBps <= 5000));

  const root = mkdtempSync(path.join(tmpdir(), "aagaard-vote-risk-"));
  const configPath = path.join(root, "aagaard.config.json");
  try {
    writeFileSync(configPath, JSON.stringify({ accounts: [
      { account: "over-cap", tradingLive: true, maxVoteWeightBps: 10_000 },
      { account: "under-floor", maxVoteWeightBps: -1 },
    ] }));
    const adversarial = loadAagaardConfig({ configPath });
    assert.equal(adversarial.wallets.find((wallet) => wallet.account === "over-cap")?.risk.maxVoteWeightBps, 5000);
    assert.equal(adversarial.wallets.find((wallet) => wallet.account === "under-floor")?.risk.maxVoteWeightBps, 100);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function roundTripMarket(tokens: Readonly<Record<string, string>> = { "SWAP.HIVE": "1.00000000" }, observedAt = new Date().toISOString()) {
  return Object.freeze({
    observedAt,
    tokens,
    venues: Object.freeze([Object.freeze({
      venue: "hive-engine",
      pair: "DEC/SWAP.HIVE",
      midpoint: 0.00125,
      bestBid: 0.0012,
      bestAsk: 0.0013,
      bestBidQuantity: 10_000,
      bestAskQuantity: 10_000,
      bidDepth: 10_000,
      askDepth: 10_000,
      relativeSpreadBps: 800,
      imbalance: 0,
      thin: false,
      exactBook: Object.freeze({
        observedAt,
        bids: Object.freeze([{ priceSwapHivePerToken: "0.00120000", quantity: "10000.000" }]),
        asks: Object.freeze([{ priceSwapHivePerToken: "0.00130000", quantity: "10000.000" }]),
        bidComplete: true,
        askComplete: true,
        bidOrdered: true,
        askOrdered: true,
      }),
    })]),
    pools: Object.freeze([Object.freeze({
      pair: "DEC:SWAP.HIVE",
      impliedPrice: 0.001,
      baseQuantity: 1_000_000,
      quoteQuantity: 1_000,
      baseQuantityExact: "1000000.000",
      quoteQuantityExact: "1000.00000000",
      tvlQuote: 2_000,
      feeBps: 0,
    })]),
    precision: Object.freeze({ DEC: 3, "SWAP.HIVE": 8 }),
  });
}

function reverseRoundTripMarket(tokens: Readonly<Record<string, string>> = { "SWAP.HIVE": "1.00000000" }) {
  const observedAt = new Date().toISOString();
  return Object.freeze({
    observedAt,
    tokens,
    venues: Object.freeze([Object.freeze({
      venue: "hive-engine",
      pair: "DEC/SWAP.HIVE",
      midpoint: 0.000825,
      bestBid: 0.0008,
      bestAsk: 0.00085,
      bestBidQuantity: 10_000,
      bestAskQuantity: 10_000,
      bidDepth: 10_000,
      askDepth: 10_000,
      relativeSpreadBps: 606,
      imbalance: 0,
      thin: false,
      exactBook: Object.freeze({
        observedAt,
        bids: Object.freeze([{ priceSwapHivePerToken: "0.00080000", quantity: "10000.000" }]),
        asks: Object.freeze([{ priceSwapHivePerToken: "0.00085000", quantity: "10000.000" }]),
        bidComplete: true,
        askComplete: true,
        bidOrdered: true,
        askOrdered: true,
      }),
    })]),
    pools: Object.freeze([Object.freeze({
      pair: "DEC:SWAP.HIVE",
      impliedPrice: 0.0012,
      baseQuantity: 1_000_000,
      quoteQuantity: 1_200,
      baseQuantityExact: "1000000.000",
      quoteQuantityExact: "1200.00000000",
      tvlQuote: 2_400,
      feeBps: 0,
    })]),
    precision: Object.freeze({ DEC: 3, "SWAP.HIVE": 8 }),
  });
}

function emptyFleetOrderScan(accounts: readonly string[], observedAt = new Date().toISOString()) {
  const normalized = Object.freeze([...new Set(accounts.map((account) => account.toLowerCase()))].sort());
  return Object.freeze({
    kind: "aagaard.maker-order-scan" as const,
    observedAt,
    source: "hive-engine.market.buyBook+sellBook" as const,
    accountsRequested: normalized,
    accountsObserved: normalized,
    complete: true,
    orders: Object.freeze([]),
    limitations: Object.freeze([]),
  });
}

function roundTripState(wallet: WalletActor): WalletChainState {
  return Object.freeze({
    account: wallet.account,
    hive: "1.000 HIVE",
    hbd: "1.000 HBD",
    currentMana: "9000",
    maxMana: "10000",
    tokens: Object.freeze({ "SWAP.HIVE": "1.00000000" }),
  });
}

/** An execution-boundary assay carries only the wallet whose evidence and
 * keys it proves. Fleet throughput belongs to separate runtime tests. */
function exactWalletConfig(config: ReturnType<typeof loadAagaardConfig>, account: string) {
  const wallet = config.wallets.find((entry) => entry.account === account);
  assert.ok(wallet, `${account} must exist in the configured fleet`);
  return Object.freeze({ ...config, wallets: Object.freeze([wallet]) });
}

test("replacement exposes the older Aagaard lane capabilities as wallet arenas", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-"));
  try {
    const config = loadAagaardConfig();
    const runtime = createAagaardRuntime(config, ensureStore(root));
    const readout = await runtime.runTick("2026-07-08T00:00:00.000Z");
    assert.equal(readout.accounts.length, 6);
    assert.ok(readout.witness.rows >= readout.accounts.length * 3);
    for (const account of readout.accounts) {
      const arenaNames = new Set(account.arenas.map((arena) => arena.name));
      assert.ok(arenaNames.has("voting"));
      assert.ok(arenaNames.has("trading"));
      assert.ok(arenaNames.has("incentive"));
      assert.ok(arenaNames.has("posting"));
      assert.ok(arenaNames.has("gaming"));
      assert.equal(account.posting.locked, true);
      assert.equal(account.gaming.locked, true);
    }
    assert.match(fleetWitnessDigest(readout), /aagaard\.fleet-tick/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("posting and gaming stay source-locked while voting/trading/incentive are runtime-gated", () => {
  const config = loadAagaardConfig();
  const runtime = createAagaardRuntime(config, ensureStore(mkdtempSync(path.join(tmpdir(), "aagaard-"))));
  const report = capabilityReport(config, runtime.control);
  assert.equal(isLocked("posting"), true);
  assert.equal(isLocked("gaming"), true);
  assert.equal(report.find((entry) => entry.capability === "posting")?.enabled, false);
  assert.equal(report.find((entry) => entry.capability === "gaming")?.enabled, false);
  assert.equal(runtime.control.enable("posting"), false);
});

test("parity report separates older route coverage from live write readiness", () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-parity-"));
  try {
    const keyRoot = path.join(root, "keys");
    const config = loadAagaardConfig({ env: { ...process.env, AAGAARD_KEY_ROOT: keyRoot } });
    const runtime = createAagaardRuntime(config, ensureStore(path.join(root, "store")));
    const report = aagaardParityReport(config, runtime.control);
    assert.equal(report.kind, "aagaard.parity-report");
    assert.equal(report.olderApplication, "lib/emsenn/lib/triage/sites/aagaard.561.group");
    assert.equal(report.routes.every((claim) => claim.status !== "open"), true);
    assert.equal(report.capabilities.find((claim) => claim.claim === "wallets are actors playing games in arenas")?.status, "exceeded");
    assert.equal(report.capabilities.find((claim) => claim.claim === "Hive live write boundary")?.status, "open");
    assert.equal(report.complete, false);
    assert.ok(report.open.includes("fleet is disarmed"));
    assert.ok(report.open.includes("AAGAARD_BROADCAST_COMMAND is not configured"));
    assert.ok(report.open.includes("no posting key found under keyRoot"));
    assert.ok(report.open.includes("no active key found under keyRoot"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wallet plans cover alpha, trading liquidity, incentives, and locked game detection", () => {
  const config = loadAagaardConfig();
  const wallet = config.wallets.find((entry) => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const radar = readAlphaRadar();
  assert.ok(radar.sinks.length > 0);
  const voting = planVotes(wallet);
  assert.equal(voting.arena.name, "voting");
  assert.ok(voting.intelligence.posts.length > 0);
  const trading = planTrades(wallet);
  assert.equal(trading.liveEligible, true);
  assert.ok(trading.liquidity.corridors.length > 0);
  const incentives = planIncentives(wallet);
  assert.ok(incentives.offers.length > 0);
  const noCustodyEvidence = planGaming(wallet);
  assert.equal(noCustodyEvidence.games.length, 0);
  const games = planGaming(wallet, "2026-07-22T08:00:00.000Z", Object.freeze({
    account: wallet.account,
    hive: "0.000 HIVE",
    hbd: "0.000 HBD",
    currentMana: "0",
    maxMana: "0",
    tokens: Object.freeze({ DEC: "12.5", SPS: "3.2" }),
  }));
  assert.equal(games.arena.locked, true);
  assert.ok(games.games.some((game) => game.game === "Splinterlands"));
});

test("Rising Star detection requires observed custody and remains manual-only", () => {
  const config = loadAagaardConfig();
  const wallet = config.wallets.find((entry) => entry.account === "essiebee");
  assert.ok(wallet);
  assert.equal(wallet.tokens["STARBITS"], undefined);
  assert.equal(planGaming(wallet).games.length, 0);
  const observed = planGaming(wallet, "2026-07-22T08:00:00.000Z", Object.freeze({
    account: wallet.account,
    hive: "0.000 HIVE",
    hbd: "0.000 HBD",
    currentMana: "0",
    maxMana: "0",
    tokens: Object.freeze({ STARBITS: "1.00000000" }),
  }));
  assert.deepEqual(observed.games, [Object.freeze({
    game: "Rising Star",
    heldTokens: Object.freeze([Object.freeze({ symbol: "STARBITS", balance: "1.00000000" })]),
    customJsonId: "server-session-no-custom-json",
    proposedMove: "manual-only inventory/recovery review while current terms prohibit bots and multiple accounts",
    approvedForBroadcast: false,
  })]);
});

test("curation planning refuses posts the wallet has already voted", () => {
  const config = loadAagaardConfig();
  const wallet = config.wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const posts = DEFAULT_POSTS.map((post) => Object.freeze({
    ...post,
    votes: Object.freeze([...post.votes, Object.freeze({ voter: wallet.account, rshares: 1, time: post.created, percent: 100 })]),
  }));
  const plan = planVotes(wallet, posts);
  assert.equal(plan.votes.length, 0);
  assert.ok(plan.strategyArm.candidates.every((candidate) => candidate.refusals.includes("already-voted")));
});

test("Hive adapter maps ranked posts and regenerated account mana into the arena substrate", async () => {
  const now = Math.floor(Date.now() / 1000);
  const calls: readonly unknown[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    (calls as unknown[]).push(payload);
    const result = payload.method === "condenser_api.get_accounts"
      ? [{
          name: "sigmund-vexler",
          balance: "1.234 HIVE",
          hbd_balance: "5.678 HBD",
          voting_power: 1,
          vesting_shares: "100.000000 VESTS",
          delegated_vesting_shares: "10.000000 VESTS",
          received_vesting_shares: "25.000000 VESTS",
          voting_manabar: { current_mana: "57500000", last_update_time: now - 216_000 },
        }]
      : [{
          author: "chain-author",
          permlink: "chain-post",
          title: "Chain post",
          body: "Reblog and comment to earn 2 PIZZA.",
          category: "dev",
          json_metadata: JSON.stringify({ tags: ["dev", "hive-167922"] }),
          pending_payout_value: "0.100 HBD",
          net_rshares: "10000",
          children: 3,
          created: "2026-07-08T00:00:00",
          active_votes: [{ voter: "reader", rshares: "10000" }],
        }];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const config = loadAagaardConfig();
  const wallet = config.wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const hive = createHiveClient({ nodes: ["https://example.invalid"], timeoutMs: 1000, perSourceLimit: 1, fetch: fetchImpl });
  const [posts, state] = await Promise.all([hive.readCandidateField(wallet), hive.readWalletState(wallet)]);
  assert.equal(posts[0]?.author, "chain-author");
  assert.equal(posts[0]?.votes[0]?.voter, "reader");
  assert.equal(state?.hive, "1.234 HIVE");
  assert.equal(state?.currentMana, "115000000");
  assert.equal(state?.maxMana, "115000000");
  assert.ok(calls.length >= 2);
});

test("Hive post mapper tolerates missing optional chain fields", () => {
  const post = postCandidateFromHive({ author: "a", permlink: "p", json_metadata: "{bad" });
  assert.equal(post?.author, "a");
  assert.deepEqual(post?.tags, []);
});

test("Hive internal-market reader preserves executable bid quantities in absolute units", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;
    const payload = JSON.parse(String(init?.body)) as { method: string };
    const result = payload.method === "condenser_api.get_ticker"
      ? { latest: "0.050000", highest_bid: "0.050000", lowest_ask: "0.051000" }
      : {
          bids: [
            { real_price: "0.050000", hive: 20_000, hbd: 1_000 },
            { real_price: "0.049000", hive: 10_000, hbd: 490 },
          ],
          asks: [{ real_price: "0.051000", hive: 30_000, hbd: 1_530 }],
        };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const hive = createHiveClient({ nodes: ["https://example.invalid"], timeoutMs: 1000, perSourceLimit: 1, fetch: fetchImpl });
  const reading = await hive.readInternalMarket?.();
  assert.equal(reading?.bestBid, 0.05);
  assert.equal(reading?.bestBidQuantityHive, 20);
  assert.equal(reading?.bidDepth, 1.49);
  assert.equal(reading?.asks?.[0]?.hiveQuantity, 30);
  assert.equal((await hive.readInternalMarket?.())?.bestBid, 0.05);
  assert.equal(calls, 2);
});

test("round-trip planner funds a whole bounded bundle and emits no independently executable legs", () => {
  const wallet = loadAagaardConfig().wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const plan = planTrades(wallet, "2026-07-08T00:00:00.000Z", roundTripState(wallet), roundTripMarket());
  const funded = plan.bundles.filter((bundle) => bundle.funded);
  assert.equal(funded.length, 1);
  assert.equal(plan.trades.length, 0);
  assert.equal(plan.allocation.fundedCount, 1);
  assert.equal(plan.allocationUnit, "SWAP.HIVE");
  assert.equal(plan.allocation.totalCost, funded[0]?.capitalSwapHive);
  assert.equal(plan.allocation.totalBenefit, Number(funded[0]?.worstCaseProfitSwapHive));
  assert.equal(Number(funded[0]?.quantity) > 0, true);
  assert.equal(Number(funded[0]?.expectedInputSwapHive) <= Number(funded[0]?.maxInputSwapHive), true);
  assert.equal(Number(funded[0]?.maxInputSwapHive) <= 1, true);
  assert.equal(Number(funded[0]?.minimumProceedsSwapHive) > Number(funded[0]?.maxInputSwapHive), true);
  assert.equal(Number(funded[0]?.worstCaseProfitSwapHive) > 0, true);

  const reverse = planTrades(wallet, "2026-07-08T00:00:00.000Z", roundTripState(wallet), reverseRoundTripMarket());
  assert.equal(reverse.bundles.some((bundle) => bundle.funded), false);
  assert.ok(reverse.bundles.some((bundle) => bundle.refusalReason?.includes("cannot condition the pool exit")));
});

test("round-trip planner refuses the entire opportunity when admitted input capital is absent", async () => {
  const wallet = loadAagaardConfig().wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const state = Object.freeze({ ...roundTripState(wallet), tokens: Object.freeze({}) });
  const plan = planTrades(wallet, "2026-07-08T00:00:00.000Z", state, roundTripMarket({}));
  assert.equal(plan.bundles.some((bundle) => bundle.funded), false);
  assert.equal(plan.bundles.some((bundle) => bundle.refusalReason === "no admitted SWAP.HIVE capital balance"), true);
  let calls = 0;
  const execution = await executeTrading(wallet, plan, true, { posting: true, active: true }, {
    async vote() { return { id: "unused" }; },
    async tradeBundle() { calls += 1; return { id: "must-not-run" }; },
  });
  assert.equal(calls, 0);
  assert.equal(execution.bundlesExecuted, 0);
  assert.ok(execution.receipts.every((entry) => entry.status === "skipped"));
});

test("Hive broadcast command adapter emits operation payloads and returns transaction ids", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-broadcast-"));
  try {
    const log = path.join(root, "requests.json");
    const script = path.join(root, "broadcast.mjs");
    writeFileSync(script, [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  const prior = existsSync(process.argv[2]) ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : [];",
      "  writeFileSync(process.argv[2], JSON.stringify([...prior, payload]));",
      "  process.stdout.write(JSON.stringify({ id: `tx:${payload.account}:${payload.operation[0]}`, economicEffect: { status: 'confirmed', source: 'fixture', confirmedLegs: 2, expectedLegs: 2, realizedInputSwapHive: 1, realizedProceedsSwapHive: 1.1, realizedPnlSwapHive: 0.1 } }));",
      "});",
    ].join("\n"));
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const keyRoot = path.join(root, "keys");
    const writer = createHiveBroadcastCommand({ command: `${process.execPath} ${script} ${log}`, keyRoot, timeoutMs: 5000 });
    const vote = planVotes(wallet).votes[0];
    assert.ok(vote);
    const voteResult = await writer.vote(wallet, vote);
    assert.equal(voteResult.id, `tx:${wallet.account}:vote`);
    const market = roundTripMarket();
    const bundle = planTrades(wallet, undefined, roundTripState(wallet), market).bundles.find((entry) => entry.executable);
    assert.ok(bundle?.funded);
    const tradeResult = await writer.tradeBundle?.(wallet, bundle);
    assert.equal(tradeResult?.id, `tx:${wallet.account}:custom_json`);
    assert.equal(tradeResult?.economicEffect?.status, "confirmed");
    assert.equal(tradeResult?.economicEffect?.realizedPnlSwapHive, 0.1);
    const requests = JSON.parse(readFileSync(log, "utf8")) as readonly { operation: [string, Record<string, unknown>]; role: string; lane: string; keyFile?: string }[];
    assert.deepEqual(requests.map((entry) => entry.operation[0]), ["vote", "custom_json"]);
    const tradeJson = JSON.parse(String(requests[1]?.operation[1]?.["json"])) as readonly { contractName: string; contractAction: string; contractPayload: Record<string, unknown> }[];
    assert.deepEqual(tradeJson.map((call) => `${call.contractName}.${call.contractAction}`), ["marketpools.swapTokens", "market.sell"]);
    assert.equal(tradeJson[0]?.contractPayload["tokenAmount"], tradeJson[1]?.contractPayload["quantity"]);
    assert.equal(tradeJson[0]?.contractPayload["tradeType"], "exactOutput");
    assert.equal(requests[0]?.role, "posting");
    assert.equal(requests[1]?.role, "active");
    assert.equal(requests[0]?.keyFile, path.join(keyRoot, wallet.account, "posting.wif"));
    assert.equal(requests[1]?.keyFile, path.join(keyRoot, wallet.account, "active.wif"));
    assert.equal(requests[0]?.operation[1]["voter"], wallet.account);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The wrap-deposit path moves real HIVE to an external account (honey-swap,
// the live hivepegged peg custodian -- see hiveEngineOps.mjs's own
// verification comment). This test runs the REAL scripts/hive-broadcast.mjs
// as a subprocess (not a mock) and checks its validation gate directly,
// without ever reaching a real network broadcast: every case here fails
// validation before the script would construct a Waggle client, except the
// well-formed case, which is deliberately given a nonexistent keyFile so it
// fails one step later ("cannot read key file") -- proving transfer
// validation itself passed without ever attempting a real broadcast.
test("hive-broadcast script refuses every transfer except a well-formed wrap-deposit to honey-swap", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const run = (operation: readonly [string, Record<string, unknown>]): Promise<{ readonly code: number | null; readonly stderr: string }> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify({ account: "test-account", role: "active", keyFile: "/nonexistent/key.wif", operation }));
  });

  const wrongAccount = await run(["transfer", { from: "test-account", to: "some-random-account", amount: "1.000 HIVE", memo: WRAP_MEMO }]);
  assert.equal(wrongAccount.code, 1);
  assert.ok(wrongAccount.stderr.includes("refusing transfer to"));

  const wrongMemo = await run(["transfer", { from: "test-account", to: HONEY_SWAP_ACCOUNT, amount: "1.000 HIVE", memo: "not the real memo" }]);
  assert.equal(wrongMemo.code, 1);
  assert.ok(wrongMemo.stderr.includes("memo does not exactly match"));

  const malformedAmount = await run(["transfer", { from: "test-account", to: HONEY_SWAP_ACCOUNT, amount: "1 HIVE", memo: WRAP_MEMO }]);
  assert.equal(malformedAmount.code, 1);
  assert.ok(malformedAmount.stderr.includes("not a well-formed"));

  const wellFormed = await run(["transfer", { from: "test-account", to: HONEY_SWAP_ACCOUNT, amount: "1.234 HIVE", memo: WRAP_MEMO }]);
  assert.equal(wellFormed.code, 1);
  assert.ok(wellFormed.stderr.includes("cannot read key file"), `expected to fail past transfer validation and hit the keyFile read, got: ${wellFormed.stderr}`);
});

test("hive-broadcast admits only a size-consistent pool-buy/order-book-exit batch", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const run = (calls: readonly Record<string, unknown>[]): Promise<{ readonly code: number | null; readonly stderr: string }> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify({
      account: "test-account",
      role: "active",
      keyFile: "/nonexistent/key.wif",
      operation: ["custom_json", {
        id: "ssc-mainnet-hive",
        required_auths: ["test-account"],
        required_posting_auths: [],
        json: JSON.stringify(calls),
      }],
    }));
  });
  const swap = { contractName: "marketpools", contractAction: "swapTokens", contractPayload: { tokenPair: "DEC:SWAP.HIVE", tokenSymbol: "DEC", tokenAmount: "10.000", tradeType: "exactOutput", maxAmountIn: "0.01100000" } };
  const sell = { contractName: "market", contractAction: "sell", contractPayload: { symbol: "DEC", quantity: "10.000", price: "0.00120000", expiration: 300 } };

  const valid = await run([swap, sell]);
  assert.equal(valid.code, 1);
  assert.ok(valid.stderr.includes("cannot read key file"), valid.stderr);

  const mismatched = await run([swap, { ...sell, contractPayload: { ...sell.contractPayload, quantity: "9.000" } }]);
  assert.equal(mismatched.code, 1);
  assert.ok(mismatched.stderr.includes("exact same symbol and quantity"));

  const reversed = await run([sell, swap]);
  assert.equal(reversed.code, 1);
  assert.ok(reversed.stderr.includes("exactly pool exact-output swap -> limit sell"));

  const buy = { contractName: "market", contractAction: "buy", contractPayload: { symbol: "DEC", quantity: "10.000", price: "0.00100000", expiration: 300 } };
  const poolExit = { contractName: "marketpools", contractAction: "swapTokens", contractPayload: { tokenPair: "DEC:SWAP.HIVE", tokenSymbol: "DEC", tokenAmount: "10.000", tradeType: "exactInput", minAmountOut: "0.01100000" } };
  const validReverse = await run([buy, poolExit]);
  assert.equal(validReverse.code, 1);
  assert.ok(validReverse.stderr.includes("exactly pool exact-output swap -> limit sell"), validReverse.stderr);
});

test("hive-broadcast admits only an exact posting-authorized TerraCore claim", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const run = (payload: Record<string, unknown>): Promise<{ readonly code: number | null; readonly stderr: string }> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
  const operation = ["custom_json", {
    id: "terracore_claim",
    required_auths: [],
    required_posting_auths: ["michael561"],
    json: '{"amount":"68.88013281"}',
  }];
  const valid = await run({ account: "michael561", role: "posting", keyFile: "/nonexistent/posting.wif", operation });
  assert.equal(valid.code, 1);
  assert.ok(valid.stderr.includes("cannot read key file"), valid.stderr);

  const active = await run({ account: "michael561", role: "active", keyFile: "/nonexistent/active.wif", operation });
  assert.ok(active.stderr.includes("posting authority"), active.stderr);

  const rounded = structuredClone(operation);
  (rounded[1] as Record<string, unknown>)["json"] = '{"amount":"68.8801328"}';
  const malformed = await run({ account: "michael561", role: "posting", keyFile: "/nonexistent/posting.wif", operation: rounded });
  assert.ok(malformed.stderr.includes("positive 8-decimal amount"), malformed.stderr);

  const battle = structuredClone(operation);
  (battle[1] as Record<string, unknown>)["id"] = "terracore_battle";
  (battle[1] as Record<string, unknown>)["json"] = '{"target":"some-player"}';
  const admittedBattle = await run({ account: "michael561", role: "posting", lane: "gaming", target: "terracore-one-action", keyFile: "/nonexistent/posting.wif", operation: battle });
  assert.equal(admittedBattle.code, 1);
  assert.ok(admittedBattle.stderr.includes("cannot read key file"), admittedBattle.stderr);

  const unboundedBattle = await run({ account: "michael561", role: "posting", keyFile: "/nonexistent/posting.wif", operation: battle });
  assert.ok(unboundedBattle.stderr.includes("one-action gaming lane"), unboundedBattle.stderr);

  const selfBattle = structuredClone(battle);
  (selfBattle[1] as Record<string, unknown>)["json"] = '{"target":"michael561"}';
  const refusedSelf = await run({ account: "michael561", role: "posting", lane: "gaming", target: "terracore-one-action", keyFile: "/nonexistent/posting.wif", operation: selfBattle });
  assert.ok(refusedSelf.stderr.includes("non-self target"), refusedSelf.stderr);
});

test("hive-broadcast admits only an exact TerraCore engineering SCRAP burn lane", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const run = (payload: Record<string, unknown>): Promise<{ readonly code: number | null; readonly stderr: string }> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
  const operation = ["custom_json", {
    id: "ssc-mainnet-hive",
    required_auths: ["michael561"],
    required_posting_auths: [],
    json: JSON.stringify({
      contractName: "tokens",
      contractAction: "transfer",
      contractPayload: { symbol: "SCRAP", to: "null", quantity: "196.00000000", memo: "terracore_engineering-0123456789abcdef" },
    }),
  }];
  const valid = await run({ account: "michael561", role: "active", lane: "gaming", target: "terracore-engineering-upgrade", keyFile: "/nonexistent/active.wif", operation });
  assert.equal(valid.code, 1);
  assert.ok(valid.stderr.includes("cannot read key file"), valid.stderr);

  const wrongStat = structuredClone(operation);
  const wrongFields = wrongStat[1] as unknown as Record<string, unknown>;
  const wrongDecoded = JSON.parse(String(wrongFields["json"] ?? "{}")) as { contractPayload: { memo: string } };
  wrongDecoded.contractPayload.memo = "terracore_damage-0123456789abcdef";
  wrongFields["json"] = JSON.stringify(wrongDecoded);
  const refusedStat = await run({ account: "michael561", role: "active", lane: "gaming", target: "terracore-engineering-upgrade", keyFile: "/nonexistent/active.wif", operation: wrongStat });
  assert.ok(refusedStat.stderr.includes("engineering upgrade"), refusedStat.stderr);

  const wrongLane = await run({ account: "michael561", role: "active", lane: "gaming", target: "some-other-burn", keyFile: "/nonexistent/active.wif", operation });
  assert.ok(wrongLane.stderr.includes("refusing contract call"), wrongLane.stderr);
});

test("Hive-Engine adapter maps balances, books, and pools into market state", async () => {
  const bookIndexes: { readonly table: string; readonly indexes: unknown }[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { params: { contract: string; table: string; query: Record<string, unknown>; indexes?: unknown } };
    const { contract, table, query } = payload.params;
    if (contract === "market" && (table === "buyBook" || table === "sellBook")) bookIndexes.push({ table, indexes: payload.params.indexes });
    let result: unknown[] = [];
    if (contract === "tokens" && table === "balances") {
      result = [
        { account: query["account"], symbol: "DEC", balance: "12.5" },
        { account: query["account"], symbol: "BUDS", balance: "0" },
      ];
    } else if (contract === "market" && table === "buyBook" && query["symbol"] === "DEC") {
      result = [{ symbol: "DEC", price: "0.00075", quantity: "1000" }];
    } else if (contract === "market" && table === "sellBook" && query["symbol"] === "DEC") {
      result = [{ symbol: "DEC", price: "0.00085", quantity: "800" }];
    } else if (contract === "marketpools" && table === "pools") {
      result = [{ tokenPair: "DEC:SWAP.HIVE", baseQuantity: "1000000", quoteQuantity: "900", tradeFeeMultiplier: "0.9975" }];
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const config = loadAagaardConfig();
  const wallet = config.wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const hiveEngine = createHiveEngineClient({
    nodes: ["https://example.invalid/contracts"],
    timeoutMs: 1000,
    balanceLimit: 100,
    marketLimit: 10,
    poolLimit: 10,
    symbols: ["DEC"],
    fetch: fetchImpl,
  });
  const chainState: WalletChainState = Object.freeze({
    account: wallet.account,
    hive: "1.000 HIVE",
    hbd: "1.000 HBD",
    currentMana: "9000",
    maxMana: "10000",
    tokens: Object.freeze({}),
  });
  const market = await hiveEngine.readWalletMarket(wallet, chainState);
  assert.equal(market?.tokens["DEC"], "12.5");
  assert.ok(Math.abs((market?.venues.find((venue) => venue.pair === "DEC/SWAP.HIVE")?.midpoint ?? 0) - 0.0008) < 0.0000001);
  assert.equal(market?.venues.find((venue) => venue.pair === "DEC/SWAP.HIVE")?.bestBid, 0.00075);
  assert.equal(market?.pools.find((pool) => pool.pair === "DEC:SWAP.HIVE")?.feeBps, 25);
  assert.equal(market?.pools.find((pool) => pool.pair === "DEC:SWAP.HIVE")?.baseQuantity, 1_000_000);
  assert.deepEqual(bookIndexes.sort((left, right) => left.table.localeCompare(right.table)), [
    { table: "buyBook", indexes: [{ index: "priceDec", descending: true }] },
    { table: "sellBook", indexes: [{ index: "priceDec", descending: false }] },
  ]);
  const merged = mergeWalletState(wallet, chainState, market);
  const games = planGaming(wallet, "2026-07-08T00:00:00.000Z", merged);
  assert.ok(games.games.some((game) => game.game === "Splinterlands" && game.heldTokens.some((token) => token.symbol === "DEC")));
  const trading = planTrades(wallet, "2026-07-08T00:00:00.000Z", merged, market);
  assert.ok(trading.liquidity.venues.some((venue) => venue.pair === "DEC/SWAP.HIVE"));
  assert.ok(trading.liquidity.pools.some((pool) => pool.pair === "DEC:SWAP.HIVE"));
});

test("a transient token-balance RPC failure does not erase shared market structure or invent capital", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { params: { contract: string; table: string; query: Record<string, unknown> } };
    const { contract, table, query } = payload.params;
    if (contract === "tokens" && table === "balances") throw new Error("transient balance outage");
    let result: unknown[] = [];
    if (contract === "market" && table === "buyBook" && query["symbol"] === "DEC") result = [{ price: "0.0012", quantity: "1000" }];
    if (contract === "market" && table === "sellBook" && query["symbol"] === "DEC") result = [{ price: "0.0013", quantity: "1000" }];
    if (contract === "marketpools" && table === "pools") result = [{ tokenPair: "DEC:SWAP.HIVE", baseQuantity: "1000000", quoteQuantity: "1000" }];
    if (contract === "tokens" && table === "tokens") result = [{ symbol: "DEC", precision: 3 }, { symbol: "SWAP.HIVE", precision: 8 }];
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const wallet = loadAagaardConfig().wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const client = createHiveEngineClient({ nodes: ["https://example.invalid/contracts"], timeoutMs: 1000, balanceLimit: 100, marketLimit: 10, poolLimit: 500, symbols: ["DEC"], fetch: fetchImpl });
  const state = Object.freeze({ ...roundTripState(wallet), tokens: Object.freeze({}) });
  const market = await client.readWalletMarket(wallet, state);
  assert.deepEqual(market?.tokens, {});
  assert.equal(market?.availability?.balances, false);
  assert.equal(market?.availability?.pools, true);
  assert.equal(market?.venues[0]?.bestBid, 0.0012);
  assert.equal(market?.pools[0]?.baseQuantity, 1_000_000);
  assert.equal(market?.pools[0]?.feeBps, 25);
  const plan = planTrades(wallet, undefined, state, market);
  assert.equal(plan.bundles.some((bundle) => bundle.funded), false);
});

test("Hive-Engine market reads serialize provider requests", async () => {
  const config = loadAagaardConfig();
  const wallet = config.wallets.find((entry) => entry.account === "michael561");
  assert.ok(wallet);
  let inFlight = 0;
  let maximumInFlight = 0;
  const symbols = ["DEC", "SPS", "SPSP", "VOUCHER", "STARBITS", "STARPRO", "SIM", "BUDS", "SEEDS"];
  const fetchImpl: typeof fetch = async (_input, init) => {
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    if (inFlight > 1) throw new Error("provider request serialization failed");
    try {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      const payload = JSON.parse(String(init?.body)) as { params: { contract: string; table: string; query: Record<string, unknown> } };
      const { contract, table, query } = payload.params;
      let result: unknown[] = [];
      if (contract === "marketpools" && table === "pools") result = symbols.map((symbol) => ({ tokenPair: `${symbol}:SWAP.HIVE`, baseQuantity: "1000", quoteQuantity: "1" }));
      if (contract === "market" && table === "buyBook") result = [{ price: "0.00100000", quantity: "1000" }];
      if (contract === "market" && table === "sellBook") result = [{ price: "0.00110000", quantity: "1000" }];
      if (contract === "tokens" && table === "tokens") {
        const requested = (query["symbol"] as { $in?: string[] } | undefined)?.$in ?? [];
        result = requested.map((symbol) => ({ symbol, precision: symbol === "SWAP.HIVE" ? 8 : 3 }));
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "content-type": "application/json" } });
    } finally {
      inFlight -= 1;
    }
  };
  const client = createHiveEngineClient({
    nodes: ["https://provider.example/rpc/contracts"],
    timeoutMs: 1000,
    balanceLimit: 100,
    marketLimit: 10,
    poolLimit: 100,
    symbols,
    fetch: fetchImpl,
  });
  const market = await client.readWalletMarket(wallet, Object.freeze({
    account: wallet.account,
    hive: "0.000 HIVE",
    hbd: "0.000 HBD",
    currentMana: "0",
    maxMana: "0",
    tokens: Object.freeze({}),
  }));
  assert.ok(market);
  assert.equal(maximumInFlight, 1);
  assert.equal(market.availability?.booksObserved, market.availability?.booksRequested);
});

test("armed ticks use key-vault aware execution receipts instead of inferred broadcasts", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-"));
  const keyRoot = path.join(root, "keys");
  try {
    const loaded = loadAagaardConfig({ env: { ...process.env, AAGAARD_LIVE: "1", AAGAARD_KEY_ROOT: keyRoot } });
    const config = exactWalletConfig(loaded, "sigmund-vexler");
    const evidenceAt = "2026-07-08T13:00:00.000Z";
    const market = {
      async readWalletMarket() { return roundTripMarket({ "SWAP.HIVE": "1.00000000" }, evidenceAt); },
      async readFleetOpenOrders(accounts: readonly string[]) { return emptyFleetOrderScan(accounts, evidenceAt); },
    };
    const noKeyRuntime = createAagaardRuntime(config, ensureStore(path.join(root, "no-keys")), { market, allowSynthetic: true, now: () => Date.parse(evidenceAt) });
    const noKeyReadout = await noKeyRuntime.runTick(evidenceAt);
    const noKeySigmund = noKeyReadout.accounts.find((account) => account.account === "sigmund-vexler");
    assert.ok(noKeySigmund?.voting);
    assert.equal(noKeySigmund.voting.votesBroadcast, 0);
    assert.equal(noKeySigmund.voting.votesSkipped, noKeySigmund.voting.votesPlanned);
    assert.ok(noKeySigmund.voting.execution.receipts.every((entry) => entry.status === "skipped" && entry.error === "no posting key"));
    assert.equal(noKeySigmund.trading?.mode, "propose-only");
    const noKeyStatus = noKeyRuntime.status() as { readonly accounts: readonly { readonly keys: { readonly posting: boolean; readonly active: boolean } }[] };
    assert.equal(noKeyStatus.accounts[0]?.keys.posting, false);

    mkdirSync(path.join(keyRoot, "sigmund-vexler"), { recursive: true });
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
    const writer: HiveWriteBoundary = {
      async vote(_wallet, vote) { return { id: `vote:${vote.author}/${vote.permlink}` }; },
      async trade(_wallet, trade) { return { id: `trade:${trade.pair}` }; },
      async tradeBundle(_wallet, bundle) { return { id: `bundle:${bundle.id}` }; },
      async liquidity(_wallet, entry) { return { id: `lp:${entry.pool}` }; },
      async savings(_wallet, entry) { return { id: `savings:${entry.amountHbd}` }; },
      async incentive(_wallet, offer, action) { return { id: `incentive:${action}:${offer.id}` }; },
    };
    const keyedRuntime = createAagaardRuntime(config, ensureStore(path.join(root, "with-keys")), { writer, market, allowSynthetic: true, now: () => Date.parse(evidenceAt) });
    const keyedReadout = await keyedRuntime.runTick(evidenceAt);
    const keyedSigmund = keyedReadout.accounts.find((account) => account.account === "sigmund-vexler");
    assert.ok(keyedSigmund?.voting);
    assert.equal(keyedSigmund.voting.votesBroadcast, keyedSigmund.voting.votesPlanned);
    assert.ok(keyedSigmund.voting.execution.receipts.every((entry) => entry.status === "broadcast" && entry.txId?.startsWith("vote:")));
    assert.equal(keyedSigmund.trading?.mode, "propose-only");
    assert.ok((keyedSigmund.trading?.execution.receipts ?? []).some((entry) => entry.status === "propose-only"
      && entry.error?.includes("direct Aagaard/CEO capital operation retired")),
      JSON.stringify(keyedSigmund.trading?.execution.receipts ?? []));
    assert.equal(keyedSigmund.trading?.tradesExecuted, 0);
    assert.equal(keyedSigmund.trading?.lpExecuted, 0);
    assert.equal((keyedSigmund.trading?.execution.receipts ?? []).some((entry) => entry.status === "broadcast"), false);
    const keyedStatus = keyedRuntime.status() as { readonly accounts: readonly { readonly keys: { readonly posting: boolean; readonly active: boolean } }[] };
    assert.equal(keyedStatus.accounts[0]?.keys.active, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a configured live runtime refuses unavailable substrate instead of trading seeded fallbacks", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-unavailable-substrate-"));
  const keyRoot = path.join(root, "keys");
  try {
    mkdirSync(path.join(keyRoot, "sigmund-vexler"), { recursive: true });
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
    const config = loadAagaardConfig({ env: { ...process.env, AAGAARD_LIVE: "1", AAGAARD_KEY_ROOT: keyRoot } });
    const hive = {
      async readCandidateField() { throw new Error("Hive unavailable"); },
      async readWalletState() { throw new Error("Hive unavailable"); },
      async readInternalMarket() { throw new Error("Hive unavailable"); },
    };
    const market = { async readWalletMarket() { throw new Error("Hive Engine unavailable"); } };
    let writes = 0;
    const writer: HiveWriteBoundary = {
      async vote() { writes += 1; return { id: "must-not-vote" }; },
      async tradeBundle() { writes += 1; return { id: "must-not-trade" }; },
    };
    const store = ensureStore(path.join(root, "store"));
    const runtime = createAagaardRuntime(config, store, { hive, market, writer });
    const readout = await runtime.runTick("2026-07-08T13:06:00.000Z");

    assert.equal(writes, 0);
    assert.ok(readout.accounts.every((entry) => (entry.voting?.votesPlanned ?? 0) === 0));
    assert.ok(readout.accounts.every((entry) => (entry.trading?.tradesPlanned ?? 0) === 0));
    assert.ok(readout.accounts.every((entry) => (entry.trading?.bundlesPlanned ?? 0) === 0));
    assert.ok(readSubstrateSnapshots(store, 20).every((snapshot) => snapshot.posts.length === 0
      && snapshot.market === null
      && snapshot.chainState.hive === "0.000 HIVE"
      && Object.keys(snapshot.chainState.tokens).length === 0));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trading execution counts confirmed economic effects, not outer-chain broadcasts", async () => {
  const wallet = loadAagaardConfig().wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const plan = planTrades(wallet, undefined, roundTripState(wallet), roundTripMarket(), null, {}, true, emptyFleetOrderScan([wallet.account]));
  assert.equal(plan.trades.length, 0);
  assert.equal(plan.bundles.filter((bundle) => bundle.funded).length, 1);
  assert.equal(plan.lp.length, 0);

  const writer: HiveWriteBoundary = {
    async vote() { return { id: "unused" }; },
    async tradeBundle() {
      return {
        id: "9a0e91b84d08c93c4fabf4b3ef07cc4b8cdadf87",
        economicEffect: {
          status: "confirmed",
          source: "hive-engine.getTransactionInfo",
          reference: "9a0e91b84d08c93c4fabf4b3ef07cc4b8cdadf87",
          contract: "marketpools+market",
          action: "swapTokens+sell",
        },
      };
    },
  };

  const executionNow = Date.now();
  const execution = await executeTrading(wallet, plan, true, { posting: true, active: true }, writer, executionNow, sigmundAuthorization(plan, executionNow));
  assert.equal(execution.tradesExecuted, 2);
  assert.equal(execution.bundlesExecuted, 1);
  assert.equal(execution.lpExecuted, 0);
  assert.equal(execution.receipts.find((entry) => entry.action === "trade-bundle")?.economicEffect?.status, "confirmed");
});

test("bad incumbent Aagaard execution cannot trade without Sigmund's exact enterprise envelope", async () => {
  const wallet = loadAagaardConfig().wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const plan = planTrades(wallet, undefined, roundTripState(wallet), roundTripMarket(), null, {}, true, emptyFleetOrderScan([wallet.account]));
  assert.ok(plan.bundles.some((bundle) => bundle.funded));
  let writes = 0;
  const writer: HiveWriteBoundary = {
    async vote() { return { id: "unused" }; },
    async tradeBundle() { writes += 1; return { id: "must-not-run" }; },
  };
  const executionNow = Date.now();
  const direct = await executeTrading(wallet, plan, true, { posting: true, active: true }, writer, executionNow);
  assert.equal(writes, 0);
  assert.equal(direct.mode, "propose-only");
  assert.ok(direct.receipts.some((entry) => entry.error?.includes("direct Aagaard/CEO capital operation retired")));

  const changedPlan = Object.freeze({ ...plan, savings: Object.freeze({ amountHbd: 0.001 }) });
  const staleEnvelope = sigmundAuthorization(plan, executionNow);
  const mismatched = await executeTrading(wallet, changedPlan, true, { posting: true, active: true }, writer, executionNow, staleEnvelope);
  assert.equal(writes, 0);
  assert.ok(mismatched.receipts.some((entry) => entry.error?.includes("plan digest does not match")));
});

test("armed trading refuses stale market or fleet-order evidence", async () => {
  const wallet = loadAagaardConfig().wallets.find((entry): entry is WalletActor => entry.account === "sigmund-vexler");
  assert.ok(wallet);
  const staleAt = "2026-07-08T00:00:00.000Z";
  let writes = 0;
  const writer: HiveWriteBoundary = {
    async vote() { return { id: "unused" }; },
    async tradeBundle() { writes += 1; return { id: "must-not-run" }; },
  };
  const staleMarket = Object.freeze({ ...roundTripMarket(), observedAt: staleAt });
  const staleMarketPlan = planTrades(wallet, undefined, roundTripState(wallet), staleMarket, null, {}, true, emptyFleetOrderScan([wallet.account]));
  assert.ok(staleMarketPlan.bundles.some((bundle) => bundle.funded));
  const executionNow = Date.now();
  const marketExecution = await executeTrading(wallet, staleMarketPlan, true, { posting: true, active: true }, writer, executionNow, sigmundAuthorization(staleMarketPlan, executionNow));
  assert.ok(marketExecution.receipts.some((entry) => entry.error?.includes("market evidence")));

  const staleOrdersPlan = planTrades(wallet, undefined, roundTripState(wallet), roundTripMarket(), null, {}, true, emptyFleetOrderScan([wallet.account], staleAt));
  assert.ok(staleOrdersPlan.bundles.some((bundle) => bundle.funded));
  // A fresh "now" must be captured after this plan's fresh market snapshot,
  // never the earlier `executionNow`: reusing it races the wall clock and
  // can make the just-stamped market look future-dated, masking the
  // fleet-order staleness this assertion targets.
  const secondExecutionNow = Date.now();
  const orderExecution = await executeTrading(wallet, staleOrdersPlan, true, { posting: true, active: true }, writer, secondExecutionNow, sigmundAuthorization(staleOrdersPlan, secondExecutionNow));
  assert.ok(orderExecution.receipts.some((entry) => entry.error?.includes("fleet open-order evidence")));
  assert.equal(writes, 0);
});

test("armed runtime may vote but cannot bypass AGRODAO enterprise capital admission", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-runtime-broadcast-"));
  const keyRoot = path.join(root, "keys");
  try {
    const log = path.join(root, "broadcast-requests.json");
    const script = path.join(root, "broadcast.mjs");
    writeFileSync(script, [
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  const prior = existsSync(process.argv[2]) ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : [];",
      "  writeFileSync(process.argv[2], JSON.stringify([...prior, payload]));",
      "  process.stdout.write(JSON.stringify({ txId: `${payload.account}:${payload.lane}:${payload.operation[0]}` }));",
      "});",
    ].join("\n"));
    mkdirSync(path.join(keyRoot, "sigmund-vexler"), { recursive: true });
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
    const config = exactWalletConfig(loadAagaardConfig({ env: { ...process.env, AAGAARD_LIVE: "1", AAGAARD_KEY_ROOT: keyRoot } }), "sigmund-vexler");
    const writer = createHiveBroadcastCommand({ command: `${process.execPath} ${script} ${log}`, keyRoot, timeoutMs: 5000 });
    const evidenceAt = "2026-07-08T13:10:00.000Z";
    const market = {
      async readWalletMarket() { return roundTripMarket({ "SWAP.HIVE": "1.00000000" }, evidenceAt); },
      async readFleetOpenOrders(accounts: readonly string[]) { return emptyFleetOrderScan(accounts, evidenceAt); },
    };
    const runtime = createAagaardRuntime(config, ensureStore(path.join(root, "store")), { writer, market, allowSynthetic: true, now: () => Date.parse(evidenceAt) });
    const status = runtime.status() as { readonly writes: { readonly hive: boolean } };
    assert.equal(status.writes.hive, true);
    const readout = await runtime.runTick(evidenceAt);
    const account = readout.accounts.find((entry) => entry.account === "sigmund-vexler");
    assert.ok(account?.voting);
    assert.ok(account.voting.execution.receipts.some((entry) => entry.status === "broadcast" && entry.txId?.includes(":voting:vote")));
    assert.ok(account.trading?.execution.receipts.some((entry) => entry.status === "propose-only" && entry.error?.includes("direct Aagaard/CEO capital operation retired")),
      JSON.stringify(account.trading?.execution.receipts ?? []));
    assert.equal(account.trading?.tradesExecuted, 0);
    assert.equal(account.trading?.lpExecuted, 0);
    const requests = JSON.parse(readFileSync(log, "utf8")) as readonly { lane: string; role: string; operation: [string, Record<string, unknown>]; keyFile?: string }[];
    assert.ok(requests.some((entry) => entry.lane === "voting" && entry.role === "posting" && entry.operation[0] === "vote"));
    assert.equal(requests.some((entry) => entry.lane === "trading" && entry.role === "active"), false);
    assert.ok(requests.some((entry) => entry.role === "posting" && entry.keyFile === path.join(keyRoot, "sigmund-vexler", "posting.wif")));
    assert.equal(requests.some((entry) => entry.role === "active" && entry.keyFile === path.join(keyRoot, "sigmund-vexler", "active.wif")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("operator auth exposes protected-resource metadata and bearer decisions", () => {
  const auth = createOperatorAuth({
    publicBaseUrl: "http://127.0.0.1:18807/",
    opsToken: "secret",
    allowedEmail: "operator@example.invalid",
    openWhenUnconfigured: false,
  });
  assert.equal(auth.mode, "bearer");
  assert.match(auth.challenge, /oauth-protected-resource/);
  assert.equal(auth.authorize({}).status, 401);
  assert.equal(auth.authorize({ authorization: "Bearer wrong" }).status, 403);
  assert.equal(auth.authorize({ authorization: "Bearer secret" }).ok, true);
  assert.equal(auth.protectedResourceMetadata()["resource"], "http://127.0.0.1:18807/ops");
  assert.deepEqual(auth.protectedResourceMetadata()["authorization_servers"], ["http://127.0.0.1:18807"]);
  assert.equal(auth.authorizationServerMetadata()["issuer"], "http://127.0.0.1:18807");

  const local = createOperatorAuth({
    publicBaseUrl: "http://localhost:18807",
    opsToken: "",
    allowedEmail: "operator@example.invalid",
    openWhenUnconfigured: true,
  });
  assert.equal(local.mode, "open");
  assert.equal(local.authorize({}).ok, true);
});

test("operator auth issues PKCE access tokens and revokes them", async () => {
  const auth = createOperatorAuth({
    publicBaseUrl: "http://127.0.0.1:18807",
    opsToken: "secret",
    allowedEmail: "operator@example.invalid",
    openWhenUnconfigured: false,
  });
  const client = auth.registerClient({ client_name: "test-client", redirect_uris: ["http://127.0.0.1:18807/ui"], token_endpoint_auth_method: "none" });
  const verifier = "test-verifier";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:18807/ui",
    code_challenge: challenge,
    code_challenge_method: "S256",
    operator_token: "secret",
    state: "state-1",
  });
  const authorization = await auth.authorizeUrl(params);
  assert.equal(authorization.ok, true);
  assert.ok(authorization.ok && authorization.redirect.includes("state=state-1"));
  const code = new URL(authorization.ok ? authorization.redirect : "http://invalid").searchParams.get("code") ?? "";
  const exchanged = auth.exchangeToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:18807/ui",
    code_verifier: verifier,
  }));
  assert.ok(!("error" in exchanged));
  if ("error" in exchanged) return;
  assert.equal(auth.authorize({ authorization: `Bearer ${exchanged.access_token}` }).ok, true);
  assert.deepEqual(auth.revokeToken(new URLSearchParams({ token: exchanged.access_token })), { revoked: true });
  assert.equal(auth.authorize({ authorization: `Bearer ${exchanged.access_token}` }).status, 403);
});

test("operator auth confines Google callback tokens to the allowed email", async () => {
  const calls: string[] = [];
  let email = "operator@example.invalid";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/.well-known/openid-configuration")) {
      return new Response(JSON.stringify({
        authorization_endpoint: "https://accounts.google.example/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.google.example/token",
        userinfo_endpoint: "https://openidconnect.google.example/v1/userinfo",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://oauth2.google.example/token") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ access_token: "google-access" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url === "https://openidconnect.google.example/v1/userinfo") {
      assert.equal((init?.headers as Record<string, string>)["authorization"], "Bearer google-access");
      return new Response(JSON.stringify({ email, email_verified: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500, headers: { "content-type": "application/json" } });
  };
  const auth = createOperatorAuth({
    publicBaseUrl: "http://127.0.0.1:18807",
    opsToken: "",
    allowedEmail: "operator@example.invalid",
    openWhenUnconfigured: false,
    google: {
      clientId: "google-client",
      clientSecret: "google-secret",
      discoveryUrl: "https://accounts.google.example/.well-known/openid-configuration",
      fetch: fetchImpl,
    },
  });
  assert.equal(auth.mode, "google");
  const client = auth.registerClient({ client_name: "google-test-client", redirect_uris: ["http://127.0.0.1:18807/ui"], token_endpoint_auth_method: "none" });
  const verifier = "google-verifier";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const started = await auth.authorizeUrl(new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:18807/ui",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "local-state",
  }));
  assert.equal(started.ok, true);
  assert.ok(started.ok && started.redirect.startsWith("https://accounts.google.example/o/oauth2/v2/auth"));
  const googleState = new URL(started.ok ? started.redirect : "http://invalid").searchParams.get("state") ?? "";

  email = "intruder@example.invalid";
  const rejected = await auth.authorizeCallback(new URLSearchParams({ state: googleState, code: "google-code" }));
  assert.deepEqual(rejected, { ok: false, status: 403, error: "Google email not allowed" });
  assert.equal(auth.authorize({ authorization: "Bearer google-secret" }).status, 403);

  const restarted = await auth.authorizeUrl(new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:18807/ui",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "local-state-2",
  }));
  assert.equal(restarted.ok, true);
  const allowedState = new URL(restarted.ok ? restarted.redirect : "http://invalid").searchParams.get("state") ?? "";
  email = "operator@example.invalid";
  const callback = await auth.authorizeCallback(new URLSearchParams({ state: allowedState, code: "google-code" }));
  assert.equal(callback.ok, true);
  const issuedCode = new URL(callback.ok ? callback.redirect : "http://invalid").searchParams.get("code") ?? "";
  const exchanged = auth.exchangeToken(new URLSearchParams({
    grant_type: "authorization_code",
    code: issuedCode,
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:18807/ui",
    code_verifier: verifier,
  }));
  assert.ok(!("error" in exchanged));
  if ("error" in exchanged) return;
  assert.equal(exchanged.principal, "operator@example.invalid");
  assert.equal(auth.authorize({ authorization: `Bearer ${exchanged.access_token}` }).principal, "operator@example.invalid");
  assert.ok(calls.some((entry) => entry.includes("openid-configuration")));
});
