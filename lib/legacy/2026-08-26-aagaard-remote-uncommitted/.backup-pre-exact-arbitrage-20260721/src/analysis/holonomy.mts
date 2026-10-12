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

export interface ArbitrageCycle {
  /** Node sequence, first repeated as last: e.g. ["HIVE","DEC","SWAP.HIVE","HIVE"]. */
  readonly path: readonly string[];
  readonly venues: readonly string[];
  /** Raw log-holonomy around the cycle, in basis points: the profit fraction
   *  (times 10,000) of executing the cycle once, before fees. Positive means
   *  traversing `path` in the given order profits. */
  readonly holonomyBps: number;
  /** holonomyBps less a conservative round-trip fee estimate. */
  readonly netHolonomyBps: number;
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
  readonly logPotential: number;
  readonly feePotential: number;
  readonly depth: number;
}

/** BFS spanning tree from an arbitrary root, tracking cumulative signed
 *  log-price (the node's "potential") and cumulative fee cost from the root. */
function spanningTree(nodes: readonly string[], edges: readonly PriceEdge[]): Map<string, TreeEntry> {
  const adjacency = new Map<string, PriceEdge[]>();
  for (const e of edges) (adjacency.get(e.from) ?? adjacency.set(e.from, []).get(e.from)!).push(e);

  const tree = new Map<string, TreeEntry>();
  for (const root of nodes) {
    if (tree.has(root)) continue; // already reached from an earlier component's root
    tree.set(root, Object.freeze({ parent: null, viaVenue: "", logPotential: 0, feePotential: 0, depth: 0 }));
    const queue: string[] = [root];
    while (queue.length > 0) {
      const u = queue.shift()!;
      const uEntry = tree.get(u)!;
      for (const e of adjacency.get(u) ?? []) {
        if (tree.has(e.to)) continue;
        tree.set(e.to, Object.freeze({
          parent: u,
          viaVenue: e.venue,
          logPotential: uEntry.logPotential + Math.log(e.rate),
          feePotential: uEntry.feePotential + e.feeBps,
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
    // A tree edge itself closes no cycle (its own holonomy is 0 by
    // construction); only a co-tree edge carries signal.
    if (u.viaVenue !== "" && tree.get(e.from)?.parent === e.to) continue;
    if (v.parent === e.from && v.viaVenue === e.venue) continue;

    const holonomy = u.logPotential + Math.log(e.rate) - v.logPotential;
    const holonomyBps = holonomy * 10_000;
    // Conservative round-trip fee: the tree path in, this edge, the tree
    // path back out — overcounting a cycle whose true path is shorter than
    // going via the root, which understates profit rather than overstating it.
    const feeBps = u.feePotential + e.feeBps + v.feePotential;
    const netHolonomyBps = Math.abs(holonomyBps) - feeBps;
    if (netHolonomyBps < minNet) continue;

    const toRootFromU = pathToRoot(tree, e.from);
    const toRootFromV = pathToRoot(tree, e.to);
    const vSet = new Set(toRootFromV);
    let lca = toRootFromU[toRootFromU.length - 1]!;
    const uToLca: string[] = [];
    for (const node of toRootFromU) {
      uToLca.push(node);
      if (vSet.has(node)) {
        lca = node;
        break;
      }
    }
    const vToLca = toRootFromV.slice(0, toRootFromV.indexOf(lca) + 1);
    // uToLca runs e.from -> ... -> lca; vToLca (reversed, minus its own lca
    // duplicate) runs lca -> ... -> e.to; the edge itself closes e.to back to
    // e.from — so this is already a closed cycle, first element repeated last.
    const path = Object.freeze([...uToLca, ...vToLca.slice(0, -1).reverse(), e.from]);
    const key = [...new Set(path)].sort().join(",");
    if (seen.has(key)) continue;
    seen.add(key);

    const venues = Object.freeze([
      ...uToLca.slice(1).map((node, i) => tree.get(uToLca[i]!)?.viaVenue ?? tree.get(node)!.viaVenue),
      ...vToLca.slice(0, -1).map((node) => tree.get(node)!.viaVenue).reverse(),
      e.venue,
    ].filter((venue) => venue !== ""));

    cycles.push(Object.freeze({
      path,
      venues,
      holonomyBps: Number(holonomyBps.toFixed(3)),
      netHolonomyBps: Number(netHolonomyBps.toFixed(3)),
    }));
  }

  cycles.sort((a, b) => b.netHolonomyBps - a.netHolonomyBps);
  return Object.freeze(cycles.slice(0, limit));
}

/** Read every significant arbitrage cycle directly off a liquidity reading. */
export function readHolonomy(liquidity: LiquidityReading, options?: { readonly minNetHolonomyBps?: number; readonly limit?: number }): readonly ArbitrageCycle[] {
  return detectHolonomy(edgesFromLiquidity(liquidity), options);
}
