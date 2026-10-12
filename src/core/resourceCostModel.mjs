import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { readFile } from "node:fs/promises";

export const RC_CYCLE_OPERATIONS = Object.freeze(["custom_json_operation", "transfer_operation"]);
export const DEFAULT_HIVE_RC_NODES = Object.freeze([
  "https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me",
]);
/** Fraction (percent, 0-100) of an account's total RC capacity held back,
 * unspent, as its reserve for other duties (posting, transfers outside this
 * cycle, future cycles before the next regeneration); a cycle refuses when
 * its own RC need would eat into that reserve. Hive RC regenerates fully
 * over five days and is never spent as HIVE, so a well-provisioned account
 * pays no marginal price for it -- this is a capacity floor, not a cost. */
export const RC_CYCLE_RESERVE_PERCENT = 20n;
/** Minimum SWAP.HIVE margin the certified worst-case profit must clear
 * above the priced signer+runner cost before a cycle is trusted
 * net-positive. Hive RC is checked as a capacity floor above and
 * contributes nothing to this priced total. */
export const NET_FLOOR_MARGIN_SWAP_HIVE = "0.00100000";

export const DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE = "0.00010000";
export const DEFAULT_RUNNER_SWAP_HIVE_PER_CYCLE = "0.00010000";
export const SIGNER_OVERHEAD_PARAMETER = "AAGAARD_SIGNER_SWAP_HIVE_PER_CYCLE";
export const RUNNER_OVERHEAD_PARAMETER = "AAGAARD_RUNNER_SWAP_HIVE_PER_CYCLE";
/** Two 15-minute autonomous timers (sigmund-vexler, michael561) share one
 * host (cold-red-gate): 4 cycles/hour * 24 * 30 * 2 accounts. */
export const HOST_CYCLES_PER_MONTH = 5_760;
export const DEFAULT_MACHINES_RECORD_MACHINE_NAME = "cold-red-gate";

export const RESOURCE_COMPONENT_NAMES = Object.freeze(["Hive RC", "signer", "runner/paymaster"]);

/**
 * @param {string} value an exact unsigned decimal string
 * @param {number} precision maximum fractional digits
 * @returns {bigint}
 */
function parseDecimalUnits(value, precision) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,20}))?$/u.exec(String(value ?? "").trim());
  if (!match) throw new TypeError(`not an exact unsigned decimal: ${value}`);
  const fractionDigits = match[2] ?? "";
  if (fractionDigits.length > precision) throw new TypeError(`value exceeds ${precision}-decimal precision: ${value}`);
  return BigInt(match[1]) * 10n ** BigInt(precision) + BigInt(fractionDigits.padEnd(precision, "0") || "0");
}

/**
 * @param {bigint} value
 * @param {number} precision
 * @returns {string}
 */
