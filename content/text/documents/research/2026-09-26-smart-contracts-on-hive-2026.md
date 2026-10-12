---
title: "Smart contracts on Hive in 2026: Hive-Engine, Magi (formerly VSC), HAF, custom_json, the DHF, witnesses, and RC delegation"
date: 2026-09-26
status: research note
scope: "durable knowledge for MARSH-on-Hive and the Group's Hive earning lines; keyless reads and public documentation only"
data-sources:
  - "https://developers.hive.io/layer2/ (Hive Developer Portal, Layer 2 index)"
  - "https://developers.hive.io/layer2/engine.html, https://developers.hive.io/layer2/vsc.html"
  - "https://github.com/hive-engine/hivesmartcontracts, https://github.com/hive-engine/hivesmartcontracts-wiki"
  - "https://docs.magi.eco/ (redirected from docs.vsc.eco/ — see S2)"
  - "https://github.com/vsc-eco (go-vsc-node, go-contract-template, as-contract-template, market-sdk)"
  - "https://developers.hive.io/services/dhf.html; https://hive.blog/@gtg/dhf"
  - "https://github.com/openhive-network/haf; https://hive.blog/hive-139531/@blocktrades/a-developer-s-introduction-to-the-hive-application-framework"
  - "https://hive.blog/hive/@hiveio/hive-hardfork-25-is-on-the-way-hive-to-reach-equilibrium-on-june-30th-2021 (HF25 reverse-auction removal)"
  - "condenser_api.get_dynamic_global_properties, condenser_api.get_accounts against https://api.hive.blog, fetched live 2026-09-26"
fetched-at: "2026-09-26, single research session; API/on-chain figures are point-in-time"
---

This note answers "what does 'smart contracts on Hive' mean in 2026" for the
Group's own use, so MARSH-on-Hive (S6 of the accompanying design) and the
Hive earning-lines enumeration are built on sourced fact rather than
recollection. Nothing here recommends spending; every on-chain number is a
keyless read, reproducible by re-running the cited call.

## 1. There is no single "Hive smart contract platform" — there are two, at different layers

Hive L1 itself has no general-purpose contract execution; its own operations
are a fixed set (`transfer`, `vote`, `custom_json`, market orders, savings,
proposals, …). Two independent ecosystems add programmability on top, and
they are not interchangeable:

| | Hive-Engine | Magi (formerly VSC) |
|---|---|---|
| What it is | A witness-run sidechain that replays `custom_json` ops into JS contract calls | A Layer-2 with its own WASM execution environment, anchored to Hive |
| Contract language | Plain JavaScript, one file, sandboxed | Go (via TinyGo) or AssemblyScript, compiled to WASM |
| Consensus | A separate set of "Hive-Engine witnesses" (their own node software, `hivesmartcontracts`) | VSC/Magi validators; state on IPFS, anchor records on Hive L1 |
| Deploy path today | Governance-gated on the shared mainnet sidechain (new contract code ships in the node software all witnesses run); permissionless on your own node | `vsc-contract-deploy` CLI, permissionless, ~10 HBD per deploy |
| Maturity | Live since 2020 (as Steem-Engine before), large existing ecosystem (tokens, NFTs, an AMM) | Actively developed 2026, DHF-funded, newer and smaller ecosystem |

