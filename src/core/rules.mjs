// The fleet's operations are judged against the house's rules before they are signed: each
// wallet acts as `hive:<account>`, each operation as `hive:<operation name>`, and the rules the
// agency records state (this package's own lib/agency/rules, and every section's when the
// repository is present) decide whether it may proceed. With no rules readable the signer
// refuses, so a missing registry never signs an action the rules would have stopped.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agencyAt } from "@red-cup-engineering/organizing/agency/held";
import { judgeAction } from "@red-cup-engineering/organizing/agency/rules";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The agency root the rules are read from: METROPLAT_AGENCY_ROOT, the repository's `lib`, or this package. */
export function rulesRoot(env = process.env) {
  if (env.METROPLAT_AGENCY_ROOT) return env.METROPLAT_AGENCY_ROOT;
  for (let dir = PACKAGE_ROOT; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, ".git"))) return path.join(dir, "lib");
  }
  return PACKAGE_ROOT;
}

/** Judge one fleet operation; throws with the rules' own statements when it must not be signed. */
export function assertRulesPermit({ account, opName, opFields, decoded }, { root = rulesRoot() } = {}) {
  const registry = agencyAt(root);
  if ((registry.rules?.size ?? 0) === 0) throw new Error(`rules: no rules readable under ${root}; refusing to sign`);
  const judgment = judgeAction(registry, { actor: `hive:${account}`, verb: `hive:${opName}`, input: { ...opFields, ...(decoded === undefined ? {} : { decoded }) } });
  if (judgment.decision === "refuse") throw new Error(`rules: ${judgment.reasons.join("; ")}`);
  return judgment;
}
