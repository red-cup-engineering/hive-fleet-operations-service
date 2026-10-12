import type { IncomeTokenDistributionScan } from "../src/core/incomeTokenSettlement.mts";

export interface IncomeTokenAuditOptions {
  readonly account: string;
  readonly symbol: "EDSI" | "SPI" | "BRO";
  readonly record: boolean;
}

export function parseOptions(argv: readonly string[]): IncomeTokenAuditOptions;
export function scanIncomeTokenDistributions(account: string, symbol: "EDSI" | "SPI" | "BRO"): Promise<IncomeTokenDistributionScan>;
export function operate(options: IncomeTokenAuditOptions): Promise<Readonly<Record<string, unknown>>>;
