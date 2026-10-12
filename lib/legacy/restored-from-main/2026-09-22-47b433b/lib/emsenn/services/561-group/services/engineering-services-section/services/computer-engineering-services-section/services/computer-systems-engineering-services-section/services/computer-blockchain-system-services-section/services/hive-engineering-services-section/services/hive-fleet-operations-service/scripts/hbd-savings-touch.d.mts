export interface HbdSavingsTouchOptions { readonly account: string; readonly keyFile: string; readonly executeOne: boolean }
export function parseOptions(argv: readonly string[]): HbdSavingsTouchOptions;
export function planTouch(state: Readonly<Record<string, any>>, nowMs?: number): Readonly<Record<string, any>>;
export function operate(options: HbdSavingsTouchOptions): Promise<Readonly<Record<string, unknown>>>;
