export interface UnstakeTokenOptions { readonly account: string; readonly symbol: string; readonly keyFile: string; readonly executeOne: boolean }
export function parseOptions(argv: readonly string[]): UnstakeTokenOptions;
export function statesAgree(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean;
export function planUnstake(state: Readonly<Record<string, any>>): Readonly<Record<string, any>>;
export function operate(options: UnstakeTokenOptions): Promise<Readonly<Record<string, unknown>>>;
