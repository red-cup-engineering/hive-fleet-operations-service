import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const EXIT_TIGHTNESS_PILOT_ACCOUNT = "emsenn0";
export const EXIT_TIGHTNESS_PILOT_PERMLINK = "your-hive-engine-balance-is-not-your-exit-value";
export const EXIT_TIGHTNESS_PILOT_TARGET = `${EXIT_TIGHTNESS_PILOT_ACCOUNT}/${EXIT_TIGHTNESS_PILOT_PERMLINK}`;
export const EXIT_TIGHTNESS_PILOT_BODY_SHA256 = "c3b7a052484898dabf17c766663e9971222a9c42642527a4037bdabfa7176003";
export const EXIT_TIGHTNESS_PILOT_PRICE = "0.250 HBD";
export const EXIT_TIGHTNESS_PILOT_MAX_REPORTS = 5;

const ARTICLE = new URL("../../content/documents/articles/notes/2026/07/22/2026-07-22-your-hive-engine-balance-is-not-your-exit-value.md", import.meta.url);
const TITLE = "Your Hive Engine balance is not your exit value";
const METADATA = JSON.stringify({
  tags: ["hive-engine", "trading", "hive", "web3"],
  app: "aagaard/0.1.0",
  format: "markdown",
});

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function article() {
  const raw = readFileSync(ARTICLE, "utf8").replaceAll("\r\n", "\n").trimEnd();
  const lines = raw.split("\n");
  if (lines[0] !== `# ${TITLE}` || lines[1] !== "") throw new Error("exit-tightness pilot article title carrier changed");
  const body = lines.slice(2).join("\n");
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== EXIT_TIGHTNESS_PILOT_BODY_SHA256) throw new Error("exit-tightness pilot article body changed without signer review");
  if (Buffer.byteLength(body, "utf8") > 65_535) throw new Error("exit-tightness pilot article exceeds the Hive comment body bound");
  return Object.freeze({ title: TITLE, body, bodySha256: digest });
}

export function exitTightnessPilotComment() {
  const source = article();
  return Object.freeze({
    parent_author: "",
    parent_permlink: "hive-engine",
    author: EXIT_TIGHTNESS_PILOT_ACCOUNT,
    permlink: EXIT_TIGHTNESS_PILOT_PERMLINK,
    title: source.title,
    body: source.body,
    json_metadata: METADATA,
  });
}

export function assertExactExitTightnessPilotPost({ account, role, lane, target, fields }) {
  const expected = exitTightnessPilotComment();
  const admitted = account === EXIT_TIGHTNESS_PILOT_ACCOUNT
    && role === "posting"
    && lane === "product-pilot"
    && target === EXIT_TIGHTNESS_PILOT_TARGET
    && exactKeys(fields, ["parent_author", "parent_permlink", "author", "permlink", "title", "body", "json_metadata"])
    && Object.keys(expected).every((key) => fields[key] === expected[key]);
  if (!admitted) throw new Error("exit-tightness pilot post requires the one exact reviewed article, author, permlink, metadata, and posting lane");
  return true;
}

export function exitTightnessPilotOffer() {
  const source = article();
  return Object.freeze({
    kind: "aagaard.exit-tightness-product-pilot-offer",
    account: EXIT_TIGHTNESS_PILOT_ACCOUNT,
    target: EXIT_TIGHTNESS_PILOT_TARGET,
    bodySha256: source.bodySha256,
    terms: Object.freeze({
      price: EXIT_TIGHTNESS_PILOT_PRICE,
      maximumPaidReports: EXIT_TIGHTNESS_PILOT_MAX_REPORTS,
      paymentAsset: "HBD",
      invoiceBeforePayment: true,
      revenueBeforeSettledPayment: "0.000 HBD",
    }),
  });
}
