import assert from "node:assert/strict";
import test from "node:test";
import { curationPolicy } from "../src/core/accountStrategy.mjs";

test("curation excludes every fleet author while preserving independent exclusions and account lanes", () => {
  const config = {
    curation: { neverVoteAuthors: ["excluded", "curator"], maxDailyBudgetPercent: 20 },
    accounts: [{ account: "curator", lanes: ["curation"] }, { account: "other-house-account", lanes: ["games"] }],
  };
  const before = structuredClone(config);
  const policy = curationPolicy(config);
  assert.deepEqual(policy.accounts, ["curator"]);
  assert.deepEqual(policy.neverVoteAuthors, ["excluded", "curator", "other-house-account"]);
  assert.equal(policy.maxDailyBudgetPercent, 20);
  assert.deepEqual(config, before);
  assert.equal(Object.isFrozen(policy.neverVoteAuthors), true);
});

test("a fleet without explicit author exclusions still refuses voting within its own accounts", () => {
  const policy = curationPolicy({ accounts: [{ account: "curator", lanes: ["curation"] }] });
  assert.deepEqual(policy.neverVoteAuthors, ["curator"]);
  assert.deepEqual(curationPolicy({ accounts: [] }).accounts, []);
});
