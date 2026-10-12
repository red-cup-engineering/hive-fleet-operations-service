import type { DCityRecoveryPlan, DCityRecoveryState } from "../src/integrations/dcity/dcity.adapter.ts";

export interface DCityRecoveryOptions {
  readonly account: string;
  readonly keyFile: string;
  readonly executeOne: boolean;
}

export function parseOptions(argv: readonly string[]): DCityRecoveryOptions;
export function operate(options: DCityRecoveryOptions): Promise<Readonly<Record<string, unknown>>>;
export function statesAgree(left: DCityRecoveryState, right: DCityRecoveryState): boolean;
export function planState(state: DCityRecoveryState): DCityRecoveryPlan;
