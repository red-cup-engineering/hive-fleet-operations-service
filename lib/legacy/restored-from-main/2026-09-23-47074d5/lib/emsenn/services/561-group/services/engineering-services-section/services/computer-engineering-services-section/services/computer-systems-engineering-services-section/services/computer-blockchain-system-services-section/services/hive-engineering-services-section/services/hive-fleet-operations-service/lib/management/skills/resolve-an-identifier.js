#!/usr/bin/env node
/**
 * @skill resolving-an-identifier
 * @verb-phrase resolving an identifier
 * @closure-kind process
 * @description Thin re-export of the published owner @561-group/resolving-an-identifier: resolveIdentifier and its parts (parseRef, findUnit, dataDir, readDataPool, appendDataRecord, findDataRecord, findGlobalPools, and the rest), plus the identical CLI. Kept as a same-directory file so this skill's sibling scripts (dispatch-a-task.js, list-open-obligations.js) keep resolving it with a relative import, and so `node resolve-an-identifier.js <ref>` still works from here — the resolution law itself lives once, at the owning package, never copied.
 *
 * @postcondition every export and the CLI behavior are exactly the owning package's — this file adds no logic of its own
 */
export * from "@561-group/resolving-an-identifier";
import { main } from "@561-group/resolving-an-identifier";

if (import.meta.url === `file://${process.argv[1]}`) main();
