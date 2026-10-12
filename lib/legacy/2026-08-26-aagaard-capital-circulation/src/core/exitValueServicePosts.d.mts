export interface ExitValuePostSpec { readonly kind: "merchant" | "editorial"; readonly account: "help-fund" | "sigmund-vexler";
  readonly lane: "merchant-offer-publication" | "editorial-publication"; readonly permlink: string; readonly target: string;
  readonly title: string; readonly bodySha256: string; readonly source: URL; }
export const EXIT_VALUE_MERCHANT: ExitValuePostSpec;
export const EXIT_VALUE_EDITORIAL: ExitValuePostSpec;
export const EXIT_VALUE_POSTS: Readonly<{ merchant: ExitValuePostSpec; editorial: ExitValuePostSpec }>;
export function exitValueServiceComment(kind: "merchant" | "editorial"): Readonly<Record<string, string>>;
export function assertExactExitValueServicePost(input: Readonly<{ account: string; role: string; lane: string; target: string;
  fields: Readonly<Record<string, unknown>> }>): "merchant" | "editorial";
export function exitValueMerchantOffer(): Readonly<{ kind: "aagaard.exit-value-service-offer"; merchant: "help-fund"; target: string;
  requestLocation: string; terms: Readonly<{ price: "0.250 HBD"; maximumPaidReports: 5; invoiceBeforePayment: true;
    paymentAccount: "help-fund"; revenueBeforeSettledPayment: "0.000 HBD" }> }>;