function renderDecimalUnits(value, precision) {
  const scale = 10n ** BigInt(precision);
  const whole = value / scale;
  const fraction = (value < 0n ? -value : value) % scale;
  return precision === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(precision, "0")}`;
}

async function nodeRcCapacityUnits(fetchImpl, node, account, operations) {
  const [rcAccounts, ...opStatsRows] = await Promise.all([
    new RpcClient({ nodes: [node], timeout: 12000, fetch: fetchImpl }).call("rc_api.find_rc_accounts", { accounts: [account] }),
    ...operations.map((operation) => new RpcClient({ nodes: [node], timeout: 12000, fetch: fetchImpl }).call("rc_api.get_rc_operation_stats", { operation })),
  ]);
  const rcRow = rcAccounts?.rc_accounts?.[0];
  if (!rcRow || rcRow.account !== account) throw new Error("RC account evidence malformed");
  const maxRc = BigInt(String(rcRow.max_rc));
  const currentMana = BigInt(String(rcRow.rc_manabar?.current_mana ?? "0"));
  if (maxRc <= 0n) throw new Error("chain RC state is degenerate");
  const rcNeeded = opStatsRows.reduce((sum, row) => sum + BigInt(String(row?.avg_cost_rc ?? "0")), 0n);
  return { maxRc, currentMana, rcNeeded };
}

/**
 * Checks whether an account's currently available Hive Resource Credits can
 * afford one cycle's operations (by default, one custom_json plus a
 * conservative transfer allowance) while keeping RC_CYCLE_RESERVE_PERCENT of
 * its total RC capacity free for its other duties. Hive RC regenerates over
 * five days and is never spent as HIVE, so it has no marginal SWAP.HIVE
 * price to an account that has it: this is a capacity floor, never a cost.
 * Reads the account's real RC manabar/max_rc and the real average RC cost
 * of the named operations from at least two independent public Hive API
 * nodes, and judges the most conservative (least-margin) of their readings.
 * Refuses fail-closed (never a fabricated pass) when fewer than two nodes
 * respond.
 * @param {{ account: string, operations?: readonly string[], nodes?: readonly string[],
 *   fetchImpl?: typeof fetch, reservePercent?: bigint }} request
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function observeRcCapacity({ account, operations = RC_CYCLE_OPERATIONS, nodes = DEFAULT_HIVE_RC_NODES,
  fetchImpl = fetch, reservePercent = RC_CYCLE_RESERVE_PERCENT }) {
  if (!Array.isArray(nodes) || nodes.length < 2) throw new TypeError("RC capacity checking requires at least two independent HTTPS providers");
  const settled = await Promise.allSettled(nodes.map((node) => nodeRcCapacityUnits(fetchImpl, node, account, operations)));
  const observed = settled.filter((row) => row.status === "fulfilled").map((row) => row.value);
  if (observed.length < 2) {
    return Object.freeze({ status: "unpriced-resource-cost-model", reason: "rc-capacity-single-witness",
      witness: Object.freeze({ providersResponded: observed.length, providersQueried: nodes.length }) });
  }
  const margins = observed.map((row) => {
    const reserveUnits = (row.maxRc * reservePercent) / 100n;
    const availableForCycle = row.currentMana - reserveUnits;
    return { ...row, reserveUnits, availableForCycle, marginUnits: availableForCycle - row.rcNeeded };
  });
  const chosen = margins.reduce((worst, row) => (row.marginUnits < worst.marginUnits ? row : worst));
  const witness = Object.freeze({
    source: "rc_api.find_rc_accounts+rc_api.get_rc_operation_stats", operations: Object.freeze([...operations]),
    providersAgreeing: observed.length, reservePercent: Number(reservePercent),
    maxRc: chosen.maxRc.toString(), currentMana: chosen.currentMana.toString(), rcNeeded: chosen.rcNeeded.toString(),
    reserveUnits: chosen.reserveUnits.toString(), availableForCycle: chosen.availableForCycle.toString(),
  });
  if (chosen.marginUnits < 0n) {
    return Object.freeze({ status: "unpriced-resource-cost-model", reason: "rc-capacity-insufficient", witness });
  }
  return Object.freeze({
    status: "priced", unit: "SWAP.HIVE", amountSwapHive: "0.00000000",
    maxRc: chosen.maxRc.toString(), currentMana: chosen.currentMana.toString(), rcNeeded: chosen.rcNeeded.toString(),
    witness,
  });
}

/**
 * Prices one host-shared overhead role (signer or runner) in SWAP.HIVE per
 * cycle. When the named machine's entry in the 561-group machines record
 * carries a monthly SWAP.HIVE cost for this role (or a shared
 * `monthlyCostSwapHive`), that figure is amortized over
 * HOST_CYCLES_PER_MONTH; otherwise a declared default is used and named
 * explicitly in the witness, so the cost is never silently zero.
 * @param {{ role: "signer"|"runner", machineName?: string, machinesRecordPath: string,
 *   defaultSwapHivePerCycle: string, readFileImpl?: typeof readFile }} request
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function priceHostOverheadSwapHive({ role, machineName = DEFAULT_MACHINES_RECORD_MACHINE_NAME,
  machinesRecordPath, defaultSwapHivePerCycle, readFileImpl = readFile }) {
  try {
    const text = await readFileImpl(machinesRecordPath, "utf8");
    const record = JSON.parse(text);
    const machine = Array.isArray(record?.entities) ? record.entities.find((entity) => entity?.attributes?.name === machineName) : null;
    const attributes = machine?.attributes ?? {};
    const monthly = (role === "signer" ? attributes.monthlySignerCostSwapHive : attributes.monthlyRunnerCostSwapHive)
      ?? attributes.monthlyCostSwapHive;
    if (typeof monthly === "string") {
      const perCycleUnits8 = parseDecimalUnits(monthly, 8) / BigInt(HOST_CYCLES_PER_MONTH);
      return Object.freeze({ amountSwapHive: renderDecimalUnits(perCycleUnits8, 8), unit: "SWAP.HIVE",
        witness: Object.freeze({ source: "561-group-machines-record", path: machinesRecordPath, machine: machineName,
          monthlySwapHive: monthly, cyclesPerMonth: HOST_CYCLES_PER_MONTH }) });
    }
  } catch {
    // Falls through to the declared default: a missing or malformed record
    // is never treated as a zero cost.
  }
  return Object.freeze({ amountSwapHive: defaultSwapHivePerCycle, unit: "SWAP.HIVE",
    witness: Object.freeze({ source: "declared-parameter",
      parameter: role === "signer" ? SIGNER_OVERHEAD_PARAMETER : RUNNER_OVERHEAD_PARAMETER,
      reason: "the 561-group machines record does not carry cold-red-gate's monthly cost" }) });
}

function unpricedComponents({ rc, signer, runner }) {
  return Object.freeze([
    Object.freeze({ name: "Hive RC", amount: rc.status === "priced" ? rc.amountSwapHive : null, unit: "SWAP.HIVE",
      witness: Object.freeze(rc.status === "priced" ? rc.witness : { reason: rc.reason, ...rc.witness }) }),
    Object.freeze({ name: "signer", amount: signer.amountSwapHive, unit: "SWAP.HIVE", witness: signer.witness }),
    Object.freeze({ name: "runner/paymaster", amount: runner.amountSwapHive, unit: "SWAP.HIVE", witness: runner.witness }),
  ]);
}

/**
 * Prices the two real SWAP.HIVE resource costs an autonomous Aagaard
 * capital-circulation cycle consumes -- the signer host share and the
 * runner host share -- gates on Hive RC as a capacity floor (see
 * observeRcCapacity), and composes them into one `{status:"priced",
 * components, total}` decision, or a fail-closed `{status:
 * "unpriced-resource-cost-model", reason, stillUnpriced, components}`
 * naming exactly which resource(s) could not be priced/gated or why the
 * certified worst-case edge does not clear NET_FLOOR_MARGIN_SWAP_HIVE
 * above the priced total.
 *
 * There is no separate Hive-Engine market fee component: the live
 * `market` contract (getContract "market", cold-red-gate verified
 * 2026-09-05) has no params table and no BEED reference anywhere in its
 * code -- `market.sell`/`market.buy` charge nothing beyond RC. The
 * `marketpools` contract's only fee is `tradeFeeMul` (0.9975, taken
 * in-kind from the swapped token pair, not a separate charge) plus a
 * one-time `poolCreationFee` denominated in BEE (not BEED) that this
 * cycle's `swapTokens` action never triggers. Both fees this cycle's
 * quotes actually pay are already netted into the opportunity's own
 * `worstCaseProfitSwapHive` by the assay that produced it (see
 * `feeBps`/`tradeFeeMultiplier` in global-arbitrage-scan.mjs and
 * exact-pool-cycle-assay.mjs), so pricing them again here would double
 * count them.
 *
 * There is also no Hive-RC-to-SWAP.HIVE conversion: RC regenerates over
 * five days and is never spent as HIVE, so it has no marginal price to an
 * account that has it (the `hivepegged` wrap-fee conversion this used to
 * apply mirrored a contract name confirmed not to exist on-chain -- see
 * content/text/documents/research/2026-07-24-hive-engine-income-token-mechanics.md).
 * @param {{ account: string, worstCaseProfitSwapHive: string, operations?: readonly string[],
 *   rcNodes?: readonly string[], fetchImpl?: typeof fetch, machinesRecordPath: string,
 *   signerDefaultSwapHivePerCycle?: string, runnerDefaultSwapHivePerCycle?: string,
 *   readFileImpl?: typeof readFile, rcReservePercent?: bigint }} request
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function priceResourceCosts({ account, worstCaseProfitSwapHive, operations = RC_CYCLE_OPERATIONS,
  rcNodes = DEFAULT_HIVE_RC_NODES, fetchImpl = fetch, machinesRecordPath,
  signerDefaultSwapHivePerCycle = DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE, runnerDefaultSwapHivePerCycle = DEFAULT_RUNNER_SWAP_HIVE_PER_CYCLE,
  readFileImpl = readFile, rcReservePercent = RC_CYCLE_RESERVE_PERCENT }) {
  const [rc, signer, runner] = await Promise.all([
    observeRcCapacity({ account, operations, nodes: rcNodes, fetchImpl, reservePercent: rcReservePercent }),
    priceHostOverheadSwapHive({ role: "signer", machinesRecordPath, defaultSwapHivePerCycle: signerDefaultSwapHivePerCycle, readFileImpl }),
    priceHostOverheadSwapHive({ role: "runner", machinesRecordPath, defaultSwapHivePerCycle: runnerDefaultSwapHivePerCycle, readFileImpl }),
  ]);
  if (rc.status !== "priced") {
    return Object.freeze({ status: "unpriced-resource-cost-model", reason: rc.reason,
      stillUnpriced: Object.freeze(["Hive RC"]), components: unpricedComponents({ rc, signer, runner }),
      credentialAccess: false, chainMutation: false });
  }
  const rcUnits = parseDecimalUnits(rc.amountSwapHive, 8);
  const signerUnits = parseDecimalUnits(signer.amountSwapHive, 8);
  const runnerUnits = parseDecimalUnits(runner.amountSwapHive, 8);
  const totalUnits = rcUnits + signerUnits + runnerUnits;
  const profitUnits = parseDecimalUnits(worstCaseProfitSwapHive, 8);
  const marginUnits = parseDecimalUnits(NET_FLOOR_MARGIN_SWAP_HIVE, 8);
  if (profitUnits < totalUnits + marginUnits) {
    return Object.freeze({ status: "unpriced-resource-cost-model", reason: "net-floor-not-met",
      profit: renderDecimalUnits(profitUnits, 8), cost: renderDecimalUnits(totalUnits, 8),
      stillUnpriced: Object.freeze([]), components: unpricedComponents({ rc, signer, runner }),
      credentialAccess: false, chainMutation: false });
  }
  return Object.freeze({
    status: "priced", total: renderDecimalUnits(totalUnits, 8), credentialAccess: false, chainMutation: false,
    components: Object.freeze([
      Object.freeze({ name: "Hive RC", amount: rc.amountSwapHive, unit: "SWAP.HIVE", witness: rc.witness }),
      Object.freeze({ name: "signer", amount: signer.amountSwapHive, unit: "SWAP.HIVE", witness: signer.witness }),
      Object.freeze({ name: "runner/paymaster", amount: runner.amountSwapHive, unit: "SWAP.HIVE", witness: runner.witness }),
    ]),
  });
}
