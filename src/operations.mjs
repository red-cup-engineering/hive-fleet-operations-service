/**
 * The Hive wallet fleet's game-play accounts as an operation family, so an office acts through
 * MetroPlat instead of a bespoke script invocation: read a game's live position, or run its one
 * admitted action (claim, plant/harvest, or the single conservative battle each cycle already
 * plans). Every mutating verb defaults `executeOne` to false — a read, never a broadcast — so a
 * caller must ask for execution explicitly. The operating account for each game comes from the
 * fleet's own strategy config (aagaard.config.json's per-account `lanes`), never a name written
 * into this file: accountsWithLane is the one place account identity is decided.
 */
import { operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { accountsWithLane } from "./core/accountStrategy.mjs";

// The one starter plot this fleet has planted so far (land 472218, seed 472217 "Artichoke",
// plot 0) — game-state facts read off the account's own NFTs, not a policy choice. A caller
// may name a different land/seed/plot once the fleet plants a second one.
const DCROPS_DEFAULT_PLOT = Object.freeze({ landID: 472218, seedID: 472217, plotNo: 0 });

function laneAccount(lane, requested) {
  const holders = accountsWithLane(lane);
  const account = requested ?? holders[0];
  if (!account) throw new Error(`hive-games: no fleet account carries the "${lane}" lane`);
  if (!holders.includes(account)) throw new Error(`hive-games: ${account} does not carry the "${lane}" lane`);
  return account;
}

export function hiveGamesOperations() {
  return Object.freeze([
    operation({
      verb: "hive-game-holozing-rewards",
      summary: "Read HoloZing's pending ZING rewards, or claim them into staked ZING.",
      description: "Domain: { account?, executeOne? }. Codomain: the aagaard.holozing-reward-claim-receipt (observed, or claimed-confirmed/refused once two Hive-Engine providers agree). executeOne defaults to false. The Alpha Vial this account holds is never opened or transferred by this verb.",
      reads: ["hive/holozing-pending-rewards"],
      writes: ["hive/holozing-zing-stake"],
      run: async (input = {}) => {
        const args = { account: laneAccount("holozing-rewards", input.account), executeOne: input.executeOne === true };
        const { operate } = await import("../scripts/holozing-rewards.mjs");
        return operate(args);
      },
    }),
    operation({
      verb: "hive-game-terracore-cycle",
      summary: "Read TerraCore's SCRAP/battle state, or run its one admitted action this tick (claim raid-exposed SCRAP, or one conservative battle).",
      description: "Domain: { account?, executeOne? }. Codomain: the aagaard.terracore-one-action-receipt. executeOne defaults to false. At most one claim or one battle runs per call; the fleet's Resource Credit reserve gates whether a battle is admitted at all.",
      reads: ["hive/terracore-player-state"],
      writes: ["hive/terracore-scrap", "hive-engine/scrap-balance"],
      run: async (input = {}) => {
        const args = { account: laneAccount("games", input.account), executeOne: input.executeOne === true, recoverTx: input.recoverTx ?? "" };
        const { operate } = await import("../scripts/terracore-cycle.mjs");
        return operate(args);
      },
    }),
    operation({
      verb: "hive-game-dcrops-cycle",
      summary: "Read one dCrops plot's season/land/seed state, or run its one admitted action (remove-expired, plant, or harvest).",
      description: "Domain: { account?, landID?, seedID?, plotNo?, executeOne? }. Codomain: the aagaard.dcrops-plot-receipt. Defaults to this fleet's one planted starter plot (land 472218, seed 472217, plot 0); executeOne defaults to false.",
      reads: ["hive-engine/dcrops-plot-state"],
      writes: ["hive-engine/dcrops-plot-action"],
      run: async (input = {}) => {
        const args = {
          account: laneAccount("games", input.account),
          landID: input.landID ?? DCROPS_DEFAULT_PLOT.landID,
          seedID: input.seedID ?? DCROPS_DEFAULT_PLOT.seedID,
          plotNo: input.plotNo ?? DCROPS_DEFAULT_PLOT.plotNo,
          executeOne: input.executeOne === true,
        };
        const { operate } = await import("../scripts/dcrops-cycle.mjs");
        return operate(args);
      },
    }),
    operation({
      verb: "hive-game-workerbee-pool-audit",
      summary: "Read whether the WORKERBEE-to-ph1102 delegation has a newly settled BEE distribution.",
      description: "Domain: { account? }. Codomain: the aagaard.workerbee-pool-audit record. Read-only: this verb never stakes, delegates, or claims — the fleet's one stake-and-delegate position is already placed, and this only checks the pool's own periodic payout.",
      reads: ["hive-engine/workerbee-delegation", "hive/account-history"],
      run: async (input = {}) => {
        const args = { account: laneAccount("workerbee-yield", input.account) };
        const { operate } = await import("../scripts/workerbee-pool-audit.mjs");
        return operate(args);
      },
    }),
  ]);
}
