import assert from "node:assert/strict";
import test from "node:test";
import { planRcReserve } from "../src/core/rcReserve.mjs";
const base = {
    observedAt: "2026-07-22T10:03:00.000Z",
    currentRc: "102273114",
    maximumRc: "5089858976",
    averageOperationRc: "100071366",
    operation: "vote_operation"
};
test("shared RC law waits rather than spending nearly the entire manabar on one vote", ()=>{
    const plan = planRcReserve(base);
    assert.equal(plan.decision, "wait-for-rc-regeneration");
    assert.equal(plan.requiredRc, "200142732");
    assert.equal(plan.eligibleAt, "2026-07-22T12:21:27.000Z");
    assert.equal(plan.credentialAccess, false);
    assert.equal(plan.chainMutation, false);
});
test("shared RC law admits at twice average cost and refuses an impossible reserve", ()=>{
    assert.equal(planRcReserve({
        ...base,
        currentRc: "200142732"
    }).decision, "ready");
    const impossible = planRcReserve({
        ...base,
        currentRc: "1",
        maximumRc: "150000000"
    });
    assert.equal(impossible.decision, "maximum-rc-insufficient");
    assert.equal(impossible.eligibleAt, null);
    assert.throws(()=>planRcReserve({
            ...base,
            currentRc: "200",
            maximumRc: "100"
        }), /cannot exceed/u);
});
