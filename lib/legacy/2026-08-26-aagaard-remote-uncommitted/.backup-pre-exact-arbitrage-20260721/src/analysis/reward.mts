// analysis/reward — the reward-route read: where curation reward actually
// flows. A post being under-priced (a sink) is necessary but not sufficient;
// what gets captured by voting it depends on plumbing the raw data exposes but
// a flat scorer never reads:
//
//   • beneficiaries — a post can route 0-100% of its payout to other accounts
//     via the beneficiary mechanism. The author/curators split only the
//     remainder. A 90%-beneficiary post is a near-dead end for curation
//     reward no matter how under-priced it looks.
//   • curation saturation — curation reward on a post is split pro-rata by
//     vote weight. If the post is already thick with rshares, a marginal vote
//     earns a small slice; if it is thin, the vote dominates the split.
//
// The capture efficiency combines these into a 0..1 multiplier on a sink's
// deficit: expected captured alpha ~= deficit x captureEfficiency x timingScore.

import type { PostCandidate } from "../core/core.adapter.ts";

export interface RewardRouteReading {
  readonly author: string;
  readonly permlink: string;
  readonly beneficiaryFraction: number;
  readonly netRshares: number;
  readonly saturation: number;
  readonly captureEfficiency: number;
}

function beneficiaryFractionOf(post: PostCandidate): number {
  const weight = (post.beneficiaries ?? []).reduce((s, b) => s + (Number.isFinite(b.weight) ? b.weight : 0), 0);
  // Beneficiary weights are in hundredths of a percent (10000 = 100%).
  return Math.max(0, Math.min(1, weight / 10000));
}

/** Read the reward route over a cohort of candidate posts (saturation is
 *  cohort-relative, so the whole set is needed at once). */
export function readRewardRoutes(posts: readonly PostCandidate[]): Map<string, RewardRouteReading> {
  const out = new Map<string, RewardRouteReading>();
  let maxR = 0;
  const rshares = new Map<string, number>();
  for (const p of posts) {
    const r = Math.max(0, p.netRshares);
    rshares.set(`${p.author}/${p.permlink}`, r);
    if (r > maxR) maxR = r;
  }
  for (const p of posts) {
    const key = `${p.author}/${p.permlink}`;
    const r = rshares.get(key) ?? 0;
    const saturation = maxR > 0 ? r / maxR : 0;
    const beneficiaryFraction = beneficiaryFractionOf(p);
    const captureEfficiency = (1 - beneficiaryFraction) * (1 - 0.7 * saturation);
    out.set(key, Object.freeze({
      author: p.author,
      permlink: p.permlink,
      beneficiaryFraction,
      netRshares: r,
      saturation,
      captureEfficiency: Math.max(0, Math.min(1, captureEfficiency)),
    }));
  }
  return out;
}
