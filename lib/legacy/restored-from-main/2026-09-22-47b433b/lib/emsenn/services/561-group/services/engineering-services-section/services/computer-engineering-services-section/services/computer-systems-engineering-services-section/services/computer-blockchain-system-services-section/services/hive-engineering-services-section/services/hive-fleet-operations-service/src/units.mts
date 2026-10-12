// Shared fixed-width bigint-to-decimal-string core used by every non-negative
// monetary formatter in this package. Callers own their own negative-value
// policy (exactArbitrage recurses with a "-" prefix; TerraCore throws).

export function formatFixedUnits(value: bigint, scale: number): string {
  const factor = 10n ** BigInt(scale);
  if (scale === 0) return value.toString();
  return `${value / factor}.${(value % factor).toString().padStart(scale, "0")}`;
}
