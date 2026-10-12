import type { EconomicEffectEvidence } from "../../core/core.adapter.ts";

export function assessRoundTripEconomicEffect(
  account: string,
  calls: readonly unknown[],
  rows: readonly unknown[],
): EconomicEffectEvidence;
