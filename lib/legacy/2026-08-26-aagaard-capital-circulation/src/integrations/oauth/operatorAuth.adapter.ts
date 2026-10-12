import { createHash, randomBytes } from "node:crypto";

export interface OperatorAuthOptions {
  readonly publicBaseUrl: string;
  readonly opsToken: string;
  readonly allowedEmail: string;
  readonly openWhenUnconfigured: boolean;
  readonly google?: GoogleIdentityOptions;
}

export interface GoogleIdentityOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly discoveryUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface AuthorizationDecision {
  readonly ok: boolean;
  readonly status: 200 | 401 | 403;
  readonly reason: string;
  readonly principal?: string;
  readonly challenge?: string;
}

export interface RegisteredClient {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method: "none";
}

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly scope: "ops";
  readonly principal: string;
}

export interface OperatorAuth {
  readonly publicBaseUrl: string;
  readonly allowedEmail: string;
  readonly mode: "bearer" | "open" | "google";
  readonly challenge: string;
  authorize(headers: Record<string, string | readonly string[] | undefined>): AuthorizationDecision;
  registerClient(input: Readonly<Record<string, unknown>>): RegisteredClient;
  authorizeUrl(input: URLSearchParams): Promise<{ readonly ok: true; readonly redirect: string } | { readonly ok: false; readonly status: 400 | 401 | 403; readonly error: string; readonly challenge?: string }>;
  authorizeCallback(input: URLSearchParams): Promise<{ readonly ok: true; readonly redirect: string } | { readonly ok: false; readonly status: 400 | 401 | 403; readonly error: string; readonly challenge?: string }>;
  exchangeToken(input: URLSearchParams): TokenResponse | { readonly error: string; readonly status: 400 | 401 };
  revokeToken(input: URLSearchParams): { readonly revoked: boolean };
  authorizationServerMetadata(): Readonly<Record<string, unknown>>;
  protectedResourceMetadata(): Readonly<Record<string, unknown>>;
}

interface AuthorizationCode {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly expiresAt: number;
  readonly principal: string;
}

interface PendingGoogleAuthorization {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly expiresAt: number;
  readonly state?: string;
}

interface AccessToken {
  readonly token: string;
  readonly principal: string;
  readonly expiresAt: number;
}

interface GoogleDiscovery {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly userinfo_endpoint: string;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function s256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? Object.freeze(value.filter((entry): entry is string => typeof entry === "string" && entry !== "")) : Object.freeze([]);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function headerValue(headers: Record<string, string | readonly string[] | undefined>, name: string): string {
  const found = headers[name] ?? headers[name.toLowerCase()];
  if (typeof found === "string") return found;
  return Array.isArray(found) ? found[0] ?? "" : "";
}

function bearer(headers: Record<string, string | readonly string[] | undefined>): string {
  const authorization = headerValue(headers, "authorization");
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

function validRedirect(client: RegisteredClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri);
}

export function createOperatorAuth(options: OperatorAuthOptions): OperatorAuth {
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl);
  const opsToken = options.opsToken.trim();
  const googleClientId = options.google?.clientId.trim() ?? "";
  const googleClientSecret = options.google?.clientSecret.trim() ?? "";
  const googleEnabled = googleClientId !== "" && googleClientSecret !== "";
  const mode: OperatorAuth["mode"] = googleEnabled ? "google" : opsToken === "" && options.openWhenUnconfigured ? "open" : "bearer";
  const resourceMetadata = `${publicBaseUrl}/.well-known/oauth-protected-resource`;
  const challenge = `Bearer realm="aagaard", resource_metadata="${resourceMetadata}"`;
  const clients = new Map<string, RegisteredClient>();
  const codes = new Map<string, AuthorizationCode>();
  const pendingGoogle = new Map<string, PendingGoogleAuthorization>();
  const accessTokens = new Map<string, AccessToken>();
  const tokenTtlMs = 3_600_000;
  const codeTtlMs = 300_000;
  const googleFetch = options.google?.fetch ?? fetch;
  const googleDiscoveryUrl = options.google?.discoveryUrl ?? "https://accounts.google.com/.well-known/openid-configuration";
  let googleDiscovery: Promise<GoogleDiscovery> | undefined;

  function acceptOperatorSecret(secret: string): boolean {
    return mode === "open" || (opsToken !== "" && secret === opsToken);
  }

  function issuedToken(secret: string): AccessToken | undefined {
    const row = accessTokens.get(secret);
    if (!row) return undefined;
    if (row.expiresAt <= Date.now()) {
      accessTokens.delete(secret);
      return undefined;
    }
    return row;
  }

