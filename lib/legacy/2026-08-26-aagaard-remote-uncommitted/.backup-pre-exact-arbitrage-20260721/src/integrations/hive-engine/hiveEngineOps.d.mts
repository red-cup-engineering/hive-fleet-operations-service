type HiveEngineOp = readonly ["custom_json", Readonly<Record<string, unknown>>];
type HiveTransferOp = readonly ["transfer", Readonly<Record<string, unknown>>];

export function marketBuy(account: string, symbol: string, quantityHive: string): HiveEngineOp;
export function marketSell(account: string, symbol: string, quantity: string): HiveEngineOp;
export function stake(account: string, symbol: string, quantity: string, to?: string): HiveEngineOp;
export function unstake(account: string, symbol: string, quantity: string): HiveEngineOp;
export function delegate(account: string, symbol: string, quantity: string, to: string): HiveEngineOp;
export function addLiquidity(account: string, tokenPair: string, baseQuantity: string, quoteQuantity: string): HiveEngineOp;
export function removeLiquidity(account: string, tokenPair: string, sharesPercent: string): HiveEngineOp;
export function swapTokens(account: string, tokenPair: string, tokenSymbol: string, tokenAmount: string, tradeType: "exactInput" | "exactOutput", bound?: string): HiveEngineOp;
export const HONEY_SWAP_ACCOUNT: string;
export const WRAP_MEMO: string;
export function wrapHive(account: string, quantityHive: string): HiveTransferOp;
export function unwrapHive(account: string, quantity: string): HiveEngineOp;
