# MCP Server Dynamic Client Registration (DCR) — Tech Design

**Date:** 2026-09-15
**Branch:** `mcp-dcr-tech-design` (design only, no implementation)
**Status:** Draft — open questions in §8 need answers before this becomes an implementation plan.

## Summary

This repo's `/mcp` endpoint (shipped in `docs/superpowers/specs/2026-08-05-mcp-endpoint-design.md`)
deliberately deferred OAuth discovery and Dynamic Client Registration: *"MCP client auth model —
bearer JWT only (matching current REST/GraphQL auth) is sufficient for now. No OAuth 2.1
discovery/dynamic client registration needed in v1"*
(`docs/superpowers/specs/2026-08-05-mcp-endpoint-design.md:412-413`, repeated in
`docs/superpowers/plans/2026-08-05-mcp-endpoint.md:1537`). This doc is the follow-up: how to add DCR
(RFC 7591) so MCP clients (Claude Desktop, Claude Code, ChatGPT connectors, etc.) can register
themselves against this server's authorization flow without a human manually provisioning a
`client_id` first.

**Correction from an earlier draft of this doc**: the first pass here recommended delegating
registration to Keycloak's native DCR support, based on the local dev stack
(`docker-compose.yml`). **That doesn't hold in production.** fhir-server's production environments
authenticate against **Descope, Okta, and AWS Cognito** — Keycloak is dev-only. Worse, of those three,
**Cognito has no native DCR support at all**, and **Okta's DCR requires an Initial Access Token**
(admin-gated, not the anonymous/zero-touch registration MCP clients expect) — only Descope supports
open DCR cleanly. fhir-server's own token-verification layer already reflects a multi-IdP reality:
`EXTERNAL_AUTH_JWKS_URLS`/`EXTERNAL_AUTH_WELL_KNOWN_URLS` (`src/utils/configManager.js`, merged in
`src/strategies/authService.js:181-210`) let a single deployment trust several external issuers'
JWKS at once. There is often no single "the authorization server" to point DCR clients at, and even
where there is, it may be Cognito.

**Revised recommendation (§6): fhir-server should implement its own DCR endpoint (Option B)** —
mint local `client_id`s, store registrations, and broker the real OAuth relationship to one
pre-provisioned upstream IdP credential per environment — mirroring the pattern
`~/git/mcp-fhir-agent` already runs in production for exactly this reason. That repo's own code
comment states the rationale directly: *"Use OIDCProxy for authentication so it handles dynamic
client registration even though Cognito does not support it"*
(`mcpfhiragent/mcp_servers/mcp_server.py:222`, §4.1). The "just delegate to the IdP" design (Option A,
kept below for completeness) only works for a deployment whose sole trusted IdP is Descope — it is
not a general answer for this codebase.

## 1. Background: why DCR, and what MCP actually requires

The MCP Authorization spec (2025-06-18+) models an MCP server as an OAuth 2.1 *protected resource*.
A client that doesn't already have a `client_id` for that resource must be able to get one without a
human in the loop — that's DCR's job. The discovery chain a spec-compliant client walks is:

1. Unauthenticated request to `/mcp` → 401 with a `WWW-Authenticate: Bearer resource_metadata="..."`
   challenge (or the client fetches `/.well-known/oauth-protected-resource<path>` directly).
2. **RFC 9728** Protected Resource Metadata document → lists `authorization_servers` for this
   resource.
3. **RFC 8414** Authorization Server Metadata for that server → includes `registration_endpoint` (if
   the AS supports DCR).
4. **RFC 7591**: client `POST`s its metadata (`redirect_uris`, `grant_types`,
   `token_endpoint_auth_method`, etc.) to `registration_endpoint`, gets back a `client_id`.
5. Standard OAuth 2.1 authorization-code + PKCE flow begins using that `client_id`.

Worth noting up front: MCP's own guidance has been shifting. The protocol maintainers' September 2026
post on this (see references) describes real operational pain with open-ended DCR at scale —
unbounded client-table growth, no clean way to expire stale registrations, one `client_id` per client
*instance* rather than per application — and now positions **Client ID Metadata Documents (CIMD)** as
the preferred mechanism for *new* implementations, with DCR kept around mainly for installed/desktop
clients that have no public HTTPS origin to host a CIMD document, and for backward compatibility. CIMD
is still spec-in-flux (SEP 991/1032) and current mainstream MCP clients (Claude Desktop/Code, ChatGPT
connectors) implement DCR, not CIMD, today — so DCR is still the right thing to build now. See §8.4.

