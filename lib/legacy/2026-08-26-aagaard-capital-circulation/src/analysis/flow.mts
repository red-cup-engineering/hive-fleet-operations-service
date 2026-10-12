// Detailed-balance / signed net flux, ported from Obsmetrologia's
// ReactionNetworks/DetailedBalance.lean: for a reversible reaction pair,
// DetailedBalance holds exactly when forward and backward propensities
// match (netFlux = 0), and any imbalance gives a strictly SIGNED net flux
// -- not just a magnitude, a direction, with the theorem itself stating
// the exact condition under which the signal is provably zero (the built-in
// null test both mining passes called out, independently, as the point
// where this differs from an ad hoc order-flow-imbalance ratio).
//
// Applied to a Hive-Engine token's own realized trade history: each fill
// in the market contract's tradesHistory table carries a `type`
// (whether a marketBuy or a marketSell order was the one that crossed
// the book) and a `volume` (SWAP.HIVE-denominated). Summing volume by
// type over a recent window gives forward (buy) and backward (sell)
// propensity directly from realized flow, not a fitted rate.
//
// See the Obsmetrologia financial-methods catalog, section 3.1. This is
// `implemented` (real, reported for observation), not yet `live` -- no
// trade decision depends on its direction yet.

export interface TradeFill {
  readonly type: "buy" | "sell";
  readonly volumeSwapHive: number;
}

export interface FlowReading {
  readonly symbol: string;
  readonly fillCount: number;
  readonly buyVolume: number;
  readonly sellVolume: number;
  /** Signed: positive means net buying pressure (SWAP.HIVE flowing in to
   *  acquire the token), negative means net selling pressure. */
  readonly netFlux: number;
  /** True exactly when |netFlux| is negligible relative to total volume
   *  -- the Lean's own detailedBalance-holds condition, extended with a
   *  disclosed tolerance band for continuous real volume data (see
   *  allocation.mts's TIE_TOLERANCE for the same kind of disclosed
   *  extension). */
  readonly balanced: boolean;
}

const BALANCE_TOLERANCE = 0.05; // net flux within 5% of total volume reads as balanced

export function detailedBalance(symbol: string, fills: readonly TradeFill[]): FlowReading {
  let buyVolume = 0;
  let sellVolume = 0;
  for (const fill of fills) {
    if (fill.type === "buy") buyVolume += fill.volumeSwapHive;
    else sellVolume += fill.volumeSwapHive;
  }
  const totalVolume = buyVolume + sellVolume;
  const netFlux = buyVolume - sellVolume;
  return Object.freeze({
    symbol,
    fillCount: fills.length,
    buyVolume,
    sellVolume,
    netFlux,
    balanced: totalVolume <= 0 || Math.abs(netFlux) / totalVolume <= BALANCE_TOLERANCE,
  });
}
