---
name: playing-hive-games
description: "Claim a Hive game's ready rewards, or run its one admitted action this tick, for whichever fleet account the strategy config carries that game's lane."
closure-kind: process
requires-capabilities:
  - hive-game-holozing-rewards
  - hive-game-terracore-cycle
  - hive-game-dcrops-cycle
  - hive-game-workerbee-pool-audit
---

# Play the fleet's Hive games on schedule

1. Read a game's live position first: call the verb with `executeOne` omitted (or `false`). The
   operating account is resolved from `aagaard.config.json`'s per-account `lanes` — never name an
   account in code that calls these verbs.
2. When the read reports a ready claim, an eligible plant/harvest, or the one available battle,
   call the same verb again with `executeOne: true`.
3. Every claim, plant/harvest, and battle already reconciles against at least two independently
   observed chain providers before it reports success (`claimed-confirmed`, `confirmed`,
   `battle-won-confirmed`); a receipt with any other status did not change on-chain state and is
   not done.
4. This skill grants no vial-opening, no Splinterlands battle submission, and no dCity/HashKings
   NFT liquidation — those stay outside every verb this skill grants, because the underlying game
   packages (`holozing-services-section`, `splinterlands-services-section`, `dcity-services-section`,
   `hashkings-services-section`) never expose them in the first place.
5. `hive-game-workerbee-pool-audit` is read-only: it reports whether the pool has settled a new
   BEE distribution to the fleet's existing WORKERBEE delegation. It never stakes or delegates.

Deployed as three 15-minute systemd --user timers (`hive-game-holozing-rewards`,
`hive-game-terracore`, `hive-game-dcrops`) and one hourly read-only timer
(`hive-game-workerbee-audit`) on cold-red-gate, each appending one JSON line per tick to
`~/.local/state/561-group/hive-games/<game>.jsonl` via `scripts/journal-game-tick.mjs` regardless
of whether the tick claimed something or found nothing to do.
