#!/usr/bin/env node
/**
 * @skill listing-open-obligations
 * @verb-phrase listing open obligations
 * @closure-kind process
 * @description Thin re-export of the published owner @561-group/listing-open-obligations: listOpenObligations, officeSeats, and the identical CLI. Kept as a same-directory file so `node list-open-obligations.js` still works from this path — the obligations query itself lives once, at the owning package, never copied.
 *
 * @postcondition every export and the CLI behavior are exactly the owning package's — this file adds no logic of its own
 */
export * from "@561-group/listing-open-obligations";
import { main } from "@561-group/listing-open-obligations";

if (import.meta.url === `file://${process.argv[1]}`) main();
