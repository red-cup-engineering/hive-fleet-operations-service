// analysis/holonomy — arbitrage as holonomy, per the firm's own Distal Bypass
// framing (executive-office/content/documents/articles/notes/2026/07/16/
// 2026-07-16-the-distal-bypass.md) and, independently, the classical
// Fundamental Theorem of Asset Pricing (Delbaen-Schachermayer): no arbitrage
// is equivalent to the existence of an equivalent martingale measure, which
// in log-price terms is exactly the condition that log-prices around any
// cycle of venues form a COBOUNDARY — every cycle sums to zero. A market
// that fails this is not "mispriced" in the vague sense; it carries a
// nonzero holonomy, a real number, on that specific cycle, and that number
// (exponentiated) IS the arbitrage profit before fees.
//
// The existing corridor check (readLiquidity's `corridors`) only compares
// TWO venues quoting the SAME pair — a 2-cycle. This module generalises to
// every cycle the observed price graph actually carries: build the graph of
// every quoted exchange rate as a directed, log-weighted edge; pick a
// spanning tree; every edge outside the tree closes a cycle whose signed
// log-price sum (its holonomy) is read directly, without ever computing an
// actual price level, exactly as Cech cohomology reads an obstruction from
// local data alone. A HIVE -> DEC -> SWAP.HIVE -> HIVE triangular route the
// pairwise check cannot see at all is exactly the kind of cycle this closes.
//
// This is deliberately conservative: a fee estimate along the WHOLE round
// trip through the graph's root is charged against every cycle, which
// overcounts the true fee for cycles whose real path is shorter — erring
// toward understating profit, never overstating it.

import type { LiquidityReading } from "../core/core.adapter.ts";

export interface PriceEdge {
  readonly from: string;
  readonly to: string;
  readonly venue: string;
  /** Price of one unit of `from` in units of `to`. */
  readonly rate: number;
  readonly feeBps: number;
}

export interface DirectedCycleHop extends PriceEdge {}

export interface ArbitrageCycle {
  /** Node sequence, first repeated as last: e.g. ["HIVE","DEC","SWAP.HIVE","HIVE"]. */
  readonly path: readonly string[];
  readonly venues: readonly string[];
  /** The exact directed edges whose rates multiply in `path` order. */
  readonly hops: readonly DirectedCycleHop[];
  /** Raw positive log-holonomy around the emitted direction, scaled by
   *  10,000. The exact gross return is `grossReturnBps`. */
  readonly holonomyBps: number;
  /** Exact gross multiplicative return of the emitted direction, in bps. */
  readonly grossReturnBps: number;
  /** Exact gross return after multiplying every hop's estimated fee factor. */
  readonly netHolonomyBps: number;
  /** Midpoints, spot pool ratios, non-atomic reads, and proxy capacity make
   *  this an observation, never an execution instruction. */
  readonly executionAdmissible: false;
  readonly evidenceGaps: readonly string[];
}

/** Parse a venue pair ("HIVE/HBD") or pool pair ("DEC:SWAP.HIVE") into its
 *  two asset symbols. */
function parsePair(pair: string): readonly [string, string] | null {
  const sep = pair.includes("/") ? "/" : pair.includes(":") ? ":" : null;
  if (!sep) return null;
  const [a, b] = pair.split(sep);
  if (!a || !b) return null;
  return [a, b];
}

// A pool below this quote-asset TVL cannot absorb even a modest few-unit
// trade without slippage swamping any apparent divergence -- its implied
// price is real in the sense that it would move a small trade a long way,
// not in the sense that a few-unit trade clears anywhere near it. Shared
// with core.adapter.ts's own corridor check, which carries the identical
// one-sided-venue and thin-pool exposure this module was built to fix.
export const MIN_POOL_TVL_QUOTE = 1000;

/** Build the directed, log-weighted price graph from a liquidity reading:
 *  one forward and one reverse edge per quoted venue and pool.
 *
 *  A one-sided order book (bidDepth or askDepth exactly 0) is not a real
 *  two-sided price -- it is degenerate, and comparing it against a genuine
 *  quote elsewhere manufactures "arbitrage" out of the side that has no
 *  liquidity to actually fill, not out of any real market disagreement.
 *  A pool thinner than MIN_POOL_TVL_QUOTE is excluded for the same reason:
 *  its implied price is not one a real trade could clear near. */
