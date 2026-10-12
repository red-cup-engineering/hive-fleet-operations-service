import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { startRwilProviderProcess, type RunningRwilProvider } from "@emsenn/rwil-rdf-services/test-provider";

import {
  createAagaardRuntime,
  ensureStore,
  loadAagaardConfig,
  readDervishTrialObservations,
  type AagaardConfig,
} from "../src/index.mts";

let rwil: RunningRwilProvider | undefined;
let signingRoot: string | undefined;
const priorRwilAgent = process.env["RWIL_RDF_AGENT"];
const priorSigning = Object.freeze({
  key: process.env["AGENT_CARD_SIGNING_KEY"],
  jwks: process.env["AGENT_CARD_JWKS"],
  kid: process.env["AGENT_CARD_SIGNING_KID"],
});

test.before(async () => {
  signingRoot = mkdtempSync(path.join(tmpdir(), "aagaard-dervish-signing-"));
  const kid = "aagaard-dervish-test-ed25519";
  const pair = generateKeyPairSync("ed25519");
  const privateKeyPath = path.join(signingRoot, "private.pem");
  const jwksPath = path.join(signingRoot, "jwks.json");
  writeFileSync(privateKeyPath, pair.privateKey.export({ format: "pem", type: "pkcs8" }));
  writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...pair.publicKey.export({ format: "jwk" }), alg: "EdDSA", kid }] }));
  process.env["AGENT_CARD_SIGNING_KEY"] = privateKeyPath;
  process.env["AGENT_CARD_JWKS"] = jwksPath;
  process.env["AGENT_CARD_SIGNING_KID"] = kid;
  rwil = await startRwilProviderProcess();
  process.env["RWIL_RDF_AGENT"] = rwil.agentCardUrl;
});

test.after(async () => {
  if (priorRwilAgent === undefined) delete process.env["RWIL_RDF_AGENT"];
  else process.env["RWIL_RDF_AGENT"] = priorRwilAgent;
  for (const [name, prior] of [
    ["AGENT_CARD_SIGNING_KEY", priorSigning.key],
    ["AGENT_CARD_JWKS", priorSigning.jwks],
    ["AGENT_CARD_SIGNING_KID", priorSigning.kid],
  ] as const) {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
  await rwil?.close();
  if (signingRoot) rmSync(signingRoot, { recursive: true, force: true });
});

test("six-account fleet ticks append and advance one Dervish trial", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-dervish-runtime-"));
  try {
    const config = loadAagaardConfig();
    assert.equal(config.wallets.length, 6);
    const store = ensureStore(root);
    const runtime = createAagaardRuntime(config, store);

    const first = await runtime.runTick("2026-07-20T01:00:00.000Z");
    const second = await runtime.runTick("2026-07-20T01:01:00.000Z");
    const trials = readDervishTrialObservations(store.dataDir);

    assert.equal(first.dervish?.globalStep, 0);
    assert.equal(first.dervish?.site, 0);
    assert.equal(first.dervish?.phase, 0);
    assert.equal(first.dervish?.account, config.wallets[0]?.account);
    assert.equal(second.dervish?.globalStep, 1);
    assert.equal(second.dervish?.site, 1);
    assert.equal(second.dervish?.phase, 1);
    assert.equal(second.dervish?.account, config.wallets[1]?.account);
    assert.equal(trials.length, 2);
    assert.deepEqual(trials.map((trial) => trial.trialId), [first.dervish?.trialId, second.dervish?.trialId]);
    assert.ok(trials.every((trial) => trial.claims.realizedPnlHbd === null && trial.claims.causalEffect === null));
    // Advancing the observation coordinate does not select which wallets act
    // or alter their already-produced plans/receipts under the same substrate.
    assert.equal(first.accounts.length, 6);
    assert.ok(first.accounts.every((account) => account.voting && account.trading));
    assert.deepEqual(
      first.accounts.map((account) => [account.account, account.voting?.votesPlanned, account.trading?.tradesPlanned]),
      second.accounts.map((account) => [account.account, account.voting?.votesPlanned, account.trading?.tradesPlanned]),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non-six roster runs normally and leaves Dervish unavailable", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-dervish-unavailable-"));
  try {
    const base = loadAagaardConfig();
    const config = Object.freeze({
      ...base,
      name: `${base.name}-five-wallet-test`,
      wallets: Object.freeze(base.wallets.slice(0, 5)),
    }) satisfies AagaardConfig;
    const store = ensureStore(root);
    const readout = await createAagaardRuntime(config, store).runTick("2026-07-20T02:00:00.000Z");

    assert.equal(readout.accounts.length, 5);
    assert.equal(readout.dervish, null);
    assert.deepEqual(readDervishTrialObservations(store.dataDir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