## 2. Current state in this repo (file:line citations)

- **Transport/routing**: `src/routeHandlers/mcpServer.js` wraps `@modelcontextprotocol/server`'s
  `McpServer` + `@modelcontextprotocol/node`'s Streamable HTTP transport; stateless per-request, no
  session state. `getRouter()` just mounts `router.all('/', ...)` — zero auth logic lives here.
- **Tools**: `src/mcp/mcpToolHandler.js` registers per-resource search tools + a generic `fhir_search`
  tool; every call reads `FhirRequestInfo` from `httpContext` (AsyncLocalStorage) and delegates to
  `SearchBundleOperation.searchBundleAsync` — the same path REST/GraphQL use. No auth/scope logic here
  either; it all depends on upstream middleware having done its job.
- **Auth today**: `app.js:443-477` gates the whole `/mcp` mount behind `configManager.enableMcp`
  (`ENABLE_MCP`, default off — `src/utils/configManager.js:579-585`). Inside: `passport.use('mcpStrategy',
  container.jwt_strategy)` (`app.js:445`) reuses `MyJwtStrategy` (`src/strategies/jwt.bearer.strategy.js`,
  passport-jwt + `jwks-rsa`), which verifies bearer JWTs against `configManager.authJwksUrl` — whatever
  IdP `AUTH_JWKS_URL` is configured to point at for that deployment (Keycloak locally; Descope, Okta, or
  Cognito in production — §2.1). `app.js:456` adds `forbidForUserTypes([AUTH_USER_TYPES.cmsPartnerUser])`,
  matching the categorical block GraphQL uses. **No OAuth discovery endpoints exist for `/mcp` today**
  — no `.well-known/oauth-protected-resource`, no `.well-known/oauth-authorization-server`, no
  `WWW-Authenticate` challenge on 401. The only discovery endpoint in the app is
  `/.well-known/smart-configuration` (`app.js:404` → `src/routeHandlers/smartConfiguration.js`), which
  fetches-and-caches whatever `AUTH_CONFIGURATION_URI` resolves to for that deployment, verbatim.
- **No client registry**: nothing in `src/` registers, stores, or manages OAuth clients. Client
  provisioning today is entirely out of band, via whichever upstream IdP admin console/API applies.
- **Dependencies**: `package.json:91-92` — `@modelcontextprotocol/node@^2.0.0`,
  `@modelcontextprotocol/server@^2.0.0`. No `@modelcontextprotocol/express`, no `openid-client`, no
  `oidc-provider`, no Keycloak admin SDK.
- **Local dev stack runs Keycloak** — `docker-compose.yml:161-224` runs Keycloak 26.5.4
  (`start-dev`, realm imported from `keycloak-config/realm-import.json`, no client-registration-policy
  configured in that realm file today). Keycloak natively supports RFC 7591 DCR
  (`/realms/<realm>/clients-registrations/openid-connect`), which made it tempting to assume as the
  design basis — **but production does not run Keycloak** (§2.1), so this is dev-convenience only and
  shouldn't drive the production design.

### 2.1 Production identity providers

Descope, Okta, and AWS Cognito (confirmed directly; not
  discoverable from this repo's own code, which is IdP-agnostic by design via
  `AUTH_CONFIGURATION_URI`/`AUTH_JWKS_URL`/`EXTERNAL_AUTH_JWKS_URLS`). fhir-server's token
  verification already supports trusting several of these **at once**:
  `configManager.externalAuthJwksUrls`/`externalAuthWellKnownUrls` (comma-separated env vars) are
  merged into one trusted keyset by `AuthService.getExternalJwksAsync()`
  (`src/strategies/authService.js:181-210`), alongside the primary `AUTH_JWKS_URL`. The sibling
  `mcp-fhir-agent` repo's own environment config makes the shape of this concrete: its
  `AUTH_PROVIDER_LIST` in production lists entries like `client2,client1,client3,oktafhir,samsung,
  descope_sdk,descope_wellsense,descope_mcp` — several distinct Cognito user pools, one Okta tenant,
  and several Descope projects, each with its own issuer/well-known/client-id
  (`.helm/prod-ue1.values.yaml:35` in that repo). fhir-server's `EXTERNAL_AUTH_JWKS_URLS` plays the
  same structural role. **Consequence for this design**: there is frequently no single "the
  authorization server" for a deployment to point DCR clients at — see §7.1.

