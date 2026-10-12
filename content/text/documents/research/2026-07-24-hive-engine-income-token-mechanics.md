---
title: "Hive-Engine income-token mechanics: mining, distribution, tribe-stake, and tip tokens"
date: 2026-07-24
status: research note
work-order: wo-research-2026-07-24-hive-engine-income-token-mechanics-md-7fd0323ff111
declared-by: claude/executive-officer-to-the-leader
scope: "keyless reads only — no keys, no signing, no trading; mechanics/ecosystem layer, not the michael561 account plan (that lives separately at content/text/documents/designs/2026-07-24-michael561-income-staking-acquisition-plan.md, not read or written here)"
source-post: "https://peakd.com/@michael561/acquiring-workerbee-using-hiveengines-internal-dex-cec (bridge.get_post, author michael561, permlink acquiring-workerbee-using-hiveengines-internal-dex-cec)"
cited-post: "https://peakd.com/@emsenn0/your-hive-engine-balance-is-not-your-exit-value (2026-07-22)"
data-sources:
  - "https://api.hive-engine.com/rpc/contracts (contract find/getContract JSON-RPC, ground truth for all on-chain numbers below)"
  - "https://api.hive.blog (bridge.get_post, condenser_api)"
  - "https://scot-api.hive-engine.com/config?token=LEO"
  - web search citations inline where an off-chain/bot mechanic could not be read from a contract
fetched-at: "2026-07-24, single research session; all quoted balances/order-book/pool figures are point-in-time and will have moved by the time this is read"
---


This note is durable engineering context for lane capabilities the Union may
build later (per the Leader: "so we can have the context we need in the
future to build shit that strategies like this"). It does not recommend or
execute anything; every RPC call below is a keyless read, reproducible by
re-running the same `curl`.

## 0. The source post, extracted

`michael561`'s post ("Acquiring WORKERBEE Using Hive-Engine's Internal Dex",
published 2024-12-08, fetched via `bridge.get_post`) describes a plain
retail-UI acquisition, not a fee-optimized one:

- Logged into hive-engine.com with Hive Keychain, opened the **HIVE/WORKERBEE**
  market tab (note: the pair traded there is denominated against SWAP.HIVE
  under the hood, displayed as "HIVE" by the UI).
- Placed a **market order** ("executes at the best available price") rather
  than a limit order, explicitly for simplicity over price.
- After acquiring WORKERBEE, staked it and **delegated the stake to
  `neoxianminer`**, described in the post as "a mining pool" that "aggregate[s]
  staked WORKERBEE to increase mining efficiency and distribute rewards
  proportionally among participants."
- No fee figures are stated anywhere in the post — it is a UX walkthrough, not
  a cost accounting. Section 5 below supplies the real fee model from the
  contracts themselves; §1 below shows, from live chain state, that the
  "distribute rewards proportionally" claim in the post is **not** something
  the mining contract enforces — it is a promise about what `neoxianminer`
  (or any pool account) chooses to do with BEE it wins.

## 1. Mining tokens (contract `mining`) — WORKERBEE→BEE worked example

**How it works, from the deployed contract source** (`getContract` on
`mining`, table `pools`/`miningPower`, read directly, not from docs):

- A pool row (`{contract:"mining", table:"pools", query:{id:"BEE:WORKERBEE"}}`)
  names a `minedToken`, one or more `tokenMiners` (token+multiplier that earn
  power in this pool), a `lotteryAmount`, `lotteryWinners`, and
  `lotteryIntervalHours`. Every `lotteryIntervalHours` the contract draws
  `lotteryWinners` independent weighted-random winners from the `miningPower`
  table (one row per **Hive account**, not per pool), each winner receiving
  `lotteryAmount / lotteryWinners` of `minedToken`, paid by direct
  `tokens.issue` to that individual account. This is executed by the
  `checkPendingLotteries`/`runLottery` actions, run by the null-sender system
  account — fully contract-enforced, no issuer discretion in who gets paid
  once the draw runs.
