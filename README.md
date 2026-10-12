# Aagaard

Autonomous Hive wallet operations with chain evidence as the only economic
truth. The service never treats a local report, cache, or prior plan as proof
of a balance, fill, fee, reward, or profit.

Hive wire operations and signing are supplied by
`@red-cup-engineering/hive-blockchain-client-service`. Fleet policy code keeps
account authorization, bounded action selection, independent-provider agreement,
and post-submission reconciliation. Releases must install the declared client and
HTTP dependencies; there is no embedded client source tree. The public package
exports and `npm run serve` execute `src/*.mjs` directly, with no compiler or
parallel `dist` runtime.

## Operating rules

- A route is admitted only from fresh, independently agreeing public-chain or
  Hive Engine observations.
- Amounts, prices, and resource costs use exact integer/fraction arithmetic.
- A submitted transaction is never retried automatically. It is reconciled by
  transaction identity and observable post-state before another action can be
  considered.
- Gross spread is not profit. Venue fees and host overheads must be priced and
  witnessed, and Hive RC capacity must clear its reserve, before a route can
  be reported as economic.
- Signing stays behind the existing allowlisted broadcaster and cloud key-file
  permissions. Operators and timers invoke bounded code paths; no interactive
  command is an autonomous strategy.

## Resource cost model

An autonomous cycle's real per-cycle SWAP.HIVE cost is the signer host share
plus the runner/paymaster host share (`src/core/resourceCostModel.mjs`,
`priceResourceCosts`), each amortized from the 561-group machines record when
it carries a monthly figure, otherwise a named declared default
(`AAGAARD_SIGNER_SWAP_HIVE_PER_CYCLE`, `AAGAARD_RUNNER_SWAP_HIVE_PER_CYCLE`).
A cycle is trusted net-positive only once its certified worst-case profit
clears that priced total plus `NET_FLOOR_MARGIN_SWAP_HIVE`.

Hive Resource Credits are a capacity floor, never a price: RC regenerates
fully over five days and is never spent as HIVE, so it costs a
well-provisioned account nothing to hold. A cycle instead checks the
account's current RC against the RC each of its operations actually needs
(`rc_api.get_rc_operation_stats`, at least two independent providers,
judged by the more conservative reading) and refuses `rc-capacity-insufficient`
when meeting that need would eat into a declared reserve fraction of the
account's total RC capacity (`RC_CYCLE_RESERVE_PERCENT`, default 20%) kept
free for the account's other duties.

## Pool-to-book arbitrage

The fleet and `scripts/automatic-arbitrage-cycle.mjs` use the same execution
function in `src/core/automaticArbitrageCycle.mjs`. An unfinished acquisition
or sell is reconciled before the account can acquire another position.
The cycle records each submission intent before invoking the signer and retains
the returned transaction identity. Concurrent callers claim transitions
exclusively; a restart cannot turn an unanswered submission into a retry.

Set `AAGAARD_DATA_DIR` to one persistent, absolute directory shared by the
fleet and CLI. The CLI also accepts `--data-dir`. The default is this service's
`data/` directory. Preserve `arbitrage-intents/` within that directory across
releases; using a fresh directory loses the outstanding-intent protection.
The store requires filesystem support for atomic hard links and directory sync.

From this service directory:

```sh
node scripts/automatic-arbitrage-cycle.mjs --account <admitted-account>
node scripts/automatic-arbitrage-cycle.mjs --account <admitted-account> --execute-one
```

The first command observes a route or reconciles an existing intent without
signing. The second may submit the next authorized leg. Both check an existing
transaction before advancing; neither repeats a broadcast.

A signer timeout or process death can leave `submission-outcome-unknown`.
After finding the actual transaction on-chain, attach its identity with
`--recover-swap <transaction-id>` or `--recover-sell <transaction-id>`.
Recovery requires two providers to agree on the exact account, operation,
transfers, and a block timestamp no earlier than submission. Previously recorded
transaction IDs cannot be reused. Without `--execute-one`, recovery does not
submit the next leg. Without a verified identity, the account stays blocked.

Confirmation currently recognizes a sell filled completely in its original
transaction. Partial fills, later fills, expired orders, and failed chain
operations remain unresolved; this cycle does not liquidate or clear them
automatically. Their unresolved intent prevents another acquisition.

Resumed cycles accumulate modeled resource costs. When recovery costs are
unknown, the result reports confirmed gross proceeds with
`round-trip-confirmed-unpriced` and a null modeled net profit. Intent records
coordinate submission; chain evidence still establishes economic effects.

## Verification

```sh
npm test
npm run check
```

The repository deliberately has no separate settlement database. Historic
episodes are reconstructed from Hive/Hive Engine transaction history and the
relevant contract post-state.

## Native HIVE/HBD market

`scripts/native-market-cycle.mjs --account <fleet-account>` performs one
read-only cycle by default. It obtains independently agreeing order-book,
five-minute history, balance, open-order, and account-history observations,
then emits a bounded plan. `--watch-seconds 15` repeats the observation.

Live mode requires the existing allowlisted broadcaster and active-key root.
The acquisition is fill-or-kill and capped at 1.000 HIVE. The contingent
maker exit is not submitted until a fresh complete chain observation proves
the acquired HIVE balance and the acquisition order's disappearance. Use
`--live --cancel-all` to cancel every currently observed native order for the
selected account. Local logs and transaction submissions are never treated as
fill, proceeds, or profit evidence.
