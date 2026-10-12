import assert from "node:assert/strict";
import test from "node:test";
import { observeRcReserve } from "../src/integrations/hive/rcReserve.adapter.mjs";
function providerFetch(changes = {}) {
    return async (input, init)=>{
        const node = String(input);
        const change = changes[node] ?? {};
        if (change.unavailable) throw new Error("offline");
        const request = JSON.parse(String(init?.body));
        const result = request.method === "rc_api.find_rc_accounts" ? {
            rc_accounts: [
                {
                    account: "michael561",
                    max_rc: "1000",
                    rc_manabar: {
                        current_mana: "100",
                        last_update_time: 1000
                    }
                }
            ]
        } : {
            avg_cost_rc: change.average ?? 60
        };
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result
        }), {
            status: 200
        });
    };
}
const nodes = [
    "https://one.example",
    "https://two.example",
    "https://three.example"
];
test("independent RC evidence produces the exact two-times-average reserve plan", async ()=>{
    const observation = await observeRcReserve({
        account: "michael561",
        operation: "custom_json_operation",
        observedAt: "1970-01-01T00:16:40.000Z",
        nodes,
        fetchImpl: providerFetch()
    });
    assert.equal(observation.status, "certified");
    assert.equal(observation.providerKnowledge.value, "true");
    assert.equal(observation.plan?.currentRc, "100");
    assert.equal(observation.plan?.requiredRc, "120");
    assert.equal(observation.plan?.decision, "wait-for-rc-regeneration");
    assert.equal(observation.plan?.eligibleAt, "1970-01-01T02:40:40.000Z");
    assert.equal(observation.credentialAccess, false);
});
test("contradictory RC cost evidence is FOUR both and produces no plan", async ()=>{
    const observation = await observeRcReserve({
        account: "michael561",
        operation: "custom_json_operation",
        observedAt: "1970-01-01T00:16:40.000Z",
        nodes,
        fetchImpl: providerFetch({
            "https://three.example": {
                average: 61
            }
        })
    });
    assert.equal(observation.status, "uncertified");
    assert.equal(observation.providerKnowledge.value, "both");
    assert.equal(observation.plan, null);
});
test("one RC provider is FOUR neither and produces no plan", async ()=>{
    const observation = await observeRcReserve({
        account: "michael561",
        operation: "custom_json_operation",
        observedAt: "1970-01-01T00:16:40.000Z",
        nodes,
        fetchImpl: providerFetch({
            "https://two.example": {
                unavailable: true
            },
            "https://three.example": {
                unavailable: true
            }
        })
    });
    assert.equal(observation.status, "uncertified");
    assert.equal(observation.providerKnowledge.value, "neither");
    assert.equal(observation.plan, null);
});
