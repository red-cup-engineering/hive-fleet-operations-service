// Exact, two-provider cost witness for Hive Engine market-order BEED burns.
// The fee is priced at executable BEED bid depth, never assumed free or 1:1.

const NODES = Object.freeze(["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts", "https://herpc.liotes.com/contracts"]);
const FEE_BEED = 10n; // 0.0010 BEED
const MIN_NET = 100_000n; // 0.00100000 SWAP.HIVE after the BEED mark
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function units(value, precision) { const text = String(value ?? ""); const match = DECIMAL.exec(text); if (!match || (match[1]?.length ?? 0) > precision) return null;
  const [whole, fraction = ""] = text.split("."); return BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0"); }
function render(value, precision) { return `${value / 10n ** BigInt(precision)}.${(value % 10n ** BigInt(precision)).toString().padStart(precision, "0")}`; }
function rpc(node, params) { return fetch(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "find", params }), signal: AbortSignal.timeout(15_000) })
  .then(async (response) => { const body = await response.json(); if (!response.ok || body?.error || !Array.isArray(body?.result)) throw new Error("Hive Engine fee evidence unavailable"); return body.result; }); }

function markFee(state) {
  const balance = units(state.balance, 4); if (balance === null || balance < FEE_BEED) return null;
  let remaining = FEE_BEED, proceeds = 0n, prior = null;
  for (const bid of state.bids) { const quantity = units(bid.quantity, 4), price = units(bid.price, 8); if (quantity === null || price === null || quantity <= 0n || price <= 0n || (prior !== null && price > prior)) return null;
    const take = quantity < remaining ? quantity : remaining; proceeds += take * price / 10_000n; remaining -= take; prior = price; if (remaining === 0n) return proceeds; }
  return null;
}

export function assessBeedFeeWitness({ account, worstCaseProfitSwapHive, states }) {
  const profit = units(worstCaseProfitSwapHive, 8); if (profit === null || profit <= 0n || !Array.isArray(states) || states.length < 2) return Object.freeze({ status: "unpriced-resource-cost-model" });
  const groups = new Map(); for (const state of states) { const key = JSON.stringify(state); const group = groups.get(key) ?? []; group.push(state); groups.set(key, group); }
  const winner = [...groups.values()].find((group) => group.length >= 2); if (!winner || groups.size !== 1) return Object.freeze({ status: "unpriced-resource-cost-model", reason: "independent BEED fee evidence disagrees" });
  const cost = markFee(winner[0]); if (cost === null || profit < cost + MIN_NET) return Object.freeze({ status: "unpriced-resource-cost-model", reason: "BEED reserve, depth, or net floor is insufficient" });
  return Object.freeze({ status: "witnessed-net-cost", totalSwapHive: render(cost, 8), feeBeed: "0.0010", resources: Object.freeze(["Hive Engine BEED market fee", "Hive RC", "signer", "runner/paymaster"]), source: "two-provider-executable-BEED-bid-depth" });
}

export async function observeBeedFeeWitness({ account, worstCaseProfitSwapHive }) {
  const states = await Promise.all(NODES.map(async (node) => { const [balances, bids] = await Promise.all([
    rpc(node, { contract: "tokens", table: "balances", query: { account, symbol: "BEED" }, limit: 2, offset: 0, indexes: [] }),
    rpc(node, { contract: "market", table: "buyBook", query: { symbol: "BEED" }, limit: 200, offset: 0, indexes: [{ index: "priceDec", descending: true }] }),
  ]); if (balances.length > 1) throw new Error("duplicate BEED balance"); return Object.freeze({ balance: String(balances[0]?.balance ?? "0.0000"), bids: Object.freeze(bids.map((row) => Object.freeze({ quantity: String(row.quantity), price: String(row.price) }))) }); }));
  return assessBeedFeeWitness({ account, worstCaseProfitSwapHive, states });
}
