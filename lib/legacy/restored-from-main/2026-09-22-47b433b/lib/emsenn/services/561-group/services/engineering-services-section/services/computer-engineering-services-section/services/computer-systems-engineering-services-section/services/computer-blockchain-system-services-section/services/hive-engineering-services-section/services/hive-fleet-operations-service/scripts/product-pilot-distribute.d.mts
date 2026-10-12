export interface ProductPilotDistributeOptions {
  readonly account: "michael561";
  readonly keyFile: string;
  readonly executeOne: boolean;
  readonly settleTx: string;
}

export function parseOptions(argv: readonly string[]): ProductPilotDistributeOptions;
export function exactProductReblogOperation(operation: unknown): boolean;
export function operate(options: ProductPilotDistributeOptions): Promise<Readonly<Record<string, unknown>>>;
