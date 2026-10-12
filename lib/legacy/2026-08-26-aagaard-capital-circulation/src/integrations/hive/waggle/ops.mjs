// ops — high-level operation builders. Each returns a `[name, payload]` pair ready to drop into
// a transaction's `operations` array. Pure: no network, no signing. Field shapes follow
// docs/dev/notes/02-serialization-spec.md §7.

import { slugify as slugifyText } from "../../../../../../../../../../../../../../computer-data-engineering-services-section/services/computer-content-engineering-services-section/services/computer-text-content-engineering-services-section/src/slugify-text.mjs";

// A vote. weight is in basis points: 10000 = 100% up, -10000 = 100% down, 0 = unvote.
export const vote = ({ voter, author, permlink, weight = 10000 }) => [
  "vote",
  { voter, author, permlink, weight },
];

// A comment. A top-level post is a comment with empty parent_author and the first tag as
// parent_permlink (see `post`). json_metadata is stringified if given as an object.
export const comment = ({
  parent_author = "",
  parent_permlink,
  author,
  permlink,
  title = "",
  body,
  json_metadata = {},
}) => [
  "comment",
  {
    parent_author,
    parent_permlink,
    author,
    permlink,
    title,
    body,
    json_metadata:
      typeof json_metadata === "string" ? json_metadata : JSON.stringify(json_metadata),
  },
];

// comment_options. beneficiaries is [{ account, weight }] (weight in basis points); when present
// it is encoded as the beneficiaries extension (variant id 0).
export const commentOptions = ({
  author,
  permlink,
  max_accepted_payout = "1000000.000 HBD",
  percent_hbd = 10000,
  allow_votes = true,
  allow_curation_rewards = true,
  beneficiaries = [],
}) => {
  const extensions = beneficiaries.length
    ? [[0, { beneficiaries: beneficiaries.map((b) => ({ account: b.account, weight: b.weight })) }]]
    : [];
  return [
    "comment_options",
    { author, permlink, max_accepted_payout, percent_hbd, allow_votes, allow_curation_rewards, extensions },
  ];
};

export const transfer = ({ from, to, amount, memo = "" }) => [
  "transfer",
  { from, to, amount, memo },
];

export const transferToVesting = ({ from, to, amount }) => [
  "transfer_to_vesting",
  { from, to, amount },
];

export const deleteComment = ({ author, permlink }) => [
  "delete_comment",
  { author, permlink },
];

export const claimRewardBalance = ({ account, reward_hive, reward_hbd, reward_vests }) => [
  "claim_reward_balance",
  { account, reward_hive, reward_hbd, reward_vests },
];

// custom_json. `json` may be an object/array (stringified) or a pre-stringified string.
export const customJson = ({
  id,
  json,
  required_auths = [],
  required_posting_auths = [],
}) => [
  "custom_json",
  {
    required_auths,
    required_posting_auths,
    id,
    json: typeof json === "string" ? json : JSON.stringify(json),
  },
];

// follow / unfollow / reblog are custom_json with id "follow", authorized by the posting key.
export const follow = (follower, following) =>
  customJson({
    id: "follow",
    required_posting_auths: [follower],
    json: ["follow", { follower, following, what: ["blog"] }],
  });

export const unfollow = (follower, following) =>
  customJson({
    id: "follow",
    required_posting_auths: [follower],
    json: ["follow", { follower, following, what: [] }],
  });

export const reblog = (account, author, permlink) =>
  customJson({
    id: "follow",
    required_posting_auths: [account],
    json: ["reblog", { account, author, permlink }],
  });

// --- permlink helpers (see 03-rpc-read-spec.md §5) ---

// Slugify a title into a permlink-safe string: lowercase, [a-z0-9-], runs collapsed, trimmed.
export const slugify = (title) => slugifyText(String(title)).slice(0, 256);

// A unique reply permlink: re-<parentAuthor>-<parentPermlink>-<timestamp-ish>. Caller supplies a
// uniquifier (e.g. a date string or random token) so this stays pure/deterministic for tests.
export const commentPermlink = (parentAuthor, parentPermlink, uniq) =>
  slugify(`re-${parentAuthor}-${parentPermlink}-${uniq}`);
