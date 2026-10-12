function parsePair(pair) {
    const sep = pair.includes("/") ? "/" : pair.includes(":") ? ":" : null;
    if (!sep) return null;
    const [a, b] = pair.split(sep);
    if (!a || !b) return null;
    return [
        a,
        b
    ];
}
export const MIN_POOL_TVL_QUOTE = 1000;
export function edgesFromLiquidity(liquidity) {
    const edges = [];
    const add = (from, to, venue, rate, feeBps)=>{
        if (!Number.isFinite(rate) || rate <= 0) return;
        edges.push(Object.freeze({
            from,
            to,
            venue,
            rate,
            feeBps
        }));
        edges.push(Object.freeze({
            from: to,
            to: from,
            venue,
            rate: 1 / rate,
            feeBps
        }));
    };
    for (const venue of liquidity.venues){
        const pair = parsePair(venue.pair);
        if (!pair || venue.midpoint <= 0) continue;
        if (venue.bidDepth <= 0 || venue.askDepth <= 0) continue;
        add(pair[0], pair[1], venue.venue, venue.midpoint, venue.relativeSpreadBps / 2);
    }
    for (const pool of liquidity.pools){
        const pair = parsePair(pool.pair);
        if (!pair || pool.impliedPrice <= 0) continue;
        if (pool.tvlQuote < MIN_POOL_TVL_QUOTE) continue;
        add(pair[0], pair[1], `pool:${pool.pair}`, pool.impliedPrice, pool.feeBps);
    }
    return Object.freeze(edges);
}
function spanningTree(nodes, edges) {
    const adjacency = new Map();
    for (const e of edges)(adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)).push(e);
    const tree = new Map();
    for (const root of nodes){
        if (tree.has(root)) continue;
        tree.set(root, Object.freeze({
            parent: null,
            viaVenue: "",
            viaRate: 1,
            viaFeeBps: 0,
            logPotential: 0,
            depth: 0
        }));
        const queue = [
            root
        ];
        while(queue.length > 0){
            const u = queue.shift();
            const uEntry = tree.get(u);
            for (const e of adjacency.get(u) ?? []){
                if (tree.has(e.to)) continue;
                tree.set(e.to, Object.freeze({
                    parent: u,
                    viaVenue: e.venue,
                    viaRate: e.rate,
                    viaFeeBps: e.feeBps,
                    logPotential: uEntry.logPotential + Math.log(e.rate),
                    depth: uEntry.depth + 1
                }));
                queue.push(e.to);
            }
        }
    }
    return tree;
}
function pathToRoot(tree, node) {
    const path = [
        node
    ];
    let current = node;
    for(;;){
        const entry = tree.get(current);
        if (!entry || entry.parent === null) break;
        current = entry.parent;
        path.push(current);
    }
    return path;
}
function freezeHop(from, to, venue, rate, feeBps) {
    return Object.freeze({
        from,
        to,
        venue,
        rate,
        feeBps
    });
}
function treeRoute(tree, from, to) {
    const fromToRoot = pathToRoot(tree, from);
    const toToRoot = pathToRoot(tree, to);
    const toSet = new Set(toToRoot);
    const lca = fromToRoot.find((node)=>toSet.has(node));
    if (!lca) return Object.freeze([]);
    const hops = [];
    let current = from;
    while(current !== lca){
        const entry = tree.get(current);
        if (!entry || entry.parent === null) return Object.freeze([]);
        hops.push(freezeHop(current, entry.parent, entry.viaVenue, 1 / entry.viaRate, entry.viaFeeBps));
        current = entry.parent;
    }
    const downNodes = toToRoot.slice(0, toToRoot.indexOf(lca)).reverse();
    for (const child of downNodes){
        const entry = tree.get(child);
        if (!entry || entry.parent === null) return Object.freeze([]);
        hops.push(freezeHop(entry.parent, child, entry.viaVenue, entry.viaRate, entry.viaFeeBps));
    }
    return Object.freeze(hops);
}
function reverseRoute(hops) {
    return Object.freeze([
        ...hops
    ].reverse().map((hop)=>freezeHop(hop.to, hop.from, hop.venue, 1 / hop.rate, hop.feeBps)));
}
function routeProduct(hops) {
    return hops.reduce((product, hop)=>product * hop.rate, 1);
}
function netRouteProduct(hops) {
    return hops.reduce((product, hop)=>product * hop.rate * Math.max(0, 1 - hop.feeBps / 10_000), 1);
}
function directedCycleKey(hops) {
    const labels = hops.map((hop)=>`${hop.from}>${hop.to}@${hop.venue}`);
    if (labels.length === 0) return "";
    const rotations = labels.map((_, index)=>[
            ...labels.slice(index),
            ...labels.slice(0, index)
        ].join("|"));
    rotations.sort();
    return rotations[0];
}
function isTreeEdge(tree, edge) {
    const to = tree.get(edge.to);
    if (to?.parent === edge.from && to.viaVenue === edge.venue) return true;
    const from = tree.get(edge.from);
    return from?.parent === edge.to && from.viaVenue === edge.venue;
}
export function detectHolonomy(edges, options = {}) {
    const minNet = options.minNetHolonomyBps ?? 15;
    const limit = options.limit ?? 10;
    const nodes = [
        ...new Set(edges.flatMap((e)=>[
                e.from,
                e.to
            ]))
    ];
    if (nodes.length === 0) return Object.freeze([]);
    const tree = spanningTree(nodes, edges);
    const cycles = [];
    const seen = new Set();
    for (const e of edges){
        const u = tree.get(e.from);
        const v = tree.get(e.to);
        if (!u || !v) continue;
        if (isTreeEdge(tree, e)) continue;
        let hops = Object.freeze([
            freezeHop(e.from, e.to, e.venue, e.rate, e.feeBps),
            ...treeRoute(tree, e.to, e.from)
        ]);
        if (hops.length < 2 || hops[hops.length - 1]?.to !== hops[0]?.from) continue;
        let grossProduct = routeProduct(hops);
        if (!Number.isFinite(grossProduct) || grossProduct <= 0 || Math.abs(grossProduct - 1) < Number.EPSILON) continue;
        if (grossProduct < 1) {
            hops = reverseRoute(hops);
            grossProduct = routeProduct(hops);
        }
        const netProduct = netRouteProduct(hops);
        const netHolonomyBps = (netProduct - 1) * 10_000;
        if (netHolonomyBps < minNet) continue;
        const key = directedCycleKey(hops);
        if (seen.has(key)) continue;
        seen.add(key);
        const path = Object.freeze([
            hops[0].from,
            ...hops.map((hop)=>hop.to)
        ]);
        const venues = Object.freeze(hops.map((hop)=>hop.venue));
        const holonomyBps = Math.log(grossProduct) * 10_000;
        const grossReturnBps = (grossProduct - 1) * 10_000;
        cycles.push(Object.freeze({
            path,
            venues,
            hops,
            holonomyBps: Number(holonomyBps.toFixed(3)),
            grossReturnBps: Number(grossReturnBps.toFixed(3)),
            netHolonomyBps: Number(netHolonomyBps.toFixed(3)),
            executionAdmissible: false,
            evidenceGaps: Object.freeze([
                "midpoint-and-pool-spot-rates-are-not-executable-quotes",
                "edge-observations-do-not-share-a-proven-atomic-snapshot",
                "route-capacity-is-not-hard-sized-through-every-hop"
            ])
        }));
    }
    cycles.sort((a, b)=>b.netHolonomyBps - a.netHolonomyBps);
    return Object.freeze(cycles.slice(0, limit));
}
export function readHolonomy(liquidity, options) {
    return detectHolonomy(edgesFromLiquidity(liquidity), options);
}
