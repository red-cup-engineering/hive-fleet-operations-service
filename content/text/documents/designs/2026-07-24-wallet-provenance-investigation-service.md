---
title: "Wallet-provenance-investigation service: the die, and a first fleet run"
date: 2026-07-24
status: "draft"
work-order: wo-designs-2026-07-24-wallet-provenance-investigation-service-m-ece72597692b
kind: design
declared-by: claude/executive-officer-to-the-leader
doctrine: content/text/documents/articles/notes/2026-07-24-account-strategy-doctrine.md
config: aagaard.config.json
access: keyless reads only; no key was read, no transaction was signed or broadcast in producing this document
fetched: 2026-07-24, head block ~108403155 (condenser_api.get_dynamic_global_properties)
---


## 0. Doctrine this die operates under

Per `content/text/documents/articles/notes/2026-07-24-account-strategy-doctrine.md`
(2026-07-24): **"any asset any wallet we have has, assume i
wanted it for a reason, at least when i got it."** This die is a
reconstruction instrument, never a liquidation proposal. Its terminal states
are always one of the doctrine's five strategy classes — **stack-token**,
**income-printing** (the doctrine's "tokens that print"), **curation-stake**
(community-curation staking), **tip**, **governance accrual** — or the
doctrine's own escape hatch, **presumed-intent-unknown**, which is itself an
admitted output, not a defect. Nothing this die emits is, or implies, a sell
order.

## Part 1 — the die

### 1.1 Typed input

```
WalletProvenanceQuery {
  account: ChainQualifiedAccountId   // e.g. "hive:michael561" — chain prefix is load-bearing, not decorative (die register)
  assetFilter?: {
    symbols?: string[]               // e.g. ["WORKERBEE","ZING"] — native "HIVE"/"HBD"/"HP" are reserved symbols
    kind?: "native" | "engine-liquid" | "engine-staked" | "engine-delegated" | "nft"
  }
  historyDepth?: {
    sampleOnly: boolean               // true = bounded recent-history sample (this run's default); false = full-replay request
    lookbackOps?: number              // native account_history op count, if sampleOnly
  }
}
```

The `hive:` prefix is not cosmetic: this die is chain-qualified by design so a
later `eth:`/`base:` account can be typed against the same shape without a
new die being cast — see the x402 die's own "scale-polysemous... never an
acronym" register (`die.json`), which this die's input type follows literally.

### 1.2 Typed output — per-asset provenance record

```
AssetProvenanceRecord {
  account: ChainQualifiedAccountId
  asset: {
    id: string                        // symbol, or native "HIVE"|"HBD"|"HP", or NFT set id
    kind: "native-liquid" | "native-hp" | "engine-liquid" | "engine-staked"
        | "engine-delegated-out" | "engine-delegated-in" | "engine-pending-unstake"
        | "nft-instance"
    amount: string                    // exact decimal string, token-native precision — never a float
  }
  acquisition: {
    mechanism: "purchase" | "transfer-in" | "mining-emission" | "airdrop"
             | "stake-reward" | "author-reward" | "curation-reward"
             | "auto-distribution" | "delegation-in" | "unresolved"
    counterparty?: string             // sender account, contract, or pool id, when the mechanism names one
    memo?: string
  }
  when: {
    firstAcquisitionTimestamp: string | "unresolved-beyond-sample-depth"
    latestChangeTimestamp: string
  }
  strategyClass: "stack-token" | "income-printing" | "curation-stake" | "tip"
               | "governance" | "presumed-intent-unknown"
  evidenceRefs: {
    rpcCalls: string[]                // exact method + endpoint + params, replayable verbatim
    txIds: string[]
  }
}
```

Two fields are deliberately independent and must never be collapsed into
each other, which this run's own data forces into the open (§2.7): a record
can carry **fully certain acquisition evidence** (an exact tx id, sender, and
memo) while still carrying `strategyClass: presumed-intent-unknown`, because
the doctrine's five classes are strategy-purpose buckets, and "no admitted
class fits" is a different fact from "we don't know how we got it." The
reverse also occurs: a class can be confidently assigned by symbol identity
(a known mining/distribution contract, a known tribe token) while
`acquisition.mechanism` stays `unresolved` because the specific inbound event
wasn't in the sampled window. A refusal (§1.3) is a third, stricter state
still: it means the query itself could not be answered at all, not that an
answer was answered weakly.

### 1.3 Typed refusal

```
WalletProvenanceRefusal {
  account: ChainQualifiedAccountId
  reason: "unreadable-account"        // condenser_api.get_accounts returned empty/error for the name
         | "unsupported-chain"        // prefix other than "hive:" with no die cast for that chain yet
         | "history-truncated-beyond-confidence"  // the requested lookback exceeds what the sampled window can support
}
```

### 1.4 What the sellable version adds

- **Pricing unit**: per-account (one `WalletProvenanceQuery` with no
  `assetFilter`, full holdings) or per-asset (one query, one `symbols`
  filter) — mirroring the existing invoice-first manual-report pattern
  already priced in this settlement (`README.md`: "five invoice-first manual
  reports at exactly 0.250 HBD each," the product-pilot lane). This die does
  not itself set a price; it is the unit the Hive-x402 die (§0 related)
  would settle against once cast.
- **What the buyer gets**: every field in §1.2 for the queried scope —
  asset, amount, mechanism, counterparty, timestamps, strategy class or
  `presumed-intent-unknown`, and replayable RPC/tx evidence.
- **What is withheld, always**: no private inference about the wallet
  owner's identity, off-chain behavior, or intent beyond what the public
  chain data itself states. The doctrine's classification (stack-token,
  income-printing, etc.) is admitted *strategy taxonomy*, applied the same
  way whether the querying party is the Union itself or a paying Hive
  Market buyer — it is not a psychological profile, and this die's output
  schema has no field for one.

### 1.5 The keyless RPC inventory, verified this run

| Call | Endpoint | Verified this run | Notes |
|---|---|---|---|
| `condenser_api.get_accounts` | `https://api.hive.blog` | **Works** — returned full account objects for all six fleet accounts in one batched call | Source of `balance`, `hbd_balance`, `vesting_shares`, `delegated_vesting_shares`, `received_vesting_shares`, `created`, `post_count` |
| `condenser_api.get_dynamic_global_properties` | `https://api.hive.blog` | **Works** | Needed to convert VESTS→HP (`total_vesting_fund_hive / total_vesting_shares`); head block 108403155 at fetch time |
| `condenser_api.get_account_history` | `https://api.hive.blog` | **Works** — `params: [account, -1, N]` returns the newest N ops | This run sampled the newest 10–15 ops per account; a full-confidence `firstAcquisitionTimestamp` for native assets requires paginating backward from the account's own `created` timestamp, not attempted this run (see §2's per-account notes) |
| `account_history_api.get_account_history` | `https://api.hive.blog` | **Works**, same data as the `condenser_api` wrapper, object-shaped params (`{account, start, limit}`) instead of positional | Confirms the two namespaces are the same underlying node call; either is a lawful evidence ref |
| Hive-Engine `find` on `tokens`/`balances` | `https://api.hive-engine.com/rpc/contracts` | **Works** | `query: {account}`, `limit: 500` — returned 4 to 106 rows per fleet account this run |
| Hive-Engine `find` on `tokens`/`tokens` (token metadata) | `https://api.hive-engine.com/rpc/contracts` | **Works** | Used to resolve a bare symbol to its issuer/name/precision — load-bearing for telling a mining/distribution token from an ordinary tribe token by identity, not guesswork (§2.7 examples) |
| Hive-Engine `getHistory` JSON-RPC method | `https://api.hive-engine.com/rpc/contracts` | **Refused by the node**: `{"error":{"code":-32601,"message":"Method not found"}}` | Not a lawful evidence source; do not cite it |
| `https://accounts.hive-engine.com/accountHistory?account=X&symbol=Y&limit=N` | REST, not JSON-RPC | **This is the endpoint that actually answers.** Confirmed 200 with real per-token event history (`tokens_stake`, `tokens_delegate`, `tokens_unstakeDone`, `distribution_checkPendingDistributions`, `market_buy`/`market_sell`/`market_placeOrder`/`market_closeOrder`, `mining_lottery`, `comments_authorReward[_stake]`, `comments_curationReward[_stake]`) for every account/symbol pair queried this run | This is the die's actual Hive-Engine acquisition-evidence source; the task brief's assumed JSON-RPC `accountsHistory` shape does not exist as such — it is this REST path |
| `https://history.hive-engine.com/accountHistory...` | REST | **404** — wrong host, not a working alternative | Recorded so a later run doesn't re-try it |