- **Critical, empirically confirmed finding**: a `miningPower` row's `power`
  is that one account's own `stake + delegationsIn` for the mining token, kept
  live by the `tokens` contract calling `mining.handleStakeChange` on every
  stake/unstake/delegate/undelegate. When you **delegate** your staked
  WORKERBEE to a pool operator (e.g. `neoxianminer`, or `ph1102` — the pool
  the fleet's own `scripts/workerbee-yield.mjs` targets), your own `stake`
  drops to the delegated-away amount and your own `miningPower` entry falls to
  whatever remains undelegated. The pool operator's account is the one
  actually entered in the lottery with the combined power, and is the one
  `tokens.issue` pays BEE to. Live proof, fetched this session:
  - `michael561`'s current WORKERBEE balance: `stake=0.00000`,
    `delegationsOut=3.66758`, `delegationsIn=0` — i.e. **zero** mining power
    of its own right now.
  - `ph1102`'s `mining.miningPower` row for `BEE:WORKERBEE`:
    `power=19915.73918` — and `ph1102`'s own `witnesses.accounts` row shows
    `approvalWeight=19915.73918`, the *identical* number, because both the
    mining contract's power and the witness-governance weight (§6) are
    computed from the same `stake + delegationsIn` balance field.
  - Any BEE a pool operator wins is issued straight to the operator's own
    wallet. Whether it is ever shared back with the accounts that delegated
    to it is **not visible in the mining contract at all** — it is an
    off-chain, issuer-scripted promise (the post's "distribute rewards
    proportionally" line), unverifiable keylessly beyond watching the pool
    operator's own outgoing transfer history.
  - The only way an account keeps both its own mining odds *and* its own
    governance weight is to stake and **not** delegate elsewhere.
- **Contract-enforced vs promised, summarized**: the lottery draw and BEE
  payout to the `miningPower.account` on record is contract-enforced. Whether
  that account is *you* or a pool operator you delegated to is a choice you
  make; any redistribution by a pool operator back to delegators is
  issuer-promised, not contract-enforced.

**Verify keylessly** (all against `https://api.hive-engine.com/rpc/contracts`,
method `find` unless noted):
```
{"contract":"mining","table":"pools","query":{"id":"BEE:WORKERBEE"}}
{"contract":"mining","table":"miningPower","query":{"id":"BEE:WORKERBEE"},"indexes":[{"index":"power","descending":true}]}
{"contract":"tokens","table":"balances","query":{"account":"<acct>","symbol":"WORKERBEE"}}
{"contract":"tokens","table":"tokens","query":{"symbol":"WORKERBEE"}}   # or BEE
{"contract":"market","table":"metrics","query":{"symbol":"WORKERBEE"}}  # or BEE
getContract {"name":"mining"}   # read the deployed source directly for ground truth
```

**Worked example (live figures, fetched 2026-07-24)**:
- `BEE:WORKERBEE` pool: `lotteryAmount=10 BEE`, `lotteryWinners=10`,
  `lotteryIntervalHours=1` (24 draws/day, 168/week), `totalPower=229866.38956`
  WORKERBEE. `tokenMiners=[{symbol:"WORKERBEE",multiplier:1}]`.
- WORKERBEE token: `precision=5`, `supply=302764.13654`,
  `totalStaked=229867.32531` (near-matches pool `totalPower`; the small
  residual is normal update lag). BEE token: `precision=8`,
  `supply=4940436.57085270`, `totalStaked=512086.93557889`.
- Market metrics: BEE `highestBid=0.50792124` SWAP.HIVE, WORKERBEE
  `lowestAsk=1.49990000`, `highestBid=1.22200000` SWAP.HIVE.
- **Expected annual BEE per 1 staked-and-undelegated WORKERBEE**:
  `1 × 10 × 168 × 52 / 229866.38956 = 0.380047 BEE/year`.
- At BEE's top bid (the price you could *actually* exit at, per the
  exit-tightness discipline below): `0.380047 × 0.50792124 = 0.193034
  SWAP.HIVE/year` of BEE income per WORKERBEE.
- **Effective annual yield**: `12.87%` measured against the WORKERBEE
  *acquisition* cost (top ask, `1.4999`); `15.80%` measured against the
  WORKERBEE *exit* value (top bid, `1.2220`) — the higher number if you value
  your existing WORKERBEE at what you could sell it for right now, the lower
  number if you value it at what it would cost to rebuild the position today.
  Both numbers assume the account keeps its own mining entry (no delegation
  to a third party) and both are computed at the mean/expected-value level;
  the per-draw variance is high (10 winners out of a `totalPower` of ~230k,
  drawn every hour) — a single staked WORKERBEE mostly wins nothing on any
  given draw.
- Order-book depth for direct WORKERBEE↔SWAP.HIVE was thin: top 5 asks summed
  to only ~200 WORKERBEE (mostly one `ecoinstant` order of 200 at 1.50, plus
  sub-0.1 crumbs at higher prices). The `BEE:WORKERBEE` **diesel pool**
  (marketpools, §5) is far deeper: `baseQuantity=76280.14653788 BEE`,
  `quoteQuantity=31816.30906557 WORKERBEE`, worth roughly 39–41k SWAP.HIVE on
  each side at current prices — a two-hop route (WORKERBEE→BEE via this
  pool, then BEE→SWAP.HIVE via BEE's own 401,944-SWAP.HIVE-deep pool) may
  beat the thin direct order book for any size beyond a couple hundred
  WORKERBEE.

**Other live mining pools** (26 of 34 rows in `mining.pools` are `active:true`,
fetched in full this session): `FARM::FARM` (mines FARM, totalPower 392,609),
`FARMGOV:FARM` (mines FARMGOV, 24h/40, totalPower 421,113), `MYTHICAL::MYTHICAL`
(totalPower 145,795), `SERPENTIS:MYTHICAL`, `CONTROLUS::MYTHICAL` (totalPower
only 566 — thin), `NEOXAG:NEOXAG` (mines NEOXAG, 24h interval, 3200/draw,
totalPower **68,634,719** — by far the largest mining base observed), `DSPN:DSPN`
(totalPower 1,097,030), `CTP:CTPM`, `MUSIC:MUSIC`, `HH:HHG`, and several with
`totalPower=0` despite `active:true` — **`PAL:EXT-SWAP.HIVEPAL`,
`PAL:EXT-BEEPAL`, `WAIV:EXT-SWAP.HIVEWAIV`, `MEME:EXT-MEMELOLZ`** — meaning the
pool exists and would pay out if anyone staked into it, but nobody currently
has, so the "external" lottery numerator is fed by `marketpools.liquidityPositions`
(`pool.externalContract==="marketpools"`) rather than plain `mining.miningPower`,
per the `runLottery` code path — a different mechanic than WORKERBEE's, worth
a dedicated read before building a lane for those.

**What a lane-capability die for this class needs**: a single-purpose die
whose typed input is one admitted `(minedTokenSymbol, minerTokenSymbol)` pair
plus an account name (no key material), whose read leg fetches the pool row,
that account's own `miningPower` row (not a delegated-to pool's), the mined
and miner token metadata, and top-of-book/pool depth for both legs; its output
is an expected-value annual yield in SWAP.HIVE terms computed only from
displayed bid depth (never last price), with an explicit "own power vs.
delegated-away power" flag; its refusal path fires on non-unique or
non-agreeing provider reads, a pool gone `active:false`, `totalPower` of zero,
or the account's own stake having been fully delegated elsewhere (which means
there is no yield left to compute for that account at all).

