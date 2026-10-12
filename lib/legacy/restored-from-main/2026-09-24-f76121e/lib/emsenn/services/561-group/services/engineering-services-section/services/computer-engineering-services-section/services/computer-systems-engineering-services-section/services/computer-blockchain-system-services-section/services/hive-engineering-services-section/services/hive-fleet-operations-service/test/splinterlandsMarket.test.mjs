import assert from "node:assert/strict";
import test from "node:test";
import { SPLINTERLANDS_ROSTER_PURCHASE_POLICY, assertExactSplinterlandsRosterPurchaseOperation, planSplinterlandsRosterPurchase, reconcileSplinterlandsRosterPurchase } from "../src/integrations/splinterlands/splinterlandsMarket.mjs";
const NOW = new Date("2026-07-22T05:00:00.000Z");
const PRICES = new Map([
    [
        802,
        0.269
    ],
    [
        784,
        0.015
    ],
    [
        742,
        0.010
    ],
    [
        731,
        0.010
    ],
    [
        817,
        0.010
    ]
]);
function listing(cardDetailId, edition, suffix, overrides = {}) {
    return Object.freeze({
        market_id: `${cardDetailId.toString(16).padStart(40, "0")}-${suffix}`,
        card_id: `C${edition}-${cardDetailId}-CARD${suffix}ABCDE`,
        uid: `C${edition}-${cardDetailId}-CARD${suffix}ABCDE`,
        buy_price: PRICES.get(cardDetailId),
        seller: `seller-${cardDetailId}`,
        type: "SELL",
        expiration_date: "2026-08-22T05:00:00.000Z",
        foil: 0,
        gold: false,
        edition,
        card_detail_id: cardDetailId,
        currency: "USD",
        level: 1,
        ...overrides
    });
}
function evidence(overrides = new Map()) {
    return new Map(SPLINTERLANDS_ROSTER_PURCHASE_POLICY.cards.map((target, index)=>[
            target.cardDetailId,
            overrides.get(target.cardDetailId) ?? [
                listing(target.cardDetailId, target.edition, index)
            ]
        ]));
}
test("roster purchase is one exact five-card basket with a hard credit ceiling and reserve", ()=>{
    const plan = planSplinterlandsRosterPurchase({
        account: "michael561",
        creditBalance: 384,
        clientVersion: "0.7.177",
        nonce: "A1b2C3d4E5",
        listingsByCard: evidence(),
        now: NOW
    });
    assert.equal(plan.credits, 314);
    assert.equal(plan.creditReserve, 70);
    assert.deepEqual(plan.listings.map((row)=>row.cardDetailId), [
        802,
        784,
        742,
        731,
        817
    ]);
    assert.deepEqual(plan.operation[1].required_auths, [
        "michael561"
    ]);
    assert.deepEqual(plan.operation[1].required_posting_auths, []);
    assert.deepEqual(JSON.parse(plan.operation[1].json), {
        currency: "CREDITS",
        items: plan.listings.map((row)=>row.marketId),
        price: 314,
        app: "splinterlands/0.7.177",
        n: "A1b2C3d4E5"
    });
    assertExactSplinterlandsRosterPurchaseOperation(plan.operation, plan);
    assert.throws(()=>assertExactSplinterlandsRosterPurchaseOperation([
            "custom_json",
            {
                ...plan.operation[1],
                json: plan.operation[1].json.replace("314", "313")
            }
        ], plan), /differs/);
});
test("roster planner refuses substitutions, fleet sellers, price drift, and reserve exhaustion", ()=>{
    const base = {
        account: "michael561",
        creditBalance: 384,
        clientVersion: "0.7.177",
        nonce: "A1b2C3d4E5",
        now: NOW
    };
    const wrongEdition = new Map([
        [
            802,
            [
                listing(802, 15, 1)
            ]
        ]
    ]);
    assert.throws(()=>planSplinterlandsRosterPurchase({
            ...base,
            listingsByCard: evidence(wrongEdition)
        }), /no admitted listing/);
    const fleetSeller = new Map([
        [
            784,
            [
                listing(784, 14, 1, {
                    seller: "sigmund-vexler"
                })
            ]
        ]
    ]);
    assert.throws(()=>planSplinterlandsRosterPurchase({
            ...base,
            listingsByCard: evidence(fleetSeller)
        }), /no admitted listing/);
    const tooExpensive = new Map([
        [
            802,
            [
                listing(802, 14, 1, {
                    buy_price: 0.276
                })
            ]
        ]
    ]);
    assert.throws(()=>planSplinterlandsRosterPurchase({
            ...base,
            listingsByCard: evidence(tooExpensive)
        }), /above the hard 320-credit ceiling/);
    assert.throws(()=>planSplinterlandsRosterPurchase({
            ...base,
            creditBalance: 377,
            listingsByCard: evidence()
        }), /fewer than 64 credits/);
});
test("roster settlement requires all exact UIDs and the exact committed credit delta", ()=>{
    const plan = planSplinterlandsRosterPurchase({
        account: "michael561",
        creditBalance: 384,
        clientVersion: "0.7.177",
        nonce: "A1b2C3d4E5",
        listingsByCard: evidence(),
        now: NOW
    });
    const acquired = plan.listings.map((row)=>row.uid);
    assert.deepEqual(reconcileSplinterlandsRosterPurchase({
        plan,
        beforeCredits: 384,
        afterCredits: 70,
        beforeUids: [
            "C12-640-EXISTINGAA"
        ],
        afterUids: [
            "C12-640-EXISTINGAA",
            ...acquired
        ]
    }), {
        confirmed: true,
        creditsSpent: 314,
        acquiredUids: acquired
    });
    assert.throws(()=>reconcileSplinterlandsRosterPurchase({
            plan,
            beforeCredits: 384,
            afterCredits: 71,
            beforeUids: [],
            afterUids: acquired
        }), /credit delta/);
    assert.throws(()=>reconcileSplinterlandsRosterPurchase({
            plan,
            beforeCredits: 384,
            afterCredits: 70,
            beforeUids: [],
            afterUids: acquired.slice(1)
        }), /lacks an exact acquired UID/);
});