  async function discoverGoogle(): Promise<GoogleDiscovery> {
    googleDiscovery ??= googleFetch(googleDiscoveryUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Google discovery failed: ${response.status}`);
      const body = record(await response.json());
      const authorizationEndpoint = text(body["authorization_endpoint"]);
      const tokenEndpoint = text(body["token_endpoint"]);
      const userinfoEndpoint = text(body["userinfo_endpoint"]);
      if (!authorizationEndpoint || !tokenEndpoint || !userinfoEndpoint) throw new Error("Google discovery document is missing OAuth endpoints");
      return Object.freeze({ authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, userinfo_endpoint: userinfoEndpoint });
    });
    return googleDiscovery;
  }

  function validateClientRequest(input: URLSearchParams): { readonly ok: true; readonly client: RegisteredClient; readonly redirectUri: string; readonly codeChallenge: string } | { readonly ok: false; readonly status: 400; readonly error: string } {
    const clientId = input.get("client_id") ?? "";
    const client = clients.get(clientId);
    if (!client) return Object.freeze({ ok: false, status: 400 as const, error: "unknown client_id" });
    const redirectUri = input.get("redirect_uri") ?? "";
    if (!validRedirect(client, redirectUri)) return Object.freeze({ ok: false, status: 400 as const, error: "redirect_uri not registered" });
    if (input.get("response_type") !== "code") return Object.freeze({ ok: false, status: 400 as const, error: "expected response_type=code" });
    const codeChallenge = input.get("code_challenge") ?? "";
    if (codeChallenge === "" || input.get("code_challenge_method") !== "S256") return Object.freeze({ ok: false, status: 400 as const, error: "expected S256 PKCE challenge" });
    return Object.freeze({ ok: true as const, client, redirectUri, codeChallenge });
  }

  function mintCode(input: { readonly clientId: string; readonly redirectUri: string; readonly codeChallenge: string; readonly principal: string; readonly state?: string }): string {
    const code = token(24);
    codes.set(code, Object.freeze({ code, clientId: input.clientId, redirectUri: input.redirectUri, codeChallenge: input.codeChallenge, expiresAt: Date.now() + codeTtlMs, principal: input.principal }));
    const target = new URL(input.redirectUri);
    target.searchParams.set("code", code);
    if (input.state) target.searchParams.set("state", input.state);
    return target.toString();
  }

  async function googlePrincipal(input: URLSearchParams): Promise<{ readonly ok: true; readonly email: string } | { readonly ok: false; readonly status: 401 | 403; readonly error: string }> {
    const code = input.get("code") ?? "";
    if (code === "") return Object.freeze({ ok: false as const, status: 401 as const, error: "Google authorization code missing" });
    const discovery = await discoverGoogle();
    const form = new URLSearchParams({
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: `${publicBaseUrl}/oauth/callback`,
      grant_type: "authorization_code",
    });
    const tokenResponse = await googleFetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!tokenResponse.ok) return Object.freeze({ ok: false as const, status: 401 as const, error: "Google token exchange rejected" });
    const tokenBody = record(await tokenResponse.json());
    const accessToken = text(tokenBody["access_token"]);
    if (accessToken === "") return Object.freeze({ ok: false as const, status: 401 as const, error: "Google access token missing" });
    const userResponse = await googleFetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!userResponse.ok) return Object.freeze({ ok: false as const, status: 401 as const, error: "Google userinfo rejected" });
    const user = record(await userResponse.json());
    const email = text(user["email"]);
    const verified = user["email_verified"];
    if (email !== options.allowedEmail) return Object.freeze({ ok: false as const, status: 403 as const, error: "Google email not allowed" });
    if (verified === false || verified === "false") return Object.freeze({ ok: false as const, status: 403 as const, error: "Google email not verified" });
    return Object.freeze({ ok: true as const, email });
  }

  return Object.freeze({
    publicBaseUrl,
    allowedEmail: options.allowedEmail,
    mode,
    challenge,
    authorize(headers: Record<string, string | readonly string[] | undefined>) {
      if (mode === "open") return Object.freeze({ ok: true, status: 200, reason: "operator auth open for local development", principal: "local-operator" });
      const secret = bearer(headers);
      if (secret === "") return Object.freeze({ ok: false, status: 401, reason: "bearer token required", challenge });
      const issued = issuedToken(secret);
      if (issued) return Object.freeze({ ok: true, status: 200, reason: "issued access token accepted", principal: issued.principal });
      if (secret === opsToken) return Object.freeze({ ok: true, status: 200, reason: "operator bearer token accepted", principal: options.allowedEmail });
      return Object.freeze({ ok: false, status: 403, reason: "bearer token rejected", challenge });
    },
    registerClient(input: Readonly<Record<string, unknown>>) {
      const redirectUris = strings(input["redirect_uris"]);
      const client = Object.freeze({
        client_id: `aagaard-client-${token(18)}`,
        client_name: text(input["client_name"], "aagaard-client"),
        redirect_uris: redirectUris.length > 0 ? redirectUris : Object.freeze([`${publicBaseUrl}/ui`]),
        token_endpoint_auth_method: "none" as const,
      });
      clients.set(client.client_id, client);
      return client;
    },
    async authorizeUrl(input: URLSearchParams) {
      const valid = validateClientRequest(input);
      if (!valid.ok) return valid;
      if (mode === "google") {
        const discovery = await discoverGoogle();
        const googleState = token(24);
        pendingGoogle.set(googleState, Object.freeze({ clientId: valid.client.client_id, redirectUri: valid.redirectUri, codeChallenge: valid.codeChallenge, expiresAt: Date.now() + codeTtlMs, ...(input.get("state") ? { state: input.get("state")! } : {}) }));
        const target = new URL(discovery.authorization_endpoint);
        target.searchParams.set("response_type", "code");
        target.searchParams.set("client_id", googleClientId);
        target.searchParams.set("redirect_uri", `${publicBaseUrl}/oauth/callback`);
        target.searchParams.set("scope", "openid email profile");
        target.searchParams.set("state", googleState);
        return Object.freeze({ ok: true as const, redirect: target.toString() });
      }
      if (!acceptOperatorSecret(input.get("operator_token") ?? "")) return Object.freeze({ ok: false, status: mode === "open" ? 400 as const : 401 as const, error: "operator authorization required", challenge });
      return Object.freeze({ ok: true as const, redirect: mintCode({ clientId: valid.client.client_id, redirectUri: valid.redirectUri, codeChallenge: valid.codeChallenge, principal: mode === "open" ? "local-operator" : options.allowedEmail, ...(input.get("state") ? { state: input.get("state")! } : {}) }) });
    },
    async authorizeCallback(input: URLSearchParams) {
      if (mode !== "google") return Object.freeze({ ok: false, status: 400 as const, error: "Google OAuth is not configured" });
      const state = input.get("state") ?? "";
      const pending = pendingGoogle.get(state);
      pendingGoogle.delete(state);
      if (!pending || pending.expiresAt <= Date.now()) return Object.freeze({ ok: false, status: 400 as const, error: "Google authorization state expired" });
      if (input.get("error")) return Object.freeze({ ok: false, status: 401 as const, error: input.get("error_description") ?? input.get("error") ?? "Google authorization rejected" });
      const principal = await googlePrincipal(input);
      if (!principal.ok) return principal;
      return Object.freeze({ ok: true as const, redirect: mintCode({ clientId: pending.clientId, redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge, principal: principal.email, ...(pending.state ? { state: pending.state } : {}) }) });
    },
    exchangeToken(input: URLSearchParams) {
      if (input.get("grant_type") !== "authorization_code") return Object.freeze({ error: "expected authorization_code grant", status: 400 as const });
      const code = input.get("code") ?? "";
      const row = codes.get(code);
      if (!row || row.expiresAt <= Date.now()) return Object.freeze({ error: "invalid or expired code", status: 400 as const });
      if (row.clientId !== (input.get("client_id") ?? "")) return Object.freeze({ error: "client_id mismatch", status: 400 as const });
      if (row.redirectUri !== (input.get("redirect_uri") ?? row.redirectUri)) return Object.freeze({ error: "redirect_uri mismatch", status: 400 as const });
      if (s256(input.get("code_verifier") ?? "") !== row.codeChallenge) return Object.freeze({ error: "PKCE verifier rejected", status: 401 as const });
      codes.delete(code);
      const access = token(32);
      accessTokens.set(access, Object.freeze({ token: access, principal: row.principal, expiresAt: Date.now() + tokenTtlMs }));
      return Object.freeze({ access_token: access, token_type: "Bearer" as const, expires_in: Math.floor(tokenTtlMs / 1000), scope: "ops" as const, principal: row.principal });
    },
    revokeToken(input: URLSearchParams) {
      const revoked = accessTokens.delete(input.get("token") ?? "");
      return Object.freeze({ revoked });
    },
    authorizationServerMetadata() {
      return Object.freeze({
        issuer: publicBaseUrl,
        authorization_endpoint: `${publicBaseUrl}/oauth/authorize`,
        token_endpoint: `${publicBaseUrl}/oauth/token`,
        google_callback_endpoint: `${publicBaseUrl}/oauth/callback`,
        revocation_endpoint: `${publicBaseUrl}/oauth/revoke`,
        registration_endpoint: `${publicBaseUrl}/oauth/register`,
        response_types_supported: Object.freeze(["code"]),
        grant_types_supported: Object.freeze(["authorization_code"]),
        code_challenge_methods_supported: Object.freeze(["S256"]),
        token_endpoint_auth_methods_supported: Object.freeze(["none"]),
        identity_provider: mode === "google" ? "google" : "local",
        service_documentation: `${publicBaseUrl}/ui`,
      });
    },
    protectedResourceMetadata() {
      return Object.freeze({
        resource: `${publicBaseUrl}/ops`,
        authorization_servers: Object.freeze([publicBaseUrl]),
        bearer_methods_supported: Object.freeze(["header"]),
        resource_documentation: `${publicBaseUrl}/ui`,
      });
    },
  });
}
