export function parseOptions(argv: readonly string[]): Readonly<{ record: true }>;
export function operate(options: Readonly<{ record: true }>): Promise<Readonly<Record<string, unknown>>>;
