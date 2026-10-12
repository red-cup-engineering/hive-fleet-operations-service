---
title: "DHF proposal draft: MARSH-on-Hive and the 561 Group's open fleet tooling"
date: 2026-09-26
status: "draft -- awaiting the founder's receiver account, daily-pay figure, and funding period before posting"
kind: dhf-proposal-draft
access: keyless reads only; no key was read, no transaction was signed or broadcast in producing this document
---

## What still needs the founder before this can be posted or proposed on-chain

This document is the **post body** a `create_proposal` operation's `permlink`/`subject` would
point to, plus the proposal's own parameters, laid out so the founder can fill in the four
things only they can decide:

1. **Receiver account** -- which Hive account receives the daily HBD pay (a fleet account, or a
   dedicated one). Not filled in here.
2. **Daily pay ask.** For scale: the DHF pays out roughly 1% of its ~23.2M HBD balance per day
   (read live 2026-09-26) across every proposal above its moving return-line threshold, and the
   single largest funded proposal found this session ("HBD Stabilizer") asks 12,000 HBD/day --
   that is an outlier, not a comparable. A first proposal for a small, already-built, actively
   maintained tool suite is realistically a modest, renewable ask rather than a maximal one;
   **recommendation: start at 10-30 HBD/day** (roughly $0.47-$1.40/day at today's ~$0.047 HIVE-
   equivalent HBD peg), scaled up in a later proposal once the tooling has a public track
   record. This is a recommendation, not a decision -- the founder sets the final number.
3. **Funding period / renewal cadence.** DHF proposals run start-to-end date; recommend a short
   first period (e.g. 90 days) to build a track record before asking for a longer renewal.
4. **Whether to post this at all now, or after MARSH-on-Hive's Hive-Engine contract is actually
   live** (see the open deploy step in `apps/multi-agent-resource-sharing-host/src/MARSH.hive-
   engine.js`) -- a proposal describing already-deployed, verifiable-on-chain tooling is a
   stronger ask than one describing code that compiles but is not yet deployed anywhere public.

Everything below this line is the proposed **post body**, ready to use once those four
decisions are made.

---

# MARSH-on-Hive and the 561 Group's open Hive fleet tooling

## What this proposal funds

Continued maintenance and extension of a small, already-working suite of open tools for
operating on Hive programmatically and honestly:

- **MARSH-on-Hive** -- a content-addressed, compare-and-swap resource-sharing contract (the
  same semantics the 561 Group already runs on Base EVM), ported to Hive-Engine (deployed as a
  self-contained JS sidechain contract, tested against a full harness standing in for a real
  `hivesmartcontracts` node) and drafted for Magi Network (Hive's WASM Layer 2, written against
  its real Go SDK). This gives any Hive account or app a simple, auditable way to publish and
  hand off typed, content-addressed resource state on-chain, without inventing a new token or a
  new custodial service.
- **A Hive curation pipeline** that reads real-time tag yield across five communities, schedules
  votes against an explicit, auditable policy (mana budget, dust rules, preferred tags, never-
  vote-author list), and casts them with two-node chain confirmation and a permanent per-vote
  journal -- open-source, reusable by any account, not tied to this org's own wallets.
- **A Hive-Engine market-making and liquidity-opportunity toolkit** (peg-ladder cycling for the
  internal HIVE/HBD market, constant-product pool opportunity discovery) that any account can
  point at its own inventory.
- **A Resource Credit delegation opportunity observer**, published today, that reads
  `rc_api.find_rc_accounts` and reports an account's idle RC above what it has already delegated
  out -- a small step toward making the RC delegation market (currently thin and bilateral, per
  our own research) more legible to potential lessors and lessees alike.
- **Per-game automation for the Hive-Engine game ecosystem** (HoloZing, TerraCore, dCrops,
  WorkerBee today; the same pattern extends to others), each running on its own schedule,
  journaling every action it takes or skips, so a guild or a solo player can see exactly what
  ran and why.

All of it is written in plain, dependency-free Node.js, tested, and organized as small,
single-purpose packages rather than one monolith -- easy for another builder to read, fork, or
extend.

## Why fund this from the DHF rather than elsewhere

This is exactly the kind of maintained, reusable infrastructure the DHF exists to fund: it
lowers the cost of building *more* tools on Hive (a contract-sharing primitive, a market-making
toolkit, an RC-legibility tool) rather than building a single closed product. None of it is
proprietary to our own accounts' strategy -- the policy files, schedules, and thresholds that
make each tool's *particular* behavior ours are separate, small, swappable config, not baked
into the code.

## What continued funding buys, concretely

- Finishing MARSH-on-Hive's deploy (getting the Hive-Engine contract live, whether on a
  Group-run dev sidechain or the shared mainnet sidechain once accepted; compiling and deploying
  the Magi/WASM contract once a toolchain is set up for it).
- Extending the per-dapp game automation to the rest of the Hive-Engine game ecosystem, each as
  its own small, auditable package.
- Turning the RC delegation observer into an actual two-sided listing (lessor availability next
  to lessee demand), the missing piece of a real RC market.
- Ongoing maintenance as Hive's own hardforks and Hive-Engine/Magi's own APIs change underneath
  these tools (this proposal's own research note found and corrected one live bug this way
  today: a curation-timing assumption stale since Hardfork 25, four years unfixed anywhere it
  had been copied).

## Accountability

Every tool above is source-visible, tested, and journals its own actions on-chain or to an
append-only local log; this proposal's daily pay is small enough to be judged purely on whether
that visible activity continues, without needing a separate reporting mechanism.

---

*Prepared 2026-09-26. Sources for every factual claim above: the companion research notes
`2026-09-26-smart-contracts-on-hive-2026.md` and
`2026-09-26-assisting-hive-as-a-network-earning-lines.md` in this same directory tree, and this
session's own commits to `apps/multi-agent-resource-sharing-host` and
`hive-engineering-services-section/services/observe-hive-rc-delegation-opportunity-service`.*