export function edgesFromLiquidity(liquidity: LiquidityReading): readonly PriceEdge[] {
  const edges: PriceEdge[] = [];
  const add = (from: string, to: string, venue: string, rate: number, feeBps: number): void => {
    if (!Number.isFinite(rate) || rate <= 0) return;
    edges.push(Object.freeze({ from, to, venue, rate, feeBps }));
    edges.push(Object.freeze({ from: to, to: from, venue, rate: 1 / rate, feeBps }));
  };
  for (const venue of liquidity.venues) {
    const pair = parsePair(venue.pair);
    if (!pair || venue.midpoint <= 0) continue;
    if (venue.bidDepth <= 0 || venue.askDepth <= 0) continue;
    add(pair[0], pair[1], venue.venue, venue.midpoint, venue.relativeSpreadBps / 2);
  }
  for (const pool of liquidity.pools) {
    const pair = parsePair(pool.pair);
    if (!pair || pool.impliedPrice <= 0) continue;
    if (pool.tvlQuote < MIN_POOL_TVL_QUOTE) continue;
    add(pair[0], pair[1], `pool:${pool.pair}`, pool.impliedPrice, pool.feeBps);
  }
  return Object.freeze(edges);
}

interface TreeEntry {
  readonly parent: string | null;
  readonly viaVenue: string;
  /** Directed tree edge from parent to this node; absent at a root. */
  readonly viaRate: number;
  readonly viaFeeBps: number;
  readonly logPotential: number;
  readonly depth: number;
}

/** BFS spanning tree from an arbitrary root, tracking cumulative signed
 *  log-price (the node's "potential"). */
function spanningTree(nodes: readonly string[], edges: readonly PriceEdge[]): Map<string, TreeEntry> {
  const adjacency = new Map<string, PriceEdge[]>();
  for (const e of edges) (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e);

  const tree = new Map<string, TreeEntry>();
  for (const root of nodes) {
    if (tree.has(root)) continue; // already reached from an earlier component's root
    tree.set(root, Object.freeze({ parent: null, viaVenue: "", viaRate: 1, viaFeeBps: 0, logPotential: 0, depth: 0 }));
    const queue: string[] = [root];
    while (queue.length > 0) {
      const u = queue.shift()!;
      const uEntry = tree.get(u)!;
      for (const e of adjacency.get(u) ?? []) {
        if (tree.has(e.to)) continue;
        tree.set(e.to, Object.freeze({
          parent: u,
          viaVenue: e.venue,
          viaRate: e.rate,
          viaFeeBps: e.feeBps,
          logPotential: uEntry.logPotential + Math.log(e.rate),
          depth: uEntry.depth + 1,
        }));
        queue.push(e.to);
      }
    }
  }
  return tree;
}

function pathToRoot(tree: ReadonlyMap<string, TreeEntry>, node: string): string[] {
  const path: string[] = [node];
  let current = node;
  for (;;) {
    const entry = tree.get(current);
    if (!entry || entry.parent === null) break;
    current = entry.parent;
    path.push(current);
  }
  return path;
}

function freezeHop(from: string, to: string, venue: string, rate: number, feeBps: number): DirectedCycleHop {
  return Object.freeze({ from, to, venue, rate, feeBps });
}

/** Return the directed tree route from `from` to `to` through their LCA. */
function treeRoute(tree: ReadonlyMap<string, TreeEntry>, from: string, to: string): readonly DirectedCycleHop[] {
  const fromToRoot = pathToRoot(tree, from);
  const toToRoot = pathToRoot(tree, to);
  const toSet = new Set(toToRoot);
  const lca = fromToRoot.find((node) => toSet.has(node));
  if (!lca) return Object.freeze([]);

  const hops: DirectedCycleHop[] = [];
  let current = from;
  while (current !== lca) {
    const entry = tree.get(current);
    if (!entry || entry.parent === null) return Object.freeze([]);
    hops.push(freezeHop(current, entry.parent, entry.viaVenue, 1 / entry.viaRate, entry.viaFeeBps));
    current = entry.parent;
  }

  const downNodes = toToRoot.slice(0, toToRoot.indexOf(lca)).reverse();
  for (const child of downNodes) {
    const entry = tree.get(child);
    if (!entry || entry.parent === null) return Object.freeze([]);
    hops.push(freezeHop(entry.parent, child, entry.viaVenue, entry.viaRate, entry.viaFeeBps));
  }
  return Object.freeze(hops);
}

