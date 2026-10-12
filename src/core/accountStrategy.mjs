import { readFileSync } from "node:fs";

const CONFIG_PATH = new URL("../../aagaard.config.json", import.meta.url);

/** The key roles the strategy config declares an account holds, or null when it declares none. */
export function declaredKeyRoles(account, config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))) {
    const row = (Array.isArray(config.accounts) ? config.accounts : []).find((entry)=>entry?.account === account);
    return Array.isArray(row?.keys) ? row.keys.filter((role)=>typeof role === "string") : null;
}

/** An account signs only with a role its strategy config says the fleet holds. */
export function assertAccountMutationRole(input, config) {
    const roles = declaredKeyRoles(input.account, config);
    if (roles !== null && !roles.includes(input.role)) {
        throw new TypeError(`${input.account} holds only ${roles.join(", ") || "no"} keys; a ${input.role}-key ${input.operation} is not signable`);
    }
    return true;
}

/** One account's signing policy from the strategy config: the fleet's accounts (the only transfer
 * recipients besides the peg), whether it trades, the keys it holds, its per-operation value caps
 * (thousandths of HIVE/HBD/SWAP.HIVE) and its vote ceiling and mana floor. */
export function accountPolicy(account, config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))) {
    const rows = Array.isArray(config.accounts) ? config.accounts : [];
    const row = rows.find((entry)=>entry?.account === account) ?? null;
    const number = (value, fallback)=>typeof value === "number" && Number.isFinite(value) ? value : fallback;
    const live = row?.tradingLive === true;
    return Object.freeze({
        account,
        inFleet: row !== null,
        fleet: Object.freeze(new Set(rows.map((entry)=>entry?.account).filter((name)=>typeof name === "string"))),
        tradingLive: live,
        keys: declaredKeyRoles(account, config),
        capHiveMilli: BigInt(Math.floor(number(row?.capHiveMilli, live ? 5000 : 1000))),
        capHbdMilli: BigInt(Math.floor(number(row?.capHbdMilli, live ? 5000 : 1000))),
        capSwapHiveMilli: BigInt(Math.floor(number(row?.capSwapHiveMilli, number(row?.capHiveMilli, live ? 5000 : 1000)))),
        maxVoteWeightBps: Math.max(1, Math.min(10000, Math.floor(number(row?.maxVoteWeightBps, 5000)))),
        votingPowerFloorBps: Math.max(0, Math.min(10000, Math.floor(number(row?.votingPowerFloorBps, row?.archetype === "alpha-hunter" ? 6500 : 8000)))),
    });
}

/** The fleet accounts whose strategy config runs `lane` (their "lanes" list), in config order. */
export function accountsWithLane(lane, config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))) {
    return Object.freeze((Array.isArray(config.accounts) ? config.accounts : [])
        .filter((entry)=>Array.isArray(entry?.lanes) && entry.lanes.includes(lane)).map((entry)=>entry.account));
}

/** The curation cycle's policy from the strategy config: its shared "curation" block, run for the
 * accounts whose lanes include "curation". */
export function curationPolicy(config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))) {
    return Object.freeze({ ...(config.curation ?? {}), accounts: accountsWithLane("curation", config) });
}
