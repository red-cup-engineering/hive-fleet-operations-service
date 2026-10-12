export interface PublishExitValueOptions { readonly kind: "merchant" | "editorial"; readonly keyFile: string; readonly executeOne: boolean; readonly settleTx: string; }
export function parseOptions(argv: readonly string[]): PublishExitValueOptions;
export function exactServicePublicationOperation(kind: "merchant" | "editorial", operation: unknown): boolean;
export function operate(options: PublishExitValueOptions): Promise<Readonly<Record<string, unknown>>>;