Both sit *beside* Hive's native primitives (voting, HBD, the DHF, witnesses),
which are not "contracts" in either sense — they are hard-coded consensus
rules. Source: [Hive Developer Portal — Layer 2](https://developers.hive.io/layer2/).

## 2. Hive-Engine (a.k.a. `hivesmartcontracts`, née Steem-Engine/SSC)

Hive-Engine is a sidechain: a separate set of nodes ("Hive-Engine witnesses")
replay every Hive `custom_json` operation addressed to it and execute the
named contract action in a sandboxed Node VM, reaching consensus on the
resulting state (a MongoDB-backed key/value+table store) the same way Hive
witnesses reach consensus on blocks. The house's own Hive-Engine client
(`@red-cup-engineering/hive-blockchain-client-service/engine.mjs`,
`EngineClient`) already speaks this layer — the house code just never
deploys a *new* contract to it, only calls the existing ones (`tokens`,
`market`, `marketpools`, `nft`, `nftmarket`, `mining`…).

**Writing a contract.** A contract is one self-contained JavaScript file with
no `require()`, no third-party modules, and no `RegExp` — everything a
contract needs comes from the injected `api` object (`api.db`, `api.sender`,
`api.owner`, `api.BigNumber`, `api.emit`, `api.assert`, `api.debug`,
`api.executeSmartContract`). The lifecycle hook is `actions.createSSC`
(table setup, run once at deploy/genesis); every other exported function on
`actions` is a callable contract action. Example, quoted from the
Hive-Engine wiki's Smart Contracts Guide:

```js
actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('users');
  if (tableExists === false) {
    await api.db.createTable('users', ['account', 'lastTickBlock']);
    await api.db.createTable('params');
    const params = {};
    params.basicFee = '100';
    await api.db.insert('params', params);
  }
};

actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;
  const { registerFee } = payload;
  const params = await api.db.findOne('params', {});
  if (registerFee && !api.BigNumber(registerFee).isNaN()) {
    params.registerFee = registerFee;
  }
  await api.db.update('params', params);
};
```

Source: [hivesmartcontracts-wiki/Smart-Contracts-Guide.md](https://github.com/hive-engine/hivesmartcontracts-wiki/blob/master/Smart-Contracts-Guide.md).

**Deploying a contract.** The deploying account broadcasts a `custom_json`
(id `ssc-mainnet-hive` on the production sidechain) whose payload is:

```json
{
  "contractName": "contract",
  "contractAction": "deploy",
  "contractPayload": { "name": "MySmartContractName", "code": "BASE64_ENCODED_JS" }
}
```

Source: [hivesmartcontracts-wiki/Deploy-a-Smart-Contract.md](https://github.com/hive-engine/hivesmartcontracts-wiki/blob/main/Deploy-a-Smart-Contract.md).

**The catch, stated plainly.** On the shared production sidechain, every
witness node must be running node software that recognizes your new
contract's code before that code can execute — there is no user-facing
"upload arbitrary bytecode, it just runs" path the way there is on an EVM
chain. New contracts historically go through the Hive-Engine maintainers/
witness set. The permissionless path that *is* available to anyone today is
running your own `hivesmartcontracts` node (open-source, the same software
the real sidechain runs) as a private dev/test sidechain — genesis-replay
against a real or test Hive node, your own MongoDB, your own witness set of
one. That is Hive-Engine's actual "testnet/dev environment" in 2026: you run
it yourself. Source: [hivesmartcontracts-wiki/How-to-setup-a-Hive-Smart-Contracts-node.md](https://github.com/hive-engine/hivesmartcontracts-wiki/blob/main/How-to-setup-a-Hive-Smart-Contracts-node.md).

## 3. Magi Network — the rebrand of VSC, Hive's WASM Layer 2

Searching `vsc.eco` documentation in 2026 redirects (HTTP 301) to
`docs.magi.eco`: **VSC has been rebranded/absorbed as "Magi Network"**
("Virtual Smart Chain: Cross Chain Interoperability Protocol"), while its
GitHub organization is still `vsc-eco` and its packages are still published
under the `@vsc.eco` npm scope — the two names refer to the same project at
different points in its life, and current documentation uses "Magi." DHF
proposal listings still show it under both names ("VSC Network — Bring Smart
Contracts to Hive!" and "Next phase of VSC Hive Smart Contracts and V4V.APP
Joint DHF proposal" at `ecency.com/proposals/279` and `/303`).

Magi is "the first truly decentralized, full-featured smart contract system
on the Hive blockchain": contract code and state are content-addressed on
IPFS, and Magi validators publish anchor records back to Hive L1 (via
`custom_json`) to keep the network in consensus. It connects to Hive as its
L1, uses Hive's Resource-Credit model so calling a contract is feeless in
the traditional gas sense, and layers Hive's identity (usernames, account
abstraction, social login) on top. Sources: [VSC website launch post](https://hive.blog/vsc/@vsc.network/vsc-website-official-launch-the-next-generation-smart-contract-l2-for-the-hive-blockchain), [Magi Network](https://magi.eco/), [docs.magi.eco introduction](https://docs.magi.eco/).

**Writing a contract (Go/TinyGo path, the one with a documented worked
example):**

```go
package main
import "contract-template/sdk"

//go:wasmexport hello_world
func HelloWorld(a *string) *string {
  ret := "Hello world"
  return &ret
}

//go:wasmexport setString
func SetString(a *string) *string {
  sdk.StateSetObject("myString", *a)
  return a
}

//go:wasmexport getString
func GetString(a *string) *string {
  return sdk.StateGetObject("myString")
}
```

Template: `git clone https://github.com/vsc-eco/go-contract-template`. Build:

```bash
tinygo build -gc=custom -scheduler=none -panic=trap -no-debug \
  -target=wasm-unknown -o artifacts/main.wasm ./contract
wasm-strip -o artifacts/main-striped.wasm artifacts/main.wasm   # or wasm-tools strip
```

Deploy (mainnet, ~10 HBD per deployment, needs a funded Hive account's active
key plus a generated BLS/libp2p identity in `data/config/identityConfig.json`):

```bash
vsc-contract-deploy -init   # writes data/config/identityConfig.json to fill in
vsc-contract-deploy -wasmPath artifacts/main-striped.wasm -name "my first contract"
```

Calling a deployed contract today is documented as a web-explorer action
("Magi Blocks", `vsc.techcoderx.com` — search the contract id, use its Call
Contract tab with a connected wallet); a JS/TS client library ("Magi JS")
is referenced for wallet interop and "sign and broadcast multi-op
transaction[s]" but its exact `custom_json` wire format for an off-chain
Node client was **not confirmed** from the public docs pages fetched this
session — one search result described a `custom_json` id of `vsc.call` for
contract calls, but that is a secondhand summary, not a verbatim doc quote,
and should be checked against `github.com/vsc-eco/go-vsc-node`'s source
before a house client relies on it. Sources: [docs.magi.eco/how-to/smart-contract-development/](https://docs.magi.eco/how-to/smart-contract-development/), [docs.magi.eco/references/sdk/](https://docs.magi.eco/references/sdk/), [docs.magi.eco/how-to/build-on-magi/](https://docs.magi.eco/how-to/build-on-magi/).

**Contract SDK surface** (Go side, `sdk` package): `StateSetObject`/
`StateGetObject`/`StateDeleteObject` (this contract's own key/value state),
`ContractStateGet` (read another contract's state), `GetEnv`/`GetEnvKey`
(`contract.id`, `msg.sender`, `block.height`, `tx.id`, …), `GetBalance`/
`HiveDraw`/`HiveTransfer`/`HiveWithdraw` (asset movement between the caller,
the contract, and Hive), `ContractCall` (cross-contract calls, 20-deep
recursion limit), `TssCreateKey`/`TssGetKey`/`TssSignKey` (threshold-signed
keys for cross-chain custody), `Log`, `Abort`/`Revert`. Source: [docs.magi.eco/references/sdk/](https://docs.magi.eco/references/sdk/).

**A local devnet exists** (`go-vsc-node`'s `devnet-setup`/`magid`/
`genesis-elector` binaries, needing Go, MongoDB, and a running Hive
*testnet* node) — real, but multi-service infrastructure the Group does not
currently run; see S6 for what this means for MARSH-on-Hive's own deploy
step. Source: [docs.magi.eco/how-to/devnet-setup/](https://docs.magi.eco/how-to/devnet-setup/).

## 4. HAF — the Hive Application Framework (not a contract layer)

HAF is infrastructure for *reading* Hive, not for executing logic on it: a
`hived` node's blocks are replayed into a Postgres database with a fork
manager, and "HAF apps" are SQL-defined APIs/indices over that database
(account balances, block explorers, reputation, custom per-app tables).
`balance_tracker`, `haf_block_explorer`, and `hived`'s own account-history
plugin are examples; the ecosystem describes itself as building "robust and
scalable Hive APIs and apps." Nothing in HAF executes user-submitted code —
it is the layer a witness/API operator would run to *offer* rich queries
(see S7's node-operation earning line), and it is the layer both Hive-Engine
and Magi's own indexers plausibly resemble in spirit without being HAF apps
themselves. Sources: [openhive-network/haf](https://github.com/openhive-network/haf), [A developer's introduction to HAF](https://hive.blog/hive-139531/@blocktrades/a-developer-s-introduction-to-the-hive-application-framework).

## 5. `custom_json`, the DHF, witnesses, and RC — the native layer everything else rides on

- **`custom_json`** is Hive L1's one generic escape hatch: an operation
  carrying `{id, json, required_auths, required_posting_auths}`, broadcast
  and included in a block like any other op, but otherwise meaningless to L1
  consensus — its `id` is a namespace convention (`ssc-mainnet-hive` for
  Hive-Engine, whatever Magi's anchor ops use) that a *second* system
  (Hive-Engine witnesses, Magi validators, a game's own backend) chooses to
  interpret. Every sidechain and L2 above is, mechanically, just a
  particular community-agreed reading of a stream of `custom_json` ops.
- **The DHF (Decentralized Hive Fund, formerly "the SPS")** is Hive's own
  built-in treasury: the account `hive.fund` receives a slice of new HIVE
  issuance and holds it largely as HBD — **23,221,826 HBD** and **28,115,432
  HIVE**, read live today via `condenser_api.get_accounts(["hive.fund"])`.
  Anyone can post a funding proposal (`create_proposal`: receiver, daily pay
  rate, start/end date, a link to the proposal's justification); Hive
  accounts vote proposals up by stake-weighted approval the same way they
  vote witnesses (one exception: HP delegated *to* an account also carries
  that voter's proposal votes). Payout is automatic, per block, to every
  proposal above a moving "Return Proposal" threshold, until the fund's
  daily budget (about 1% of the fund per day) is exhausted; four proposals
  were reported above that line as of this search, led by "HBD Stabilizer"
  at 12,000 HBD/day. Sources: [developers.hive.io/services/dhf.html](https://developers.hive.io/services/dhf.html), [hive.blog/@gtg/dhf](https://hive.blog/@gtg/dhf).
- **Witnesses** are the ~20 (plus backups) block-producing accounts elected
  by stake-weighted approval vote; they earn per-block pay and jointly set a
  handful of chain-wide parameters by median vote — including
  `hbd_interest_rate`, read live today at **1000 basis points = 10% APR**
  via `condenser_api.get_dynamic_global_properties`. Running a witness node
  earns only if voted into the paid set; running an *API* node (a public
  `hived`/HAF endpoint) can earn indirectly (reputation, DHF-proposal
  eligibility, paid heavy-query tiers) without needing witness votes at all.
- **Resource Credits (RC)** meter every Hive account's free transaction
  bandwidth, regenerating from staked HP the same way voting mana does.
  There is no single canonical RC *delegation marketplace* the way there is
  for, say, TRON bandwidth rental — RC delegation exists as a chain
  primitive (`delegate_rc` custom_json, and native `rc_api` reads:
  `find_rc_accounts`, `get_rc_current_allocations`) but is mostly used
  bilaterally today (an app or guild delegating RC to its own users), not
  brokered on an open market. This is a real, currently-thin opportunity —
  see S7.

## 6. What this means for MARSH-on-Hive (see the companion design/build)

Given S2 vs. S3: **Hive-Engine is the layer the Group can actually exercise
today** — plain JavaScript, the exact style already used everywhere in this
codebase, and a genuinely permissionless dev/test path (run your own
`hivesmartcontracts` node). **Magi is the layer worth building the *real*
future contract against** — a true general-purpose WASM VM with per-contract
state, cross-contract calls, and native asset custody, actively funded by
the DHF, but currently requiring a Go/TinyGo toolchain, a running Hive
testnet, and MongoDB to exercise a local devnet, none of which this
environment has installed. Both contracts are written (S6 of the companion
note); only Magi's is not locally compiled, for that reason, named as the
one remaining step.

## 7. Open items this note does not resolve

- Magi/VSC's exact off-chain client wire format (the `custom_json` id and
  payload an ordinary Node script would broadcast to call a deployed
  contract, as opposed to the web explorer) needs confirming against
  `go-vsc-node`'s source before a house client signs anything real against
  it.
- Whether Hive-Engine's current maintainers have a standing process for
  accepting a new third-party contract onto the shared mainnet sidechain
  (as opposed to running one's own private sidechain) was not found in the
  wiki pages fetched this session and would need asking directly (their
  Discord/GitHub) before assuming either a cost or a timeline.
