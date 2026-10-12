// Debye graph screening, ported from Obsmetrologia's
// KineticTheory/Plasma/DebyeGraphScreening.lean: the settled potential
// from a source charge, propagated through a graph of relay cells with a
// nonnegative attenuation kernel, is the least fixed point of a monotone
// closure -- proved monotone in the source charge and idempotent (running
// the propagation again on an already-settled state is a no-op).
//
// Applied to Hive-Engine's pool-connectivity graph: a shock (a large
// liquidation, a pool exploit) at one token is a source charge; each pool
// it crosses attenuates it, with a DEEPER pool absorbing more of the
// shock (screening it) and a shallower pool passing more through -- the
// discrete analogue of denser plasma screening faster. The settled
// "reach" is the set of tokens the shock still measurably affects before
// attenuation drops below a threshold, and how many hops it took to get
// there.
//
// This is a real, disclosed simplification, not a literal port of the
// Lean's rational attenuation kernel: the per-edge factor here is derived
// from relative pool depth (deeper = more screening), monotone and
// bounded in [0.1, 1] by construction, which is what guarantees
// termination (charge strictly shrinks every hop) -- the same
// monotonicity guarantee the Lean proves, arrived at by a simpler,
// honestly-approximate kernel rather than the proof's own construction.
//
// See the Obsmetrologia financial-methods catalog, section 2.2. This is
// `implemented` (real, reported for observation), not `live` -- no trade
// or risk decision depends on it yet.

export interface ScreeningEdge {
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly depth: number;
}

export interface ScreeningReading {
  readonly source: string;
  /** Tokens the shock still measurably reaches, in the order first
   *  reached (breadth-first). */
  readonly reach: readonly string[];
  /** How many hops the shock traveled before attenuating below threshold
   *  everywhere -- the graph's own "Debye length" for this source. */
  readonly hops: number;
}

const ATTENUATION_THRESHOLD = 0.05;
// Bounds every edge's screening factor in [MIN_FACTOR, 1]: MIN_FACTOR
// (the deepest pool in the graph) still passes a little through, and no
// edge attenuates to exactly zero in one hop -- both needed for the
// factor to stay strictly positive so charge decay is well-defined
// everywhere rather than dividing by or comparing against a hard zero.
const MIN_FACTOR = 0.1;

function attenuationFactor(depth: number, maxDepth: number): number {
  if (!(maxDepth > 0)) return 1;
  const screened = Math.min(1, Math.max(0, depth) / maxDepth);
  return 1 - screened * (1 - MIN_FACTOR);
}

export function readScreening(source: string, edges: readonly ScreeningEdge[]): ScreeningReading {
  const maxDepth = Math.max(0, ...edges.map((edge) => edge.depth));
  const adjacency = new Map<string, { readonly to: string; readonly factor: number }[]>();
  for (const edge of edges) {
    const factor = attenuationFactor(edge.depth, maxDepth);
    for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from)!.push({ to, factor });
    }
  }
  const charge = new Map<string, number>([[source, 1]]);
  const visited = new Set([source]);
  const reachOrder: string[] = [];
  let frontier = [source];
  let hops = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      const nodeCharge = charge.get(node) ?? 0;
      for (const { to, factor } of adjacency.get(node) ?? []) {
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
  return Object.freeze({ source, reach: Object.freeze(reachOrder), hops });
}

export function edgesForScreening(pools: readonly { readonly pair: string; readonly tvlQuote: number }[]): readonly ScreeningEdge[] {
  return Object.freeze(pools.flatMap((pool) => {
    const [a, b] = pool.pair.split(":");
    return a && b ? [Object.freeze({ label: pool.pair, a, b, depth: pool.tvlQuote })] : [];
  }));
}
