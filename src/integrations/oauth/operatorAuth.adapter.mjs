// Aagaard's operator authority: the house's one authorization server, with who the operator is
// decided here. With a Google client the operator signs in with Google (only the allowed address,
// through the web server's admission); without one, an operator token (AAGAARD_OPS_TOKEN) is the
// credential; with neither and auth not required, local development runs open. The operator UI is
// the server's own origin, so its authorization needs no consent page.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { createWebAdmissionApplication } from "@red-cup-engineering/computer-web-server/admission/application";
import { createAuthorizationServer, createJsonFileGrantStore } from "@red-cup-engineering/oauth-services-section/authorization-server";

const text = (value) => (typeof value === "string" ? value.trim() : "");
const bearer = (headers) => /^Bearer\s+(.+)$/iu.exec(headers?.authorization ?? headers?.Authorization ?? "")?.[1]?.trim() ?? "";
const same = (left, right) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));

/** A handler's representation as a Web Response (the admission already answers with Responses). */
function responseOf(value) {
  if (value instanceof Response) return value;
  const headers = new Headers(value.headers ?? {});
  if (value.type && !headers.has("content-type")) headers.set("content-type", value.type);
  if (value.cacheControl?.noStore) headers.set("cache-control", "no-store");
  return new Response(value.status === 204 || value.status === 302 ? null : value.body ?? "", { status: value.status ?? 200, headers });
}

/**
 * @param {{ publicBaseUrl: string, opsToken?: string, allowedEmail: string, openWhenUnconfigured?: boolean,
 *   google?: { clientId?: string, clientSecret?: string }, sessionSecret?: string, stateDir?: string, grantStoreProfile?: string }} options
 */
export function createOperatorAuth(options) {
  const publicBaseUrl = new URL(options.publicBaseUrl).href.replace(/\/$/u, "");
  const grantStore = options.stateDir === undefined ? undefined : createJsonFileGrantStore(join(options.stateDir, "oauth"), { profile: options.grantStoreProfile });
  if (options.grantStoreProfile !== undefined && grantStore?.profile !== options.grantStoreProfile) throw new TypeError("requested OAuth grant custody profile is unavailable");
  const opsToken = text(options.opsToken);
  const googleClientId = text(options.google?.clientId);
  const googleClientSecret = text(options.google?.clientSecret);
  const mode = googleClientId !== "" && googleClientSecret !== "" ? "google" : opsToken === "" && options.openWhenUnconfigured ? "open" : "bearer";
  const challenge = `Bearer realm="aagaard", resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`;
  const admission = mode !== "google" ? undefined : createWebAdmissionApplication({
    realm: new URL(publicBaseUrl).host,
    providers: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        sessionSecret: options.sessionSecret ?? randomBytes(32).toString("base64url"),
        allowedEmails: options.allowedEmail,
        publicBaseUrl,
        sessionCookie: "aagaard_session",
        transactionCookie: "aagaard_google",
      },
    },
  });
  const server = createAuthorizationServer({
    issuer: publicBaseUrl,
    name: new URL(publicBaseUrl).host,
    resources: [`${publicBaseUrl}/ops`],
    ...(grantStore === undefined ? {} : { store: grantStore }),
    authenticate: async (ctx) => {
      if (mode === "open") return { subject: "local-operator" };
      if (mode === "bearer") {
        const offered = ctx.url.searchParams.get("operator_token") ?? "";
        return offered !== "" && same(offered, opsToken) ? { subject: options.allowedEmail } : undefined;
      }
      const principal = await admission.identifyContext({ ...ctx, locals: {} });
      return principal?.email === undefined ? undefined : { subject: principal.email, email: principal.email };
    },
    loginUrl: (returnTo) => (mode === "google" ? `/oauth/login?return_to=${encodeURIComponent(returnTo)}` : "/ui"),
  });
  const resources = [...server.app.resources, ...(admission?.resources ?? [])];

  return Object.freeze({
    publicBaseUrl,
    allowedEmail: options.allowedEmail,
    mode,
    challenge,
    server,
    /** The OAuth and sign-in routes, answered as Web Responses; undefined for any other request. */
    async handle(request) {
      const url = new URL(request.url);
      const found = resources.find((resource) => resource.match === url.pathname && (resource.methods ?? ["GET"]).includes(request.method));
      if (found === undefined) return undefined;
      return responseOf(await found.handler({ request, url, locals: {}, trace: { id: "aagaard" } }));
    },
    /** Whether a request to the operator plane is authorized, and as whom. */
    async authorize(headers) {
      if (mode === "open") return Object.freeze({ ok: true, status: 200, reason: "operator auth open for local development", principal: "local-operator" });
      const secret = bearer(headers);
      if (secret === "") return Object.freeze({ ok: false, status: 401, reason: "bearer token required", challenge });
      const claims = await server.verifyToken(secret);
      if (claims !== undefined) return Object.freeze({ ok: true, status: 200, reason: "issued access token accepted", principal: claims.subject });
      if (opsToken !== "" && same(secret, opsToken)) return Object.freeze({ ok: true, status: 200, reason: "operator bearer token accepted", principal: options.allowedEmail });
      return Object.freeze({ ok: false, status: 403, reason: "bearer token rejected", challenge });
    },
  });
}
