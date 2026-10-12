import test from "node:test";
import assert from "node:assert/strict";
import { PrivateKey } from "@red-cup-engineering/hive-blockchain-client-service/keys.mjs";
import { authMessage, captureDecision, parseOptions, reconcileWildsSession, shouldHeal, signAuthMessage, teamWiped } from "../scripts/holozing-wilds.mjs";

test("Wilds options require bounded explicit authority", () => {
  const parsed = parseOptions([
    "--account", "michael561",
    "--key-file", "/run/private/posting.wif",
    "--class", "forest:female",
    "--start-default",
    "--auto-heal",
    "--capture-max", "2",
    "--duration-sec", "300",
  ]);
  assert.deepEqual(parsed, {
    account: "michael561",
    keyFile: "/run/private/posting.wif",
    healerClass: "forest",
    gender: "female",
    startDefault: true,
    autoHeal: true,
    captureMax: 2,
    durationSeconds: 300,
    record: false,
  });
  assert.equal(parseOptions(["--account", "michael561", "--key-file", "x", "--record"]).record, true);
  assert.throws(() => parseOptions(["--account", "michael561", "--key-file", "x", "--duration-sec", "601"]), /5 through 600/);
  assert.throws(() => parseOptions(["--account", "michael561", "--key-file", "x", "--capture-max", "4"]), /0 through 3/);
  assert.throws(() => parseOptions(["--account", "michael561", "--key-file", "x", "--auto-heal"]), /requires --start-default/);
  assert.throws(() => parseOptions(["--account", "michael561", "--key-file", "x", "--class", "forest:robot"]), /must be/);
  assert.throws(() => parseOptions(["--account", "michael561", "--key-file", "x", "--endpoint", "wss:\/\/attacker.invalid"]), /unknown argument/);
});

test("Wilds authentication exactly matches the Keychain buffer shape", () => {
  const nonce = "0123456789abcdef0123456789abcdef";
  assert.equal(authMessage("michael561", nonce), `holozing-wilds:wilds-auth:michael561:${nonce}`);
  const signature = signAuthMessage("michael561", nonce, new PrivateKey(Buffer.alloc(32, 1)));
  assert.match(signature, /^[0-9a-f]{130}$/);
  assert.throws(() => authMessage("michael561", "not-a-server-nonce"), /invalid server nonce/);
});

test("Wilds healing retains mana and observes the Forest HoT interval", () => {
  const state = {
    phase: "battle",
    clock: 10_000,
    activeIndex: 0,
    team: [{ hp: 55, maxHp: 100, fainted: false }],
    healer: { mana: 24, pulseCost: 12 },
  };
  assert.equal(shouldHeal(state, 0), true);
  assert.equal(shouldHeal(state, 8_000), false);
  assert.equal(shouldHeal({ ...state, healer: { mana: 12, pulseCost: 12 } }, 0), false);
  assert.equal(shouldHeal({ ...state, team: [{ hp: 20, maxHp: 100 }], healer: { mana: 12, pulseCost: 12 } }, 0), true);
  assert.equal(shouldHeal({ ...state, phase: "prep" }, 0), false);
});

test("a fully wiped team stops the bounded runner before any revive path", () => {
  assert.equal(teamWiped({ team: [{ name: "Chirple", hp: 0 }, { name: "Woolio", hp: 0, fainted: true }, { name: "Fal", hp: -1 }] }), true);
  assert.equal(teamWiped({ team: [{ name: "Chirple", hp: 0 }, { name: "Woolio", hp: 1 }] }), false);
  assert.equal(teamWiped({ team: [] }), false);
});

test("Wilds capture policy caps attempts, targets weakened normals, and retains Dust", () => {
  const state = {
    phase: "battle",
    zone: 1,
    activeIndex: 0,
    team: [{ hp: 50, maxHp: 100, fainted: false }],
    healer: { mana: 20, pulseCost: 12 },
    wild: { name: "Larvie", level: 1, hp: 150, maxHp: 1000 },
    buildings: { habitat: 0 },
    paragon: 0,
    holoDust: 100,
  };
  assert.deepEqual(captureDecision(state, 0, 2), { maximumCost: 32, reserveDust: 50, hpRatio: 0.15 });
  assert.equal(captureDecision(state, 2, 2), null);
  assert.equal(captureDecision({ ...state, holoDust: 81 }, 0, 2), null);
  assert.equal(captureDecision({ ...state, wild: { ...state.wild, hp: 151 } }, 0, 2), null);
  assert.equal(captureDecision({ ...state, wild: { ...state.wild, alpha: true } }, 0, 2), null);
  assert.equal(captureDecision({ ...state, team: [{ hp: 50 }, {}, {}, {}] }, 0, 2), null);
});

test("Wilds session reconciliation distinguishes sent, settled, successful, and reserve-safe capture", () => {
  const initial = {
    holoDust: 251.77,
    stats: { wildsDefeated: 13, captureAttempts: 2, captureSuccess: 1, captureFail: 1 },
  };
  const settled = reconcileWildsSession(initial, {
    holoDust: 227.25,
    stats: { wildsDefeated: 16, captureAttempts: 3, captureSuccess: 2, captureFail: 1 },
  }, 1);
  assert.deepEqual(settled, {
    confirmed: true,
    reason: "the authoritative final counters settle every requested capture action",
    dustDelta: -24.52,
    wildsDefeatedDelta: 3,
    captureAttemptsDelta: 1,
    captureSuccessDelta: 1,
    captureFailDelta: 0,
    captureActionsSettled: true,
    captureOutcome: "success",
    reserveDust: 50,
    reserveRetained: true,
  });
  const pending = reconcileWildsSession(initial, initial, 1);
  assert.equal(pending.confirmed, false);
  assert.equal(pending.captureOutcome, "pending");
  assert.equal(reconcileWildsSession(null, initial, 0).confirmed, false);
});
