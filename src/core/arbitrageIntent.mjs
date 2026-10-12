// Durable intent, not a balance or settlement database. Each account has a
// sequence of immutable revisions. Creating the next revision exclusively is
// the right to perform its next action; a crashed submission is never leased
// out again. Chain evidence is still required to establish every effect.
import { mkdir, readdir, readFile, open, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const REVISION = /^([0-9]{16})\.json$/u;

export function arbitrageIntentStore(dataDir, account) {
  if (typeof dataDir !== "string" || !dataDir || !/^[a-z][a-z0-9.-]{2,15}$/u.test(account)) {
    throw new TypeError("arbitrage intent requires a data directory and canonical account");
  }
  const directory = path.join(dataDir, "arbitrage-intents", account);
  return Object.freeze({
    async hasTransaction(id) {
      const names = await readdir(directory);
      for (const name of names.filter((entry) => REVISION.test(entry))) {
        const state = JSON.parse(await readFile(path.join(directory, name), "utf8"));
        if (state.swap?.id === id || state.sell?.id === id) return true;
      }
      return false;
    },
    async read() {
      let names;
      try { names = await readdir(directory); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
      const latest = names.filter((name) => REVISION.test(name)).sort().at(-1);
      if (!latest) return null;
      const state = JSON.parse(await readFile(path.join(directory, latest), "utf8"));
      if (state.account !== account || state.revision !== Number(REVISION.exec(latest)[1])) {
        throw new Error("arbitrage intent identity is corrupt; refusing execution");
      }
      return state;
    },
    async advance(previous, next) {
      const revision = (previous?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision) || revision > 9999999999999999) throw new RangeError("arbitrage revision exhausted");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Persist the account-directory links as well as the revision's inode.
      for (const ancestor of [path.dirname(path.resolve(dataDir)), dataDir, path.dirname(directory)]) {
        const parent = await open(ancestor, "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
      const temporary = path.join(directory, `.${randomUUID()}.tmp`);
      const destination = path.join(directory, `${String(revision).padStart(16, "0")}.json`);
      const state = { ...next, account, revision };
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(`${JSON.stringify(state)}\n`);
        await file.sync();
      } finally { await file.close(); }
      try {
        // link is atomic and cannot overwrite another caller's revision.
        try { await link(temporary, destination); }
        catch (error) { if (error.code === "EEXIST") return null; throw error; }
        const parent = await open(directory, "r");
        try { await parent.sync(); } finally { await parent.close(); }
        return state;
      } finally { await unlink(temporary); }
    },
  });
}
