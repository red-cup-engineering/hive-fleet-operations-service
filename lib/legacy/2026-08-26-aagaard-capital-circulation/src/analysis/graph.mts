// analysis/graph — discrete-geometry reads over the attention/co-vote graphs.
//
// Three structural lenses, each surfacing an opportunity (or a trap) the
// scalar radar cannot see:
//
//   • Forman-Ricci curvature. Per edge, a combinatorial Ricci curvature.
//     Strongly negative-curvature edges are bridges — they connect two
//     otherwise weakly-linked communities. A post that bridges communities
//     reaches an audience the crowd under-prices precisely because it sits
//     between their silos: a high-reach, low-competition vote. Positive
//     curvature = inside a dense clique (already saturated).
//
//   • Cycle space / first Betti number b1 = E - V + components. b1 is the rank
//     of H1 - the number of independent cycles. In the account co-vote graph
//     (accounts joined when they vote the same posts), tight cycle-dense
//     clusters are mutual-voting rings: cartels.
//
//   • Persistent homology over a reward filtration. Sweep a payout threshold
//     from high to low; a sink that survives as its own connected component
//     across a wide threshold band has a long persistence bar - durable,
//     structurally-isolated alpha - versus one that immediately merges into
//     the bulk (transient).
//
// All combinatorial, native arithmetic.

import type { PostCandidate } from "../core/core.adapter.ts";

export interface CurvatureEdge {
  readonly a: string;
  readonly b: string;
  readonly curvature: number;
}

export interface CurvatureReading {
  readonly edges: readonly CurvatureEdge[];
  readonly bridges: readonly CurvatureEdge[];
}

/** Forman-Ricci curvature of every edge of an unweighted simple graph given as
 *  an adjacency map. F(u,v) = 4 - deg(u) - deg(v). */
export function formanCurvature(adjacency: ReadonlyMap<string, ReadonlySet<string>>): CurvatureReading {
  const edges: CurvatureEdge[] = [];
  const seen = new Set<string>();
  for (const [u, nbrs] of adjacency) {
    for (const v of nbrs) {
      const key = u < v ? `${u} ${v}` : `${v} ${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const du = adjacency.get(u)?.size ?? 0;
      const dv = adjacency.get(v)?.size ?? 0;
      edges.push({ a: u, b: v, curvature: 4 - du - dv });
    }
  }
  const bridges = [...edges].sort((x, y) => x.curvature - y.curvature).slice(0, 8);
  return Object.freeze({ edges: Object.freeze(edges), bridges: Object.freeze(bridges) });
}

export interface CycleReading {
  readonly nodes: number;
  readonly edges: number;
  readonly components: number;
  readonly b1: number;
  readonly cycleDensity: number;
}

function unionFind(nodes: readonly string[]): { find: (x: string) => string; union: (a: string, b: string) => void } {
  const parent = new Map<string, string>(nodes.map((n) => [n, n]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) ?? r;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c) ?? r;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { find, union };
}

/** Cycle-space dimension (b1) of a graph given as an undirected edge list. */
export function cycleSpace(nodeSet: Iterable<string>, edgeList: readonly { a: string; b: string }[]): CycleReading {
  const nodes = [...new Set([...nodeSet, ...edgeList.flatMap((e) => [e.a, e.b])])];
  const { find, union } = unionFind(nodes);
  const undirected = new Set<string>();
  for (const e of edgeList) {
    if (e.a === e.b) continue;
    undirected.add(e.a < e.b ? `${e.a} ${e.b}` : `${e.b} ${e.a}`);
    union(e.a, e.b);
  }
  const roots = new Set(nodes.map(find));
  const components = roots.size || (nodes.length > 0 ? 1 : 0);
  const E = undirected.size;
  const V = nodes.length;
  const b1 = Math.max(0, E - V + components);
  return Object.freeze({ nodes: V, edges: E, components, b1, cycleDensity: b1 / Math.max(1, V) });
}

/** Build the account co-vote graph: an undirected edge between two voters for
 *  each post they both voted, with a co-vote count. */
export function coVoteGraph(posts: readonly PostCandidate[]): {
  adjacency: Map<string, Set<string>>;
  edges: { a: string; b: string; w: number }[];
} {
  const pairCount = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  for (const p of posts) {
    const voters = (p.votes ?? []).map((v) => v.voter);
    // Bound the per-post voter set so a 1000-vote whale post does not blow up
    // to ~500k pairs: cap deterministically.
    const capped = voters.slice(0, 40);
    for (let i = 0; i < capped.length; i++) {
      for (let j = i + 1; j < capped.length; j++) {
        const a = capped[i]!;
        const b = capped[j]!;
        if (a === b) continue;
        const key = a < b ? `${a} ${b}` : `${b} ${a}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
        (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
      }
    }
  }
  const edges = [...pairCount].map(([key, w]) => {
    const [a, b] = key.split(" ");
    return { a: a!, b: b!, w };
  });
  return { adjacency, edges };
}

export interface CartelReading {
  readonly cycle: CycleReading;
  readonly tightPairs: readonly { readonly a: string; readonly b: string; readonly coVotes: number }[];
}

/** Detect curation cartels: cycle-dense clusters in the co-vote graph plus the
 *  voter pairs that co-vote far more than chance. */
export function readCartels(posts: readonly PostCandidate[]): CartelReading {
  const { edges } = coVoteGraph(posts);
  // Only edges with repeated co-voting (w >= 2) carry cartel signal.
  const ring = edges.filter((e) => e.w >= 2);
  const cycle = cycleSpace(ring.flatMap((e) => [e.a, e.b]), ring);
  const tightPairs = [...edges]
    .sort((x, y) => y.w - x.w)
    .slice(0, 10)
    .filter((e) => e.w >= 2)
    .map((e) => ({ a: e.a, b: e.b, coVotes: e.w }));
  return Object.freeze({ cycle, tightPairs: Object.freeze(tightPairs) });
}

export interface DurabilityReading {
  readonly author: string;
  readonly permlink: string;
  readonly persistence: number;
}

/** Persistent-homology (H0) durability over a reward-threshold filtration of
 *  the post<->tag graph: how long each post survives as an isolated component
 *  as the payout threshold descends. */
export function readDurability(posts: readonly PostCandidate[], scoreOf: (p: PostCandidate) => number): Map<string, DurabilityReading> {
  const out = new Map<string, DurabilityReading>();
  if (posts.length === 0) return out;
  const scored = posts.map((p) => ({ p, key: `${p.author}/${p.permlink}`, s: scoreOf(p) }));
  const maxS = Math.max(1, ...scored.map((x) => x.s));
  const LEVELS = 12;
  const tagOwners = new Map<string, string[]>();
  for (const x of scored) for (const t of x.p.tags) (tagOwners.get(t) ?? tagOwners.set(t, []).get(t)!).push(x.key);

  for (const x of scored) {
    let isolatedLevels = 0;
    let includedLevels = 0;
    for (let l = LEVELS; l >= 1; l--) {
      const tau = (l / LEVELS) * maxS;
      if (x.s < tau) continue;
      includedLevels++;
      let merged = false;
      for (const t of x.p.tags) {
        for (const ownerKey of tagOwners.get(t) ?? []) {
          if (ownerKey === x.key) continue;
          const other = scored.find((o) => o.key === ownerKey);
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
    out.set(x.key, Object.freeze({ author: x.p.author, permlink: x.p.permlink, persistence }));
  }
  return out;
}
