---
title: "Assisting Hive as a network: every earning line, ranked, and what is already built"
date: 2026-09-26
status: research note
scope: "an inventory, not a new recommendation engine -- every line below is cross-checked against what this checkout already runs before being ranked"
data-sources:
  - "repo inventory of hive-engineering-services-section/services/* (2026-09-26)"
  - "the companion research note, 2026-09-26-smart-contracts-on-hive-2026.md"
  - "condenser_api.get_dynamic_global_properties, rc_api.find_rc_accounts (live, 2026-09-26)"
---

Every way the Group can earn by *assisting Hive as a network* (as opposed to trading its
assets), ranked by expected earnings per unit of effort, cross-checked against what this
checkout already runs so nothing here duplicates a package that exists. "Effort" means
engineering + operating effort, not capital -- capital-sizing is a separate, founder-made
decision noted per line.

## 1. Curation (built, and today's fix roughly triples its live effectiveness for free)

The Group already runs a two-account, five-tag curation cycle every two minutes on
cold-red-gate (`curation-services-section`: `observe-tribe-curation-yield-service`,
`schedule-set-of-votes-service`, `cast-set-of-votes-service`, `run-hive-curation-cycle-service`).
Today's fix (see the dated commit) corrected a stale pre-HF25 timing assumption that was
refusing ~99% of candidates as "outside-window"; the very next cycle after the fix cast a real
vote. Effort to keep running: zero (already deployed). Expected earnings: small per curation
reward math (this is a ~640 HP and ~23 HP account, not a whale), but now actually accruing
instead of mostly not firing. **Rank: highest per-effort of anything here, because the effort
was already spent and today's fix was a data correction, not new code.**

## 2. Hive-Engine market making / liquidity provision (built)

`internal-market-services-section` (`apply-peg-ladder-service`, `derive-peg-ladder-service`,
`hive-peg-ladder-cycle-service`, `reconcile-peg-ladder-fills-service`) and
`observe-hive-engine-liquidity-opportunity-service` already exist: HIVE/HBD peg-ladder market
making and Hive-Engine constant-product pool opportunity discovery. Effort: already built;
scaling it is a capital-sizing decision (how much liquid HIVE/HBD/token inventory to commit),
not an engineering one. **Rank: high, capital-gated.**

## 3. Game guild operations (built)

`hive-games-services-section` (dCity, dCrops, HashKings, HoloZing, Splinterlands, TerraCore,
WorkerBee) is built out, and as of today's other concurrent work, four of those run on
systemd timers on cold-red-gate claiming rewards/advancing state automatically (HoloZing ZING
claims, TerraCore SCRAP claims + its one battle, dCrops plot advancement, WorkerBee pool
watching), journaling every tick. Effort: already built and deployed. Expected earnings: small
today (starter-scale assets per the fleet's own holdings), scales with capital committed to
each game's assets -- a founder-made sizing decision per game, not an engineering one.
**Rank: high, capital-gated, already running.**

## 4. DHF-funded development proposals for tools the Group already builds

Not yet done: a draft proposal exists as of this note (see the companion document,
`2026-09-26-dhf-proposal-marsh-on-hive-and-fleet-tooling.md`), naming MARSH-on-Hive and the
curation/market/game tooling above as the deliverable. The DHF currently holds 23.2M HBD and
pays roughly 1% of that per day to proposals above its moving return-line threshold (see the
smart-contracts note, S5) -- this is real, ongoing money for exactly the kind of maintained
infrastructure this checkout already produces, not a one-off grant. Effort: writing the
proposal is done; getting it funded needs stake-weighted votes, which needs either the
Group's own HP (small today) or outside reputation/visibility -- a distribution problem, not
an engineering one. **Rank: potentially the highest absolute payout per engineering-hour of
anything on this list, gated on votes rather than more code.**

## 5. Resource Credit (RC) delegation leasing

Not previously built; built today as `observe-hive-rc-delegation-opportunity-service`
(read-only: reports an account's idle RC above what it has already delegated out). No
established public market rate exists to price a lease against (see the smart-contracts note,
S5/S7) -- this is a real but currently thin, mostly-bilateral opportunity (an app or guild
delegating RC to its own users), not a liquid market the Group can simply tap. Effort: low
(observation is built); realizing income needs finding a counterparty willing to pay for
delegated RC, which is a business-development step, not an engineering one. **Rank: low
today, real but requires demand-finding.**

## 6. Witness / API / HAF node operation

Not built, and not recommended as a near-term line: witness *pay* only accrues to accounts
voted into the top ~20 (or backup) witnesses, which needs both real infrastructure (a
synced, fast `hived` node) and enough stake-weighted reputation to be voted in -- neither of
which the Group has today. Running a public API or HAF-backed endpoint can earn indirectly
(reputation, paid heavy-query tiers, DHF-proposal eligibility) without needing witness votes,
but needs real server capacity beyond cold-red-gate's current footprint. **Rank: lowest
per-effort today; a multi-month infrastructure commitment, not a quick win. Named here so it
is not forgotten, not proposed for building now.**

## 7. HBD savings interest (not automated, by standing founder ruling)

HBD savings currently pays 10% APR (`hbd_interest_rate` 1000 basis points, read live
2026-09-26 via `condenser_api.get_dynamic_global_properties`) -- a real, simple, near-zero-
effort yield. It is **not** built as an automated operation and should not be: the curation
program's own doctrine (`the-hive-curation-program.md`, S4D-S7) already refused automating
any staking/savings/delegation instrument, per the founder's liquidity-stays-liquid ruling,
and both fleet accounts hold 0.000 HBD in savings today by that same standing choice. Listed
here for completeness, not as a build item -- moving HBD into savings is the founder's own
manual call, never an automated one.

## Ranked summary

| # | Line | Built? | Capital needed | Rank driver |
|---|---|---|---|---|
| 1 | Curation | yes (fixed today) | none | effort already spent, fix unlocked it |
| 2 | Hive-Engine market making | yes | scales with capital | already running, capital-gated |
| 3 | Game guild ops | yes (4 games live today) | scales with capital | already running, capital-gated |
| 4 | DHF-funded proposals | draft written today | none | vote/reputation-gated, highest absolute upside |
| 5 | RC delegation leasing | observer built today | none | demand-finding-gated |
| 6 | Witness/API/HAF node | no | real infrastructure | multi-month commitment |
| 7 | HBD savings | refused (founder ruling) | n/a | liquidity-stays-liquid |

## Candidate rule for the founder's unified rule-check layer

MARSH-on-Hive's contract already enforces controller-only resource transitions on-chain (see
the companion MARSH-on-Hive commit); at the fleet-signer layer, the rule worth adding once
`marsh` contract calls are wired into `hive-broadcast.mjs`'s Hive-Engine call validation would
be, in the same shape as the existing rules:

- statement: "The fleet signer MUST NOT broadcast a Hive-Engine `marsh` contract call whose
  `resource` field does not already name the signing account as its controller segment."
- subject: `hive:<any fleet account>`
- action: `hive:custom_json` (contractName `marsh`)
- condition: the resource id's controller segment equals the signing account.

Not added to `hive-broadcast.mjs` in this pass -- named here for the rules layer rather than
hand-rolled, per standing direction.
