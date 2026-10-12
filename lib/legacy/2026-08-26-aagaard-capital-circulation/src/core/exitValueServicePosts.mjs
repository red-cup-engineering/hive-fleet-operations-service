import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXIT_VALUE_MERCHANT = Object.freeze({ kind: "merchant", account: "help-fund",
  lane: "merchant-offer-publication", permlink: "hive-engine-exit-value-report-pilot",
  target: "help-fund/hive-engine-exit-value-report-pilot", title: "Hive Engine exit-value certificate: five-report pilot",
  bodySha256: "e7695c01b5051455f7d35c8f41539f51b2553d535211fc7867c3acf662790f09",
  source: new URL("../../content/documents/articles/notes/2026/07/22/2026-07-22-hive-engine-exit-value-report-pilot.md", import.meta.url) });
export const EXIT_VALUE_EDITORIAL = Object.freeze({ kind: "editorial", account: "sigmund-vexler",
  lane: "editorial-publication", permlink: "your-hive-engine-balance-is-not-your-exit-value",
  target: "sigmund-vexler/your-hive-engine-balance-is-not-your-exit-value", title: "Your Hive Engine balance is not your exit value",
  bodySha256: "71d6c929831641984f9d5f825aa9831c29d969734141f09cec36637b1c3517c6",
  source: new URL("../../content/documents/articles/notes/2026/07/22/2026-07-22-your-hive-engine-balance-is-not-your-exit-value-sigmund.md", import.meta.url) });
export const EXIT_VALUE_POSTS = Object.freeze({ merchant: EXIT_VALUE_MERCHANT, editorial: EXIT_VALUE_EDITORIAL });
const METADATA = JSON.stringify({ tags: ["hive-engine", "trading", "hive", "web3"], app: "aagaard/0.1.0", format: "markdown" });

function exactKeys(value, keys) { return value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function sourceOf(spec) { const raw = readFileSync(spec.source, "utf8").replaceAll("\r\n", "\n").trimEnd(); const lines = raw.split("\n");
  if (lines[0] !== `# ${spec.title}` || lines[1] !== "") throw new Error(`${spec.kind} post title carrier changed`);
  const body = lines.slice(2).join("\n"); const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== spec.bodySha256) throw new Error(`${spec.kind} post body changed without signer review`);
  if (Buffer.byteLength(body, "utf8") > 65_535) throw new Error(`${spec.kind} post exceeds Hive's comment body bound`);
  return Object.freeze({ body, digest }); }

export function exitValueServiceComment(kind) {
  const spec = EXIT_VALUE_POSTS[kind]; if (!spec) throw new TypeError("service publication kind must be merchant or editorial");
  const source = sourceOf(spec); return Object.freeze({ parent_author: "", parent_permlink: "hive-engine",
    author: spec.account, permlink: spec.permlink, title: spec.title, body: source.body, json_metadata: METADATA });
}

export function assertExactExitValueServicePost({ account, role, lane, target, fields }) {
  const spec = Object.values(EXIT_VALUE_POSTS).find((candidate) => candidate.account === account && candidate.lane === lane);
  if (!spec || role !== "posting" || target !== spec.target
    || !exactKeys(fields, ["parent_author", "parent_permlink", "author", "permlink", "title", "body", "json_metadata"])) {
    throw new TypeError("exit-value publication requires one exact assigned publisher or merchant post");
  }
  const expected = exitValueServiceComment(spec.kind);
  if (!Object.keys(expected).every((key) => fields[key] === expected[key])) {
    throw new TypeError("exit-value publication content, author, permlink, metadata, or role changed");
  }
  return spec.kind;
}

export function exitValueMerchantOffer() { return Object.freeze({ kind: "aagaard.exit-value-service-offer",
  merchant: "help-fund", target: EXIT_VALUE_MERCHANT.target, requestLocation: `https://hive.blog/@${EXIT_VALUE_MERCHANT.target}`,
  terms: Object.freeze({ price: "0.250 HBD", maximumPaidReports: 5, invoiceBeforePayment: true,
    paymentAccount: "help-fund", revenueBeforeSettledPayment: "0.000 HBD" }) }); }
