// analysis/intelligence — the composite voting intelligence. Folds every lens
// into one per-post expected-captured-alpha and the weight that captures it,
// plus the reads that only exist at the composite level:
//
//   • Sheaf layer-disagreement. The attention field is not one scalar but
//     several that should agree: PAYOUT (what the post is paid) and
//     ENDORSEMENT (net_rshares — genuine stake behind it). A post paid high
//     but thinly endorsed (or richly endorsed yet underpaid) is a layer
//     disagreement — the underpaid-but-endorsed case is the purest sink.
//
//   • Kirchhoff optimal weight. Conservation says reward flux balances. A
//     sink is a node where the law is violated — reward flows in below its
//     neighbourhood. The vote is the missing edge whose current restores
//     balance; the optimal current is exactly the node's deficit. So the
//     principled vote weight is proportional to the deficit (clamped to
//     mana/risk), not a flat default.
//
//   • Reflexive lambda-2 discount. Taking alpha changes the field: a vote
//     adds stake and partially closes the gap it harvests, and the gap
//     closes on its own at rate lambda-2 (the spectral decay constant).
//     Expected alpha is discounted by a bounded first-order factor of
//     lambda-2 — price-taker for small capital, decayed for the field's own
//     diffusion.

import type { PostCandidate } from "../core/core.adapter.ts";
import { readTimingOf, type TimingReading } from "./timing.mts";
import { readRewardRoutes, type RewardRouteReading } from "./reward.mts";
import { readContent, type ContentReading } from "./content.mts";
import { readSignals, type SignalReading } from "./signals.mts";
import { readSpectral, type SpectralReading, type WeightedEdge } from "./spectral.mts";
import { formanCurvature, readCartels, readDurability, type CartelReading, type CurvatureReading } from "./graph.mts";

const SCORE_CAP = 64;

// Not floored: flooring to an integer bucket destroys nearly all signal for
// posts paid well under $1 (a floor(0.4) and a floor(0.85) are both 0), which
// is exactly the scale a small test wallet's own candidate field often sits
// at. The soft cap still bounds a single post's leverage over the durability
// filtration's threshold sweep.
function payoutBucket(pendingPayout: number): number {
  if (!Number.isFinite(pendingPayout) || pendingPayout < 0) return 0;
  return Math.min(pendingPayout, SCORE_CAP);
}

export interface PostIntelligence {
  readonly key: string;
  readonly deficit: number;
  readonly expectedAlpha: number;
  readonly kirchhoffWeightBps: number;
  readonly likelyCartelTrail: boolean;
  readonly bridge: boolean;
  readonly timingScore: number;
  readonly engagement: number;
  readonly contentFitness: number;
  readonly durability: number;
  readonly cartelExposure: number;
  readonly downvotePressure: number;
  readonly frustration: number;
  readonly layerDisagreement: number;
  readonly reflexiveDiscount: number;
}

export interface CompositeIntelligence {
  readonly spectral: SpectralReading;
  readonly curvature: CurvatureReading;
  readonly cartels: CartelReading;
  readonly bridges: readonly string[];
  readonly posts: readonly PostIntelligence[];
}

/** Build the post<->tag bipartite attention graph as a node set + weighted
 *  edges, shared by the spectral and curvature reads. */
function attentionGraph(posts: readonly PostCandidate[]): { nodes: Set<string>; edges: WeightedEdge[]; adjacency: Map<string, Set<string>> } {
  const nodes = new Set<string>();
  const edges: WeightedEdge[] = [];
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };
  for (const p of posts) {
    const pk = `p:${p.author}/${p.permlink}`;
    nodes.add(pk);
    for (const t of p.tags) {
      const tk = `t:${t}`;
      nodes.add(tk);
      edges.push({ a: pk, b: tk, w: 1 });
      link(pk, tk);
    }
  }
  return { nodes, edges, adjacency };
}

/**
 * Read the full composite voting intelligence over a candidate cohort.
 * `sinkDeficits` come from the alpha radar (the Laplacian deviation
 * magnitude), keyed `${author}/${permlink}`.
 */
