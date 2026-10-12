// chain — Hive read methods + the TaPoS ref_block derivation (spec docs/dev/notes/03-rpc-read-spec.md §4).
// Every read function takes an RpcClient as its first arg and just calls `rpc.call(method, params)`.
// param STYLES follow spec §1: condenser_api = positional array, bridge/*_api = named object.

// deriveReferenceBlock — PURE, no rpc (spec §4.1).
// ref_block_num    = head_block_number & 0xffff
// ref_block_prefix = Buffer.from(head_block_id, 'hex').readUInt32LE(4)
// The head_block_id first 4 bytes are the block number big-endian; the next 4 bytes are read LE.
export function deriveReferenceBlock(head_block_number, head_block_id) {
  const ref_block_num = head_block_number & 0xffff;
  const ref_block_prefix = Buffer.from(head_block_id, "hex").readUInt32LE(4);
  return { ref_block_num, ref_block_prefix };
}

// 4.1 — condenser_api.get_dynamic_global_properties; params [] (no-arg condenser → empty array).
export async function getDynamicGlobalProperties(rpc) {
  return rpc.call("condenser_api.get_dynamic_global_properties", []);
}

// Read DGP then derive the TaPoS reference fields. `time` is the chain head time ISO string.
export async function getReferenceBlockData(rpc) {
  const dgp = await getDynamicGlobalProperties(rpc);
  const { ref_block_num, ref_block_prefix } = deriveReferenceBlock(
    dgp.head_block_number,
    dgp.head_block_id,
  );
  return {
    ref_block_num,
    ref_block_prefix,
    time: dgp.time,
    head_block_number: dgp.head_block_number,
  };
}

// 4.2 — condenser_api.get_accounts; params [[...names]] (double-bracket, positional).
export async function getAccounts(rpc, names) {
  return rpc.call("condenser_api.get_accounts", [[...names]]);
}

// 4.5 — condenser_api.get_content; params [author, permlink] (positional).
export async function getContent(rpc, author, permlink) {
  return rpc.call("condenser_api.get_content", [author, permlink]);
}

// 4.5 — bridge.get_post; named object.
export async function getPost(rpc, { author, permlink, observer }) {
  return rpc.call("bridge.get_post", { author, permlink, observer });
}

// 4.6 — bridge.get_ranked_posts; named object.
export async function getRankedPosts(
  rpc,
  { sort, tag = "", observer = "", limit, start_author, start_permlink },
) {
  return rpc.call("bridge.get_ranked_posts", {
    sort,
    tag,
    observer,
    limit,
    start_author,
    start_permlink,
  });
}

// 4.7 — bridge.get_account_posts; named object.
export async function getAccountPosts(
  rpc,
  { sort, account, observer = "", limit, start_author, start_permlink },
) {
  return rpc.call("bridge.get_account_posts", {
    sort,
    account,
    observer,
    limit,
    start_author,
    start_permlink,
  });
}

// 4.8 — bridge.get_profile; named object.
export async function getProfile(rpc, { account, observer = "" }) {
  return rpc.call("bridge.get_profile", { account, observer });
}

// 4.9 — condenser_api.get_follow_count; params [account] (positional).
export async function getFollowCount(rpc, account) {
  return rpc.call("condenser_api.get_follow_count", [account]);
}

// 4.10 — condenser_api.get_followers; params [account, start, type, limit] (positional).
export async function getFollowers(rpc, account, start = null, type = "blog", limit = 100) {
  return rpc.call("condenser_api.get_followers", [account, start, type, limit]);
}

// 4.10 — condenser_api.get_following; params [account, start, type, limit] (positional).
export async function getFollowing(rpc, account, start = null, type = "blog", limit = 100) {
  return rpc.call("condenser_api.get_following", [account, start, type, limit]);
}

// 4.3 — condenser_api.get_account_history; params [account, start, limit] (positional).
export async function getAccountHistory(rpc, account, start = -1, limit = 100) {
  return rpc.call("condenser_api.get_account_history", [account, start, limit]);
}

// 4.4 — condenser_api.broadcast_transaction; params [tx]. Result {} on mempool accept.
export async function broadcastTransaction(rpc, tx) {
  return rpc.call("condenser_api.broadcast_transaction", [tx]);
}

// 4.4 — condenser_api.broadcast_transaction_synchronous; params [tx]. Result { id, block_num, ... }.
export async function broadcastTransactionSynchronous(rpc, tx) {
  return rpc.call("condenser_api.broadcast_transaction_synchronous", [tx]);
}
