#!/usr/bin/env node
import process from "node:process";
import { start, installGracefulShutdown } from "@561-group/web-server";
import { createAagaardApp, DEFAULT_PORT } from "./index.ts";

const host = process.env["HOST"] ?? "127.0.0.1";
const port = envPort(process.env["PORT"]) ?? DEFAULT_PORT;

const app = createAagaardApp();
const result = await start(app, { host, port });
installGracefulShutdown(result);
process.stdout.write(`Aagaard (propolis) listening at http://${host}:${result.port}/\n`);
await new Promise<never>(() => {});

function envPort(value: string | undefined): number | undefined {
  if (!value || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
