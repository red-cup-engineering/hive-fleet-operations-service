export interface CurationCycleOptions { readonly account: string; readonly keyFile: string; readonly executeOne: boolean }
export function parseOptions(argv: readonly string[]): CurationCycleOptions;
export function majorityAgreement<T>(rows: readonly { readonly node: string; readonly value: T }[], identity?: (value: T) => string): Readonly<{ value: T; providers: readonly string[] }>;
export function majorityAvailableAgreement<T>(rows: readonly ({ readonly node: string; readonly status: "available"; readonly value: T }
  | { readonly node: string; readonly status: "unavailable"; readonly problem: string })[], label: string,
  identity?: (value: T) => string): Readonly<{ value: T; providers: readonly string[] }>;
export function postEvidenceFromRaw(raw: Readonly<Record<string, unknown>>, account: string, nowMs?: number): Readonly<Record<string, unknown>>;
export function postEvidenceIdentity(value: Readonly<Record<string, unknown>>): string;
export function voteVisible(raw: Readonly<Record<string, unknown>>, account: string): boolean;
export function exactVoteOperation(actual: unknown, expected: unknown): boolean;
export function settlementPendingReceipt(base: Readonly<Record<string, unknown>>, transactionId: string, hive: readonly Readonly<Record<string, unknown>>[], error: unknown, completedAt?: string): Readonly<Record<string, unknown>>;
export function recordPendingReceipt(base: Readonly<Record<string, unknown>>, transactionId: string, hive: readonly Readonly<Record<string, unknown>>[], settlementIdentity: Readonly<Record<string, unknown>>, error: unknown, completedAt?: string): Readonly<Record<string, unknown>>;
export function operate(options: CurationCycleOptions): Promise<Readonly<Record<string, unknown>>>;