function reverseRoute(hops: readonly DirectedCycleHop[]): readonly DirectedCycleHop[] {
  return Object.freeze([...hops].reverse().map((hop) => freezeHop(hop.to, hop.from, hop.venue, 1 / hop.rate, hop.feeBps)));
}

function routeProduct(hops: readonly DirectedCycleHop[]): number {
  return hops.reduce((product, hop) => product * hop.rate, 1);
}

function netRouteProduct(hops: readonly DirectedCycleHop[]): number {
  return hops.reduce((product, hop) => product * hop.rate * Math.max(0, 1 - hop.feeBps / 10_000), 1);
}

/** A rotation-invariant identity that preserves direction, venues, and
 *  repeated assets. Distinct routes over the same asset set remain distinct. */
function directedCycleKey(hops: readonly DirectedCycleHop[]): string {
  const labels = hops.map((hop) => `${hop.from}>${hop.to}@${hop.venue}`);
  if (labels.length === 0) return "";
  const rotations = labels.map((_, index) => [...labels.slice(index), ...labels.slice(0, index)].join("|"));
  rotations.sort();
  return rotations[0]!;
}

function isTreeEdge(tree: ReadonlyMap<string, TreeEntry>, edge: PriceEdge): boolean {
  const to = tree.get(edge.to);
  if (to?.parent === edge.from && to.viaVenue === edge.venue) return true;
  const from = tree.get(edge.from);
  return from?.parent === edge.to && from.viaVenue === edge.venue;
}

/** Detect every cycle a co-tree edge closes, and its holonomy. */
export function detectHolonomy(edges: readonly PriceEdge[], options: { readonly minNetHolonomyBps?: number; readonly limit?: number } = {}): readonly ArbitrageCycle[] {
  const minNet = options.minNetHolonomyBps ?? 15;
  const limit = options.limit ?? 10;
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  if (nodes.length === 0) return Object.freeze([]);
  const tree = spanningTree(nodes, edges);

  const cycles: ArbitrageCycle[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const u = tree.get(e.from);
    const v = tree.get(e.to);
    if (!u || !v) continue;
    // The exact tree edge and its same-venue reciprocal close no cycle. A
    // parallel edge on another venue does close a real two-venue cycle and
    // must not be discarded merely because it joins the same assets.
    if (isTreeEdge(tree, e)) continue;

    let hops: readonly DirectedCycleHop[] = Object.freeze([
      freezeHop(e.from, e.to, e.venue, e.rate, e.feeBps),
      ...treeRoute(tree, e.to, e.from),
    ]);
    if (hops.length < 2 || hops[hops.length - 1]?.to !== hops[0]?.from) continue;

    let grossProduct = routeProduct(hops);
    if (!Number.isFinite(grossProduct) || grossProduct <= 0 || Math.abs(grossProduct - 1) < Number.EPSILON) continue;
    // A negative signed holonomy means the constructed route loses. Reverse
    // the actual hops—not merely the number—so the emitted path and rates
    // always describe the profitable orientation they claim to describe.
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

    const path = Object.freeze([hops[0]!.from, ...hops.map((hop) => hop.to)]);
    const venues = Object.freeze(hops.map((hop) => hop.venue));
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
        "route-capacity-is-not-hard-sized-through-every-hop",
      ]),
    }));
  }

  cycles.sort((a, b) => b.netHolonomyBps - a.netHolonomyBps);
  return Object.freeze(cycles.slice(0, limit));
}

/** Read every significant arbitrage cycle directly off a liquidity reading. */
export function readHolonomy(liquidity: LiquidityReading, options?: { readonly minNetHolonomyBps?: number; readonly limit?: number }): readonly ArbitrageCycle[] {
  return detectHolonomy(edgesFromLiquidity(liquidity), options);
}
