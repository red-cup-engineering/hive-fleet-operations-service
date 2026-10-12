#!/usr/bin/env node
/**
 * @skill dispatching-a-task
 * @verb-phrase dispatching a task
 * @closure-kind process
 * @description Thin re-export of the published owner @561-group/dispatching-a-task: dispatch, officeSeats, seatedDispatches, repoRootFromArgv, and the identical CLI (--read, --list, --help, --dry-run). Kept as a same-directory file so this skill's sibling scripts keep resolving it here, and so `node dispatch-a-task.js` still works from this path — the dispatch verb itself lives once, at the owning package, never copied.
 *
 * @postcondition every export and the CLI behavior are exactly the owning package's — this file adds no logic of its own
 */
export * from "@561-group/dispatching-a-task";
import { main } from "@561-group/dispatching-a-task";

if (import.meta.url === `file://${process.argv[1]}`) main();
