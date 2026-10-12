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
  aagaardParityReport,
  capabilityReport,
  createAagaardRuntime,
  createHiveBroadcastCommand,
  createHiveClient,
  createHiveEngineClient,
  createOperatorAuth,
  dispositionIncentiveNomination,
  ensureStore,
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
  type WalletActor,
  type WalletChainState,
} from "../src/index.mts";

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
  const games = planGaming(wallet);
  assert.equal(games.arena.locked, true);
  assert.ok(games.games.some((game) => game.game === "Splinterlands"));
});

test("Hive adapter maps ranked posts and account state into the arena substrate", async () => {
  const calls: readonly unknown[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { method: string; params: unknown };
    (calls as unknown[]).push(payload);
    const result = payload.method === "condenser_api.get_accounts"
      ? [{ name: "sigmund-vexler", balance: "1.234 HIVE", hbd_balance: "5.678 HBD", voting_power: 8765 }]
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
  assert.equal(state?.currentMana, "8765");
  assert.ok(calls.length >= 2);
});

test("Hive post mapper tolerates missing optional chain fields", () => {
  const post = postCandidateFromHive({ author: "a", permlink: "p", json_metadata: "{bad" });
  assert.equal(post?.author, "a");
  assert.deepEqual(post?.tags, []);
});

test("Hive broadcast command adapter emits operation payloads and returns transaction ids", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-broadcast-"));
  try {
    const log = path.join(root, "requests.jsonl");
    const script = path.join(root, "broadcast.mjs");
    writeFileSync(script, [
      "import { appendFileSync } from 'node:fs';",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  appendFileSync(process.argv[2], JSON.stringify(payload) + '\\n');",
      "  process.stdout.write(JSON.stringify({ id: `tx:${payload.account}:${payload.operation[0]}` }));",
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
    // Real on-chain precision per token is required to size a real
    // broadcast quantity (see core.adapter.ts's sizeTradeQuantity) -- the
    // offline fallback pools/venues need a matching precision map or every
    // trade is honestly refused rather than sized, exactly as it would be
    // against real data with no precision fetched.
    const market = { tokens: {}, venues: [], pools: [], precision: { DEC: 3, SIM: 3, "SWAP.HIVE": 3 } };
    const trade = planTrades(wallet, undefined, undefined, market).trades[0];
    assert.ok(trade);
    const tradeResult = await writer.trade?.(wallet, trade);
    assert.equal(tradeResult?.id, `tx:${wallet.account}:custom_json`);
    const requests = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { operation: [string, Record<string, unknown>]; role: string; lane: string; keyFile?: string });
    assert.deepEqual(requests.map((entry) => entry.operation[0]), ["vote", "custom_json"]);
    const tradeJson = JSON.parse(String(requests[1]?.operation[1]?.["json"])) as { contractName: string; contractAction: string };
    assert.equal(tradeJson.contractName, "market");
    // A corridor trade's pair is "SWAP.HIVE/{symbol}" (give up SWAP.HIVE,
    // acquire the cheap symbol) -- marketBuy, not marketSell; the reverse
    // was a real bug (see core.adapter.ts's corridorTrades comment).
    assert.equal(tradeJson.contractAction, "marketBuy");
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

test("Hive-Engine adapter maps balances, books, and pools into market state", async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { params: { contract: string; table: string; query: Record<string, unknown> } };
    const { contract, table, query } = payload.params;
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
  assert.equal(market?.pools.find((pool) => pool.pair === "DEC:SWAP.HIVE")?.feeBps, 25);
  const merged = mergeWalletState(wallet, chainState, market);
  const games = planGaming(wallet, "2026-07-08T00:00:00.000Z", merged);
  assert.ok(games.games.some((game) => game.game === "Splinterlands" && game.heldTokens.some((token) => token.symbol === "DEC")));
  const trading = planTrades(wallet, "2026-07-08T00:00:00.000Z", merged, market);
  assert.ok(trading.liquidity.venues.some((venue) => venue.pair === "DEC/SWAP.HIVE"));
  assert.ok(trading.liquidity.pools.some((pool) => pool.pair === "DEC:SWAP.HIVE"));
});

test("ticks persist raw substrate, locked analysis drafts, and incentive arbitration state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-"));
  try {
    const store = ensureStore(root);
    const runtime = createAagaardRuntime(loadAagaardConfig(), store);
    await runtime.runTick("2026-07-08T12:00:00.000Z");
    const substrate = readSubstrateSnapshots(store, 20);
    assert.equal(substrate.length, 6);
    assert.ok(substrate.every((snapshot) => snapshot.posts.length > 0));
    assert.ok(substrate.some((snapshot) => snapshot.activeVotes.length > 0));

    const helpDrafts = readLockedDrafts(store, "help-fund");
    const sigmundDrafts = readLockedDrafts(store, "sigmund-vexler");
    assert.ok(helpDrafts.some((draft) => draft.topic === "he-liquidity" && draft.approvedForBroadcast === false));
    assert.ok(sigmundDrafts.some((draft) => draft.topic === "hive-spectral" && draft.approvedForBroadcast === false));

    const nominations = listIncentiveNominations(store);
    const nomination = nominations.find((record) => record.offer.requiredActions.includes("comment"));
    assert.ok(nomination);
    assert.equal(nomination.status, "pending");
    const updated = dispositionIncentiveNomination(store, nomination.offerId, "llm-draft", "2026-07-08T12:05:00.000Z");
    assert.equal(updated?.status, "drafted");
    assert.ok(updated?.draftId);
    assert.ok(readLockedDrafts(store, nomination.account).some((draft) => draft.id === updated?.draftId && draft.topic === "incentive-response"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("armed ticks use key-vault aware execution receipts instead of inferred broadcasts", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-"));
  const keyRoot = path.join(root, "keys");
  try {
    const config = loadAagaardConfig({ env: { ...process.env, AAGAARD_LIVE: "1", AAGAARD_KEY_ROOT: keyRoot } });
    const noKeyRuntime = createAagaardRuntime(config, ensureStore(path.join(root, "no-keys")));
    const noKeyReadout = await noKeyRuntime.runTick("2026-07-08T13:00:00.000Z");
    const noKeySigmund = noKeyReadout.accounts.find((account) => account.account === "sigmund-vexler");
    assert.ok(noKeySigmund?.voting);
    assert.equal(noKeySigmund.voting.votesBroadcast, 0);
    assert.equal(noKeySigmund.voting.votesSkipped, noKeySigmund.voting.votesPlanned);
    assert.ok(noKeySigmund.voting.execution.receipts.every((entry) => entry.status === "skipped" && entry.error === "no posting key"));
    assert.equal(noKeySigmund.trading?.mode, "propose-only");
    const noKeyStatus = noKeyRuntime.status() as { readonly accounts: readonly { readonly keys: { readonly posting: boolean; readonly active: boolean } }[] };
    assert.equal(noKeyStatus.accounts[2]?.keys.posting, false);

    mkdirSync(path.join(keyRoot, "sigmund-vexler"), { recursive: true });
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
    const writer: HiveWriteBoundary = {
      async vote(_wallet, vote) { return { id: `vote:${vote.author}/${vote.permlink}` }; },
      async trade(_wallet, trade) { return { id: `trade:${trade.pair}` }; },
      async liquidity(_wallet, entry) { return { id: `lp:${entry.pool}` }; },
      async savings(_wallet, entry) { return { id: `savings:${entry.amountHbd}` }; },
      async incentive(_wallet, offer, action) { return { id: `incentive:${action}:${offer.id}` }; },
    };
    const keyedRuntime = createAagaardRuntime(config, ensureStore(path.join(root, "with-keys")), { writer });
    const keyedReadout = await keyedRuntime.runTick("2026-07-08T13:05:00.000Z");
    const keyedSigmund = keyedReadout.accounts.find((account) => account.account === "sigmund-vexler");
    assert.ok(keyedSigmund?.voting);
    assert.equal(keyedSigmund.voting.votesBroadcast, keyedSigmund.voting.votesPlanned);
    assert.ok(keyedSigmund.voting.execution.receipts.every((entry) => entry.status === "broadcast" && entry.txId?.startsWith("vote:")));
    assert.equal(keyedSigmund.trading?.mode, "live");
    assert.ok((keyedSigmund.trading?.execution.receipts ?? []).some((entry) => entry.status === "broadcast" && entry.role === "active"));
    const keyedStatus = keyedRuntime.status() as { readonly accounts: readonly { readonly keys: { readonly posting: boolean; readonly active: boolean } }[] };
    assert.equal(keyedStatus.accounts[2]?.keys.active, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("armed runtime can broadcast through the Hive command boundary", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-runtime-broadcast-"));
  const keyRoot = path.join(root, "keys");
  try {
    const log = path.join(root, "broadcast-requests.jsonl");
    const script = path.join(root, "broadcast.mjs");
    writeFileSync(script, [
      "import { appendFileSync } from 'node:fs';",
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  appendFileSync(process.argv[2], JSON.stringify(payload) + '\\n');",
      "  process.stdout.write(JSON.stringify({ txId: `${payload.account}:${payload.lane}:${payload.operation[0]}` }));",
      "});",
    ].join("\n"));
    mkdirSync(path.join(keyRoot, "sigmund-vexler"), { recursive: true });
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
    writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
    const config = loadAagaardConfig({ env: { ...process.env, AAGAARD_LIVE: "1", AAGAARD_KEY_ROOT: keyRoot } });
    const writer = createHiveBroadcastCommand({ command: `${process.execPath} ${script} ${log}`, keyRoot, timeoutMs: 5000 });
    // Real on-chain precision per token is required to size a real trade
    // quantity (core.adapter.ts's sizeTradeQuantity) -- this minimal market
    // boundary supplies it so the offline fallback pools/venues can still
    // size a trade honestly, exactly as real Hive-Engine data would.
    const market = { async readWalletMarket() { return { tokens: {}, venues: [], pools: [], precision: { DEC: 3, SIM: 3, "SWAP.HIVE": 3 } }; } };
    const runtime = createAagaardRuntime(config, ensureStore(path.join(root, "store")), { writer, market });
    const status = runtime.status() as { readonly writes: { readonly hive: boolean } };
    assert.equal(status.writes.hive, true);
    const readout = await runtime.runTick("2026-07-08T13:10:00.000Z");
    const account = readout.accounts.find((entry) => entry.account === "sigmund-vexler");
    assert.ok(account?.voting);
    assert.ok(account.voting.execution.receipts.some((entry) => entry.status === "broadcast" && entry.txId?.includes(":voting:vote")));
    assert.ok(account.trading?.execution.receipts.some((entry) => entry.status === "broadcast" && entry.txId?.includes(":trading:")));
    const requests = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { lane: string; role: string; operation: [string, Record<string, unknown>]; keyFile?: string });
    assert.ok(requests.some((entry) => entry.lane === "voting" && entry.role === "posting" && entry.operation[0] === "vote"));
    assert.ok(requests.some((entry) => entry.lane === "trading" && entry.role === "active"));
    assert.ok(requests.some((entry) => entry.role === "posting" && entry.keyFile === path.join(keyRoot, "sigmund-vexler", "posting.wif")));
    assert.ok(requests.some((entry) => entry.role === "active" && entry.keyFile === path.join(keyRoot, "sigmund-vexler", "active.wif")));
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
