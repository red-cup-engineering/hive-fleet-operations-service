// analysis/signals — two chain-data reads free from substrate already
// captured (no extra fetch).
//
//   • Signed-vote frustration. Active votes carry negative rshares -
//     downvotes. A post with both up- and down-vote mass is contested: a
//     signed graph whose frustration (the share of vote mass fighting the
//     consensus sign) measures controversy. Curating into a downvote war
//     risks the reward being nullified or the stake drawn into a flag fight -
//     so frustration is a penalty, and a purely-downvoted post is a trap to
//     avoid, not a sink to capture.
//
//   • Comment-tree branching. High branching = high genuine engagement (eyes,
//     discussion) - legitimacy that distinguishes an organically-rising post
//     from a whale-inflated one. A mild positive signal, normalised across
//     the cohort.

import type { PostCandidate } from "../core/core.adapter.ts";

export interface SignalReading {
  readonly author: string;
  readonly permlink: string;
  readonly downvotePressure: number;
  readonly frustration: number;
  readonly downvoted: boolean;
  readonly engagement: number;
}

function signedMass(votes: readonly { readonly rshares: number }[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const v of votes) {
    const r = v.rshares;
    if (r >= 0) up += r;
    else down += -r;
  }
  return { up, down };
}

/** Read signed-vote + engagement signals over a cohort (engagement needs the
 *  cohort max comment count, so the whole set is taken at once). */
export function readSignals(posts: readonly PostCandidate[]): Map<string, SignalReading> {
  const out = new Map<string, SignalReading>();
  const maxChildren = Math.max(1, ...posts.map((p) => p.comments));
  for (const p of posts) {
    const { up, down } = signedMass(p.votes ?? []);
    const total = up + down;
    const downvotePressure = total > 0 ? down / total : 0;
    // Frustration peaks where up and down mass are balanced (4*x*(1-x)).
    const frustration = 4 * downvotePressure * (1 - downvotePressure);
    out.set(`${p.author}/${p.permlink}`, Object.freeze({
      author: p.author,
      permlink: p.permlink,
      downvotePressure,
      frustration,
      downvoted: downvotePressure > 0.5,
      engagement: p.comments / maxChildren,
    }));
  }
  return out;
}
