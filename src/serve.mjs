import { createWebServer } from "@red-cup-engineering/computer-web-server";
import { startWebServer } from "@red-cup-engineering/computer-web-server/node";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ALL_CAPABILITIES, aagaardParityReport, capabilityReport, composeDailyDrafts, createAagaardRuntime, createHiveClient, createHiveEngineClient, createOperatorAuth, dispositionIncentiveNomination, ensureStore, isLocked, listIncentiveNominations, loadAagaardConfig, mergeWalletState, planGaming, planIncentives, planTrades, planVotes, readFleetTicks, readLastReadout, readLockedDrafts, readCurationTelemetry, readSubstrateSnapshots, recordIncentiveNominations, recordLockedDrafts } from "./index.mjs";
export function createAagaardServer(options = {}) {
const appRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const config = options.config ?? loadAagaardConfig({
    configPath: path.join(appRoot, "aagaard.config.json")
});
const store = options.store ?? ensureStore(appRoot, {
    witnessJournalRequired: true
});
const hive = config.hive.enabled ? createHiveClient(config.hive) : undefined;
const hiveEngine = config.hiveEngine.enabled ? createHiveEngineClient(config.hiveEngine) : undefined;
const runtime = options.runtime ?? createAagaardRuntime(config, store, {
    ...hive ? {
        hive
    } : {},
    ...hiveEngine ? {
        market: hiveEngine
    } : {},
});
const host = options.host ?? process.env["HOST"] ?? "127.0.0.1";
const port = options.port ?? Number(process.env["PORT"] ?? 18807);
const publicBaseUrl = (process.env["PUBLIC_BASE_URL"] ?? process.env["BASE_URL"] ?? `http://${host}:${port}`).replace(/\/$/, "");
const googleDiscoveryUrl = process.env["GOOGLE_DISCOVERY_URL"];
const auth = options.auth ?? createOperatorAuth({
    publicBaseUrl,
    grantStoreProfile: options.grantStoreProfile ?? process.env["OAUTH_GRANT_STORE_PROFILE"],
    opsToken: process.env["AAGAARD_OPS_TOKEN"] ?? "",
    ...(process.env["AAGAARD_SESSION_SECRET"] ? { sessionSecret: process.env["AAGAARD_SESSION_SECRET"] } : {}),
    ...(store.dataDir ? { stateDir: store.dataDir } : {}),
    allowedEmail: process.env["AAGAARD_ALLOWED_EMAIL"] ?? "morgan.sennhauser@gmail.com",
    openWhenUnconfigured: process.env["AAGAARD_REQUIRE_AUTH"] !== "1",
    google: {
        clientId: process.env["GOOGLE_CLIENT_ID"] ?? "",
        clientSecret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
        ...googleDiscoveryUrl ? {
            discoveryUrl: googleDiscoveryUrl
        } : {}
    }
});
function send(status, value, type = "application/json; charset=utf-8", headers = {}) {
    const body = type.startsWith("application/json") ? `${JSON.stringify(value, null, 2)}\n` : String(value);
    return new Response(body, { status, headers: { "content-type": type, ...headers } });
}
function notFound() { return send(404, { error: "not found" }); }
function bodyOk(request) {
    return request.method === "POST" || request.method === "GET";
}
function ui() {
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aagaard</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:0;background:#f7f7f4;color:#1b1b18}
main{max-width:1100px;margin:0 auto;padding:24px}
header{display:flex;align-items:center;justify-content:space-between;gap:16px}
button{border:1px solid #999;background:white;padding:8px 10px;border-radius:6px;cursor:pointer}
select,input{border:1px solid #999;background:white;padding:8px 10px;border-radius:6px}
pre{background:#111;color:#eee;padding:16px;overflow:auto;border-radius:6px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
.panel{border-top:1px solid #d0d0c8;padding-top:12px}
</style>
<main>
<header><h1>Aagaard</h1><span id="state"></span></header>
<div class="row panel">
<button data-path="/">Status</button>
<button data-path="/health">Health</button>
<button data-path="/arm" data-method="POST">Arm</button>
<button data-path="/disarm" data-method="POST">Disarm</button>
<button data-path="/pause" data-method="POST">Pause</button>
<button data-path="/resume" data-method="POST">Resume</button>
<button data-path="/tick" data-method="POST">Tick</button>
<button data-path="/last">Last</button>
<button data-path="/ticks">Ticks</button>
<button data-path="/parity">Parity</button>
<button data-path="/arenas">Arenas</button>
<button data-path="/witnesses">Witnesses</button>
<button data-path="/substrate">Substrate</button>
</div>
<div class="row panel">
<button data-path="/capabilities">Capabilities</button>
<button data-path="/capabilities/voting/enable" data-method="POST">Enable voting</button>
<button data-path="/capabilities/voting/disable" data-method="POST">Disable voting</button>
<button data-path="/capabilities/trading/enable" data-method="POST">Enable trading</button>
<button data-path="/capabilities/trading/disable" data-method="POST">Disable trading</button>
<button data-path="/capabilities/incentive/enable" data-method="POST">Enable incentives</button>
<button data-path="/capabilities/incentive/disable" data-method="POST">Disable incentives</button>
</div>
<div class="row panel">
<label>Account <select id="account"></select></label>
<button data-account-route="alpha">Alpha</button>
<button data-account-route="strategy">Strategy</button>
<button data-account-route="intelligence">Intelligence</button>
<button data-account-route="liquidity">Liquidity</button>
<button data-account-route="drafts">Drafts</button>
<button data-account-route="games">Games</button>
<button data-agent-route="curation">Agent curation</button>
<button data-agent-route="market">Agent market</button>
<button data-agent-route="wallet">Agent wallet</button>
</div>
<div class="row panel">
<button data-path="/incentives">Incentives</button>
<button data-incentive-choice="ignore">Ignore offer</button>
<button data-incentive-choice="llm-draft">Draft response</button>
<button data-incentive-choice="manual">Manual review</button>
</div>
<pre id="out"></pre>
<script>
const out=document.getElementById('out');
const AUTH_MODE=${JSON.stringify(auth.mode)};
const ACCOUNTS=${JSON.stringify(config.wallets.map((wallet)=>wallet.account))};
const accountSelect=document.getElementById('account');
for(const account of ACCOUNTS){
 const option=document.createElement('option');
 option.value=account;
 option.textContent=account;
 accountSelect.appendChild(option);
}
const b64url=(buf)=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
async function sha256(s){return b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
function rand(n=32){const a=new Uint8Array(n);crypto.getRandomValues(a);return b64url(a.buffer);}
async function login(){
 const client=await fetch('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'aagaard-webux',redirect_uris:[location.origin+'/ui'],token_endpoint_auth_method:'none'})}).then(r=>r.json());
 const verifier=rand(48);
 const challenge=await sha256(verifier);
 const op=AUTH_MODE==='bearer'?(prompt('Operator token')||''):'';
 const state=rand(24);
 const u=new URL('/oauth/authorize',location.origin);
 u.searchParams.set('response_type','code');
 u.searchParams.set('client_id',client.client_id);
 u.searchParams.set('redirect_uri',location.origin+'/ui');
 u.searchParams.set('code_challenge',challenge);
 u.searchParams.set('code_challenge_method','S256');
 u.searchParams.set('state',state);
 u.searchParams.set('operator_token',op);
 if(AUTH_MODE==='google'){
  sessionStorage.aagaardClientId=client.client_id;
  sessionStorage.aagaardVerifier=verifier;
  sessionStorage.aagaardState=state;
  location.href=u.toString();
  return '';
 }
 const authz=await fetch(u);
 if(!authz.ok) throw new Error((await authz.json()).error||'authorization failed');
 const redirected=new URL(authz.url);
 const code=redirected.searchParams.get('code')||'';
 const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:client.client_id,redirect_uri:location.origin+'/ui',code_verifier:verifier});
 const token=await fetch('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}).then(r=>r.ok?r.json():Promise.reject(new Error('token exchange failed')));
 localStorage.aagaardToken=token.access_token;
 return token.access_token;
}
async function completeOAuthReturn(){
 const qs=new URLSearchParams(location.search);
 const code=qs.get('code')||'';
 if(!code) return false;
 if(qs.get('state')!==sessionStorage.aagaardState) throw new Error('authorization state mismatch');
 const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:sessionStorage.aagaardClientId||'',redirect_uri:location.origin+'/ui',code_verifier:sessionStorage.aagaardVerifier||''});
 const token=await fetch('/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body}).then(r=>r.ok?r.json():Promise.reject(new Error('token exchange failed')));
 localStorage.aagaardToken=token.access_token;
 sessionStorage.removeItem('aagaardClientId');
 sessionStorage.removeItem('aagaardVerifier');
 sessionStorage.removeItem('aagaardState');
 history.replaceState(null,'','/ui');
 return true;
}
async function call(path,method='GET'){
 if(!localStorage.aagaardToken && AUTH_MODE==='bearer') await login();
 if(!localStorage.aagaardToken && AUTH_MODE==='google' && !(await login())) return;
 const r=await fetch('/ops'+path,{method,headers:{authorization:localStorage.aagaardToken?'Bearer '+localStorage.aagaardToken:''}});
 if(r.status===401||r.status===403){localStorage.removeItem('aagaardToken');}
 out.textContent=JSON.stringify(await r.json(),null,2);
}
async function agent(route){
 const account=encodeURIComponent(accountSelect.value);
 const r=await fetch('/agents/'+account+'/'+route);
 out.textContent=JSON.stringify(await r.json(),null,2);
}
async function disposition(choice){
 const offer=prompt('Offer id');
 if(!offer) return;
 await call('/incentives/'+encodeURIComponent(offer)+'/'+choice,'POST');
}
for(const b of document.querySelectorAll('button')) b.onclick=()=>call(b.dataset.path,b.dataset.method||'GET');
for(const b of document.querySelectorAll('button[data-account-route]')) b.onclick=()=>call('/'+b.dataset.accountRoute+'/'+encodeURIComponent(accountSelect.value),'GET');
for(const b of document.querySelectorAll('button[data-agent-route]')) b.onclick=()=>agent(b.dataset.agentRoute);
for(const b of document.querySelectorAll('button[data-incentive-choice]')) b.onclick=()=>disposition(b.dataset.incentiveChoice);
completeOAuthReturn().then(()=>call('/')).catch(e=>{out.textContent=String(e);});
</script>
</main>`;
}
async function readPosts(wallet) {
    if (!hive) return [];
    try {
        const posts = await hive.readCandidateField(wallet);
        return posts;
    } catch  {
        return [];
    }
}
async function readState(wallet) {
    if (!hive) return null;
    try {
        return await hive.readWalletState(wallet);
    } catch  {
        return null;
    }
}
async function readMarket(wallet, state) {
    if (!hiveEngine) return null;
    try {
        return await hiveEngine.readWalletMarket(wallet, state);
    } catch  {
        return null;
    }
}
async function readRewardPrice() {
    if (!hive?.readRewardPrice) return undefined;
    try {
        return await hive.readRewardPrice();
    } catch  {
        return undefined;
    }
}
async function readWalletInputs(wallet) {
    const [posts, chainState, rewardPrice] = await Promise.all([
        readPosts(wallet),
        readState(wallet),
        readRewardPrice()
    ]);
    const market = await readMarket(wallet, chainState);
    return Object.freeze({
        posts,
        state: mergeWalletState(wallet, chainState, market),
        market,
        rewardPrice
    });
}
function operatorDrafts(account) {
    const draftedNominationIds = new Set(listIncentiveNominations(store).filter((record)=>record.status === "drafted" && record.draftId).map((record)=>record.draftId));
    return readLockedDrafts(store, account).filter((draft)=>draft.topic !== "incentive-response" || draftedNominationIds.has(draft.id));
}
async function handleOps(request, url) {
    const decision = await auth.authorize(Object.fromEntries(request.headers));
    if (!decision.ok) {
        return send(decision.status, {
            error: decision.status === 401 ? "unauthorized" : "forbidden",
            reason: decision.reason,
            authorize: `${auth.publicBaseUrl}/ui`
        }, "application/json; charset=utf-8", {
            "www-authenticate": decision.challenge ?? auth.challenge
        });
    }
    const rest = url.pathname.slice("/ops".length) || "/";
    const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);
    if (request.method === "GET" && rest === "/") return send(200, runtime.status());
    if (request.method === "GET" && rest === "/health") return send(200, {
        status: "ok",
        running: runtime.control.running,
        live: runtime.control.live
    });
    if (request.method === "GET" && rest === "/capabilities") return send(200, {
        capabilities: capabilityReport(config, runtime.control)
    });
    if (request.method === "GET" && rest === "/parity") return send(200, aagaardParityReport(config, runtime.control, {
        hiveWriteConfigured: true
    }));
    if (request.method === "POST" && rest === "/arm") {
        runtime.control.live = true;
        return send(200, {
            live: true
        });
    }
    if (request.method === "POST" && rest === "/disarm") {
        runtime.control.live = false;
        return send(200, {
            live: false
        });
    }
    if (request.method === "POST" && rest === "/pause") {
        runtime.control.running = false;
        return send(200, {
            running: false
        });
    }
    if (request.method === "POST" && rest === "/resume") {
        runtime.control.running = true;
        return send(200, {
            running: true
        });
    }
    if (request.method === "POST" && rest === "/tick") return send(200, await runtime.runTick());
    if (request.method === "GET" && rest === "/last") {
        const last = readLastReadout(store);
        return last ? send(200, last) : send(404, {
            note: "no tick recorded yet"
        });
    }
    if (request.method === "GET" && rest === "/ticks") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "20")));
        return send(200, {
            ticks: readFleetTicks(store, limit)
        });
    }
    if (request.method === "GET" && rest === "/substrate") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "20")));
        return send(200, {
            substrate: readSubstrateSnapshots(store, limit)
        });
    }
    if (request.method === "GET" && rest === "/strategies") {
        return send(200, {
            strategies: config.wallets.map((wallet)=>({
                    account: wallet.account,
                    archetype: wallet.strategy.archetype,
                    feeds: wallet.strategy.feeds,
                    objective: wallet.strategy.objective,
                    pacing: {
                        conviction: wallet.strategy.conviction,
                        votingPowerFloorBps: wallet.strategy.votingPowerFloorBps,
                        maxVotesPerTick: wallet.strategy.maxVotesPerTick
                    }
                }))
        });
    }
    if (request.method === "GET" && rest === "/arenas") {
        const last = readLastReadout(store) ?? await runtime.runTick();
        return send(200, {
            arenas: last.accounts.flatMap((account)=>account.arenas.map((arena)=>({
                        account: account.account,
                        ...arena
                    })))
        });
    }
    if (request.method === "GET" && rest === "/witnesses") {
        const last = readLastReadout(store) ?? await runtime.runTick();
        return send(200, {
            digestRows: last.witness.rows,
            witness: last.witness
        });
    }
    if (request.method === "POST" && parts[0] === "capabilities" && parts.length === 3) {
        const cap = parts[1];
        const action = parts[2];
        if (!ALL_CAPABILITIES.includes(cap)) return send(400, {
            error: `unknown capability ${cap}`
        });
        if (isLocked(cap)) return send(403, {
            error: `${cap} is locked`,
            capability: cap,
            locked: true
        });
        if (action === "enable") {
            runtime.control.enable(cap);
            return send(200, {
                capability: cap,
                enabled: true
            });
        }
        if (action === "disable") {
            runtime.control.disable(cap);
            return send(200, {
                capability: cap,
                enabled: false
            });
        }
        return send(400, {
            error: "expected enable or disable"
        });
    }
    if (request.method === "GET" && parts.length === 2) {
        const [route, account] = parts;
        const wallet = account ? runtime.wallet(account) : undefined;
        if (!wallet) return send(404, {
            error: `unknown account ${account ?? ""}`
        });
        if (route === "alpha") {
            const { posts, state, rewardPrice } = await readWalletInputs(wallet);
            const plan = planVotes(wallet, posts, new Date().toISOString(), state, [wallet], undefined, rewardPrice);
            return send(200, {
                account,
                radar: plan.radar,
                votesPlanned: plan.votes.length
            });
        }
        if (route === "curation") {
            return send(200, readCurationTelemetry(store.dataDir, wallet.account));
        }
        if (route === "strategy") {
            const { posts, state, rewardPrice } = await readWalletInputs(wallet);
            const plan = planVotes(wallet, posts, new Date().toISOString(), state, [wallet], undefined, rewardPrice);
            return send(200, {
                account,
                strategy: wallet.strategy,
                decision: plan.decision,
                votes: plan.votes
            });
        }
        if (route === "intelligence") {
            const { posts, state, rewardPrice } = await readWalletInputs(wallet);
            const plan = planVotes(wallet, posts, new Date().toISOString(), state, [wallet], undefined, rewardPrice);
            return send(200, {
                account,
                ...plan.intelligence
            });
        }
        if (route === "liquidity") {
            const { state, market } = await readWalletInputs(wallet);
            const plan = planTrades(wallet, new Date().toISOString(), state, market);
            return send(200, {
                account,
                liquidity: plan.liquidity
            });
        }
        if (route === "drafts") {
            const accountId = wallet.account;
            let drafts = operatorDrafts(accountId);
            if (drafts.length === 0) {
                const at = new Date().toISOString();
                const { posts, state, market, rewardPrice } = await readWalletInputs(wallet);
                const voting = planVotes(wallet, posts, at, state, [wallet], undefined, rewardPrice);
                const trading = planTrades(wallet, at, state, market);
                const incentive = planIncentives(wallet, posts, trading.liquidity);
                await recordLockedDrafts(store, composeDailyDrafts({
                    wallet,
                    voting,
                    trading,
                    incentive,
                    at
                }));
                drafts = operatorDrafts(accountId);
            }
            return send(200, {
                account: accountId,
                locked: true,
                drafts
            });
        }
        if (route === "games") {
            const { state } = await readWalletInputs(wallet);
            return send(200, planGaming(wallet, new Date().toISOString(), state));
        }
    }
    if (request.method === "GET" && rest === "/incentives") {
        const incentives = await Promise.all(config.wallets.map(async (wallet)=>{
            const { posts, state, market } = await readWalletInputs(wallet);
            const plan = planIncentives(wallet, posts, planTrades(wallet, new Date().toISOString(), state, market).liquidity);
            await recordIncentiveNominations(store, plan);
            return plan;
        }));
        return send(200, {
            incentives,
            nominations: listIncentiveNominations(store)
        });
    }
    if (request.method === "POST" && parts[0] === "incentives" && parts.length === 3) {
        const choice = parts[2];
        if (choice !== "ignore" && choice !== "llm-draft" && choice !== "manual") return send(400, {
            error: "expected ignore, llm-draft, or manual"
        });
        const updated = await dispositionIncentiveNomination(store, parts[1], choice);
        return updated ? send(200, updated) : send(404, {
            error: `unknown offer ${parts[1]}`
        });
    }
    return notFound();
}
async function handle(request) {
    if (!request.url || !bodyOk(request)) return notFound();
    const url = new URL(request.url);
    // The authorization server's metadata, registration, authorization, token and revocation, and the Google sign-in.
    const authorized = await auth.handle?.(request);
    if (authorized !== undefined) return authorized;
    if (url.pathname.startsWith("/oauth/")) return notFound();
    if (request.method === "GET" && url.pathname === "/ui") return send(200, ui(), "text/html; charset=utf-8");
    if (url.pathname.startsWith("/ops")) return handleOps(request, url);
    const agent = /^\/agents\/([^/]+)\/(curation|market|wallet)$/.exec(url.pathname);
    if (request.method === "GET" && agent) {
        const wallet = runtime.wallet(decodeURIComponent(agent[1]));
        if (!wallet) return send(404, {
            error: `unknown account ${agent[1]}`
        });
        if (agent[2] === "curation") {
            const { posts, state, rewardPrice } = await readWalletInputs(wallet);
            return send(200, planVotes(wallet, posts, new Date().toISOString(), state, [wallet], undefined, rewardPrice));
        }
        if (agent[2] === "market") {
            const { state, market } = await readWalletInputs(wallet);
            return send(200, planTrades(wallet, new Date().toISOString(), state, market));
        }
        const { state, market } = await readWalletInputs(wallet);
        return send(200, {
            account: wallet.account,
            actor: wallet,
            state,
            market
        });
    }
    return notFound();
}
const application = createWebServer({ resources: [{ match: () => ({}), handler: async ({ request }) => {
    try { return await handle(request); }
    catch (error) { return send(error.status ?? 500, { error: error instanceof Error ? error.message : String(error) }); }
} }] });
return { application, runtime, config, host, port };
}

export async function startAagaardServer(options = {}) {
    const { application, runtime, config, host, port } = createAagaardServer(options);
    const running = await startWebServer(application, { port, host });
    const controller = new AbortController();
    runtime.start(controller.signal);
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    process.stderr.write(`[aagaard] http://${host}:${running.port} live=${config.live} enabled=[${config.enabled.join(",")}]\n`);
    return { ...running, close: async () => {
        controller.abort();
        process.removeListener("SIGINT", abort);
        process.removeListener("SIGTERM", abort);
        await running.close();
    } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    startAagaardServer().catch(error => { console.error(error); process.exitCode = 1; });
}
