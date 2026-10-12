/**
 * Type declarations for the waggle public API.
 *
 * Co-located with {@link ./client.mjs} so editors and the TypeScript language server
 * resolve it automatically (hover docs, signatures, autocomplete). Hand-authored because
 * waggle is a zero-dependency ES-module package with no build step.
 *
 * @packageDocumentation
 */

/** A signing role. Social actions use `posting`; value transfers use `active`. */
export type Role = "posting" | "active" | "owner" | "memo";

/** A WIF private key string, or an already-decoded {@link PrivateKey}. */
export type KeyInput = string | PrivateKey;

/** A Hive operation: a `[name, payload]` pair, as it goes into a transaction. */
export type Operation = [name: string, payload: Record<string, unknown>];

/** The TaPoS reference data derived from the chain head, used to anchor a transaction. */
export interface ReferenceBlockData {
  ref_block_num: number;
  ref_block_prefix: number;
  /** Chain head time, ISO 8601 without a trailing `Z`. */
  time: string;
}

/** A signed, broadcast-ready transaction. */
export interface SignedTransaction {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
  operations: Operation[];
  extensions: unknown[];
  signatures: string[];
}

/** The result of broadcasting: the transaction id and the signed transaction. */
export interface BroadcastResult {
  /** The transaction id (the ripemd160-truncated digest, hex). */
  id: string;
  tx: SignedTransaction;
}

/** Options for {@link Waggle}. All are optional; with no keys, only reads work. */
export interface WaggleOptions {
  /** Node base URLs to try, in order. Defaults to the curated built-in list. */
  nodes?: string[];
  /** Per-request timeout in milliseconds. */
  timeout?: number;
  /** An injectable transport (used by tests to avoid the network). */
  transport?: unknown;
  /** Default account: the author/voter/etc. for writes, and observer for reads. */
  account?: string;
  /** Private keys by role. Each may be a WIF string or a {@link PrivateKey}. */
  keys?: Partial<Record<Role, KeyInput>>;
  /** Override the chain id (defaults to Hive mainnet). */
  chainId?: string;
  /** Transaction lifetime in seconds before expiration (default 60). */
  expirySeconds?: number;
}

export interface VoteOptions {
  author: string;
  permlink: string;
  /** Vote weight in basis points, `-10000`..`10000`. Default `10000` (100%). */
  weight?: number;
  /** Voter; defaults to the configured account. */
  voter?: string;
}

export interface PostOptions {
  title: string;
  body: string;
  /** Tags; `tags[0]` becomes the category (parent permlink). Default `["hive"]`. */
  tags?: string[];
  /** Explicit permlink; defaults to a slug of the title plus a uniquifier. */
  permlink?: string;
  author?: string;
  beneficiaries?: Array<{ account: string; weight: number }>;
  json_metadata?: Record<string, unknown>;
}

export interface CommentOptions {
  parentAuthor: string;
  parentPermlink: string;
  body: string;
  author?: string;
  permlink?: string;
  json_metadata?: Record<string, unknown>;
}

export interface ReblogOptions {
  author: string;
  permlink: string;
  /** Reblogging account; defaults to the configured account. */
  account?: string;
}

export interface TransferOptions {
  to: string;
  /** Amount with symbol, e.g. `"1.000 HIVE"` or `"2.50 HBD"`. */
  amount: string;
  /** Plaintext memo (waggle does not encrypt memos). */
  memo?: string;
  from?: string;
}

export interface RankedPostsOptions {
  /** `trending` | `hot` | `created` | … */
  sort?: string;
  tag?: string;
  limit?: number;
  observer?: string;
}

export interface AccountPostsOptions {
  account: string;
  /** `blog` | `feed` | `posts` | `replies` */
  sort?: string;
  limit?: number;
  observer?: string;
}

/**
 * The waggle client: reads Hive and builds/signs/broadcasts transactions.
 *
 * Reads need no keys. Writes need the relevant role key supplied via {@link WaggleOptions.keys}.
 *
 * @example Reading (no keys)
 * ```js
 * const hive = new Waggle();
 * const [acct] = await hive.getAccounts(["hiveio"]);
 * ```
 *
 * @example Writing (posting key for social actions)
 * ```js
 * const me = new Waggle({ account: "alice", keys: { posting: process.env.POSTING_WIF } });
 * await me.vote({ author: "bob", permlink: "a-post", weight: 10000 });
 * ```
 */
