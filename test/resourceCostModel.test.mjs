import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_RUNNER_SWAP_HIVE_PER_CYCLE,
  DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE,
  observeRcCapacity,
  priceHostOverheadSwapHive,
  priceResourceCosts,
  RUNNER_OVERHEAD_PARAMETER,
  SIGNER_OVERHEAD_PARAMETER,
} from "../src/core/resourceCostModel.mjs";

const rcAccounts = { rc_accounts: [{ account: "sigmund-vexler", max_rc: "1000000000", rc_manabar: { current_mana: "800000000", last_update_time: 0 } }] };

function rcFetch({ customJsonRc = "5000000", transferRc = "3000000", accounts = rcAccounts } = {}) {
  return async (_node, init) => {
    const body = JSON.parse(init.body);
    const method = body.method;
    const result = method === "rc_api.find_rc_accounts" ? accounts
      : method === "rc_api.get_rc_operation_stats" ? { avg_cost_rc: body.params.operation === "custom_json_operation" ? customJsonRc : transferRc }
      : null;
    return Response.json({ result });
  };
}

test("observeRcCapacity prices Hive RC at zero when the cycle need leaves the reserve intact", async () => {
  const witness = await observeRcCapacity({ account: "sigmund-vexler",
    nodes: ["https://a.example.test", "https://b.example.test"], fetchImpl: rcFetch() });
  assert.equal(witness.status, "priced");
  assert.equal(witness.unit, "SWAP.HIVE");
  assert.equal(witness.amountSwapHive, "0.00000000");
  assert.equal(witness.rcNeeded, "8000000");
  assert.equal(witness.maxRc, "1000000000");
  assert.equal(witness.currentMana, "800000000");
  assert.equal(witness.witness.reservePercent, 20);
  assert.equal(witness.witness.reserveUnits, "200000000");
  assert.equal(witness.witness.availableForCycle, "600000000");
});

test("observeRcCapacity refuses rc-capacity-insufficient when the cycle need eats into the reserve", async () => {
  const lowManaAccounts = { rc_accounts: [{ account: "sigmund-vexler", max_rc: "1000000000",
    rc_manabar: { current_mana: "1000000", last_update_time: 0 } }] };
  const witness = await observeRcCapacity({ account: "sigmund-vexler",
    nodes: ["https://a.example.test", "https://b.example.test"], fetchImpl: rcFetch({ accounts: lowManaAccounts }) });
  assert.equal(witness.status, "unpriced-resource-cost-model");
  assert.equal(witness.reason, "rc-capacity-insufficient");
  assert.equal(witness.witness.availableForCycle, "-199000000");
  assert.equal(witness.witness.rcNeeded, "8000000");
});

test("observeRcCapacity refuses fail-closed with fewer than two responding nodes", async () => {
  const single = rcFetch();
  const fetchImpl = async (node, init) => {
    if (node.includes("a.example")) throw new Error("offline");
    return single(node, init);
  };
  const witness = await observeRcCapacity({ account: "sigmund-vexler",
    nodes: ["https://a.example.test", "https://b.example.test"], fetchImpl });
  assert.equal(witness.status, "unpriced-resource-cost-model");
  assert.equal(witness.reason, "rc-capacity-single-witness");
});

test("priceHostOverheadSwapHive amortizes a real machines-record monthly cost per cycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aagaard-machines-"));
  try {
    const path = join(dir, "machines.json");
    await writeFile(path, JSON.stringify({ entities: [{ kind: "machine", attributes: { name: "cold-red-gate", monthlyCostSwapHive: "5760.00000000" } }] }));
    const witness = await priceHostOverheadSwapHive({ role: "signer", machinesRecordPath: path, defaultSwapHivePerCycle: DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE });
    assert.equal(witness.amountSwapHive, "1.00000000");
    assert.equal(witness.witness.source, "561-group-machines-record");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("priceHostOverheadSwapHive falls back to a named declared parameter when the record lacks a cost", async () => {
  const signer = await priceHostOverheadSwapHive({ role: "signer", machinesRecordPath: "/nonexistent/machines.json", defaultSwapHivePerCycle: DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE });
  assert.equal(signer.amountSwapHive, DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE);
  assert.equal(signer.witness.source, "declared-parameter");
  assert.equal(signer.witness.parameter, SIGNER_OVERHEAD_PARAMETER);

  const runner = await priceHostOverheadSwapHive({ role: "runner", machinesRecordPath: "/nonexistent/machines.json", defaultSwapHivePerCycle: DEFAULT_RUNNER_SWAP_HIVE_PER_CYCLE });
  assert.equal(runner.witness.parameter, RUNNER_OVERHEAD_PARAMETER);
});

test("priceResourceCosts composes Hive RC (zero, capacity-gated), signer, and runner into one priced decision", async () => {
  const result = await priceResourceCosts({ account: "sigmund-vexler", worstCaseProfitSwapHive: "5.00000000",
    fetchImpl: rcFetch(), machinesRecordPath: "/nonexistent/machines.json" });
  assert.equal(result.status, "priced");
  assert.equal(result.total, "0.00020000");
  assert.equal(result.components.length, 3);
  assert.deepEqual(result.components.map((component) => component.name), ["Hive RC", "signer", "runner/paymaster"]);
  assert.equal(result.components.find((component) => component.name === "Hive RC").amount, "0.00000000");
});

test("priceResourceCosts refuses fail-closed and names every still-unpriced resource when RC capacity cannot be checked", async () => {
  const fetchImpl = async (node) => { throw new Error(`unreachable ${node}`); };
  const result = await priceResourceCosts({ account: "sigmund-vexler", worstCaseProfitSwapHive: "5.00000000",
    fetchImpl, machinesRecordPath: "/nonexistent/machines.json" });
  assert.equal(result.status, "unpriced-resource-cost-model");
  assert.equal(result.reason, "rc-capacity-single-witness");
  assert.deepEqual(result.stillUnpriced, ["Hive RC"]);
  assert.equal(result.components.find((component) => component.name === "signer").amount, DEFAULT_SIGNER_SWAP_HIVE_PER_CYCLE);
});

test("priceResourceCosts refuses rc-capacity-insufficient when the cycle need eats into the declared reserve", async () => {
  const lowManaAccounts = { rc_accounts: [{ account: "sigmund-vexler", max_rc: "1000000000",
    rc_manabar: { current_mana: "1000000", last_update_time: 0 } }] };
  const result = await priceResourceCosts({ account: "sigmund-vexler", worstCaseProfitSwapHive: "5.00000000",
    fetchImpl: rcFetch({ accounts: lowManaAccounts }), machinesRecordPath: "/nonexistent/machines.json" });
  assert.equal(result.status, "unpriced-resource-cost-model");
  assert.equal(result.reason, "rc-capacity-insufficient");
  assert.deepEqual(result.stillUnpriced, ["Hive RC"]);
});

test("priceResourceCosts refuses net-floor-not-met when the certified worst-case profit does not clear priced signer+runner cost", async () => {
  const result = await priceResourceCosts({ account: "sigmund-vexler", worstCaseProfitSwapHive: "0.00050000",
    fetchImpl: rcFetch(), machinesRecordPath: "/nonexistent/machines.json" });
  assert.equal(result.status, "unpriced-resource-cost-model");
  assert.equal(result.reason, "net-floor-not-met");
  assert.equal(result.profit, "0.00050000");
  assert.equal(result.cost, "0.00020000");
  assert.deepEqual(result.stillUnpriced, []);
});