## 2. "Holding mints more" — the `distribution` contract, corrected

The obvious naive framing — "hold token X, X mints you more" — is **not**
what the Hive-Engine `distribution` contract does, per its deployed source
(`getContract` on `distribution`). It has two `strategy` modes:

- **`"fixed"`**: pays a hard-coded list of `tokenRecipients` (accounts) fixed
  percentages of deposited token balances every tick, decremented over
  `numTicksLeft`. This is a treasury/vesting schedule, not a holder reward at
  all — whoever is on the list gets paid regardless of what they hold.
- **`"pool"`** (the mode seen in every live batch fetched this session): pays
  out proportional to `effShares` computed from
  **`marketpools.liquidityPositions`** for the batch's `tokenPair` — i.e. the
  recipients are **AMM liquidity providers in that specific diesel pool**,
  not plain holders or plain stakers of the token. `getPoolRecipients` reads
  straight from `marketpools`, with a minimum `timeFactor` hold window (tied
  to `distTickHours`) to stop flash-LP gaming. This is fully contract-enforced
  — the emission and its recipient set are computed on-chain from the AMM
  share table, no issuer script required at payout time.
- 76 of 323 `distribution.batches` rows are currently `active:true` with
  `numTicksLeft>0` (fetched in full). Example: `SWAP.HIVE:LIST` (creator
  `hivelist`, `numTicks=1825`, `168` ticks used of 1825 — daily ticks over ~5
  years), currently escrowing a basket including `LIST 74638.15`, `COM
  20380.38`, `STARBITS 2385`, `WINE 41.82`, `LVL 192.96`, `SWAP.HIVE 0.02`,
  `VOTE 7465.24`, `SHEKEL 10.06`, `POKEMON 68.00` — all paid out to whoever
  is currently supplying `SWAP.HIVE:LIST` diesel-pool liquidity, not to
  people just holding LIST.