export function readVotingIntelligenceOf(posts: readonly PostCandidate[], sinkDeficits: ReadonlyMap<string, number>, nowMs?: number): CompositeIntelligence {
  const reward = readRewardRoutes(posts);
  const content = readContent(posts);
  const signals = readSignals(posts);
  const durability = readDurability(posts, (p) => payoutBucket(p.pendingPayout));
  const { nodes, edges, adjacency } = attentionGraph(posts);
  const spectral = readSpectral(nodes, edges);
  const curvature = formanCurvature(adjacency);
  const cartels = readCartels(posts);

  const cartelVoters = new Set<string>();
  for (const pair of cartels.tightPairs) {
    cartelVoters.add(pair.a);
    cartelVoters.add(pair.b);
  }

  const bridgePosts = new Set<string>();
  for (const e of curvature.bridges) {
    if (e.a.startsWith("p:")) bridgePosts.add(e.a.slice(2));
    if (e.b.startsWith("p:")) bridgePosts.add(e.b.slice(2));
  }

  const maxPayout = Math.max(1, ...posts.map((p) => payoutBucket(p.pendingPayout)));
  const maxEndorse = Math.max(1, ...posts.map((p) => Math.max(0, p.netRshares)));
  const maxDeficit = Math.max(1, ...[...sinkDeficits.values()]);

  // Reflexive discount: the field self-corrects at rate lambda-2. Larger
  // lambda-2 => faster decay => less of the edge survives to when it would be
  // realised. Bounded to (0,1].
  const reflexiveDiscount = spectral.fiedler > 0 ? 1 / (1 + spectral.fiedler) : 1;

  const out: PostIntelligence[] = [];
  for (const p of posts) {
    const key = `${p.author}/${p.permlink}`;
    const deficit = sinkDeficits.get(key) ?? 0;
    const rr: RewardRouteReading | undefined = reward.get(key);
    const captureEfficiency = rr?.captureEfficiency ?? 1;
    const timing: TimingReading = readTimingOf(p, nowMs);
    const timingScore = timing.timingScore;
    const likelyCartelTrail = timing.likelyCartelTrail;
    const cr: ContentReading | undefined = content.get(key);
    const contentFitness = cr?.fitness ?? 0;
    const dur = durability.get(key)?.persistence ?? 0;
    const bridge = bridgePosts.has(key);
    const sig: SignalReading | undefined = signals.get(key);
    const downvotePressure = sig?.downvotePressure ?? 0;
    const frustration = sig?.frustration ?? 0;
    const engagement = sig?.engagement ?? 0;

    const voters = (p.votes ?? []).slice(0, 40).map((v) => v.voter);
    const inRing = voters.filter((v) => cartelVoters.has(v)).length;
    const cartelExposure = voters.length > 0 ? inRing / voters.length : 0;

    const nPay = payoutBucket(p.pendingPayout) / maxPayout;
    const nEnd = Math.max(0, p.netRshares) / maxEndorse;
    const layerDisagreement = Math.abs(nPay - nEnd);

    const trailPenalty = likelyCartelTrail ? 0.4 : 1;
    const downvoteFactor = sig?.downvoted ? 0 : 1 - 0.5 * frustration;
    const expectedAlpha =
      deficit *
      captureEfficiency *
      timingScore *
      (1 + 0.5 * contentFitness) *
      (1 + 0.5 * dur) *
      (1 + 0.2 * engagement) *
      (bridge ? 1.25 : 1) *
      (1 - 0.5 * cartelExposure) *
      downvoteFactor *
      trailPenalty *
      reflexiveDiscount;

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
      reflexiveDiscount,
    }));
  }
  out.sort((a, b) => b.expectedAlpha - a.expectedAlpha);

  return Object.freeze({
    spectral,
    curvature,
    cartels,
    bridges: Object.freeze([...bridgePosts]),
    posts: Object.freeze(out),
  });
}
