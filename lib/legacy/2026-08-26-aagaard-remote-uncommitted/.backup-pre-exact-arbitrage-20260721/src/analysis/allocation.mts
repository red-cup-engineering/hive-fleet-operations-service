// Monotone-budget greedy allocation, ported from Obsmetrologia's
// Cohomology/AttentionAllocation.lean (Cohomology/AllocationSolver.lean's
// solveL/solveR are a proof device -- exhaustive powerset enumeration --
// not a runtime algorithm; the guarantee worth carrying over is that the
// SELECTED subset is exactly optimal under the budget, which this module
// gets by the same exhaustive method when the candidate count is small
// enough for that to be cheap, falling back to a bounded-regret greedy
// otherwise rather than pretending exactness it hasn't earned).
//
// The Lean's own novel result is tie-set degeneracy: when multiple
// distinct selections reach the same optimal value, the two fold
// directions provably choose different ones, and the tie-set size is
// reported as choiceBits = log2(|tie-set|) -- zero exactly when the
// optimum is unique. The Lean's tie-set is over EXACT ties in an
// idealized discrete model; real HBD-denominated cost/benefit figures
// essentially never tie exactly, so this module extends "tie" to a small
// relative tolerance band around the true optimum -- a deliberate,
// disclosed departure from the Lean statement, not the same claim.
//
// See lib/emsenn/services/561-group/services/lenticule-science/services/obsmetrologic-financial-analysis-services-section/
// content/documents/2026-07-18-obsmetrologia-financial-methods-catalog.md, section 1.

export interface AllocationCandidate {
  readonly id: string;
  readonly cost: number;
  readonly benefit: number;
}

export interface AllocationResult {
  // A plain array, not a Set: this result is embedded in a tick readout
  // that gets JSON-serialized to disk, and JSON.stringify(Set) silently
  // produces "{}" -- a Set would look fine in memory and lose its content
  // the moment it's persisted or reported.
  readonly funded: readonly string[];
  readonly totalCost: number;
  readonly totalBenefit: number;
  readonly consideredCount: number;
  readonly fundedCount: number;
  // null, not 0, when the candidate count exceeded the exact-enumeration
  // limit and the greedy fallback ran instead -- a fabricated "0" would
  // read as "provably unique," which the greedy path never established.
  readonly choiceBits: number | null;
  readonly exact: boolean;
}

const EMPTY_RESULT: AllocationResult = Object.freeze({
  funded: Object.freeze([]),
  totalCost: 0,
  totalBenefit: 0,
  consideredCount: 0,
  fundedCount: 0,
  choiceBits: 0,
  exact: true,
});

// 2^20 subsets (~1e6) is comfortably cheap per tick; real candidate counts
// (trades proposed in one account's one tick) are expected far below this.
const MAX_EXACT_CANDIDATES = 20;
const TIE_TOLERANCE = 0.0001; // 1 bps of the achieved optimum

function exactAllocate(candidates: readonly AllocationCandidate[], budget: number): AllocationResult {
  const n = candidates.length;
  let bestBenefit = -Infinity;
  let bestMask = 0;
  const feasibleMasks: number[] = [];
  for (let mask = 0; mask < (1 << n); mask += 1) {
    let cost = 0;
    let benefit = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      cost += candidates[i]!.cost;
      benefit += candidates[i]!.benefit;
    }
    if (cost > budget) continue;
    feasibleMasks.push(mask);
    if (benefit > bestBenefit) {
      bestBenefit = benefit;
      bestMask = mask;
    }
  }
  if (feasibleMasks.length === 0) return EMPTY_RESULT;
  const threshold = bestBenefit * (1 - TIE_TOLERANCE);
  let tieSetSize = 0;
  for (const mask of feasibleMasks) {
    let benefit = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) benefit += candidates[i]!.benefit;
    }
    if (benefit >= threshold) tieSetSize += 1;
  }
  const funded: string[] = [];
  let totalCost = 0;
  for (let i = 0; i < n; i += 1) {
    if ((bestMask & (1 << i)) === 0) continue;
    funded.push(candidates[i]!.id);
    totalCost += candidates[i]!.cost;
  }
  return Object.freeze({
    funded: Object.freeze(funded),
    totalCost,
    totalBenefit: bestBenefit,
    consideredCount: n,
    fundedCount: funded.length,
    choiceBits: tieSetSize > 0 ? Math.log2(tieSetSize) : 0,
    exact: true,
  });
}

// Classic fractional-relaxation greedy (Dantzig): sort by benefit/cost
// density, take whole items while they fit. Provably optimal for the
// fractional relaxation and within one item's value of optimal for 0/1 --
// a real, known bound, not an unqualified claim of exactness.
function greedyAllocate(candidates: readonly AllocationCandidate[], budget: number): AllocationResult {
  const ranked = [...candidates].sort((a, b) => (b.benefit / b.cost) - (a.benefit / a.cost));
  const funded: string[] = [];
  let totalCost = 0;
  let totalBenefit = 0;
  for (const candidate of ranked) {
    if (totalCost + candidate.cost > budget) continue;
    funded.push(candidate.id);
    totalCost += candidate.cost;
    totalBenefit += candidate.benefit;
  }
  return Object.freeze({
    funded: Object.freeze(funded),
    totalCost,
    totalBenefit,
    consideredCount: candidates.length,
    fundedCount: funded.length,
    choiceBits: null,
    exact: false,
  });
}

export function allocateBudget(candidates: readonly AllocationCandidate[], budget: number): AllocationResult {
  const positive = candidates.filter((c) => c.cost > 0 && c.benefit > 0 && Number.isFinite(c.cost) && Number.isFinite(c.benefit));
  if (!(budget > 0) || positive.length === 0) return EMPTY_RESULT;
  return positive.length <= MAX_EXACT_CANDIDATES ? exactAllocate(positive, budget) : greedyAllocate(positive, budget);
}
