export interface TokenLiquidationOptions {
  readonly account: string;
  readonly symbol: string;
  readonly keyFile: string;
  readonly executeOne: boolean;
  readonly maxSlippageBps: number;
}

export function parseOptions(argv: readonly string[]): TokenLiquidationOptions;
export function statesAgree(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean;
export function planLiquidation(state: Readonly<Record<string, any>>, maxSlippageBps?: number): Readonly<Record<string, any>>;
export function operate(options: TokenLiquidationOptions): Promise<Readonly<Record<string, unknown>>>;
