import { readFileSync } from "node:fs";

import { compileRmlLaw } from "@emsenn/rmn-semantic-conformance/law";

export const HIVE_FLEET_CUSTODY_OBSERVATION_LAW = compileRmlLaw(
  readFileSync(new URL("../content/contracts/hive-fleet-custody-observation-service.rml", import.meta.url), "utf8"),
);

export const HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT = HIVE_FLEET_CUSTODY_OBSERVATION_LAW.id;
