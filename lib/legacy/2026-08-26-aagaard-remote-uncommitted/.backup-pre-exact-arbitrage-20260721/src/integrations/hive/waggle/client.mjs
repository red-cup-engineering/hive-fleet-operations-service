/**
 * @module @561-group/waggle
 *
 * The top-level waggle API. The {@link Waggle} class wraps the RPC transport, the read
 * layer, the keys, and the build/sign/broadcast pipeline behind one object. Reads need no
 * keys; writes need the relevant key (posting for social actions, active for value
 * transfers). Construct with WIF strings or `PrivateKey` instances per role.
 *
 * Types and per-method documentation live in the co-located `client.d.ts`.
 *
 * @see {@link ./client.d.ts}
 */
import { RpcClient, DEFAULT_NODES } from "./rpc.mjs";
import * as chain from "./chain.mjs";
import { PrivateKey } from "./keys.mjs";
import { signTransaction, CHAIN_ID, transactionId } from "./transaction.mjs";
import * as ops from "./ops.mjs";

export class Waggle {
  constructor({
    nodes = DEFAULT_NODES,
    timeout,
    transport,
    account,
    keys = {},
    chainId = CHAIN_ID,
    expirySeconds = 60,
  } = {}) {
    this.rpc = new RpcClient({ nodes, timeout, transport });
    this.account = account;
    this.chainId = chainId;
    this.expirySeconds = expirySeconds;
    this.keys = {};
    for (const [role, k] of Object.entries(keys)) {
      if (!k) continue;
      this.keys[role] = typeof k === "string" ? PrivateKey.from(k) : k;
    }
  }

  // --- reads (no keys required) ---
  getDynamicGlobalProperties() { return chain.getDynamicGlobalProperties(this.rpc); }
  getReferenceBlockData() { return chain.getReferenceBlockData(this.rpc); }
  getAccounts(names) { return chain.getAccounts(this.rpc, names); }
  async getAccount(name) { return (await chain.getAccounts(this.rpc, [name]))[0]; }
  getContent(author, permlink) { return chain.getContent(this.rpc, author, permlink); }
  getPost(author, permlink, observer = this.account || "") {
    return chain.getPost(this.rpc, { author, permlink, observer });
  }
  getRankedPosts(opts) { return chain.getRankedPosts(this.rpc, opts); }
  getAccountPosts(opts) { return chain.getAccountPosts(this.rpc, opts); }
  getProfile(account, observer = this.account || "") {
    return chain.getProfile(this.rpc, { account, observer });
  }
  getFollowCount(account) { return chain.getFollowCount(this.rpc, account); }
  getFollowers(account, start, type, limit) { return chain.getFollowers(this.rpc, account, start, type, limit); }
  getFollowing(account, start, type, limit) { return chain.getFollowing(this.rpc, account, start, type, limit); }
  getAccountHistory(account, start, limit) { return chain.getAccountHistory(this.rpc, account, start, limit); }

  // --- write pipeline ---
  requireKey(role) {
    const key = this.keys[role];
    if (!key) throw new Error(`waggle: no ${role} key configured`);
    return key;
  }

  // Build a transaction from operations using fresh TaPoS + expiration, sign it with the given
  // role key, and return the signed tx (ready to broadcast). `time` from the chain is ISO without
  // a 'Z'; expiration is that time + expirySeconds, ISO without milliseconds/'Z'.
  async buildAndSign(operations, role = "posting") {
    const key = this.requireKey(role);
    const { ref_block_num, ref_block_prefix, time } = await chain.getReferenceBlockData(this.rpc);
    const base = new Date(`${time}Z`).getTime();
    const expiration = new Date(base + this.expirySeconds * 1000).toISOString().slice(0, -5);
    const tx = { ref_block_num, ref_block_prefix, expiration, operations, extensions: [] };
    return signTransaction(tx, [key], this.chainId);
  }

  async broadcast(operations, role = "posting") {
    const tx = await this.buildAndSign(operations, role);
    await chain.broadcastTransaction(this.rpc, tx);
    return { id: transactionId(tx), tx };
  }

  async broadcastSync(operations, role = "posting") {
    const tx = await this.buildAndSign(operations, role);
    const result = await chain.broadcastTransactionSynchronous(this.rpc, tx);
    return { ...result, tx };
  }

  // --- high-level writes (posting key unless noted) ---
  vote({ author, permlink, weight = 10000, voter = this.account } = {}) {
    return this.broadcast([ops.vote({ voter, author, permlink, weight })]);
  }

  // post a top-level article. tags[0] becomes the category (parent_permlink). permlink defaults
  // to a slug of the title plus a uniquifier so re-posts don't collide.
  post({ title, body, tags = ["hive"], permlink, author = this.account, beneficiaries = [], json_metadata } = {}) {
    const slug = permlink || `${ops.slugify(title)}-${Date.now().toString(36)}`;
    const meta = json_metadata || { app: "waggle/0.0.0", format: "markdown", tags };
    const operations = [
      ops.comment({ parent_author: "", parent_permlink: tags[0], author, permlink: slug, title, body, json_metadata: meta }),
    ];
    if (beneficiaries.length) operations.push(ops.commentOptions({ author, permlink: slug, beneficiaries }));
    return this.broadcast(operations);
  }

  // reply to a post/comment. permlink defaults to the conventional re-... slug.
  comment({ parentAuthor, parentPermlink, body, author = this.account, permlink, json_metadata } = {}) {
    const slug = permlink || ops.commentPermlink(parentAuthor, parentPermlink, Date.now().toString(36));
    const meta = json_metadata || { app: "waggle/0.0.0", format: "markdown" };
    return this.broadcast([
      ops.comment({ parent_author: parentAuthor, parent_permlink: parentPermlink, author, permlink: slug, title: "", body, json_metadata: meta }),
    ]);
  }

  follow(following, follower = this.account) { return this.broadcast([ops.follow(follower, following)]); }
  unfollow(following, follower = this.account) { return this.broadcast([ops.unfollow(follower, following)]); }
  reblog({ author, permlink, account = this.account } = {}) { return this.broadcast([ops.reblog(account, author, permlink)]); }

  // transfer value — requires the ACTIVE key.
  transfer({ to, amount, memo = "", from = this.account } = {}) {
    return this.broadcast([ops.transfer({ from, to, amount, memo })], "active");
  }

  // claim all pending rewards for the configured account (reads the balances, then claims them).
  async claimRewards(account = this.account) {
    const acc = await this.getAccount(account);
    if (!acc) throw new Error(`waggle: account ${account} not found`);
    return this.broadcast([
      ops.claimRewardBalance({
        account,
        reward_hive: acc.reward_hive_balance,
        reward_hbd: acc.reward_hbd_balance,
        reward_vests: acc.reward_vesting_balance,
      }),
    ]);
  }

  // derive the public key for each configured role's private key (handy for confirming, once keys
  // are added, that they match what's registered on-chain for the account).
  publicKeys() {
    const out = {};
    for (const [role, key] of Object.entries(this.keys)) out[role] = key.createPublic().toString();
    return out;
  }
}

export default Waggle;
export { ops, PrivateKey };
