const ATTENUATION_THRESHOLD = 0.05;
const MIN_FACTOR = 0.1;
function attenuationFactor(depth, maxDepth) {
    if (!(maxDepth > 0)) return 1;
    const screened = Math.min(1, Math.max(0, depth) / maxDepth);
    return 1 - screened * (1 - MIN_FACTOR);
}
export function readScreening(source, edges) {
    const maxDepth = Math.max(0, ...edges.map((edge)=>edge.depth));
    const adjacency = new Map();
    for (const edge of edges){
        const factor = attenuationFactor(edge.depth, maxDepth);
        for (const [from, to] of [
            [
                edge.a,
                edge.b
            ],
            [
                edge.b,
                edge.a
            ]
        ]){
            if (!adjacency.has(from)) adjacency.set(from, []);
            adjacency.get(from).push({
                to,
                factor
            });
        }
    }
    const charge = new Map([
        [
            source,
            1
        ]
    ]);
    const visited = new Set([
        source
    ]);
    const reachOrder = [];
    let frontier = [
        source
    ];
    let hops = 0;
    while(frontier.length > 0){
        const next = [];
        for (const node of frontier){
            const nodeCharge = charge.get(node) ?? 0;
            for (const { to, factor } of adjacency.get(node) ?? []){
                if (visited.has(to)) continue;
                const propagated = nodeCharge * factor;
                if (propagated < ATTENUATION_THRESHOLD) continue;
                visited.add(to);
                charge.set(to, propagated);
                reachOrder.push(to);
                next.push(to);
            }
        }
        if (next.length === 0) break;
        frontier = next;
        hops += 1;
    }
    return Object.freeze({
        source,
        reach: Object.freeze(reachOrder),
        hops
    });
}
export function edgesForScreening(pools) {
    return Object.freeze(pools.flatMap((pool)=>{
        const [a, b] = pool.pair.split(":");
        return a && b ? [
            Object.freeze({
                label: pool.pair,
                a,
                b,
                depth: pool.tvlQuote
            })
        ] : [];
    }));
}
