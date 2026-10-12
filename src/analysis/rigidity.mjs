function findRoot(parent, node) {
    let root = node;
    while(parent.get(root) !== root)root = parent.get(root);
    let current = node;
    while(parent.get(current) !== root){
        const next = parent.get(current);
        parent.set(current, root);
        current = next;
    }
    return root;
}
function componentCount(nodes, edges) {
    const parent = new Map(nodes.map((node)=>[
            node,
            node
        ]));
    for (const edge of edges){
        const rootA = findRoot(parent, edge.a);
        const rootB = findRoot(parent, edge.b);
        if (rootA !== rootB) parent.set(rootA, rootB);
    }
    return new Set(nodes.map((node)=>findRoot(parent, node))).size;
}
export function readRigidity(edges) {
    const nodes = [
        ...new Set(edges.flatMap((edge)=>[
                edge.a,
                edge.b
            ]))
    ];
    const components = componentCount(nodes, edges);
    const h1Rank = edges.length - nodes.length + components;
    const bridgeCells = edges.filter((_, index)=>componentCount(nodes, edges.filter((_, other)=>other !== index)) > components).map((edge)=>edge.label);
    return Object.freeze({
        entities: nodes.length,
        cells: edges.length,
        components,
        h1Rank,
        loadBearing: h1Rank >= 1,
        bridgeCells: Object.freeze(bridgeCells)
    });
}
export function edgesFromPools(pools) {
    return Object.freeze(pools.flatMap((pool)=>{
        const [a, b] = pool.pair.split(":");
        return a && b ? [
            Object.freeze({
                label: pool.pair,
                a,
                b
            })
        ] : [];
    }));
}
export function cyclePathIsBridgeFragile(path, venues, bridgeCells) {
    const bridgeSet = new Set(bridgeCells);
    return venues.some((venue)=>bridgeSet.has(venue.replace(/^pool:/, "")));
}
