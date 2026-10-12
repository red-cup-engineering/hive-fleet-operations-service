export interface ProductRcDelegationOptions {
  readonly account: "help-fund";
  readonly keyFile: string;
  readonly executeOne: boolean;
}

export function parseOptions(argv: readonly string[]): ProductRcDelegationOptions;
export function observe(): Promise<Readonly<Record<string, unknown>>>;
export function exactDirectRcOperation(operation: unknown): boolean;
export function operate(options: ProductRcDelegationOptions): Promise<Readonly<Record<string, unknown>>>;
