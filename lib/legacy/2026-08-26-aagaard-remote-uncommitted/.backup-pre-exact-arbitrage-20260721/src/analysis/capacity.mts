// Catabolic Lyapunov capacity bound, ported from Obsmetrologia's
// ReactionNetworks/FreeEnergyDescent.lean: in a catabolic reaction network
// (every reaction strictly destroys total particle count), total count is
// a Lyapunov potential, giving a HARD combinatorial bound on the number of
// possible reaction events -- catabolic_steps_bounded proves the firing
// count is at most the initial total, not an asymptotic decay estimate.
//
// Applied to a detected holonomy cycle: define "mispricing mass" as the
// cycle's edge fraction times the smallest liquidity depth along its own
// path (the venue/pool that would exhaust first, and so the real binding
// constraint on how much of the cycle's divergence is actually capturable
// at all). Each trade of a given size consumes a share of that mass;
// capacitySteps is the resulting hard ceiling on how many more times that
// specific cycle could be profitably traded before its edge is provably
// used up, GIVEN today's snapshot.
//
// Both mining passes independently flagged the same real caveat: real
// mispricing mass can be replenished by new information (a market moving
// again), so this bounds capacity WITHIN the current regime/snapshot, not
// in any absolute sense -- report it as such, never as a promise about the
// future.
//
// See the Obsmetrologia financial-methods catalog, section 4.1. This is
// `implemented` (real, reported for observation), not `live` -- no trade
// decision depends on it yet.

export interface CatabolicCapacity {
  readonly mispricingMassHbd: number;
  readonly depthHbd: number;
  readonly tradeSizeHbd: number;
  /** Hard ceiling, within this snapshot, on further profitable trades of
   *  tradeSizeHbd before the cycle's own mispricing mass is used up. */
  readonly capacitySteps: number;
}

export function catabolicCapacity(netHolonomyBps: number, depthHbd: number, tradeSizeHbd: number): CatabolicCapacity {
  const mispricingMassHbd = (Math.abs(netHolonomyBps) / 10000) * Math.max(0, depthHbd);
  return Object.freeze({
    mispricingMassHbd,
    depthHbd: Math.max(0, depthHbd),
    tradeSizeHbd,
    capacitySteps: tradeSizeHbd > 0 ? Math.floor(mispricingMassHbd / tradeSizeHbd) : 0,
  });
}
