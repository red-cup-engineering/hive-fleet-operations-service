import { createGraph, stronglyConnectedComponents } from "@red-cup-engineering/metrologic/models/graphs/directed-multigraph";
export function formanCurvature(adjacency) {
    const edges = [];
    const seen = new Set();
    for (const [u, nbrs] of adjacency){
        for (const v of nbrs){
            const key = u < v ? `${u} ${v}` : `${v} ${u}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const du = adjacency.get(u)?.size ?? 0;
            const dv = adjacency.get(v)?.size ?? 0;
            edges.push({
                a: u,
                b: v,
                curvature: 4 - du - dv
            });
        }
    }
    const bridges = [
        ...edges
    ].sort((x, y)=>x.curvature - y.curvature).slice(0, 8);
    return Object.freeze({
        edges: Object.freeze(edges),
        bridges: Object.freeze(bridges)
    });
}
export function cycleSpace(nodeSet, edgeList) {
    const nodes = [
        ...new Set([
            ...nodeSet,
            ...edgeList.flatMap((e)=>[
                    e.a,
                    e.b
                ])
        ])
    ];
    const graph = createGraph({
        nodes: nodes.map((id)=>({
                id
            }))
    });
    const undirected = new Set();
    for (const e of edgeList){
        if (e.a === e.b) continue;
        undirected.add(e.a < e.b ? `${e.a} ${e.b}` : `${e.b} ${e.a}`);
        graph.addEdge({
            from: e.a,
            to: e.b
        });
        graph.addEdge({
            from: e.b,
            to: e.a
        });
    }
    const components = stronglyConnectedComponents(graph).length;
    const E = undirected.size;
    const V = nodes.length;
    const b1 = Math.max(0, E - V + components);
    return Object.freeze({
        nodes: V,
        edges: E,
        components,
        b1,
        cycleDensity: b1 / Math.max(1, V)
    });
}
export function coVoteGraph(posts) {
    const pairCount = new Map();
    const adjacency = new Map();
    for (const p of posts){
        const voters = (p.votes ?? []).map((v)=>v.voter);
        const capped = voters.slice(0, 40);
        for(let i = 0; i < capped.length; i++){
            for(let j = i + 1; j < capped.length; j++){
                const a = capped[i];
                const b = capped[j];
                if (a === b) continue;
                const key = a < b ? `${a} ${b}` : `${b} ${a}`;
                pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
                (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)).add(b);
                (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)).add(a);
            }
        }
    }
    const edges = [
        ...pairCount
    ].map(([key, w])=>{
        const [a, b] = key.split(" ");
        return {
            a: a,
            b: b,
            w
        };
    });
    return {
        adjacency,
        edges
    };
}
export function readCartels(posts) {
    const { edges } = coVoteGraph(posts);
    const ring = edges.filter((e)=>e.w >= 2);
    const cycle = cycleSpace(ring.flatMap((e)=>[
            e.a,
            e.b
        ]), ring);
    const tightPairs = [
        ...edges
    ].sort((x, y)=>y.w - x.w).slice(0, 10).filter((e)=>e.w >= 2).map((e)=>({
            a: e.a,
            b: e.b,
            coVotes: e.w
        }));
    return Object.freeze({
        cycle,
        tightPairs: Object.freeze(tightPairs)
    });
}
export function readDurability(posts, scoreOf) {
    const out = new Map();
    if (posts.length === 0) return out;
    const scored = posts.map((p)=>({
            p,
            key: `${p.author}/${p.permlink}`,
            s: scoreOf(p)
        }));
    const maxS = Math.max(1, ...scored.map((x)=>x.s));
    const LEVELS = 12;
    const tagOwners = new Map();
    for (const x of scored)for (const t of x.p.tags)(tagOwners.get(t) ?? tagOwners.set(t, []).get(t)).push(x.key);
    for (const x of scored){
        let isolatedLevels = 0;
        let includedLevels = 0;
        for(let l = LEVELS; l >= 1; l--){
            const tau = l / LEVELS * maxS;
            if (x.s < tau) continue;
            includedLevels++;
            let merged = false;
            for (const t of x.p.tags){
                for (const ownerKey of tagOwners.get(t) ?? []){
                    if (ownerKey === x.key) continue;
                    const other = scored.find((o)=>o.key === ownerKey);
                    if (other && other.s >= tau && other.s > x.s) {
                        merged = true;
                        break;
                    }
                }
                if (merged) break;
            }
            if (!merged) isolatedLevels++;
        }
        const persistence = includedLevels > 0 ? isolatedLevels / LEVELS : 0;
        out.set(x.key, Object.freeze({
            author: x.p.author,
            permlink: x.p.permlink,
            persistence
        }));
    }
    return out;
}
