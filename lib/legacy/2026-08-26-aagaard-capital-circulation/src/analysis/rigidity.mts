// Percolation/coordination-cohomology rigidity, ported from Obsmetrologia's
// AperiodicOrder/Tiling/Percolation.lean and Cohomology/CoordinationCohomology.lean.
//
// Both modules turn on the same invariant: for a graph of `entities`
// (vertices) joined by `cells` (edges) into `components` connected pieces,
// H1rank = cells - entities + components is the cycle rank (first Betti
// number) -- exactly the quantity the firm's own strategy note ("The
// Distal Bypass") identifies with coordination cost / entropy
// (landauer_eq_coordination_cost). Percolation.lean's own contribution is
// the sharp threshold: a graph is "load-bearing" (has real cyclic
// redundancy) iff H1rank >= 1, and the unique H1rank=0 state is exactly a
// spanning forest -- "floppy": one edge removed from anywhere disconnects
// something. density_not_sufficient is the reason this module exists
// rather than just counting pools: the same pool COUNT can realize either
// state, so counting is not enough -- the actual graph structure decides.
//
// Applied here to Hive-Engine's pool-connectivity graph: entities are
// tokens, cells are pools pairing two tokens. A detected arbitrage cycle
// that routes through a bridge (a cell whose removal disconnects the
// graph) is structurally fragile -- the cycle's existence, not just its
// current profitability, depends on that one pool's liquidity persisting.
//
// See the Obsmetrologia financial-methods catalog, section 2.1. This is
// `implemented` (real, reported for observation), not yet `live` (no
// trade decision depends on it) -- per the firm's own development
// discipline for this catalog.

export interface RigidityReading {
  readonly entities: number;
  readonly cells: number;
  readonly components: number;
  readonly h1Rank: number;
  readonly loadBearing: boolean;
  /** Cells whose removal would increase the component count -- bridges,
   *  in the graph-theory sense; a pool named here is a single point of
   *  failure for every path that crosses it. */
  readonly bridgeCells: readonly string[];
}

interface Edge {
  readonly label: string;
  readonly a: string;
  readonly b: string;
}

function findRoot(parent: Map<string, string>, node: string): string {
  let root = node;
  while (parent.get(root) !== root) root = parent.get(root)!;
  let current = node;
  while (parent.get(current) !== root) {
    const next = parent.get(current)!;
    parent.set(current, root);
    current = next;
  }
  return root;
}

function componentCount(nodes: readonly string[], edges: readonly Edge[]): number {
  const parent = new Map<string, string>(nodes.map((node) => [node, node]));
  for (const edge of edges) {
    const rootA = findRoot(parent, edge.a);
    const rootB = findRoot(parent, edge.b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }
  return new Set(nodes.map((node) => findRoot(parent, node))).size;
}

export function readRigidity(edges: readonly Edge[]): RigidityReading {
  const nodes = [...new Set(edges.flatMap((edge) => [edge.a, edge.b]))];
  const components = componentCount(nodes, edges);
  const h1Rank = edges.length - nodes.length + components;
  // A bridge is a cell whose removal strictly increases the component
  // count -- checked directly (recompute components with that one cell
  // dropped), not inferred, since inference from degree/count alone is
  // exactly what density_not_sufficient warns against.
  const bridgeCells = edges
    .filter((_, index) => componentCount(nodes, edges.filter((_, other) => other !== index)) > components)
    .map((edge) => edge.label);
  return Object.freeze({
    entities: nodes.length,
    cells: edges.length,
    components,
    h1Rank,
    loadBearing: h1Rank >= 1,
    bridgeCells: Object.freeze(bridgeCells),
  });
}

export function edgesFromPools(pools: readonly { readonly pair: string }[]): readonly Edge[] {
  return Object.freeze(pools.flatMap((pool) => {
    const [a, b] = pool.pair.split(":");
    return a && b ? [Object.freeze({ label: pool.pair, a, b })] : [];
  }));
}

/** Whether a detected cycle's own path crosses at least one bridge cell --
 *  a per-cycle fragility flag distinct from the whole-graph reading. */
export function cyclePathIsBridgeFragile(path: readonly string[], venues: readonly string[], bridgeCells: readonly string[]): boolean {
  const bridgeSet = new Set(bridgeCells);
  return venues.some((venue) => bridgeSet.has(venue.replace(/^pool:/, "")));
}