export class Waggle {
  constructor(options?: WaggleOptions);

  /** The configured default account, if any. */
  account?: string;
  /** The configured chain id. */
  chainId: string;
  /** Decoded private keys by role. */
  keys: Partial<Record<Role, PrivateKey>>;

  // --- reads (no keys required) ---

  /** Dynamic global properties of the chain. */
  getDynamicGlobalProperties(): Promise<any>;
  /** TaPoS reference data derived from the chain head. */
  getReferenceBlockData(): Promise<ReferenceBlockData>;
  /** Account objects for the given names. */
  getAccounts(names: string[]): Promise<any[]>;
  /** A single account object, or `undefined` if not found. */
  getAccount(name: string): Promise<any>;
  /** A post or comment via `condenser_api.get_content`. */
  getContent(author: string, permlink: string): Promise<any>;
  /** A post via the bridge API. */
  getPost(author: string, permlink: string, observer?: string): Promise<any>;
  /** Ranked posts (trending/hot/created/…). */
  getRankedPosts(options: RankedPostsOptions): Promise<any[]>;
  /** An account's posts (blog/feed/posts/replies). */
  getAccountPosts(options: AccountPostsOptions): Promise<any[]>;
  /** An account's social profile. */
  getProfile(account: string, observer?: string): Promise<any>;
  /** Follower and following counts. */
  getFollowCount(account: string): Promise<any>;
  getFollowers(account: string, start: string | null, type: string, limit: number): Promise<any[]>;
  getFollowing(account: string, start: string | null, type: string, limit: number): Promise<any[]>;
  /** Account operation history. */
  getAccountHistory(account: string, start: number, limit: number): Promise<any[]>;

  // --- write pipeline ---

  /** Return the configured key for a role, or throw if it is missing. */
  requireKey(role: Role): PrivateKey;
  /** Build a transaction from operations with fresh TaPoS + expiration, and sign it. */
  buildAndSign(operations: Operation[], role?: Role): Promise<SignedTransaction>;
  /** Build, sign, and broadcast operations. Resolves once the node accepts the transaction. */
  broadcast(operations: Operation[], role?: Role): Promise<BroadcastResult>;
  /** As {@link Waggle.broadcast}, but waits for the synchronous broadcast result. */
  broadcastSync(operations: Operation[], role?: Role): Promise<BroadcastResult & Record<string, unknown>>;

  // --- high-level writes (posting key unless noted) ---

  /** Vote on a post. Posting key. */
  vote(options: VoteOptions): Promise<BroadcastResult>;
  /** Publish a top-level post. Posting key. */
  post(options: PostOptions): Promise<BroadcastResult>;
  /** Reply to a post or comment. Posting key. */
  comment(options: CommentOptions): Promise<BroadcastResult>;
  /** Follow an account. Posting key. */
  follow(following: string, follower?: string): Promise<BroadcastResult>;
  /** Unfollow an account. Posting key. */
  unfollow(following: string, follower?: string): Promise<BroadcastResult>;
  /** Reblog a post. Posting key. */
  reblog(options: ReblogOptions): Promise<BroadcastResult>;
  /** Transfer value. **Active key.** */
  transfer(options: TransferOptions): Promise<BroadcastResult>;
  /** Claim all pending rewards for the account. Posting key. */
  claimRewards(account?: string): Promise<BroadcastResult>;

  /** Derive the public key string for each configured role's private key. */
  publicKeys(): Partial<Record<Role, string>>;
}

/** A Hive private key (WIF). */
export class PrivateKey {
  static from(wif: string): PrivateKey;
  createPublic(): PublicKey;
  toString(): string;
}

/** A Hive public key (`STM…`). */
export class PublicKey {
  toString(): string;
}

/** Low-level operation builders (`vote`, `comment`, `transfer`, …). */
export const ops: Record<string, (...args: any[]) => Operation> & {
  slugify(title: string): string;
  commentPermlink(parentAuthor: string, parentPermlink: string, salt: string): string;
};

export default Waggle;
