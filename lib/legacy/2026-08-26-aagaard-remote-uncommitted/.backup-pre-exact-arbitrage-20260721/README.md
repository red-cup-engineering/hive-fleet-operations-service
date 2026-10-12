# @emsenn/aagaard

Aagaard is the Hive wallet-fleet operations app rewritten downstream of
MetroPlat. Wallets are actors; each capability lane is a game; every tick is an
arena reading whose plans and executions are witnessed as EAVT rows.

It keeps the older application's operator surface: `/agents/:account/{curation,
market,wallet}`, `/ui`, and the `/ops` control plane for status, health,
capabilities, arm/disarm, pause/resume, tick, last/ticks, alpha, strategies,
strategy, intelligence, liquidity, incentives, and drafts. It adds arena and
witness readouts so the wallet-as-actor game model is inspectable directly.
`/ops/parity` reports the old Aagaard surface covered by this rewrite and the
remaining operational gaps, such as an unconfigured Hive broadcast command or
missing role keys.

Posting and gaming are prepared but locked. Voting, trading, and incentive lanes
plan every tick; execution is suppressed unless the fleet is armed and the lane
is enabled. Trading still requires the per-wallet `tradingLive` envelope. Live
execution is key-vault aware: role presence is read from `keyRoot` (default
`~/.config/blockchain/hive`, or `AAGAARD_KEY_ROOT`) at
`<account>/posting.wif` and `<account>/active.wif`; tick readouts record
dry-run, skipped, propose-only, broadcast, and error receipts instead of
inferring broadcasts from flags alone. Actual broadcasts are opt-in through
`AAGAARD_BROADCAST_COMMAND`: Aagaard sends one JSON operation request on stdin
with the resolved role key path as `keyFile`, and records the command's returned
`id`/`txId` as the transaction receipt.
`/ops` reports whether the Hive write boundary is configured.

The service reads Hive through `src/integrations/hive/` (`bridge.get_ranked_posts`
and `condenser_api.get_accounts`) and Hive-Engine through
`src/integrations/hive-engine/` (`tokens.balances`, `market` books, and
`marketpools.pools`). If configured nodes fail, the runtime falls back to the
seeded local field so the operator surface remains available, but live runs
report arena moves from the chain and market substrate when RPC succeeds.

Every tick records the raw substrate it used under `data/logs/`: candidate posts,
active-vote rows, wallet state, market state, and the liquidity reading. Locked
drafts are kept as generated records in `data/records/locked-drafts.json`;
`/ops/drafts/:account` reads those records or composes the due drafts on demand.
The incentive queue persists nominations and dispositions, including locked
`llm-draft` response drafts, instead of returning a stateless acknowledgement.

The control plane uses an operator bearer boundary at `/ops`. Set
`AAGAARD_OPS_TOKEN` to require `Authorization: Bearer ...`; otherwise the local
development server stays open unless `AAGAARD_REQUIRE_AUTH=1` is set. The server
publishes RFC-style discovery documents at
`/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource`, and 401/403 responses include the
protected-resource `WWW-Authenticate` challenge that the WebUX and external
clients can follow. `/oauth/register`, `/oauth/authorize`, `/oauth/callback`,
`/oauth/token`, and `/oauth/revoke` implement the PKCE authorization-code flow.
With `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` configured, `/oauth/authorize`
redirects through Google OpenID Connect and only mints Aagaard access tokens for
`AAGAARD_ALLOWED_EMAIL`; without Google credentials it uses the local operator
secret for development.

```sh
pnpm -C lib/emsenn/apps/aagaard run check
pnpm -C lib/emsenn/apps/aagaard run test
pnpm -C lib/emsenn/apps/aagaard run serve
```
