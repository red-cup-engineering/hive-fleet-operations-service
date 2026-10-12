import { readTimingOf } from "./timing.mjs";
import { readRewardRoutes } from "./reward.mjs";
import { readContent } from "./content.mjs";
import { readSignals } from "./signals.mjs";
import { readSpectral } from "./spectral.mjs";
import { formanCurvature, readCartels, readDurability } from "./graph.mjs";
const SCORE_CAP = 64;
function payoutBucket(pendingPayout) {
    if (!Number.isFinite(pendingPayout) || pendingPayout < 0) return 0;
    return Math.min(pendingPayout, SCORE_CAP);
}
function attentionGraph(posts) {
    const nodes = new Set();
    const edges = [];
    const adjacency = new Map();
    const link = (a, b)=>{
        (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)).add(b);
        (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)).add(a);
    };
    for (const p of posts){
        const pk = `p:${p.author}/${p.permlink}`;
        nodes.add(pk);
        for (const t of p.tags){
            const tk = `t:${t}`;
            nodes.add(tk);
            edges.push({
                a: pk,
                b: tk,
                w: 1
            });
            link(pk, tk);
        }
    }
    return {
        nodes,
        edges,
        adjacency
    };
}
export function readVotingIntelligenceOf(posts, sinkDeficits, nowMs) {
    const reward = readRewardRoutes(posts);
    const content = readContent(posts);
    const signals = readSignals(posts);
    const durability = readDurability(posts, (p)=>payoutBucket(p.pendingPayout));
    const { nodes, edges, adjacency } = attentionGraph(posts);
    const spectral = readSpectral(nodes, edges);
    const curvature = formanCurvature(adjacency);
    const cartels = readCartels(posts);
    const cartelVoters = new Set();
    for (const pair of cartels.tightPairs){
        cartelVoters.add(pair.a);
        cartelVoters.add(pair.b);
    }
    const bridgePosts = new Set();
    for (const e of curvature.bridges){
        if (e.a.startsWith("p:")) bridgePosts.add(e.a.slice(2));
        if (e.b.startsWith("p:")) bridgePosts.add(e.b.slice(2));
    }
    const maxPayout = Math.max(1, ...posts.map((p)=>payoutBucket(p.pendingPayout)));
    const maxEndorse = Math.max(1, ...posts.map((p)=>Math.max(0, p.netRshares)));
    const maxDeficit = Math.max(1, ...[
        ...sinkDeficits.values()
    ]);
    const reflexiveDiscount = spectral.fiedler > 0 ? 1 / (1 + spectral.fiedler) : 1;
    const out = [];
    for (const p of posts){
        const key = `${p.author}/${p.permlink}`;
        const deficit = sinkDeficits.get(key) ?? 0;
        const rr = reward.get(key);
        const captureEfficiency = rr?.captureEfficiency ?? 1;
        const timing = readTimingOf(p, nowMs);
        const timingScore = timing.timingScore;
        const likelyCartelTrail = timing.likelyCartelTrail;
        const cr = content.get(key);
        const contentFitness = cr?.fitness ?? 0;
        const dur = durability.get(key)?.persistence ?? 0;
        const bridge = bridgePosts.has(key);
        const sig = signals.get(key);
        const downvotePressure = sig?.downvotePressure ?? 0;
        const frustration = sig?.frustration ?? 0;
        const engagement = sig?.engagement ?? 0;
        const voters = (p.votes ?? []).slice(0, 40).map((v)=>v.voter);
        const inRing = voters.filter((v)=>cartelVoters.has(v)).length;
        const cartelExposure = voters.length > 0 ? inRing / voters.length : 0;
        const nPay = payoutBucket(p.pendingPayout) / maxPayout;
        const nEnd = Math.max(0, p.netRshares) / maxEndorse;
        const layerDisagreement = Math.abs(nPay - nEnd);
        const trailPenalty = likelyCartelTrail ? 0.4 : 1;
        const downvoteFactor = sig?.downvoted ? 0 : 1 - 0.5 * frustration;
        const expectedAlpha = deficit * captureEfficiency * timingScore * (1 + 0.5 * contentFitness) * (1 + 0.5 * dur) * (1 + 0.2 * engagement) * (bridge ? 1.25 : 1) * (1 - 0.5 * cartelExposure) * downvoteFactor * trailPenalty * reflexiveDiscount;
        const kirchhoffWeightBps = Math.round(Math.max(0, Math.min(1, deficit / maxDeficit)) * 10000);
        out.push(Object.freeze({
            key,
            deficit,
            expectedAlpha: Number(expectedAlpha.toFixed(3)),
            kirchhoffWeightBps,
            likelyCartelTrail,
            bridge,
            timingScore,
            engagement,
            contentFitness,
            durability: dur,
            cartelExposure,
            downvotePressure,
            frustration,
            layerDisagreement,
            reflexiveDiscount
        }));
    }
    out.sort((a, b)=>b.expectedAlpha - a.expectedAlpha);
    return Object.freeze({
        spectral,
        curvature,
        cartels,
        bridges: Object.freeze([
            ...bridgePosts
        ]),
        posts: Object.freeze(out)
    });
}
