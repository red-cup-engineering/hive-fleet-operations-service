#!/usr/bin/env node
// Bounded Holozing Wilds operator. Authentication reproduces Hive Keychain's
// requestSignBuffer contract locally: compact-sign sha256(UTF-8 message) with
// the account's posting key. The key never leaves this process.
//
// This runner deliberately has no Alpha Vial/open-NFT action. When asked to
// start, it sends nftStarter:-1, the game's explicit default-Chirple choice.
// It also stops on the game's human-presence challenge instead of bypassing it.

import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PrivateKey } from "../src/integrations/hive/waggle/keys.mjs";
import { sha256 } from "../src/integrations/hive/waggle/hash.mjs";

const WS_ENDPOINT = "wss://wilds.scrobble.life/ws";
const HIVE_RPC = "https://api.hive.blog";
const CLASSES = new Set(["forest", "ocean", "light"]);
const GENDERS = new Set(["female", "male"]);

function fail(message) {
  throw new Error(`holozing-wilds: ${message}`);
}

export function parseOptions(argv) {
  const options = {
    account: "",
    keyFile: "",
    healerClass: "",
    gender: "",
    startDefault: false,
    autoHeal: false,
    captureMax: 0,
    durationSeconds: 90,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--account") options.account = take().toLowerCase();
    else if (arg === "--key-file") options.keyFile = take();
    else if (arg === "--class") {
      const [healerClass, gender, extra] = take().toLowerCase().split(":");
      if (extra || !CLASSES.has(healerClass) || !GENDERS.has(gender)) {
        fail("--class must be forest|ocean|light:female|male");
      }
      options.healerClass = healerClass;
      options.gender = gender;
    } else if (arg === "--start-default") options.startDefault = true;
    else if (arg === "--auto-heal") options.autoHeal = true;
    else if (arg === "--capture-max") options.captureMax = Number(take());
    else if (arg === "--duration-sec") options.durationSeconds = Number(take());
    else fail(`unknown argument ${arg}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  if (!options.keyFile) fail("--key-file is required");
  if (!Number.isInteger(options.durationSeconds) || options.durationSeconds < 5 || options.durationSeconds > 600) {
    fail("--duration-sec must be an integer from 5 through 600");
  }
  if (options.autoHeal && !options.startDefault) fail("--auto-heal requires --start-default");
  if (!Number.isInteger(options.captureMax) || options.captureMax < 0 || options.captureMax > 3) {
    fail("--capture-max must be an integer from 0 through 3");
  }
  return Object.freeze(options);
}

export function authMessage(account, nonce) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account)) fail("invalid authentication account");
  if (!/^[0-9a-f]{32}$/i.test(nonce)) fail("invalid server nonce");
  return `holozing-wilds:wilds-auth:${account}:${nonce}`;
}

export function signAuthMessage(account, nonce, privateKey) {
  const message = authMessage(account, nonce);
  return privateKey.sign(sha256(Buffer.from(message, "utf8"))).toString("hex");
}

export function shouldHeal(state, lastHealClock = -Infinity) {
  if (!state || state.phase !== "battle" || !Array.isArray(state.team)) return false;
  const active = state.team[state.activeIndex ?? 0];
  const healer = state.healer;
  if (!active || active.fainted || !(active.maxHp > 0) || !healer || !(healer.pulseCost > 0)) return false;
  const clock = Number(state.clock ?? 0);
  if (clock - lastHealClock < 4000) return false;
  const ratio = active.hp / active.maxHp;
  return ratio <= 0.25
    ? healer.mana >= healer.pulseCost
    : ratio <= 0.60 && healer.mana >= healer.pulseCost * 2;
}

export function captureDecision(state, attempts, maximumAttempts, reserveDust = 50) {
  const wild = state?.wild;
  const active = Array.isArray(state?.team) ? state.team[state.activeIndex ?? 0] : null;
  if (!wild || !active || active.fainted || !(active.hp > 0) || state.phase !== "battle") return null;
  if (attempts >= maximumAttempts || !(wild.maxHp > 0) || !(wild.hp > 0) || wild.hp / wild.maxHp > 0.15) return null;
  if (wild.boss || wild.isBoss || wild.elite || wild.alpha || ["boss", "elite", "alpha"].includes(String(wild.tier ?? "").toLowerCase())) return null;
  const rosterCap = 4 + Number(state.buildings?.habitat ?? 0) + Number(state.paragon ?? 0);
  if (state.team.length >= rosterCap) return null;
  const level = Math.max(1, Number(wild.level ?? 1));
  const zone = Math.max(1, Number(state.zone ?? 1));
  const zoneMultiplier = zone <= 10 ? 1 : 1 + (zone - 10) * 0.05;
  // Conservatively reserve the evolved-form 1.5x cost even when the client
  // has not sent a directly usable evolution flag.
  const maximumCost = Math.ceil((15 + 6 * level) * zoneMultiplier * 1.5);
  if (Number(state.holoDust ?? 0) - maximumCost < reserveDust) return null;
  return Object.freeze({ maximumCost, reserveDust, hpRatio: wild.hp / wild.maxHp });
}

async function hiveAccount(account) {
  const response = await fetch(HIVE_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[account]] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`Hive account verification returned HTTP ${response.status}`);
  const payload = await response.json();
  const row = payload?.result?.[0];
  if (!row) fail(`Hive account ${account} was not found`);
  return row;
}

async function loadVerifiedPostingKey(account, keyFile) {
  const mode = statSync(keyFile).mode & 0o777;
  if ((mode & 0o077) !== 0) fail("posting-key file must not be group/world accessible");
  const key = PrivateKey.from(readFileSync(keyFile, "utf8").trim());
  const publicKey = key.createPublic("STM").toString();
  const row = await hiveAccount(account);
  const threshold = Number(row.posting?.weight_threshold ?? 1);
  const weight = Number((row.posting?.key_auths ?? []).find(([candidate]) => candidate === publicKey)?.[1] ?? 0);
  if (weight < threshold) fail("the supplied key does not independently satisfy the account's posting authority");
  return key;
}

function safeState(state) {
  const active = Array.isArray(state.team) ? state.team[state.activeIndex ?? 0] : null;
  return Object.freeze({
    clock: Number(state.clock ?? 0),
    zone: Number(state.zone ?? 0),
    cell: Number(state.cell ?? 0),
    phase: state.phase ?? null,
    healer: state.healer ? Object.freeze({ class: state.healer.class ?? null, level: state.healer.level, mana: Math.round(state.healer.mana ?? 0) }) : null,
    active: active ? Object.freeze({ name: active.name, level: active.level, hp: Math.round(active.hp), maxHp: Math.round(active.maxHp) }) : null,
    wild: state.wild ? Object.freeze({ name: state.wild.name, level: state.wild.level, hp: Math.round(state.wild.hp), maxHp: Math.round(state.wild.maxHp), boss: Boolean(state.wild.boss || state.wild.isBoss), elite: Boolean(state.wild.elite), alpha: Boolean(state.wild.alpha) }) : null,
    roster: Array.isArray(state.team) ? state.team.length : 0,
    holoDust: Number(state.holoDust ?? 0),
    achievements: Array.isArray(state.achievements) ? state.achievements.length : 0,
    stats: state.stats ? Object.freeze({
      wildsDefeated: Number(state.stats.wildsDefeated ?? 0),
      captureAttempts: Number(state.stats.captureAttempts ?? 0),
      captureSuccess: Number(state.stats.captureSuccess ?? 0),
      captureFail: Number(state.stats.captureFail ?? 0),
      dustEarned: Number(state.stats.dustEarned ?? 0),
      dustSpent: Number(state.stats.dustSpent ?? 0),
    }) : null,
    recentLog: Array.isArray(state.log) ? Object.freeze(state.log.slice(-4).map(String)) : Object.freeze([]),
  });
}

function starterEvidence(message) {
  const bonuses = message?.bonuses ?? {};
  return Object.freeze({
    ownedStarterChoices: Array.isArray(message?.picks) ? message.picks.length : 0,
    bonuses: Object.freeze({
      dust: Number(bonuses.dust ?? 0),
      gloveRarity: bonuses.gloveRarity ?? null,
      bagRarity: bonuses.bagRarity ?? null,
      creatureFood: Boolean(bonuses.creatureFood),
      healerFood: Boolean(bonuses.healerFood),
      manaPotion: Boolean(bonuses.manaPotion),
      manaElixir: Boolean(bonuses.manaElixir),
    }),
  });
}

export async function operate(options, output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  if (typeof globalThis.WebSocket !== "function") fail("this Node runtime does not provide WebSocket");
  const privateKey = await loadVerifiedPostingKey(options.account, options.keyFile);
  const receipt = {
    kind: "aagaard.holozing-wilds-receipt",
    account: options.account,
    authenticated: false,
    classBound: false,
    defaultStarterSelected: false,
    nftStarterSelected: false,
    started: false,
    heals: 0,
    captureActionsSent: 0,
    presenceRequired: false,
    maxZone: 0,
    maxCell: 0,
    initialDust: null,
    finalDust: null,
    finalState: null,
    starterEvidence: null,
  };
  let socket;
  let identified = false;
  let cseq = 0;
  let lastHealClock = -Infinity;
  let lastPrintedAt = 0;
  let lastCellKey = "";
  let classSent = false;
  let defaultStarterSent = false;
  let startSent = false;
  let captureOutstanding = false;
  let settled = false;

  const finish = (resolvePromise, rejectPromise, error) => {
    if (settled) return;
    settled = true;
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    if (error) rejectPromise(error);
    else {
      output(Object.freeze({ ...receipt, completedAt: new Date().toISOString() }));
      resolvePromise(Object.freeze({ ...receipt }));
    }
  };

  return await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => finish(resolvePromise, rejectPromise), options.durationSeconds * 1000);
    try {
      socket = new WebSocket(WS_ENDPOINT);
    } catch (error) {
      clearTimeout(timer);
      finish(resolvePromise, rejectPromise, error);
      return;
    }
    const send = (value) => socket.send(JSON.stringify(value));
    socket.addEventListener("open", () => send({ t: "hello", deviceId: `aagaard:${options.account}`, ver: 1 }));
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      finish(resolvePromise, rejectPromise, new Error("holozing-wilds: WebSocket failed"));
    });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      if (!settled) finish(resolvePromise, rejectPromise);
    });
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.t === "welcome") {
        try {
          const signature = signAuthMessage(options.account, message.nonce, privateKey);
          send({ t: "subscribe" });
          send({ t: "identify", account: options.account, signature, nonce: message.nonce });
        } catch (error) {
          clearTimeout(timer);
          finish(resolvePromise, rejectPromise, error);
        }
        return;
      }
      if (message.t === "identified") {
        if (message.account !== options.account || typeof message.token !== "string" || !message.token) {
          clearTimeout(timer);
          finish(resolvePromise, rejectPromise, new Error("holozing-wilds: malformed identification receipt"));
          return;
        }
        identified = true;
        receipt.authenticated = true;
        output({ event: "identified", account: options.account });
        return;
      }
      if (message.t === "identifyFailed") {
        clearTimeout(timer);
        finish(resolvePromise, rejectPromise, new Error(`holozing-wilds: identification refused (${message.reason ?? "unknown"})`));
        return;
      }
      if (message.t === "presenceCheck") {
        receipt.presenceRequired = true;
        output({ event: "presence-required", action: "stopped-without-acknowledgement" });
        clearTimeout(timer);
        finish(resolvePromise, rejectPromise);
        return;
      }
      if (!identified) return;
      if (message.t === "starterOptions") {
        receipt.starterEvidence = starterEvidence(message);
        output({ event: "starter-options", ...receipt.starterEvidence });
        if (options.startDefault && !defaultStarterSent) {
          defaultStarterSent = true;
          receipt.defaultStarterSelected = true;
          send({ t: "nftStarter", index: -1 });
          send({ t: "start" });
          startSent = true;
          receipt.started = true;
          output({ event: "start", starter: "default-chirple", nftConsumed: false });
        }
        return;
      }
      if (message.t !== "snapshot" || !message.state || typeof message.seq !== "number") return;
      const state = message.state;
      receipt.maxZone = Math.max(receipt.maxZone, Number(state.zone ?? 0));
      receipt.maxCell = Math.max(receipt.maxCell, Number(state.cell ?? 0));
      receipt.initialDust ??= Number(state.holoDust ?? 0);
      receipt.finalDust = Number(state.holoDust ?? 0);
      receipt.finalState = safeState(state);

      if (!state.healer?.class && options.healerClass && !classSent) {
        classSent = true;
        receipt.classBound = true;
        send({ t: "action", id: "class", args: [options.healerClass, options.gender], cseq: ++cseq, atClock: Number(message.clock ?? state.clock ?? 0) });
        output({ event: "class-bound", class: options.healerClass, gender: options.gender });
        return;
      }
      if (!state.healer?.class && options.startDefault && !options.healerClass) {
        clearTimeout(timer);
        finish(resolvePromise, rejectPromise, new Error("holozing-wilds: healer class is unset; supply --class explicitly"));
        return;
      }
      if (options.startDefault && state.healer?.class && Number(state.clock ?? 0) === 0 && !startSent && !defaultStarterSent) {
        // Existing saves without a starter-choice message can still be resumed.
        defaultStarterSent = true;
        receipt.defaultStarterSelected = true;
        send({ t: "nftStarter", index: -1 });
        send({ t: "start" });
        startSent = true;
        receipt.started = true;
        output({ event: "start", starter: "default-chirple", nftConsumed: false });
      }
      if (!state.wild) captureOutstanding = false;
      const capture = captureOutstanding ? null : captureDecision(state, receipt.captureActionsSent, options.captureMax);
      if (capture) {
        captureOutstanding = true;
        send({ t: "action", id: "capture", args: [], cseq: ++cseq, atClock: Number(message.clock ?? state.clock ?? 0) });
        receipt.captureActionsSent += 1;
        output({ event: "capture-attempt", wild: state.wild.name, level: state.wild.level, hpRatio: Number(capture.hpRatio.toFixed(3)), maximumCost: capture.maximumCost, retainedDust: capture.reserveDust });
      }
      if (options.autoHeal && shouldHeal(state, lastHealClock)) {
        const clock = Number(message.clock ?? state.clock ?? 0);
        send({ t: "action", id: "heal", args: [], cseq: ++cseq, atClock: clock });
        lastHealClock = clock;
        receipt.heals += 1;
      }
      const now = Date.now();
      const cellKey = `${state.zone}:${state.cell}:${state.phase}`;
      if (cellKey !== lastCellKey || now - lastPrintedAt >= 15_000) {
        output({ event: "state", state: receipt.finalState });
        lastCellKey = cellKey;
        lastPrintedAt = now;
      }
    });
  });
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await operate(parseOptions(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
