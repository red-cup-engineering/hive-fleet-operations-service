export interface TerraCoreCycleOptions { readonly account: string; readonly keyFile: string; readonly executeOne: boolean }
export function parseOptions(argv: readonly string[]): TerraCoreCycleOptions;
export function balancesAgree(left: { readonly balance: string }, right: { readonly balance: string }): boolean;
export function findNewBattleLog(rows: readonly unknown[], priorIds: readonly string[], actor: string, target: string, earliestMs: number): Readonly<Record<string, unknown>> | null;
export function reconcileClaimBalances(beforeBalance: string, afterBalance: string, claimedAmount: string, beforeScrap: string, afterScrap: string): Readonly<{ confirmed: boolean; received: string }>;
export function settlementPendingReceipt(base: Readonly<Record<string, unknown>>, transactionId: string, hive: readonly Readonly<Record<string, unknown>>[], error: unknown, completedAt?: string): Readonly<Record<string, unknown>>;
export function operate(options: TerraCoreCycleOptions): Promise<Readonly<Record<string, unknown>>>;
