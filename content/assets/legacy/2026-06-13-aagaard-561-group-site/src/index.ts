// aagaard — propolis demo site at aagaard.561.group
import { createPropolisApp } from "@561-group/propolis";
import type { App } from "@561-group/web-server";

export const DEFAULT_PORT = 18801;
export const SITE_DOMAIN = "aagaard.561.group";

export interface AagaardConfig {
  readonly nodes?: readonly string[] | undefined;
  readonly swarmEnabled?: boolean | undefined;
}

export function createAagaardApp(config: AagaardConfig = {}): App {
  return createPropolisApp(config);
}