Two nodes are enough for the die's own confirmation posture (matching
Aagaard's existing "at least two providers" pattern elsewhere in
this codebase) for the native chain (`api.hive.blog` plus, per
`aagaard.config.json`, `api.deathwing.me` / `rpc.mahdiyari.info` as the
second/third witnesses — not independently re-queried this run, so treat
this run's native reads as single-provider until cross-checked). Hive-Engine
balance reads used only `api.hive-engine.com`; `aagaard.config.json`'s second
configured node (`herpc.dtools.dev`) was not queried this run either — both
are named here as the unrealized second-witness step, not silently treated
as already satisfied.

## Part 2 — first demonstration run over the fleet

All six accounts fetched 2026-07-24, keyless, per §1.5. VESTS→HP conversion
factor at fetch time: `0.0006183028381290138` HIVE/VEST
(`total_vesting_fund_hive / total_vesting_shares`, head block 108403155).

### 2.0 michael561 — recap, not re-derivation

`content/text/documents/designs/2026-07-24-michael561-income-staking-acquisition-plan.md`
already inventories every symbol named in michael561's own two source posts
plus WORKERBEE, against live `tokens.tokens`/`tokens.balances`/market data,
and already flags POSH and PXL `presumed-intent-unknown`. That table is
reused here by reference rather than restated. This run adds only what that
plan didn't need for its purpose:

- **Native**: 1.092 HIVE, 0.006 HBD, 294468.685181 VESTS owned (≈182.071 HP),
  257152.719571 VESTS delegated out (≈158.998 HP), 37315.965610 VESTS
  retained (≈23.073 HP effective) — account created 2024-11-28.
- **WORKERBEE (stack-token/governance, doctrine primacy)**: liquid
  0.00000, stake 0.00000, `delegationsOut` **3.66758**. Hive-Engine history
  (`accounts.hive-engine.com/accountHistory?account=michael561&symbol=WORKERBEE`)
  shows the exact pair of ops at block 61304290: `tokens_stake` 3.66758
  self→self, immediately followed by `tokens_delegate` 3.66758 to
  **`ph1102`** — an exact match to `scripts/workerbee-yield.mjs`'s documented
  batch. Older history in the same call shows a **prior** stake/delegate/
  unstake cycle in April 2025 (`tokens_unstakeDone` 3.66751 then a transfer
  of the unstaked amount to `help-fund`) — the account has cycled through
  this stack-token position at least once before the current delegation,
  which is worth the Leader's attention as a pattern, not just a snapshot.
- **BIT** (`tokens.tokens` identity: "Bitcoin MYK Inflation Token," issuer
  `mykos`): liquid **209777.88664880**. Sampled history shows repeated
  `distribution_checkPendingDistributions` events from `contract_distribution`
  at roughly daily intervals, ~2480 BIT each in the sampled window — this is
  an automatic minting/distribution mechanism by the operation's own name,
  which is exactly the doctrine's income-printing definition ("holding mints
  more tokens"); classified **income-printing**, not left in
  presumed-intent-unknown as its name alone might suggest.
- **SCRAP** (`tokens.tokens` identity: "Terracore Scrap Token," issuer
  `terracore`): liquid 198.75336909, staked 98.99962753. Identity is certain
  (TerraCore's game resource, per this node's own README), but it does not
  fit any of the doctrine's five classes — a game-utility resource, not a
  financial strategy holding — so it is carried in the consolidated table
  (§2.7) as identified-but-unclassified rather than silently folded into
  "income-printing" on the strength of its size alone.
- **ZING** (`tokens.tokens` identity: issuer `poshtoken`, same family as
  `POSH`): liquid 21.180, staked **26566.158**, `pendingUnstake`
  **35409.432**. History shows the same
  `distribution_checkPendingDistributions` mechanism paying ZING and SIM in
  the same block — income-printing. The pending-unstake figure exceeding the
  current stake is worth flagging: it means a larger unstake was already
  initiated against a since-reduced stake balance, i.e. this position is
  already mid-exit on the ZING side specifically — reported as observed
  fact, not acted on (this die never proposes unstaking or selling).
- michael561's own remaining ~30 dust-magnitude symbols not named in either
  source post (AWESOME, BONUS, CTPSB, DHEDGE, DVS, FELT, FLUX, HH, HIQS,
  HUSTLER, LIMITLESS, LVL, NFTM, ONEUP, PAY, PEPE, PHOTO, PIMP, PLN, POKEMON,
  RPEPE, SEX, SHEKEL, SQM, SWAP.HBD, SWAP.STEEM, VOTE, WOO, and SCRAP above)
  are carried into §2.7's consolidated table rather than re-derived per-token
  here, since the sibling plan's scope was the two posts, not the full
  balance sheet.

### 2.1 emsenn0 — the curator/methodology-author

- **Native**: 138.493 HIVE, 0.418 HBD, 1186643.656415 VESTS owned
  (≈733.705 HP), 149100.091241 VESTS delegated out (≈92.189 HP),
  effective ≈641.516 HP — account created 2021-02-11 (oldest fleet account
  by far), 266 posts. Sampled recent history (15 ops) is almost entirely
  `curation_reward`/`claim_reward_balance`/`effective_comment_vote` pairs
  every few hours — matches the `curator` archetype and `feeds:
  ["following","trending"]` in `aagaard.config.json` exactly.
- **SWAP.HIVE**: 83.50671937 liquid — capital-in-transit per doctrine, not
  itself a terminal strategy class.
- **EDSI** (income-printing): 89.568 liquid. Hive-Engine history shows a
  **recurring `mining_lottery` event** from `poolId: "EDSI:EDSM"`, quantity
  0.228 EDSI, at roughly 5-day intervals across the entire sampled window
  (ten consecutive events, oldest sampled 2026-01-xx-equivalent through
  2026-07-01-equivalent) — a clean, repeatable, income-printing mechanism
  distinct from michael561's EDSI (which came from the fixed
  `income-token-acquire.mjs` pilot, per §2.0/README). Two accounts holding
  the same symbol via two entirely different acquisition mechanisms is
  exactly the kind of distinction this die exists to keep separate rather
  than merge into one "EDSI = income-printing" line with no mechanism
  detail.