- **Trust-model distinction the Leader's framing needs**: a token whose
  "yield" is delivered via this contract's `"pool"` strategy requires you to
  be an LP (impermanent-loss exposure, a second asset locked, and the pool's
  own 0.25% swap-fee economics — §5) — it is not free money for passive
  holders. A project that instead promises "hold/stake X and we airdrop Y to
  you" **without** a live `distribution.batches` row backing it is making an
  issuer-scripted promise with no contract enforcement at all; the only way
  to tell the two apart keylessly is to query `distribution.batches` for that
  `tokenPair` and confirm `active:true` and `numTicksLeft>0`.

**Verify keylessly**:
```
{"contract":"distribution","table":"batches","query":{"active":true,"numTicksLeft":{"$gt":0}}}
{"contract":"marketpools","table":"liquidityPositions","query":{"tokenPair":"<PAIR>","account":"<acct>"}}
getContract {"name":"distribution"}
```

**What a lane-capability die for this class needs**: typed input is a
`tokenPair` string; the read leg confirms a live `distribution.batches` row
(`active`, ticks remaining, current escrowed basket) *and* separately
confirms the account holds a `marketpools.liquidityPositions` row for that
exact pair (not just the base token); output is the escrowed-basket value at
current top-of-book/pool prices, prorated by the account's `effShares` share
and remaining ticks; refusal fires if no live batch exists for the pair (the
"printing" claim is then issuer-promised, out of this die's scope) or if the
account has no LP position (nothing to prorate).

## 3. Community-curation stake tokens (Scot / tribe tokens)

Every Scot-tribe token exposes its full reward configuration at
`https://scot-api.hive-engine.com/config?token=<SYMBOL>` (fetched live for
LEO this session, `hive_community=hive-167922`, `token_account=leo.tokens`).
Key fields and what they mean:

- `author_reward_percentage` (LEO: 50.0) / `curation` share is the remainder
  after `beneficiaries_reward_percentage` (20.0, routed to `h@leoburn`) —
  these percentages of the tribe's own token emission per post/vote are
  **off-chain-computed** by the Scot API/hivemind-style indexer watching Hive
  comment/vote operations, then **paid on-chain** as a Hive-Engine `tokens`
  issue to the author/curators. The computation (whose vote counts how much)
  happens off the Hive-Engine chain entirely, in the Scot indexer's own code
  (not something `mining`/`tokens`/`distribution` contracts touch) — so the
  *payout* is on-chain and auditable after the fact via `tokens` history, but
  the *curve* that decided the split is off-chain and must be trusted to
  match the published config (or independently recomputed from raw Hive vote
  data, which Scot APIs do publish per-post).
- `curation_curve_exponent` (LEO: 1.0 — linear) determines how much staking
  more of the tribe token before voting scales your curation share: a linear
  curve means curation reward is directly proportional to vote weight (itself
  proportional to staked tribe-token amount, same shape as native Hive
  curation), so doubling your staked LEO roughly doubles your curation share
  on votes you cast at the same relative timing.
- `mining_pool_claim_number`/`miner_tokens` (LEO: `{"LEOM":1,"LEOMM":4}`,
  `mining_pool_claim_number=30`) — many tribes layer a **second**, tribe-local
  mining mechanic on top of Hive-Engine's own `mining` contract, using tribe-
  specific miner tokens (LEOM/LEOMM here) distinct from WORKERBEE. Treat this
  as its own instance of §1's mechanics, not something this note re-derives
  per tribe.
- `staking_pool_percentage`/`staked_reward_percentage` (LEO: both `0.0`) —
  LEO currently routes **no** extra share to stakers specifically beyond the
  ordinary curation-curve effect of staked tokens increasing vote weight;
  other tribes may set these nonzero (would need a per-tribe fetch to
  confirm — flagged unverified for tribes other than LEO in this session).

**Verify keylessly**: `https://scot-api.hive-engine.com/config?token=<SYMBOL>`
for any tribe (LEO/CTP/NEOXAG/SPT/etc. all documented to expose this
endpoint); cross-check `hive_community` against the actual Hive community
(`bridge.get_community`) to confirm the config matches the community it
claims to configure.

**What a lane-capability die for this class needs**: typed input is one
tribe `SYMBOL` plus an account; the read leg fetches that tribe's
`scot-api` config, the account's staked balance of the tribe token
(`tokens.balances`), and recent Hive posts/votes by the account tagged into
that community (via `bridge`); output is a curation-weight multiplier
estimate (never a guaranteed payout, since post-level curation splits are
computed off-chain per vote); refusal fires if the config's `hive_community`
does not resolve, if `hive_engine_enabled`/`hive_enabled` are false, or if the
account has zero stake (curation weight is then indistinguishable from an
unstaked vote).

## 4. Tip tokens

Tip-bot tokens (`!PIZZA`, `!LUV`, `!BEER`, `!LOLZ`, and similar comment-command
tips) are **entirely off-chain-triggered**: a bot watches Hive comments for
the `!TOKEN` command, checks the commenter's Hive-Engine balance against a
bot-specific threshold, and if eligible, broadcasts a `tokens` `transfer`
custom_json on the commenter's behalf (the bot account itself signs, using
its own posting/active authority, not the tipper's key) to move a small fixed
amount to the tagged recipient. The **threshold-to-allowance mapping is a bot
configuration choice, not a Hive-Engine contract rule** — none of it lives in
`tokens`, `mining`, or `distribution`; it lives in each bot operator's own
service.

From published community documentation (not independently re-derivable from
a contract read, since the logic is off-chain):
- **BEER**: staking 24 BEER grants 1 tip/day of 0.1 BEER; staking 240 BEER
  grants 10 tips/day (linear in stake, per `@rentmoney`'s "Tip Bot
  Requirements" post).
- **LUV**: holding 10 LUV grants up to 3 LUV/day in tips, amount per tip
  flexible (from ~0.50 LUV up).
- **PIZZA**: stake-tier system for weekly PIZZA rewards; the tip command
  itself checks staked-plus-liquid holdings rather than requiring staking
  specifically to invoke `!PIZZA` (exact current daily-tip threshold not
  confirmed in this session — flagged unverified below).

The only part of this class verifiable via a keyless RPC read is the
**resulting transfer**, after the fact, in `account_history_api` or
`tokens`'s own transaction history for the bot account — the eligibility
rule that produced it is not on-chain.

**Verify keylessly (post hoc only)**: `condenser_api.get_account_history` for
the tipping bot account, filtering for `custom_json` ops naming the `tokens`
contract's `transfer` action with the bot as `required_posting_auths` signer.

**What a lane-capability die for this class needs**: typed input is a
`(botAccount, tokenSymbol, tipperAccount)` triple; since eligibility logic is
off-chain, the die can only *observe*, never *compute*, allowance — its read
leg is a bounded scan of the tipper's own outgoing custom_json history for
prior successful tips by that bot (a revealed-preference proxy for "how much
allowance this account actually has"), never a claim about future allowance;
output is that observed historical tip rate with an explicit "issuer-bot
promise, not contract-enforced" tag; refusal fires if fewer than a handful of
historical tips exist to establish the pattern, since a single observed tip
cannot distinguish a threshold-gated allowance from a one-off manual send.

## 5. Acquisition routes — order book vs. diesel pool vs. SWAP.HIVE peg

Read directly from the deployed contract source this session (`getContract`
on `market` and `marketpools`), not from third-party docs, because the two
disagree with common lore in one direction:

- **`market` contract (order book, `buyBook`/`sellBook`, actions like
  `buy`/`sell`/`marketBuy`/`marketSell`/`cancel`)**: the string `"fee"` does
  **not appear anywhere** in the deployed contract's source. There is **no
  protocol trading fee** on Hive-Engine's internal limit/market order book —
  trades settle wallet-to-wallet at the maker's quoted price with no cut
  taken by the contract. Cost here is spread and available depth, not a fee
  line.
- **`marketpools` contract (diesel/AMM pools)**: `marketpools.params` gives
  `tradeFeeMul="0.9975"` live — a flat **0.25% swap fee per trade**, paid to
  the pool's liquidity providers (confirmed independently by a 2022 Tribaldex
  blog post announcing this exact figure taking effect for diesel pools,
  "100% of the fees will go to the liquidity provider"). Slippage beyond the
  0.25% fee is a function of trade size against `baseQuantity`/`quoteQuantity`
  reserve depth (constant-product AMM), worse for thin pools, negligible for
  the BEE/SWAP.HIVE-scale pools in §7's shortlist.
- **SWAP.HIVE peg (deposit/withdraw of native HIVE)**: this is **not** a
  Hive-Engine smart contract at all — it is an off-chain gateway operated by
  witness-controlled multisig accounts (`hive-engine`, `honey-swap`, etc.,
  visible in `tokens.params.heAccounts`), so there is no `params`-table fee
  to query (`hivepegged` is not a real contract name; the query returned
  `null`). The best available figure, from a 2022 Tribaldex announcement, is
  a **0.75% gateway deposit fee** (down from 1%) with withdrawal fees varying
  by chain (BSC/ETH withdrawals cited at 1%, no fee on deposit for those
  chains specifically) — this is **flagged unverified-current**: it is a
  2022 announcement with no live contract parameter to re-confirm against,
  and gateway operators can change it without an on-chain trace visible via
  `find`/`getContract`.
- **When each route wins**: the order book wins for small, patient limit
  orders in a liquid pair (zero protocol fee, but you eat the spread and any
  lack of depth — WORKERBEE's own order book was thin, per §1). The diesel
  pool wins for size or for pairs with no deep order book but a fat AMM
  reserve (e.g. routing WORKERBEE through its BEE diesel pool rather than the
  thin direct SWAP.HIVE order book) — flat 0.25% fee plus AMM slippage,
  predictable in advance from the reserve numbers. The SWAP.HIVE peg is not
  really a competing *route* between tokens — it is the unavoidable one-time
  toll (now believed ~0.75%, unconfirmed live) to get native HIVE onto the
  Hive-Engine side at all; once in as SWAP.HIVE, every further hop is market
  or diesel-pool, fee-known, on-chain.

**Verify keylessly**:
```
getContract {"name":"market"}       # confirms zero fee logic by absence
{"contract":"marketpools","table":"params","query":{}}   # tradeFeeMul
{"contract":"tokens","table":"params","query":{}}         # heAccounts gateway list
```

## 6. Governance: staked-WORKERBEE witness voting (added scope)

Read directly from the deployed `witnesses` contract source (`getContract`),
cross-checked against live `witnesses.params`/`witnesses.accounts`/
`witnesses.approvals`/`witnesses.witnesses` rows fetched this session:

- `GOVERNANCE_TOKEN_SYMBOL="WORKERBEE"`, precision 5. An account's witness
  **approval weight** is computed, live, as `balance.stake +
  balance.delegationsIn` for WORKERBEE — the *same* balance fields §1's
  mining power is computed from. `actions.approve({witness})` (a `custom_json`
  naming contract `witnesses`, action `approve`) records a `{from, to}` row in
  `witnesses.approvals` and adds the sender's current approval weight to that
  witness's `approvalWeight`; an account may hold up to
  `numberOfApprovalsPerAccount` (live: **30**) simultaneous approvals.
  Approvals **expire** after `witnessApproveExpireBlocks` (live:
  **5,184,000** blocks, roughly six months at Hive's ~3s block time) unless
  renewed, at which point `expireAllUserApprovals` zeroes them out — so a
  quoted `approvalWeight` can be stale relative to current stake if the
  voter's `lastApproveBlock` is old, not just if their balance changed.
- **Scheduling**: `numberOfTopWitnesses=20` (live) are always in the potential
  schedule by approval-weight rank; `numberOfWitnessSlots=21` (1 backup slot
  filled by weighted-random draw from the remaining approved witnesses,
  proportional to their `approvalWeight` — a second, separate lottery
  mechanism from §1's mining lottery, same `api.random()`-weighted-cumulative-
  sum pattern). `witnessSignaturesRequired` is **13** live (hard-coded default
  in the source is 14; live params show it was subsequently changed via
  `updateParams` by the contract owner, `hive-engine` — a reminder that
  `params` rows can drift from the shipped source and must be read live, not
  assumed from code).
- **Witness block reward**: `0.01902586 BEE` per witness-slot, paid only to
  the `currentWitness` on a successfully verified `proposeRound`, funded from
  the `witnesses` contract's own BEE balance (topped up from token-creation
  and similar protocol fees) — this rewards *running witness infrastructure*,
  not holding or staking WORKERBEE; ordinary stakers/voters receive no direct
  cut of it.
- **Same delegation trap as §1, confirmed live**: `ph1102`'s
  `witnesses.accounts` row shows `approvalWeight=19915.73918` with 9 active
  approvals (`kanibot`, `neoxianminer`, `endecs-bamlolx`, `c0ff33a`,
  `locolombia`, `he-marketmaker`, `ph1102.ctp`, `prime.witness`, `liotes`) —
  the exact figure that matches its own mining-power row in §1, i.e. WORKERBEE
  delegated *to* `ph1102` gives `ph1102` both the mining odds and the
  governance weight simultaneously. `michael561`'s `witnesses.accounts` row
  shows `approvalWeight=0.00000`, `approvals=0` — it has never called
  `witnesses:approve` at all, and even if it had, its own current WORKERBEE
  stake is 0 (fully delegated out), so any past approval weight would already
  have decayed to zero as its balance changed. **This directly complicates
  the doctrine framing that "WORKERBEE is part of how we get stuff for doing
  governance on hive-engine": delegating WORKERBEE away for BEE mining yield,
  as the source post and the fleet's own `workerbee-yield.mjs` both do,
  forfeits that account's own governance weight to the pool operator. Keeping
  both mining yield and governance weight on the *same* account requires
  self-staking without delegating anywhere** — a real design tradeoff, not
  a detail, that any future lane-capability die for WORKERBEE must expose
  rather than assume away.

**Verify keylessly**:
```
{"contract":"witnesses","table":"params","query":{}}
{"contract":"witnesses","table":"witnesses","query":{}}
{"contract":"witnesses","table":"accounts","query":{"account":"<acct>"}}
{"contract":"witnesses","table":"approvals","query":{"from":"<acct>"}}
getContract {"name":"witnesses"}
```

**What a lane-capability die for this class needs**: typed input is one
account; the read leg fetches that account's own `tokens.balances` WORKERBEE
row (`stake`, `delegationsIn`, `delegationsOut`) and its `witnesses.accounts`
row (`approvalWeight`, `approvals`, `lastApproveBlock`); output is a single
boolean-plus-number — "does this account currently carry its own governance
weight, and if so how much" — computed independently of any mining-yield
claim about the same tokens, never assuming the two travel together; refusal
fires if `stake` and `delegationsIn` are both zero (nothing to vote with) or
if `lastApproveBlock` is old enough that expiry is imminent/ambiguous without
re-deriving the exact expiry block from `witnessApproveExpireBlocks`.

## 7. Live survey — shortlist and known-dead examples

All figures fetched 2026-07-24 in this session; SWAP.HIVE depth for diesel
pools is the real base/quote reserve on the SWAP.HIVE side of the pair, not
the raw `baseQuantity` field (which is meaningless when SWAP.HIVE is the
*quote* token in the pair string).

| Symbol | Class | Depth/liquidity evidence | One-line verdict |
|---|---|---|---|
| BEE | mining-emitted utility token | diesel `SWAP.HIVE:BEE` pool depth 401,944 SWAP.HIVE; order book bid 0.50792/ask 0.51244 | deepest single token on the chain by diesel depth; healthy |
| WORKERBEE | mining (stakes to earn BEE + governance) | order book thin (~200 WORKERBEE visible asks); `BEE:WORKERBEE` diesel pool ~39–41k SWAP.HIVE-equivalent each side | acquire via the diesel pool for size, not the thin direct book |
| SPS (Splinterlands) | mining/tribe hybrid | `SWAP.HIVE:SPS` diesel depth 492,988 SWAP.HIVE; several more SPS-paired pools (`DEC:SPS` 63.9M DEC-side, `PKM:SPS` 16.2M) | very healthy, widest pairing footprint observed |
| SWAP.BTC | pegged asset | `SWAP.HIVE:SWAP.BTC` diesel depth 763,268 SWAP.HIVE | deepest SWAP.HIVE pool observed this session |
| LEO (tribe/Scot) | community-curation stake | `SWAP.HIVE:LEO` diesel depth 110,647 SWAP.HIVE; scot-api config live and reachable | healthy, config transparent |
| DEC (Splinterlands) | mining/utility | `SWAP.HIVE:DEC` diesel depth 276,812 SWAP.HIVE | healthy |
| NEOXAG | mining (huge base) | mining `totalPower=68,634,719` (largest observed); diesel `SWAP.HIVE:NEOXAG` only 1,587 SWAP.HIVE-equivalent; order-book volume near-zero (`0.00075` last, spread <0.001) | mining base huge but **exit liquidity is thin relative to mining base** — classic exit-tightness risk per the emsenn0 citation below |
| FARM | mining | mining `totalPower=392,609`; diesel `SWAP.HIVE:FARM` 3,242 SWAP.HIVE; order-book stale (`volumeExpiration` months old, ask 200 vs bid 0.00000001) | order book effectively dead; only the diesel pool offers real exit |
| EDSI (income/tribe token modeled in existing code) | issuer-scripted native-HIVE payer | order book: bid 1.00400/ask 1.07777, volume 213.28 over the metrics window; no diesel pool found for EDSI | thin but alive; matches `income-token-audit.mjs`'s existing `eds-pay` payer model |
| SPI (income token modeled in existing code) | issuer-scripted native-HIVE payer | order book: last trade 5.99, but `highestBid=2.00000000`, volume only 5.99 total, no diesel pool | **near-dead** — a 3x gap between last trade and top bid is a screaming exit-tightness warning; do not value at last price |
| BRO (income token modeled in existing code) | issuer-scripted native-HIVE payer | order book: last 0.0997, `highestBid=0.00030000` (300x below last price!); `BRO:SWAP.HIVE` diesel pool only 5.576 SWAP.HIVE deep | **dead/rugged-looking** — the bid is nearly worthless relative to the last trade; flag as evidence of zero real exit depth, not zero balance |
| PAL, WAIV, MEME mining pools | mining | `mining.pools` rows `active:true` but `totalPower=0` for `PAL:EXT-SWAP.HIVEPAL`, `PAL:EXT-BEEPAL`, `WAIV:EXT-SWAP.HIVEWAIV`, `MEME:EXT-MEMELOLZ` | live but currently unstaffed — would pay out to the first staker but nobody has bothered |
| SWAP.HIVE:SEED, SWAP.HIVE:INCOME diesel pools | misc | 0.00974972 and 0.05164627 SWAP.HIVE depth respectively | **known-dead by evidence**: sub-cent real depth, functionally rugged |
| XBOT:SWAP.HIVE, SWAP.HIVE:HPV diesel pools | misc | exactly `0` SWAP.HIVE-side reserve | **confirmed dead**, zero depth, not "unknown" |

## 8. What the fleet's own code already models

- `scripts/workerbee-yield.mjs` already reads the exact contracts this note
  documents (`tokens`, `mining`, `market`), computes an
  expected-value annual yield with the same lottery-expectation formula
  derived independently in §1, and — importantly — already encodes the
  stake-*and*-delegate pattern to a named pool account (`ph1102`,
  `POOL_ID="BEE:WORKERBEE"`), which per §1/§6's findings means the fleet's
  existing plan **knowingly trades away governance weight for pooled mining
  odds** whenever it runs; that tradeoff is implicit in the code today and
  should be made explicit if a future die is built from it.
- `scripts/income-token-audit.mjs` models exactly the "issuer-scripted
  emission" trust class from §2/§4: a closed `SUPPORTED` map of symbol→payer
  Hive account (`EDSI→eds-pay`, `SPI→spi-payments`, `BRO→brodivs`), reading
  native-HIVE transfer memos from `condenser_api.get_account_history` across
  independent nodes and requiring agreement before trusting a distribution —
  this is the correct pattern for anything in §2's "issuer-scripted, not
  contract-enforced" bucket, and for §7's EDSI/SPI/BRO rows specifically.

## 9. Exit-tightness discipline (cited, not repeated)

`emsenn0`'s "Your Hive Engine balance is not your exit value" (2026-07-22,
confirmed live via `bridge.get_post`) is the fleet's standing methodology for
every depth number quoted in this note: a balance times a `lastPrice` is not
an exit value; only integrating actual displayed bid depth (as
`workerbee-yield.mjs`'s `depthProceeds` already does, and as this note's §7
verdicts for SPI/BRO apply informally) tells you what a position could really
convert to. Every "dead"/"thin" verdict in §7 is exactly this discipline
applied: BRO and SPI both show a wide last-price-to-top-bid gap that a naive
balance-times-last-price valuation would hide.

## Unverified-claims list

- **SWAP.HIVE gateway deposit/withdraw fee** (§5): best figure found is a
  2022 announcement (~0.75% deposit, chain-dependent withdrawal fees); there
  is no live contract parameter to re-confirm this against keylessly, since
  the peg is gateway-operated, not a Hive-Engine smart contract. Treat as
  **unknown-current**, not zero.
- **PIZZA tip-token exact daily threshold** (§4): community posts describe a
  stake-tier system for weekly rewards and note the tip command checks
  staked-plus-liquid balance, but the exact current per-tier daily tip count
  was not pinned down in this session. **Unknown**, not zero.
- **Non-LEO tribe `staking_pool_percentage` values** (§3): only LEO's
  scot-api config was fetched this session; other tribes (CTP, NEOXAG, SPT,
  etc.) may set staker-specific bonuses nonzero — each would need its own
  `scot-api` fetch before relying on "no staker bonus" for any tribe other
  than LEO.
- **PAL/WAIV/MEME `externalContract:"marketpools"` mining mechanics** (§1):
  confirmed these pools exist and read from `marketpools.liquidityPositions`
  instead of `mining.miningPower`, but the exact `externalMiners` pairing and
  current LP-position holders were not enumerated this session.
- **Whether any pool operator (`neoxianminer`, `ph1102`, etc.) actually
  redistributes won BEE back to delegators, and on what schedule** (§1/§6):
  by construction this is off-chain issuer behavior; verifying it would
  require scanning that operator's own outgoing transfer history over time,
  not attempted in this session.
