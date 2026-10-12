export interface TerraCoreEngineeringOptions { readonly account: string; readonly keyFile: string; readonly executeOne: boolean }
export function parseOptions(argv: readonly string[]): TerraCoreEngineeringOptions;
export function engineStatesAgree(left: { readonly liquidScrap: string; readonly scrapPrecision: number }, right: { readonly liquidScrap: string; readonly scrapPrecision: number }): boolean;
export function parseUpgradeTransaction(row: unknown, account: string, quantity: string, memo: string): Readonly<Record<string, unknown>>;
export function operate(options: TerraCoreEngineeringOptions): Promise<Readonly<Record<string, unknown>>>;