- **SIM** (income-printing, legacy): 9338.841 liquid — by far emsenn0's
  largest single balance after EPC. Per this node's own README, dCity is
  closed and SIM's only remaining documented action is a one-percent-minimum
  recovery exchange (`dcity-recovery.mjs`); classified income-printing on
  historical mechanism, carried with the explicit legacy caveat.
- **Curation-stake tribe tokens** (doctrine class, all confirmed staked or
  liquid-held, not individually re-verified against `tokens.tokens` this
  pass beyond the identity check already in §1.5): ARCHON, BRO, CINE, CTP
  (4.717 delegated out), INFOWARS, LEO (129.271 delegated out — the largest
  single delegation observed this run), LOH (83.2255 staked — identical
  amount to michael561's LOH position, both via the same `ladyrewards`
  auto-stake bot per Hive-Engine token metadata's own description, "incentive
  for posting in the Community"), LUV, NEOXAG, PAL, POB (76.42629214
  delegated out), SPORTS, STEM, WAIV (180.38678367 staked — emsenn0's
  largest curation-stake position), WINE.
- **Tip**: BEER (47.95924213 staked — well above dust, an intentional
  tip-bot position per the doctrine's threshold logic), WINEX.
- Two conspicuously large, previously-unflagged holdings surfaced this run:
  **EPC 625293.100 liquid** (`tokens.tokens` identity: "Epic Token," issuer
  `epicdice` — a dice-game token) and **HKWATER 25380.0000 liquid**
  (`tokens.tokens` identity: "Hashkings Water Token," issuer `hashkings`,
  and this node's own README already documents HKWATER/BUDS/MOTA as
  HashKings legacy holdings under `hashkings-recovery.mjs`'s scope). Neither
  fits a doctrine class; both carried to §2.7. EPC in particular is large
  enough in raw magnitude that the Leader may want it looked at specifically,
  even though this die does not itself judge magnitude as urgency.

### 2.2 sigmund-vexler — the alpha-hunter/trader

- **Native**: 0.000 HIVE, 0.131 HBD, 1199.072037 VESTS owned (≈0.741 HP),
  4867.920103 VESTS **received** (≈3.010 HP, delegated in from elsewhere in
  the fleet, not self-acquired) — account created 2025-03-24, only 7 posts.
  Sampled history (15 ops) is exclusively `vote`/`effective_comment_vote`
  pairs — no transfers or claims in the sampled window at all, consistent
  with a trading account that hasn't broadcast a market order recently
  (`tradingLive: true` in config, but this run found no recent market
  activity to corroborate potential trading).
- **Hive-Engine holdings are the smallest and shallowest in the fleet**: only
  8 nonzero rows total. ARCHON (0.39090030 staked), BBHO (1.62620373
  staked), CENT (0.04335376 liquid), CTP (0.251 staked), NEOXAG (0.14460412
  staked), VYB (0.62291447 staked), WAIV (0.00010064 liquid) — all
  curation-stake by doctrine class, all small. **SWAP.HIVE**: 0.03094199
  liquid — capital-in-transit, and notably thin for an account chartered as
  the fleet's bounded-arbitrage trader; either its capital sits natively as
  HIVE elsewhere (it doesn't — native balance is 0.000) or its deployable
  capital genuinely is this small right now.
- Hive-Engine per-token history for `SWAP.HIVE` on this account returned an
  **empty array**, not an error, despite the nonzero balance shown by
  `tokens.balances` — recorded as an endpoint gap (`accounts.hive-engine.com`
  not indexing this account/symbol pair, or a symbol-name mismatch on the
  REST side), not evidence of zero history. Per the die's own refusal
  discipline (§1.2/§1.3), this is reported as `acquisition.mechanism:
  unresolved`, never inferred as "no history."
- No consolidated-table entries for this account: every nonzero holding
  classified cleanly as curation-stake or capital-in-transit.

### 2.3 help-fund — the patron-steward

- **Native**: 0.000 HIVE, 0.468 HBD, 0.000000 VESTS owned, 8400.061186
  VESTS **received** (≈5.194 HP, entirely delegated-in — help-fund holds no
  self-originated HP at all) — account created 2025-04-04, only 1 post.
  Sampled history (15 ops) is exclusively `vote`/`effective_comment_vote` —
  matches `feeds: ["hive-167922","finance","dev"]`.
- **68 Hive-Engine balance rows, 54 nonzero — the widest dust spread in the
  fleet relative to its configured purpose** (`aagaard.config.json` names
  only `{"SIM": "50"}` as its configured token, yet SIM does not even appear
  in help-fund's live balance rows this run — a config/reality mismatch
  worth the Leader's attention on its own).
- **BIT** (income-printing, same `mykos` distribution mechanism as
  michael561's): liquid **137987.70231383** — help-fund's largest holding by
  far, confirmed via the same recurring `distribution_checkPendingDistributions`
  operation, ~10.8 BIT per event at roughly daily intervals in the sampled
  window.
- **SWAP.STATE** (income-printing, same distribution mechanism, dust
  magnitude: ~0.000003 per event): tiny but classified by mechanism, not
  ignored for being small.
- **Curation-stake**: ARCHON, BRO, CENT (9.38392388 liquid — help-fund's
  second-largest identifiable holding), CINE, CTP, NEOXAG, POB, SPORTS
  (60.849 liquid), WAIV — all liquid, none staked, which is itself worth
  noting: a patron-steward account holding tribe tokens unstaked earns none
  of the curation-weight benefit the doctrine describes for this class.
- **DRIP, BEE, ONEUP, YOLO**: income-printing by symbol identity, all dust
  magnitude (<0.02 each) — present but negligible.
- **44 remaining symbols** are dust-magnitude and don't fit a doctrine class
  by identity or mechanism sampled this run; all carried to §2.7 rather than
  omitted, per the doctrine's instruction not to silently drop anything a
  wallet actually holds.

### 2.4 essiebee — the gardener

- **Native**: 0.485 HIVE, 0.000 HBD, 2397.171594 VESTS owned (≈1.482 HP),
  2353.587226 VESTS delegated out (≈1.455 HP — nearly all of its own HP
  delegated away), 5042.155140 VESTS received (≈3.118 HP) — account created
  2024-12-27, 23 posts. Sampled history's newest entry is a real transfer:
  `ecency → essiebee, 0.001 HIVE, "Daily 100% curation reward share... for
  delegating to @ecency"` at 2026-07-23T23:59:48 — direct, dated evidence of
  an active delegation-for-curation-share arrangement, not an inference.
- **SPORTS (curation-stake, Sports Talk Social tribe token)**: liquid
  6276.201, staked **3323.307** — essiebee's largest position in the fleet
  by a wide margin. History (`accountHistory?account=essiebee&symbol=SPORTS`)
  shows the acquisition mechanism directly: repeated
  `comments_authorReward`/`comments_authorReward_stake` pairs tied to
  `actifit-essiebee-*` permlinks (Actifit is a move-to-earn Hive app;
  matches the `gardener`/`gaming` feed configuration) — this is genuine
  author-reward accretion, not a purchase. The same history also shows
  **five `tokens_unstakeDone` events of ~421.84 SPORTS each between
  2025-01 and 2025-03** — meaning essiebee already unstaked and presumably
  disposed of roughly 2109 SPORTS over a year before this run, prior to
  re-accumulating to its current 3323.307 staked. Reported as an observed
  historical fact; this die does not judge whether that prior action was
  correct.
- **AFIT — presumed-intent-unknown by strategy class, but fully certain by
  acquisition**: liquid **5100** (essiebee's single largest raw-amount
  holding). History shows exactly **one** event: `tokens_transfer` from
  **michael561** to essiebee, memo *"This gives you enough to qualify for
  rewards on your posts!"* — an unambiguous, dated, fleet-internal transfer
  with an explicit stated purpose (unlocking an Actifit posting-reward
  threshold for essiebee specifically). This is the clearest illustration
  in this run of §1.2's independence rule: acquisition is fully resolved
  (exact tx, sender, memo, intent-in-memo) while strategy class still lands
  in `presumed-intent-unknown`, because "unlock another account's
  posting-reward eligibility" is not one of the doctrine's five classes —
  it is carried to §2.7 as identified, not mysterious.
- **Curation-stake, smaller**: ARCHON, CTP, CURE, NEOXAG, VKBT, VYB, WAIV —
  all small, several liquid-only (unstaked).

### 2.5 marshian — the scout

- **Native**: 0.002 HIVE, 0.091 HBD, 912.993631 VESTS owned (≈0.565 HP),
  5042.155140 VESTS received (≈3.118 HP, identical received-VESTS figure to
  essiebee — both appear to receive delegation from the same source) —
  account created 2025-01-03, 7 posts. Sampled history (15 ops) is
  exclusively `vote`/`effective_comment_vote` — matches `feeds: ["art",
  "writing","photography"]`, a pure-curation account with no transfers in
  the sampled window.
- **Only 4 nonzero Hive-Engine rows — the shallowest live balance in the
  fleet.** BBH (3.00 liquid, tip class) and LOLZ (0.00011971 liquid,
  **2.00011970 staked** — tip class; history shows the stake came from a
  single `tokens_stake` op from `lolzbot` in January 2025, plus a long tail
  of sub-0.0001 `comments_curationReward`/`_stake` dust from many individual
  vote events since) are cleanly classified. **PAY** (0.42170575 liquid,
  0.42170554 staked) and **POSH** (0.10000000 liquid) do not fit a doctrine
  class by identity or sampled mechanism — PAY's history is entirely
  sub-0.00001 `comments_curationReward`/`_stake` dust from dozens of
  individual curation events (a byproduct of marshian's own voting, not a
  deliberate PAY acquisition), and POSH has no sampled history at all in
  this run's window. Both carried to §2.7.

### 2.6 What a full run would need (all six accounts)

- **Native history beyond the sample**: this run's `condenser_api.get_account_history`
  calls used `start=-1, limit=10–15` — the newest slice only. A full
  `firstAcquisitionTimestamp` for every native transfer/claim requires
  paginating backward (`start` decreasing from each returned batch's lowest
  index) until reaching each account's own `created` op — cheapest for the
  younger accounts (sigmund-vexler, help-fund, essiebee, marshian, all
  created 2024-12 through 2025-04) and most expensive for emsenn0 (created
  2021-02-11, five years of history).
- **Second-provider confirmation**: `aagaard.config.json`'s second/third
  native nodes (`api.deathwing.me`, `rpc.mahdiyari.info`) and second
  Hive-Engine node (`herpc.dtools.dev`) were not queried this run; every
  fact above is single-provider until cross-checked, which this die's own
  typed output (§1.2 `evidenceRefs.rpcCalls`) makes auditable rather than
  hidden.
- **Per-symbol Hive-Engine history for every dust row in §2.7**: this run
  fetched targeted per-symbol history only for the flagship holdings named
  in §2.0–§2.5 (WORKERBEE, ZING, BIT ×2 accounts, EDSI ×2 accounts, SPORTS,
  AFIT, LOLZ, PAY for marshian). The ~100 remaining dust-magnitude rows in
  §2.7 have confirmed *presence* (`tokens.balances`) but not sampled
  *acquisition* — a full run would issue one `accountHistory` REST call per
  remaining symbol/account pair (bounded, cheap, but not attempted here
  given the count).
- **NFT sets**: no NFT registry (`nft.find` / `nft.getUserNFTs`) was queried
  this run for any account; `README.md`'s existing `fleet-nft-inventory.mjs`
  is the already-built instrument for that scope and should be the source
  a full run reuses rather than re-implementing.

### 2.7 Consolidated presumed-intent-unknown table

Every holding above that does not fit one of the doctrine's five strategy
classes by symbol identity or sampled acquisition mechanism, across all six
fleet accounts. `liq` = liquid balance, `stake` = staked, `dOut`/`dIn` =
delegated out/in, `pend` = pending unstake; only nonzero fields shown.
michael561's `POSH`/`PXL` are excluded here as already carried in the
sibling acquisition-plan document (§2.0) to avoid a duplicate record of the
same fact.

| Account | Asset | Amount | Best available acquisition evidence |
|---|---|---|---|
| michael561 | SCRAP | liq 198.75336909; stake 98.99962753 | Identity confirmed (`tokens.tokens`: "Terracore Scrap Token," issuer `terracore`) — TerraCore game resource; per-event history not sampled this run |
| michael561 | SEX | liq 0.022; stake 0.012; pend -0.012 | Not sampled |
| michael561 | PAY | liq 0.00108518; stake 0.02423294 | Not sampled |
| michael561 | ONEUP | liq 0.00038566 | Not sampled |
| michael561 | PIMP | stake 2.22555116 | Not sampled |
| michael561 | SWAP.HBD | liq 0.00000007 | Not sampled |
| michael561 | PHOTO | liq 0.20 | Not sampled |
| michael561 | BONUS | liq 0.00001245 | Not sampled |
| michael561 | FLUX | liq 0.00040326 | Not sampled |
| michael561 | HUSTLER | liq 0.01571519 | Not sampled |
| michael561 | PEPE | liq 0.00188691; stake 0.06297451 | Not sampled |
| michael561 | HH | liq 0.00306002 | Not sampled |
| michael561 | DHEDGE | liq 0.00201816 | Not sampled |
| michael561 | WOO | liq 0.00000914 | Not sampled |
| michael561 | VOTE | liq 0.0398 | Not sampled |
| michael561 | FUN | liq 0.00000033; stake 0.00030813 | Not sampled |
| michael561 | LVL | liq 0.00356359 | Not sampled |
| michael561 | HIQS | liq 0.00000320 | Not sampled |
| michael561 | NFTM | liq 0.00069268 | Not sampled |
| michael561 | RPEPE | liq 0.00000751 | Not sampled |
| michael561 | SQM | liq 0.00014987 | Not sampled |
| michael561 | AWESOME | liq 0.00000043 | Not sampled |
| michael561 | CTPSB | liq 0.002900 | Not sampled |
| michael561 | PLN | liq 0.00014261 | Not sampled |
| michael561 | DVS | liq 0.00002494 | Not sampled |
| michael561 | SWAP.STEEM | liq 0.00000076 | Not sampled |
| michael561 | LIST | liq 0.00156119 | Not sampled |
| michael561 | FELT | liq 0.05 | Not sampled |
| michael561 | FOODIE | stake 0.13306 | Not sampled |
| michael561 | BEED | liq 0.0192 | Not sampled |
| michael561 | SHEKEL | liq 0.01532290 | Not sampled |
| michael561 | POKEMON | liq 0.01505732 | Not sampled |
| michael561 | LIMITLESS | liq 0.22922618 | Not sampled |
| emsenn0 | EPC | liq 625293.100 | Identity confirmed (`tokens.tokens`: "Epic Token," issuer `epicdice`, precision 3) — dice-game token; per-event history not sampled |
| emsenn0 | HKWATER | liq 25380.0000 | Identity confirmed ("Hashkings Water Token," issuer `hashkings`); README already scopes this under `hashkings-recovery.mjs` as a legacy HashKings holding |
| emsenn0 | LEN | liq 1659.500 | Identity confirmed ("Liotes Energy," issuer `liotes`, precision 3); per-event history not sampled |
| emsenn0 | DUNK | liq 1000.0000 | Identity confirmed ("Dunk Coin," issuer `dunksocial`, precision 4); per-event history not sampled |
| emsenn0 | TESTO | liq 104.64800000 | Identity confirmed ("The True Test Token," issuer `imagenius.dev`, precision 8); per-event history not sampled |
| emsenn0 | LBI | liq 40.000 | Identity confirmed ("Leo Backed Investments," issuer `spinvest`, precision 6); per-event history not sampled |
| emsenn0 | ENGAGE | liq 151.000 | Not sampled |
| emsenn0 | PAY | liq 125.94352839; stake 5177.20832965 | Not sampled — large staked position, worth a follow-up run |
| emsenn0 | BST | liq 8 | Not sampled |
| emsenn0 | SPI | liq 13.06 | Not sampled |
| emsenn0 | EDS | liq 72.24 | Not sampled |
| emsenn0 | SOL | liq 10 | Not sampled |
| emsenn0 | LOTUS | liq 0.00169762; stake 0.00069762; dOut 5.39633416 | Not sampled |
| emsenn0 | EDSM | stake 5.000 | Not sampled |
| emsenn0 | LENM | stake 47.747 | Not sampled |
| emsenn0 | SWAP.SWIFT | liq 0.01 | Not sampled |
| emsenn0 | ASH | liq 0.00091535 | Not sampled |
| emsenn0 | BATTLE | stake 0.01 | Not sampled |
| emsenn0 | LIST | dOut 0.21806050 | Not sampled |
| emsenn0 | COM | liq 0.001044 | Not sampled |
| emsenn0 | BUDS | liq 2 | README-scoped legacy HashKings holding (same family as HKWATER/MOTA) |
| emsenn0 | SPT | liq 3.116000 | Not sampled |
| emsenn0 | MOTA | liq 2.2124 | README-scoped legacy HashKings holding |
| emsenn0 | CL | liq 0.961 | Not sampled |
| emsenn0 | CCC | liq 0.28516; stake 0.28516 | Not sampled |
| emsenn0 | FQX | liq 0.13291425 | Not sampled |
| emsenn0 | SPS | liq 1.57600000 | Not sampled |
| emsenn0 | LASSECASH | stake 0.00000002 | Not sampled |
| emsenn0 | WEED | liq 0.60000000 | Not sampled |
| emsenn0 | APE | liq 0.062 | Not sampled |
| emsenn0 | LVL | liq 0.25 | Not sampled |
| emsenn0 | DEC | liq 7.959 | README already documents this exact balance as the `exact-pool-cycle-assay.mjs` test input (DEC → BEE → VOUCHER → DEC); not itself a doctrine strategy class |
| emsenn0 | ONEUP | liq 0.18300000 | Not sampled |
| emsenn0 | ALERT | liq 0.00035311 | Not sampled |
| emsenn0 | BPC | liq 2.140811; stake 2.140811 | Not sampled |
| emsenn0 | LGN | liq 1.88219920 | Not sampled |
| emsenn0 | DCORE | liq 1 | Not sampled |
| emsenn0 | SWAP.HBD | liq 0.01200000 | Not sampled |
| help-fund | PEPE | liq 0.02301619 | Not sampled |
| help-fund | CHICKEN | liq 0.95619428 | Not sampled |
| help-fund | FUN | liq 0.17076988 | Not sampled |
| help-fund | FOODIE | liq 0.00495 | Not sampled |
| help-fund | STAR | liq 0.13424280 | Not sampled |
| help-fund | POSH | liq 0.00000042 | Not sampled |
| help-fund | THGAMING | liq 5.12633 | Not sampled |
| help-fund | MEME | liq 0.4560 | Not sampled |
| help-fund | VOTE | liq 0.1671 | Not sampled |
| help-fund | FUNM | liq 0.00012163 | Not sampled |
| help-fund | PSX | liq 0.00000800 | Not sampled |
| help-fund | LVL | liq 0.00011175 | Not sampled |
| help-fund | WOO | liq 0.00098975 | Not sampled |
| help-fund | PIMP | liq 1.45467635 | Not sampled |
| help-fund | HUSTLER | liq 0.09205429 | Not sampled |
| help-fund | HH | liq 0.02358738 | Not sampled |
| help-fund | SWAP.GIFU | liq 0.00004964 | Not sampled |
| help-fund | SPS | liq 0.00001030 | Not sampled |
| help-fund | SCRAP | liq 0.00000505 | Same `terracore` identity as michael561's SCRAP row above |
| help-fund | LIST | liq 0.00001956 | Not sampled |
| help-fund | WIT | liq 0.00115558 | Not sampled |
| help-fund | ONEUP | liq 0.00043508 | Not sampled |
| help-fund | SWAP.PEPET | liq 0.22696587 | Not sampled |
| help-fund | SWAP.HBD | liq 0.00000040 | Not sampled |
| help-fund | SPACO | liq 0.00056340 | Not sampled |
| help-fund | COM | liq 0.000388 | Not sampled |
| help-fund | LPR | liq 3.03123390 | Not sampled |
| help-fund | PGM | liq 0.00000197 | Not sampled |
| help-fund | GLITTER | liq 0.00062653 | Not sampled |
| help-fund | NFTM | liq 0.00000309 | Not sampled |
| help-fund | SHEKEL | liq 0.00053813 | Not sampled |
| help-fund | GROWTH | liq 0.00000520 | Not sampled |
| help-fund | SWAP.VG | liq 0.00000520 | Not sampled |
| help-fund | TOOFUCKEH | liq 0.01086789 | Not sampled |
| help-fund | BOCRYPTO | liq 0.112 | Not sampled |
| help-fund | SWAP.WAX | liq 0.00000269 | Not sampled |
| help-fund | POKEMON | liq 0.00006439 | Not sampled |
| help-fund | LIMITLESS | liq 0.00105966 | Not sampled |
| essiebee | AFIT | liq 5100 | **Fully resolved**: single `tokens_transfer` from `michael561`, memo "This gives you enough to qualify for rewards on your posts!" (2024-12-27T~) — acquisition certain, strategy class genuinely doesn't fit the doctrine's five |
| marshian | POSH | liq 0.10000000 | Not sampled |
| marshian | PAY | liq 0.42170575; stake 0.42170554 | History sampled: entirely sub-0.00001 `comments_curationReward`/`_stake` dust across dozens of unrelated posts marshian voted on — a byproduct of curation activity, not a deliberate PAY position |

**112 rows total** (111 shown above after excluding the two symbols already
carried in the sibling michael561 document). This table is long because the
fleet's real holdings are long — per doctrine, none of this is a liquidation
list; it is a "we don't yet know why we have this" list for the Leader's own
disposition.

## 3. Unrealized

- **Full-history pagination** (§2.6) was not performed for any account;
  every `firstAcquisitionTimestamp` reported above is either a specific
  sampled event or absent, never asserted from an unsampled span.
- **Second-provider confirmation** (§1.5, §2.6) was not performed for either
  the native chain or Hive-Engine reads this run; treat every fact above as
  single-provider until cross-checked against `aagaard.config.json`'s
  configured second nodes.
- **NFT inventory** was not queried this run for any account; a full run
  should reuse `scripts/fleet-nft-inventory.mjs` rather than re-implement
  registry/instance reads.
- **~100 dust-magnitude symbols** across the fleet have confirmed presence
  but not sampled acquisition mechanism (§2.7); a full run would issue one
  bounded `accountHistory` REST call per remaining symbol/account pair.
- **The Hive-x402 die and hive.market.561.group listing** (this document's
  §0/§1.4 related work orders) are both precedent, not yet live; this die's
  sellable-version pricing (§1.4) cannot settle until the x402 die's
  demonstrated read-side verification (already fulfilled per its own work
  order) is joined by an actual accept/settle path, and until
  hive.market.561.group actually deploys (still `status: open`).
- **help-fund's config/reality mismatch** (§2.3: `aagaard.config.json`
  names only `SIM` as its token, but SIM is absent from its live balance
  rows while BIT — an unconfigured token — is its largest holding by far)
  is reported as an observed fact this die surfaced; resolving whether the
  config is stale or the SIM position was fully exited is outside this
  die's scope (it doesn't propose config changes).
- **sigmund-vexler's thin SWAP.HIVE position** (§2.2: 0.03094199, against a
  `capSwapHiveMilli: 1000` config ceiling) may simply mean the arbitrage
  lane hasn't deployed capital recently, or that its deployable capital
  lives somewhere this run didn't check (native HIVE is 0.000, so not
  there) — not resolved here.
