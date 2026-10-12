import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSplinterlandsOwnedModernCore,
} from "@red-cup-engineering/splinterlands-services-section";
import { parseOptions } from "../scripts/splinterlands-audit.mjs";
import { loginMessage, parseOptions as parseSessionOptions } from "../scripts/splinterlands-session-probe.mjs";

const DETAILS = [
  { id: 640, name: "Prunda Undervesch", type: "Summoner", color: "White", secondary_color: "Blue", editions: "12", stats: { mana: [3] } },
  { id: 575, name: "Mar Toren Seeker", type: "Monster", color: "Blue", editions: "12", stats: { mana: [4] } },
  { id: 611, name: "Kha'zi Fire Mage", type: "Monster", color: "Red", editions: "12", stats: { mana: [3] } },
];

const OWNED = [
  { uid: "C12-640-5941874T9C", card_detail_id: 640, edition: 12, level: 1, delegated_to: null },
  { uid: "C12-575-ZQY8LUWF80", card_detail_id: 575, edition: 12, level: 1, delegated_to: null },
  { uid: "C12-611-5G8KJG6FKG", card_detail_id: 611, edition: 12, level: 1, delegated_to: null },
];

test("Splinterlands audit accepts only one canonical account argument", () => {
  assert.deepEqual(parseOptions(["--account", "michael561"]), { account: "michael561" });
  assert.throws(() => parseOptions(["--account", "michael561", "--execute-one"]), /usage/);
});

test("Splinterlands session probe is authentication-only and bounded", () => {
  assert.deepEqual(parseSessionOptions(["--account", "michael561", "--key-file", "/private/posting.wif"]), {
    account: "michael561", keyFile: "/private/posting.wif", timeoutSeconds: 8,
  });
  assert.equal(loginMessage("michael561", 1784682000000), "michael5611784682000000");
  assert.throws(() => parseSessionOptions(["--account", "michael561", "--key-file", "/private/posting.wif", "--find-match"]), /unknown argument/);
  assert.throws(() => parseSessionOptions(["--account", "michael561", "--key-file", "/private/posting.wif", "--timeout-sec", "60"]), /5 through 20/);
});

test("Splinterlands owned Modern readiness recognizes Michael's compatible Rebellion core", () => {
  const readiness = assessSplinterlandsOwnedModernCore(OWNED, DETAILS, [12, 14, 15, 16]);
  assert.equal(readiness.kind, "ready-owned-core");
  assert.deepEqual(readiness.compatibleElements, ["Blue"]);
  assert.equal(readiness.summoners[0]?.uid, "C12-640-5941874T9C");
  assert.equal(readiness.monsters.length, 2);

  assert.equal(assessSplinterlandsOwnedModernCore(OWNED.slice(1), DETAILS, [12, 14, 15, 16]).kind, "refuse");
  assert.equal(assessSplinterlandsOwnedModernCore([{ ...OWNED[0], delegated_to: "other" }, ...OWNED.slice(1)], DETAILS, [12, 14, 15, 16]).kind, "refuse");
});
