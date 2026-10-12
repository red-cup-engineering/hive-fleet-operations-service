import { DERVISH_FORMAL_BASIS, DERVISH_LENSES } from "./dervishExperiment.mjs";
export const HIVE_GROWTH_CYCLE_SCHEMA = "aagaard.hive-growth-cycle.v1";
export const HIVE_GROWTH_ANGLES = Object.freeze([
    Object.freeze({
        id: "curation-attention",
        purpose: "curation rewards, discovery, and audience formation",
        priorArtHints: Object.freeze([
            "core/strategyArms",
            "core/curationSettlement",
            "scripts/curation-cycle"
        ])
    }),
    Object.freeze({
        id: "asset-utility-yield",
        purpose: "token and NFT utility, staking, claims, and productive inventory",
        priorArtHints: Object.freeze([
            "core/core.adapter",
            "scripts/holozing-rewards",
            "scripts/token-unstake"
        ])
    }),
    Object.freeze({
        id: "product-revenue",
        purpose: "sell bounded information, execution, or verification services",
        priorArtHints: Object.freeze([
            "src/contract-fleet-observation",
            "core/strategyArms",
            "core/scoreboard"
        ])
    }),
    Object.freeze({
        id: "games-capability",
        purpose: "operate game assets and transfer learned circuits across chains",
        priorArtHints: Object.freeze([
            "integrations/splinterlands",
            "scripts/terracore-cycle",
            "scripts/dcrops-cycle"
        ])
    }),
    Object.freeze({
        id: "market-arbitrage",
        purpose: "realized spread, liquidity, and treasury turnover",
        priorArtHints: Object.freeze([
            "analysis/exactArbitrage",
            "core/makerOrders",
            "analysis/holonomy",
            "core/scoreboard"
        ])
    })
]);
function canonicalSource(value) {
    return /^(?:src|scripts|test|content)\/[A-Za-z0-9._/-]+$/u.test(value) && !value.includes("../");
}
export function planNextHiveGrowthCycle(input) {
    if (input.previous.schema !== HIVE_GROWTH_CYCLE_SCHEMA || !Number.isSafeInteger(input.previous.globalStep) || input.previous.globalStep < 0 || input.previous.status !== "completed") {
        throw new Error("Hive growth rotation requires one completed canonical prior cycle");
    }
    const globalStep = input.previous.globalStep + 1;
    const site = globalStep % HIVE_GROWTH_ANGLES.length;
    const angle = HIVE_GROWTH_ANGLES[site];
    if (angle.id === input.previous.angle) throw new Error("Hive growth rotation may not repeat the immediately prior angle");
    if (input.priorArt.length === 0) throw new Error("Hive growth rotation requires adopted repository prior art before action");
    const priorArt = input.priorArt.map((reading)=>{
        if (!canonicalSource(reading.source) || reading.adopted.trim().length < 8) {
            throw new Error("Hive growth prior art must name a canonical local source and a concrete adoption");
        }
        return Object.freeze({
            source: reading.source,
            adopted: reading.adopted.trim()
        });
    });
    if (new Set(priorArt.map((reading)=>reading.source)).size !== priorArt.length) throw new Error("Hive growth prior-art sources must be distinct");
    const dervishLens = DERVISH_LENSES[site];
    return Object.freeze({
        schema: HIVE_GROWTH_CYCLE_SCHEMA,
        globalStep,
        angle,
        priorArt: Object.freeze(priorArt),
        rotationWitness: Object.freeze({
            site,
            dervishLens: dervishLens.id,
            formalBasis: DERVISH_FORMAL_BASIS
        })
    });
}
