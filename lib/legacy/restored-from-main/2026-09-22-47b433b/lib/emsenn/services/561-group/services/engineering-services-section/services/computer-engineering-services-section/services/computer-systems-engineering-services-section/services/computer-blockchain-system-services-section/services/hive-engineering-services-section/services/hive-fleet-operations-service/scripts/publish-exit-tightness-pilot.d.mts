export function parseOptions(argv: readonly string[]): Readonly<{ observeOnly: true }>;
export function operate(options: Readonly<{ observeOnly: true }>): Promise<Readonly<Record<string, unknown>>>;