## 3. `review.md` applicability

Per `CLAUDE.md`, changes touching "OAuth scope/token parsing" require an adversarial review against
`review.md` at PR time. Unlike the originally-drafted Option A, **the recommended Option B (§6.1) does
touch this surface**: fhir-server would newly hold upstream IdP client credentials, proxy authorize/
token requests, and mint its own `client_id`s — a materially larger addition to the OAuth surface than
"just add discovery metadata." Flag this design for that review before implementation, with particular
attention to §7 (which upstream IdP a registered client is bound to, and whether tokens are
audience-restricted to `/mcp`) and to registration-endpoint abuse potential (open registration is a
DoS/storage-growth vector even without any tenant-data exposure, per MCP's own blog on this, §1).

## 4. Reference implementation: `~/git/mcp-fhir-agent`

That repo (Python, FastMCP-based) implements DCR by making its MCP server **both** a protected
resource *and* the DCR authorization server for the client↔server leg.

### 4.1 Why they built it this way (the decisive precedent for this design)

The rationale is stated directly in a code comment, not just inferred:

> `mcpfhiragent/mcp_servers/mcp_server.py:222`: *"Use OIDCProxy for authentication so it handles
> dynamic client registration even though Cognito does not support it"*

That repo's own docs make the same point structurally: *"This repo is a DCR server, not a DCR
client. It does not itself register with an upstream identity provider (IdP) via DCR — the
relationship between this server and the upstream IdP (Cognito, Descope, etc.) uses a statically
pre-provisioned `client_id`/`client_secret` from `AuthConfig`. DCR only governs the relationship
between MCP clients ... and this server"* (`docs/dynamic-client-registration.md:9-15`). Because the
upstream leg is always a single static credential, the proxy behaves identically regardless of which
IdP backs it — it never depends on that IdP having its own DCR capability at all.

Two more details matter for porting this to fhir-server:

- **DCR is wired to exactly one upstream provider per environment**, via a singular
  `DYNAMIC_CLIENT_REGISTRATION_AUTH_PROVIDER` env var (`create_auth_provider`,
  `oidc_proxy_auth_provider.py:80-157` — raises if that named provider's config is missing). This is
  a *different* knob from the multi-IdP `AUTH_PROVIDER_LIST` used for verify-only token acceptance
  (§2.1) — DCR does not (today) broker to "whichever IdP a token happened to come from," it brokers
  to one chosen upstream.
- **Current rollout is narrow and still Cognito-backed**: `DYNAMIC_CLIENT_REGISTRATION_AUTH_PROVIDER`
  is only configured in that repo's `dev` environment today, backed by Cognito
  (`.helm/dev-ue1.values.yaml:42-43,73-83`) — `staging`, `client-sandbox`, and `prod` don't set it at
  all yet, so those environments currently only run in verify-only passthrough mode. In other words:
  even the reference implementation hasn't reached a production DCR rollout decision either — this
  is genuinely unsolved territory across b.well's MCP servers, not just here.

### 4.2 Mechanics

- **Architecture**: `mcp.server.auth.handlers.register.RegistrationHandler` (from the base `mcp` SDK)
  validates incoming RFC 7591 metadata and mints a UUID `client_id`; fastmcp's `OAuthProxy` /
  `OIDCProxy` wraps it, forcibly downgrades every registered client to
  `token_endpoint_auth_method="none"` (public client, no secret), and persists the record.
- **Storage**: MongoDB (GridFS-backed), via an internal `oidcauthlib` storage abstraction — same
  generic cache pattern used for unrelated caches in that repo, not a FHIR resource.
- **What made this possible with reasonable effort**: `mcp` + `fastmcp` (Python packages) ship the
  registration handler and the proxy plumbing. Nothing had to be hand-built from RFC text.
- **Known gaps, worth not silently inheriting if fhir-server ever goes this route**:
  - No redirect-URI allowlist configured (`allowed_client_redirect_uris` unset).
  - No RFC 7592 client-management support — registered clients can't be updated/revoked via protocol
    (the installed handler doesn't return `registration_client_uri`/`registration_access_token`).
  - `require_authorization_consent=False` only suppresses fastmcp's own consent screen — it does
    **not** suppress the upstream IdP's separate consent flow, which caused a real production outage
    when that flow shipped disabled-by-default on a new IdP project.
  - A refresh-token persistence mixin depends on fastmcp's *unexported* internals — flagged in that
    repo's own ADR as an ongoing maintenance risk that must be re-verified on every fastmcp upgrade.
  - Resource-indicator/audience matching (RFC 8707) is root-path-only — a client discovering a
    sub-path resource gets a 404 or a metadata document with the wrong `resource` audience. Tracked
    there as `BAI-461`, deliberately deferred.
  - Not enabled in that service's `prod` environment yet — no rollout decision made there either.

The takeaway for this design: **the DCR-as-your-own-proxy pattern works, but only cheaply when your
MCP framework hands you the proxy.** Node's ecosystem doesn't (§5), so porting this pattern here is a
materially bigger lift than it was there.

## 5. npm package research

| Package | Role | Verdict |
|---|---|---|
| `@modelcontextprotocol/{core,server,node,express}` (official TS SDK, v2 line; `core`/`server`/`node` already deps here) | `@modelcontextprotocol/express` ships `mcpAuthMetadataRouter` (serves RFC 9728 Protected Resource Metadata + mirrors RFC 8414 AS metadata) and `requireBearerAuth`. Confirmed by reading the package source directly (`packages/middleware/express/src/auth/metadataRouter.ts`, `bearerAuth.ts` in `modelcontextprotocol/typescript-sdk`). **It deliberately implements no `registration_endpoint` or client store** — resource-server-side only. `@modelcontextprotocol/core` already vendors the RFC 7591/9728 Zod schemas (`OAuthClientMetadataSchema`, `OAuthClientInformationFullSchema`, `OAuthClientRegistrationErrorSchema`, `OAuthProtectedResourceMetadataSchema`) as a transitive dependency of `@modelcontextprotocol/server` — confirmed present in `node_modules/@modelcontextprotocol/core/dist/auth-*.mjs` already installed in this repo. | Still useful for Option B (§6.1): `mcpAuthMetadataRouter` can serve the *discovery* side (RFC 9728/8414) even when fhir-server's own `/register` handles the DCR POST itself, and the Zod schemas cover request/response validation for that handler for free — no extra package needed for either. |
| `oidc-provider` (npm, ~9.6.0) | Full OAuth 2.0/OIDC **authorization server** implementation with RFC 7591 DCR support built in. | Not a fit — adopting it means fhir-server *becomes* a general-purpose authorization server, a much bigger scope change than proxying DCR for MCP clients specifically. |
| `mcp-auth` (npm) + `@modelcontextprotocol/express` | Vendor-neutral token-verification/discovery helper library for MCP servers. Confirmed via its docs: it discovers AS metadata and verifies JWTs — it explicitly does **not** implement or proxy DCR. | Not a fit for DCR itself; a possible future simplification of the bearer-verification/discovery wiring, out of scope here. |
| `http-oauth-mcp-server`, `getmcpauth`, `mcp-oauth`, `mcp-proxy` (community packages) | Various example/hosted implementations of "own `/register`, proxy to upstream IdP" (i.e., mcp-fhir-agent's pattern, for Node). | None are official or widely adopted. Pulling an unvetted third-party package into a PHI-adjacent auth path is exactly the kind of thing `review.md`/§3 exists to catch — **do not adopt without a dedicated security review of the specific package** before using one to shortcut §6.1's hand-built pieces. |

**Conclusion**: there is no Node equivalent of fastmcp's `OAuthProxy` — no package hands you "act as a
DCR server while delegating the real OAuth relationship to an upstream IdP." That capability must be
hand-built (§6.1). The official SDK's own middleware package is explicitly scoped to resource-server
concerns only (discovery + bearer verification, no registration store) — consistent with fhir-server
needing to build the registration piece itself rather than finding it off the shelf.

## 6. Design options

### 6.1 Option B (recommended) — fhir-server becomes its own DCR/OAuth proxy (mirrors mcp-fhir-agent)

fhir-server exposes its own `/register`, mints local `client_id`s, and proxies the real
authorize/token legs to **one pre-provisioned upstream IdP credential per environment** — the exact
shape of §4, and for the exact reason stated in §4.1: at least one of the IdPs this app must actually
support in production (Cognito) has no native DCR to delegate to, and another (Okta) doesn't offer
the anonymous/zero-touch registration MCP clients expect. This is not a stylistic preference — it's
the only one of the three options (§6.1-6.3) that works uniformly across Descope, Okta, and Cognito
without special-casing per deployment.

- Would need, hand-built (no framework equivalent to fastmcp's `OAuthProxy` exists for Node, §5): a
  registration handler (validate against `@modelcontextprotocol/core`'s existing Zod schemas, mint
  `client_id`), a client store (Mongo, likely following the same cache-namespace pattern
  `mcpfhiragent/cache/cache_namespace.py` uses, adapted to this repo's Mongo conventions), authorize/
  token proxying logic against one configured upstream credential (mirroring the singular
  `DYNAMIC_CLIENT_REGISTRATION_AUTH_PROVIDER` knob, §4.1 — this is a separate concept from the
  existing multi-IdP `EXTERNAL_AUTH_JWKS_URLS` verify-only trust list, §2.1), and — if wanted — RFC
  7592 client management (get/update/delete), which mcp-fhir-agent itself never built.
- **Pros**: full control — redirect-URI allowlisting, rate-limiting, audit, revocation all live in
  this codebase; works the same regardless of which upstream IdP(s) a given environment trusts;
  doesn't require any particular upstream IdP to support DCR at all.
- **Cons**: this is a first-of-its-kind architectural departure — fhir-server has never issued
  tokens, proxied OAuth flows, or held IdP client credentials (§2). Materially larger build (new
  persistence layer, new security surface entirely owned by this repo) and carries forward every
  rough edge listed in §4 as *new* problems to solve here rather than lessons already absorbed by a
  working reference — plus a genuinely open question this repo would inherit too: which upstream IdP
  should the proxy broker to, per environment, when a deployment already trusts several for
  token verification (§7.1)?

Concretely, this means adding (all new app code, gated behind a new flag — e.g. `ENABLE_MCP_DCR`,
default off, independent of `ENABLE_MCP`, following the exact pattern of `configManager.enableMcp`,
`src/utils/configManager.js:579-585` — so this can ship without changing behavior for any client that
doesn't expect it):

- `POST /mcp/register` (or similar) — validates the incoming RFC 7591 request body against
  `@modelcontextprotocol/core`'s `OAuthClientMetadataSchema`, mints a `client_id`, forces
  `token_endpoint_auth_method: "none"` (public client — no secret to protect), and persists the
  record (Mongo, following this repo's existing data-access conventions rather than
  mcp-fhir-agent's GridFS/cache-namespace approach, which is specific to that repo's generic cache
  abstraction). **Must enforce the guardrails in §7.3** (Initial Access Token, redirect-URI
  allowlist, hard grant-type restriction) — an unguarded version of this endpoint is a regression
  in what a bad actor can do against this server, not a neutral addition.
- Discovery endpoints (`@modelcontextprotocol/express`'s `mcpAuthMetadataRouter` fits here regardless
  of which option is chosen — see §5): `GET /.well-known/oauth-protected-resource/mcp` (RFC 9728,
  naming `https://<this-server>/mcp` as the resource) and an authorization-server metadata document
  advertising *this app's own* `/mcp/register` as `registration_endpoint` — not the upstream IdP's.
- A `WWW-Authenticate: Bearer resource_metadata="..."` header on `/mcp`'s existing 401 response
  (currently a bare JSON 401 via `authenticateWithJsonFailure`, `app.js:450`) so unauthenticated
  clients can discover the resource metadata per spec.
- The authorize/token proxying leg, brokering to one pre-provisioned upstream credential per
  environment (§7.1) — this is the part with no off-the-shelf Node package (§5) and the bulk of the
  implementation effort.

### 6.2 Option A — delegate to an upstream IdP's native DCR (Descope-only deployments)

fhir-server adds only the discovery layer; the upstream IdP does the actual registration — the same
`mcpAuthMetadataRouter` mechanics as above, except the authorization-server metadata mirrors the
upstream IdP's own discovery document (already advertising *its* `registration_endpoint`) instead of
a `/mcp/register` this app owns. **This only works if that deployment's sole trusted IdP is Descope**
— it is unusable for a Cognito-backed deployment (no DCR endpoint exists to delegate to) and awkward
for an Okta-backed one (registration requires an Initial Access Token, defeating the zero-touch point
of DCR). Kept as background because a future Descope-only environment could reasonably use it, and
because it's dramatically cheaper (no persistence, no proxying) where it applies — but it is not
adopted as the general design (§6.1 is).

### 6.3 Option C — Client ID Metadata Documents (CIMD) instead of/alongside DCR

Host a static CIMD JSON document for known first-party MCP clients (b.well's own tooling) at a stable
HTTPS URL, used as the `client_id` itself — no registration endpoint, no client store, no expiry
problem. Per §1, this is where MCP's own guidance is heading, but the spec is still in flux (SEP
991/1032) and mainstream third-party clients (Claude Desktop/Code, ChatGPT connectors) don't implement
it yet. **Not recommended now** — revisit once client-side support lands; it doesn't preclude Option A
later (they're complementary discovery mechanisms, not competing ones).

## 7. Two gaps to design in now, not defer

### 7.1 Which upstream IdP does the DCR proxy broker to?

Under Option A of mcp-fhir-agent's own model (§4.1), DCR brokers to exactly **one** pre-provisioned
upstream credential per environment (`DYNAMIC_CLIENT_REGISTRATION_AUTH_PROVIDER`) — a different,
singular concept from fhir-server's existing `EXTERNAL_AUTH_JWKS_URLS`, which trusts **several**
upstream issuers simultaneously for ordinary bearer-token verification (§2.1). Porting the pattern
here means answering, per environment: which one upstream IdP (Descope, Okta, or a specific Cognito
user pool) does a *new* MCP-registered client actually authenticate against? If a given fhir-server
deployment only ever fronts one IdP, this is simple. If it fronts several at once (plausible, given
`EXTERNAL_AUTH_JWKS_URLS` supports that today) then either the DCR-issued client is bound to one
designated "primary" IdP for that environment (mcp-fhir-agent's current approach) or fhir-server needs
a way to pick per-registration — the latter is unexplored territory in both codebases. This decision
should be made explicitly (§8.1) before implementation, not defaulted to "whichever IdP happens to be
first in the list."

### 7.2 Audience/resource binding

Today, `mcpStrategy` accepts any JWT that passes JWKS verification against the configured
issuer(s) (`src/strategies/jwt.bearer.strategy.js`) — there's no check that the token was actually
scoped to the `/mcp` resource specifically (RFC 8707 resource indicators). mcp-fhir-agent hit exactly
this gap (`BAI-461`, §4.2) and deliberately deferred it. Recommendation: **decide this explicitly
now**, as part of implementing Option B, rather than shipping DCR discovery that points clients at a
resource indicator fhir-server doesn't actually enforce. Concretely: confirm whether the chosen
upstream IdP (§7.1) can issue audience-restricted tokens for the `/mcp` resource, and whether
`mcpStrategy` should start checking `aud` against that value. This may warrant its own follow-up
design if the answer is "yes, and it's a bigger change" — flagged as an open question (§8.2), not
silently bundled into this DCR work.

### 7.3 Registration guardrails — who can call `/mcp/register`

**The risk this defends against.** Today, every OAuth client trusted by fhir-server was created by a
human admin in an upstream IdP console — an implicit review gate. Option B removes that gate:
`/mcp/register` is a new endpoint, and unless it restricts who may call it, *anyone* can self-register
a client. Concretely, that would enable three distinct problems, only one of which is data-access:

- **Storage/DoS abuse** — anyone can spam registrations; the client store grows unbounded (the exact
  concern MCP's own blog raises, §1).
- **OAuth client impersonation / consent-phishing** — an attacker registers a legitimate-looking
  client (e.g., named to look like an official b.well or Anthropic integration), then gets a real,
  already-authorized user to click through the *real* upstream consent screen. The resulting
  authorization code/token is delivered to whatever `redirect_uri` the attacker registered. This is
  why mcp-fhir-agent's own "known gaps" list (§4.2) flags "no redirect-URI allowlist configured" — it
  is a live phishing vector, not a theoretical one, if left unaddressed.
- **Token issuance with zero user involvement (the severe one).** The proxy holds one static,
  pre-provisioned upstream credential and uses it on behalf of every registered client (§4.1). If
  `/token` ever allowed a self-registered client to invoke a non-interactive grant (most obviously
  `client_credentials`) against that shared static credential, a bad actor could self-register and
  mint a fully valid upstream access token without any real user ever logging in — strictly worse than
  today, where no public registration endpoint exists at all. This must be structurally prevented, not
  just discouraged by policy.

**Recommended controls (layered, in priority order):**

1. **Initial Access Token (IAT) required by default.** `/mcp/register` requires a bearer token —
   issued out-of-band by whoever administers this (a b.well admin, or handed to a named integration
   partner) — before a registration request is even processed. This is RFC 7591's standard mechanism
   for exactly this problem (it's what Okta requires by default, and what Keycloak offers as a policy
   toggle) and converts "anyone on the internet can register" into "only pre-vetted parties can
   register," while still letting them supply their own client metadata dynamically.
2. **Redirect URI / allowed-host allowlist, mandatory regardless of #1.** Validate `redirect_uris`
   against a pattern at registration time (e.g. a partner's pre-approved domain, `localhost:*` only
   for local dev clients) rather than accepting anything an IAT holder submits. Contains the blast
   radius even of an approved-but-compromised client.
3. **Grant-type restriction — the single non-negotiable guardrail.** Every DCR-issued client is
   hard-restricted to `authorization_code` + PKCE (+ `refresh_token`); `client_credentials` and any
   other non-interactive grant must be rejected outright for DCR-issued clients, with no
   per-client override. This is what prevents the severe risk above.
4. **Software statements — optional, for first-party auto-trust.** RFC 7591's `software_statement`
   parameter lets a client present a JWT signed by a trusted publisher (e.g., Anthropic signing "this
   really is Claude Desktop"), verified against a small allowlist of trusted signer keys. Useful later
   for known first-party clients to skip manual IAT distribution; not required for v1.
5. **Rate limiting on `/mcp/register`** regardless of #1 — defense in depth against a leaked or
   over-shared IAT.
6. **Rollout sequencing**: ship the endpoint gated behind `ENABLE_MCP_DCR` (§6.1), but leave it
   disabled in every environment until IAT issuance has an actual operational owner and process —
   mirrors mcp-fhir-agent's own current state (DCR only enabled in `dev`; not staging, client-sandbox,
   or prod, §4.1).

## 8. Open questions

1. **Which upstream IdP does DCR broker to, per environment (§7.1)?** Does a given fhir-server
   deployment front exactly one of Descope/Okta/Cognito for MCP purposes, or does the DCR proxy need
   to pick a "primary" from among several trusted issuers? Whoever owns b.well's IdP/identity
   architecture decisions should weigh in before implementation.
2. **Audience binding (§7.2)** — does tightening `/mcp` to require resource-indicator-scoped tokens
   ride along with this work, or become its own follow-up design?
3. **Registration guardrails — mechanism resolved (§7.3); ownership still open.** The controls
   themselves are decided (IAT requirement, redirect-URI allowlist, hard grant-type restriction). What
   remains open: who operationally issues/distributes Initial Access Tokens to partners, and who signs
   off on the guardrail implementation before it ships — same reviewers as `review.md` (§3), or a
   separate security review?
4. **CIMD timing (§6.3)** — confirmed not-now; revisit when mainstream MCP clients support it.

## References

- [RFC 7591 — OAuth 2.0 Dynamic Client Registration Protocol](https://www.rfc-editor.org/rfc/rfc7591.html)
- [RFC 9728 — OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8414 — OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707)
- [MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [Evolving OAuth Client Registration in the Model Context Protocol — MCP blog](https://blog.modelcontextprotocol.io/posts/client_registration/)
- [Dynamic Client Registration (DCR) in MCP — WorkOS](https://workos.com/blog/dynamic-client-registration-dcr-mcp-oauth)
- [Keycloak: Using the client registration service](https://www.keycloak.org/securing-apps/client-registration) (dev-stack IdP only, §2.1)
- [Okta: Dynamic Client Registration API](https://developer.okta.com/docs/api/openapi/okta-oauth/oauth/client) — confirms Initial Access Token is required when registration isn't open to anyone
- [Descope: Dynamic Client Registration / Inbound Apps docs](https://docs.descope.com/mcp) — confirms open DCR + CIMD support
- AWS Cognito: no RFC 7591 support; `CreateUserPoolClient` (control-plane API, IAM-authenticated) is the only client-provisioning mechanism — confirmed via multiple independent 2026 sources, no official AWS DCR feature exists
- [`modelcontextprotocol/typescript-sdk`, `packages/middleware/express`](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/middleware/express)
- `~/git/mcp-fhir-agent/docs/dynamic-client-registration.md`, `mcpfhiragent/mcp_servers/mcp_server.py:222`, `adrs/0003-connected-apps-mcp-google-integration.md`, `.helm/prod-ue1.values.yaml:35`, `.helm/dev-ue1.values.yaml:42-43,73-83`
