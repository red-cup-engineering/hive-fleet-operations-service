import { readFileSync } from "node:fs";

import { parseRml } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";

export const HIVE_FLEET_CUSTODY_OBSERVATION_LAW = parseRml(
  readFileSync(new URL("../content/contracts/hive-fleet-custody-observation-service.rml", import.meta.url), "utf8"),
);

export const HIVE_FLEET_CUSTODY_OBSERVATION_CONTRACT = semanticId(HIVE_FLEET_CUSTODY_OBSERVATION_LAW);
