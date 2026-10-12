export function parseOptions(argv: readonly string[]): Readonly<{ record: boolean }>;
export function operate(options: Readonly<{ record: boolean }>): Promise<Readonly<Record<string, unknown>>>;
