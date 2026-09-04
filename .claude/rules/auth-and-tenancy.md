---
paths:
  - "kill_the_clipboard_scanner/auth/**/*.py"
  - "kill_the_clipboard_scanner/identity/**/*.py"
  - "kill_the_clipboard_scanner/mcp_servers/auth/**/*.py"
  - "kill_the_clipboard_scanner/routers/**/*.py"
---

# Authentication and tenancy — detail

> The load-bearing invariants (token-only tenant resolution, `TenantContext`, the
> owner ⊃ admin ⊃ staff hierarchy, `Role.*` over string literals) stay in `CLAUDE.md`
> because they apply everywhere. This file carries the detail behind them.

## Provider selection

`OIDCProxyAuthProvider` supports three modes based on environment variables:

1. **MultiAuth** (DCR + pass-through) — OIDCProxy for Dynamic Client Registration +
   TokenReaderVerifier for upstream tokens
2. **OIDCProxy only** — standard DCR without pass-through
3. **None** — auth disabled for local dev (default when no auth env vars set)

In non-dev environments (`ENVIRONMENT` != local/development), the app **refuses to start**
without auth configured (fail-closed). This is why importing `api.py` fails outright when
the auth env vars are set but incoherent — `create_auth_provider` raises rather than
mounting an unauthenticated MCP server.

Local dev uses **Keycloak** (realm: `ktc-realm`, client: `ktc-client-id`). Production uses
**Descope**. The backend is OIDC-agnostic — JWT claims are the same via protocol mappers.

## Where roles come from

Roles are read from a configurable claim: `AUTH_ROLE_CLAIM`, default `cognito:groups`,
falling back to `realm_access.roles`. The `DescopeClaimsReader` **ignores it** — Descope
roles come from `tenants[<dct>].roles`. Granting a new role means touching whichever
reader applies, not just the `Role` enum.

## The two auth flows

- **Flow A — interactive OIDC (users):** the web app authenticates via Descope flows
  (production) or Keycloak (dev). The JWT carries `tenantId` plus roles;
  `get_current_tenant` returns a `TenantContext` with no DB lookup; `require_roles(...)`
  enforces role gates.
- **Flow B — M2M `client_credentials` JWT (machines):** the only M2M mechanism — a service
  presents a JWT with a `tenantId` claim (minted via `client_credentials`) and calls the
  scan endpoints; there is no separate API-key mechanism. In production, a Descope-issued
  M2M credential is **never self-service** — a b.well operator provisions the Access Key
  manually in the Descope console (scoped to the tenant via `keyTenants`) and hands the
  resulting `clientId`/`clientSecret`/`tokenUrl`/`discoveryUrl` to the tenant admin
  out-of-band; nothing is typed into the app. See `docs/m2m-client-credentials-descope.md`
  for the token-exchange and scan-request usage.
  - **Dev (Keycloak):** client `ktc-client-id-m2m` / secret `ktc-secret-m2m`; its <!-- pragma: allowlist secret -->
    service-account user carries `tenantId=test-tenant-001`. Mint a token (substitute
    `KEYCLOAK_HOST_PORT`'s actual value — `make print-keycloak-port` resolves it):

    ```bash
    curl -s -X POST "http://localhost:$(make print-keycloak-port)/realms/ktc-realm/protocol/openid-connect/token" \
      -d grant_type=client_credentials -d client_id=ktc-client-id-m2m \
      -d client_secret=ktc-secret-m2m  # pragma: allowlist secret
    ```

## Org creation, invites, user management

The three workflows — admin creates an org, admin invites/manages users, user logs in —
are documented in `docs/auth-workflows.md`. Org creation and login run through two Descope
flows: a dedicated **`ktc-sign-up`** flow creates the tenant (Create Tenant action →
`ktc-org-owner`) for new clinics, while the **`ktc-sign-in`** login flow is sign-in only
(it never creates an account/tenant; an unknown email hits a "no account — sign up" screen).

**Invites and user management are in-app for Descope** via the embedded `UserManagement`
widget on `/users` (owner/admin-gated), rendered through
`AuthStrategy.renderUserManagement(tenantId)` — no backend route or Management API
involved. Keycloak/dev stays console-driven: the method is not implemented for Keycloak, so
the `/users` page shows a "managed in your IdP console" fallback.

The org-settings page has been removed; `POST /api/signup` exists (409 for Descope
`idp-flow`, provisions for Keycloak `app-form`), and there is **no `/api/users/*` router**.
`/api/org` exists for owner-initiated org deletion (`DELETE /api/org`) — see
`kill_the_clipboard_scanner/routers/org_router.py`.

## Pointers

- How org creation differs per IdP (`idp-flow` vs `app-form`) and how the SPA picks its
  auth strategy (`identity_provider_kind`): `docs/org-creation.md`
- Running the full stack against a real Descope project instead of local Keycloak, or
  smoke-testing the deployed dev env: `docs/descope-local-testing.md`
- The two seeded dev tenants used to test tenant isolation (users, passwords, reset
  procedure): `docs/local-multi-tenant-dev.md`
