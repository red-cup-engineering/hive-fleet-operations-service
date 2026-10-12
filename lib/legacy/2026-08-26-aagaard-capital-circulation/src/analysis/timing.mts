// analysis/timing — the HF25 curation-reward time window and the vote-timing
// diffraction spectrum.
//
// This is the single highest-leverage read for curation reward, and it lives
// in data nobody bothers with raw: the post's creation time and the per-post
// active-votes list — each vote's voter, rshares, and timestamp. Under two
// lenses it is the difference between capturing a share of the mint and
// donating mana to a cartel:
//
//   1. Curation time window (mainnet HF25 "Equilibrium", 2021-06-30). The
//      pre-HF25 five-minute reverse auction — which forfeited early-vote
//      curation back to the pool — was removed:
//        • no early-vote penalty — voting fresh is no longer punished;
//        • the first 24h is a flat early window (divisor 1): curation is paid
//          on Hive Power x weight with no time-based diminishment;
//        • the next 48h (24-72h) is the mid window (divisor 2 — half weight);
//        • 72h to the 7-day payout is the late window (divisor 8 — eighth);
//        • once the 7-day cashout passes there is no curation at all.
//      (This module owns only the time window; curation SATURATION — the
//      pro-rata rshares split — is owned by analysis/reward's
//      captureEfficiency, so the two never double-count.)
//
//   2. Diffraction spectrum. A genuine organic curation has irregularly
//      spaced votes (a broad, high-entropy inter-arrival spectrum). An
//      automated trail or cartel votes in lockstep — a sharp peak in the
//      inter-arrival histogram, low timing entropy. High regularity means the
//      curation reward on that post is already being swept by a bot train;
//      expected share is small even if the post looks under-priced. The
//      diffraction spectrum is thus a cartel/bot authenticity radar over
//      votes.
//
// All native arithmetic over the snapshot's vote rows.

import type { PostCandidate } from "../core/core.adapter.ts";

export type CurationWindow = "early" | "mid" | "late" | "closed";

const EARLY_WINDOW_SECONDS = 24 * 3600;
const MID_WINDOW_SECONDS = 72 * 3600;
export const CASHOUT_WINDOW_SECONDS = 7 * 24 * 3600;

/** The HF25 curation phase a post sits in at a given age, taken directly from
 *  the chain-exact hardfork windows so this heuristic never drifts from the
 *  real reward. */
export function curationWindow(ageSeconds: number): CurationWindow {
  if (ageSeconds < EARLY_WINDOW_SECONDS) return "early";
  if (ageSeconds < MID_WINDOW_SECONDS) return "mid";
  if (ageSeconds < CASHOUT_WINDOW_SECONDS) return "late";
  return "closed";
}

export function curationPenaltyDivisor(window: CurationWindow): number {
  switch (window) {
    case "early":
      return 1;
    case "mid":
      return 2;
    case "late":
      return 8;
    case "closed":
      return 0;
  }
}

export interface TimingReading {
  readonly author: string;
  readonly permlink: string;
  readonly voteCount: number;
  readonly ageSeconds: number;
  readonly windowPhase: CurationWindow;
  readonly trainRegularity: number;
  readonly timingEntropy: number;
  readonly likelyCartelTrail: boolean;
  readonly timingScore: number;
}

/** The HF25 time-window curation multiplier from a post's age alone: 1 in the
 *  first 24h (full, no early penalty), 1/2 in the 24-72h mid window, 1/8 in
 *  the 72h-7d late window, 0 once the post has paid out. */
export function curationWindowFactor(ageSeconds: number): number {
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) return 1; // unknown age -> assume fresh
  if (ageSeconds >= CASHOUT_WINDOW_SECONDS) return 0;
  const divisor = curationPenaltyDivisor(curationWindow(ageSeconds));
  return divisor > 0 ? 1 / divisor : 0;
}

/** Shannon entropy of a discrete distribution, normalised to [0,1] by log(k). */
function normalisedEntropy(weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || weights.length <= 1) return 0;
  let h = 0;
  for (const w of weights) {
    if (w <= 0) continue;
    const p = w / total;
    h -= p * Math.log(p);
  }
  return h / Math.log(weights.length);
}

/** Histogram inter-arrival gaps into log-spaced buckets; a near-periodic
 *  train concentrates in one bucket (low entropy -> high regularity). */
function gapRegularity(sortedTimesMs: readonly number[]): { regularity: number; entropy: number } {
  if (sortedTimesMs.length < 4) return { regularity: 0, entropy: 1 };
  const gaps: number[] = [];
  for (let i = 1; i < sortedTimesMs.length; i++) {
    const g = sortedTimesMs[i]! - sortedTimesMs[i - 1]!;
    gaps.push(g > 0 ? g : 1);
  }
  const buckets = new Array<number>(16).fill(0);
  for (const g of gaps) {
    const secs = g / 1000;
    const idx = Math.max(0, Math.min(15, Math.floor(Math.log2(secs + 1))));
    buckets[idx]! += 1;
  }
  const entropy = normalisedEntropy(buckets);
  return { regularity: 1 - entropy, entropy };
}

/** Read the HF25 curation timing of one post: its age-driven window factor
 *  and the vote-train authenticity, from its creation time and votes. Votes
 *  lacking a timestamp are dropped from the regularity read (unknown timing
 *  reads as organic, never as a train). */
export function readTiming(
  author: string,
  permlink: string,
  createdIso: string,
  votes: readonly { readonly time?: string }[],
  nowMs: number = Date.now(),
): TimingReading {
  const created = Date.parse(createdIso);
  const timed = votes
    .map((v) => Date.parse(v.time ?? ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  const ageSeconds = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 1000) : Number.NaN;
  const windowFactor = curationWindowFactor(ageSeconds);
  const windowPhase: CurationWindow = Number.isFinite(ageSeconds) ? curationWindow(ageSeconds) : "early";

  const { regularity, entropy } = gapRegularity(timed);
  const likelyCartelTrail = timed.length >= 8 && regularity > 0.6;

  const organic = 1 - regularity;
  const timingScore = windowFactor * (0.7 + 0.3 * organic);

  return Object.freeze({
    author,
    permlink,
    voteCount: timed.length,
    ageSeconds: Number.isFinite(ageSeconds) ? ageSeconds : 0,
    windowPhase,
    trainRegularity: regularity,
    timingEntropy: entropy,
    likelyCartelTrail,
    timingScore: Math.max(0, Math.min(1, timingScore)),
  });
}

/** Read timing directly off a PostCandidate's own created/votes fields. */
export function readTimingOf(post: PostCandidate, nowMs?: number): TimingReading {
  return readTiming(post.author, post.permlink, post.created, post.votes ?? [], nowMs);
}
