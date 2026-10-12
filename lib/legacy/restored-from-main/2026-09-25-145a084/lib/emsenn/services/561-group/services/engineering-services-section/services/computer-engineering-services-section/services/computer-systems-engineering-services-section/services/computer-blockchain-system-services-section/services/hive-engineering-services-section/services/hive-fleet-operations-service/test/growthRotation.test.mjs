import assert from "node:assert/strict";
import test from "node:test";
import { HIVE_GROWTH_CYCLE_SCHEMA, planNextHiveGrowthCycle } from "../src/core/growthRotation.mjs";
const completedGameCycle = Object.freeze({
    schema: HIVE_GROWTH_CYCLE_SCHEMA,
    globalStep: 3,
    angle: "games-capability",
    status: "completed"
});
test("the post-Splinterlands cycle rotates to market work and binds adopted prior art", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: completedGameCycle,
        priorArt: [
            {
                source: "src/analysis/exactArbitrage.mts",
                adopted: "Require complete atomic round trips."
            },
            {
                source: "src/core/scoreboard.mts",
                adopted: "Count only reconciled realized effects."
            }
        ]
    });
    assert.equal(plan.globalStep, 4);
    assert.equal(plan.angle.id, "market-arbitrage");
    assert.equal(plan.rotationWitness.site, 4);
    assert.equal(plan.rotationWitness.dervishLens, "market-liquidity-flow");
    assert.equal(plan.rotationWitness.formalBasis.finiteCrtSchedule, "theorem-grounded");
});
test("the post-market cycle rotates to curation instead of repeating trading or games", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: {
            schema: HIVE_GROWTH_CYCLE_SCHEMA,
            globalStep: 4,
            angle: "market-arbitrage",
            status: "completed"
        },
        priorArt: [
            {
                source: "src/core/strategyArms.mts",
                adopted: "Use one exact common candidate field."
            },
            {
                source: "src/core/curationSettlement.mts",
                adopted: "Join predictions to chain-settled rewards."
            }
        ]
    });
    assert.equal(plan.globalStep, 5);
    assert.equal(plan.angle.id, "curation-attention");
    assert.equal(plan.rotationWitness.site, 0);
    assert.equal(plan.rotationWitness.dervishLens, "reward-route-settlement");
});
test("the post-curation cycle rotates to productive asset utility", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: {
            schema: HIVE_GROWTH_CYCLE_SCHEMA,
            globalStep: 5,
            angle: "curation-attention",
            status: "completed"
        },
        priorArt: [
            {
                source: "src/core/protectedAssets.mjs",
                adopted: "Preserve unique productive inventory."
            },
            {
                source: "scripts/holozing-rewards.mjs",
                adopted: "Collect only independently reconciled claim yield."
            }
        ]
    });
    assert.equal(plan.globalStep, 6);
    assert.equal(plan.angle.id, "asset-utility-yield");
    assert.equal(plan.rotationWitness.site, 1);
    assert.equal(plan.rotationWitness.dervishLens, "temporal-timing");
});
test("the post-asset cycle rotates to bounded product revenue", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: {
            schema: HIVE_GROWTH_CYCLE_SCHEMA,
            globalStep: 6,
            angle: "asset-utility-yield",
            status: "completed"
        },
        priorArt: [
            {
                source: "src/contract-fleet-observation.mjs",
                adopted: "Use an explicit paid service boundary."
            },
            {
                source: "src/core/strategyArms.mts",
                adopted: "Distinguish signals from reward forecasts."
            }
        ]
    });
    assert.equal(plan.globalStep, 7);
    assert.equal(plan.angle.id, "product-revenue");
    assert.equal(plan.rotationWitness.site, 2);
    assert.equal(plan.rotationWitness.dervishLens, "spectral-field");
});
test("the post-product cycle rotates to games capability instead of lingering on one product", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: {
            schema: HIVE_GROWTH_CYCLE_SCHEMA,
            globalStep: 7,
            angle: "product-revenue",
            status: "completed"
        },
        priorArt: [
            {
                source: "scripts/terracore-cycle.mjs",
                adopted: "Use one bounded public game action."
            },
            {
                source: "scripts/dcrops-cycle.mjs",
                adopted: "Reconcile exact inventory effects."
            }
        ]
    });
    assert.equal(plan.globalStep, 8);
    assert.equal(plan.angle.id, "games-capability");
    assert.equal(plan.rotationWitness.site, 3);
    assert.equal(plan.rotationWitness.dervishLens, "social-topology-cartel-bridge");
});
test("the post-game cycle rotates back to market work with the depth witness learned in prior cycles", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: {
            schema: HIVE_GROWTH_CYCLE_SCHEMA,
            globalStep: 8,
            angle: "games-capability",
            status: "completed"
        },
        priorArt: [
            {
                source: "src/analysis/exactArbitrage.mts",
                adopted: "Require a complete positive round trip."
            },
            {
                source: "src/core/exitTightness.mts",
                adopted: "Integrate complete displayed market depth."
            }
        ]
    });
    assert.equal(plan.globalStep, 9);
    assert.equal(plan.angle.id, "market-arbitrage");
    assert.equal(plan.rotationWitness.site, 4);
    assert.equal(plan.rotationWitness.dervishLens, "market-liquidity-flow");
});
test("the second post-market cycle rotates to curation rather than repeating a tempting scan", ()=>{
    const plan = planNextHiveGrowthCycle({
        previous: {
            schema: HIVE_GROWTH_CYCLE_SCHEMA,
            globalStep: 9,
            angle: "market-arbitrage",
            status: "completed"
        },
        priorArt: [
            {
                source: "src/core/strategyArms.mts",
                adopted: "Compare candidates on one exact field."
            },
            {
                source: "src/core/curationSettlement.mts",
                adopted: "Require later chain settlement."
            }
        ]
    });
    assert.equal(plan.globalStep, 10);
    assert.equal(plan.angle.id, "curation-attention");
    assert.equal(plan.rotationWitness.site, 0);
    assert.equal(plan.rotationWitness.dervishLens, "reward-route-settlement");
});
test("the growth cycle refuses missing prior art and non-completed history", ()=>{
    assert.throws(()=>planNextHiveGrowthCycle({
            previous: completedGameCycle,
            priorArt: []
        }), /requires adopted repository prior art/);
    assert.throws(()=>planNextHiveGrowthCycle({
            previous: {
                ...completedGameCycle,
                status: "planned"
            },
            priorArt: [
                {
                    source: "src/analysis/exactArbitrage.mts",
                    adopted: "Use the exact bundle carrier."
                }
            ]
        }), /completed canonical prior cycle/);
    assert.throws(()=>planNextHiveGrowthCycle({
            previous: completedGameCycle,
            priorArt: [
                {
                    source: "../outside",
                    adopted: "Use an unowned implementation."
                }
            ]
        }), /canonical local source/);
});
