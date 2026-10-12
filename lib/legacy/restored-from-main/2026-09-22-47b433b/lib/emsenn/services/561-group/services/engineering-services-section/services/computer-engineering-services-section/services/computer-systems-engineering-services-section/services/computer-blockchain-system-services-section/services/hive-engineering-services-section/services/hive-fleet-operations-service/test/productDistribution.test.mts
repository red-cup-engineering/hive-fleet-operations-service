import assert from "node:assert/strict";
import test from "node:test";

import { planProductReblog } from "../src/core/productDistribution.mts";

const base = { observedAt: "2026-07-22T09:00:00.000Z", author: "emsenn0", averageCustomJsonRc: "170000000" };

test("product distribution waits for the meaningful audience instead of spending a low-audience account", () => {
  const plan = planProductReblog({ ...base, candidates: [
    { account: "emsenn0", followers: 93, currentRc: "1000000000", maximumRc: "1000000000", alreadyReblogged: false },
    { account: "michael561", followers: 21, currentRc: "60000000", maximumRc: "5000000000", alreadyReblogged: false },
    { account: "essiebee", followers: 2, currentRc: "1000000000", maximumRc: "1000000000", alreadyReblogged: false },
  ] });
  assert.equal(plan.decision, "wait-for-rc-regeneration");
  assert.equal(plan.selectedAccount, "michael561");
  assert.equal(plan.policy.requiredRc, "340000000");
  assert.equal(plan.eligibleAt, "2026-07-22T15:43:12.000Z");
  assert.equal(plan.credentialAccess, false);
  assert.equal(plan.chainMutation, false);
});

test("product distribution admits exactly one producer-identity-neutral account only after the reserve is met", () => {
  const plan = planProductReblog({ ...base, candidates: [
    { account: "michael561", followers: 21, currentRc: "340000000", maximumRc: "5000000000", alreadyReblogged: false },
    { account: "marshian", followers: 1, currentRc: "1000000000", maximumRc: "1000000000", alreadyReblogged: false },
  ] });
  assert.equal(plan.decision, "reblog-one-exact-product-offer");
  assert.equal(plan.selectedAccount, "michael561");
  assert.equal(plan.eligibleAt, base.observedAt);
});

test("self-reblog, already-distributed, duplicate, and malformed candidates fail closed", () => {
  const self = planProductReblog({ ...base, candidates: [
    { account: "emsenn0", followers: 93, currentRc: "1000000000", maximumRc: "1000000000", alreadyReblogged: false },
  ] });
  assert.equal(self.decision, "no-qualified-distribution-account");
  const prior = planProductReblog({ ...base, candidates: [
    { account: "michael561", followers: 21, currentRc: "1000000000", maximumRc: "1000000000", alreadyReblogged: true },
  ] });
  assert.equal(prior.decision, "no-qualified-distribution-account");
  assert.throws(() => planProductReblog({ ...base, candidates: [
    { account: "michael561", followers: 21, currentRc: "1", maximumRc: "2", alreadyReblogged: false },
    { account: "michael561", followers: 21, currentRc: "1", maximumRc: "2", alreadyReblogged: false },
  ] }), /unique/u);
});
