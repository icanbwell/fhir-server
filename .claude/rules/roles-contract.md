---
paths:
  - "kill_the_clipboard_scanner/auth/roles.py"
  - "frontend/src/auth/roles.ts"
  - "frontend/src/auth/AuthStrategy.ts"
---

# Role names: three definitions, one contract

The strings `ktc-org-owner` / `ktc-org-admin` / `ktc-org-staff` are duplicated in
**three** places, and **no test verifies they agree**:

| # | Where | What |
|---|---|---|
| 1 | `kill_the_clipboard_scanner/auth/roles.py` | `Role.OWNER/ADMIN/STAFF` — the sole backend definition |
| 2 | `frontend/src/auth/roles.ts` | `ROLE_OWNER/ROLE_ADMIN/ROLE_STAFF` |
| 3 | The IdP config — Descope in prod, Keycloak (`ktc-realm`) in dev | **Not in this repo** |

**Renaming or adding a role means editing all three.** Miss (3) and everything still
compiles, every test still passes, and authorization breaks at runtime for real users —
the JWT carries a role string the backend no longer recognizes, so `require_roles(...)`
denies access with no build-time signal anywhere.

Neither mypy nor tsc can see this coupling: it is three independent string literals in
two languages plus an external system.

## Rules

- Routers pass `Role.*` enum members, **never** string literals. Same on the frontend:
  import from `roles.ts`, never inline `"ktc-org-admin"`.
- The hierarchy is **owner ⊃ admin ⊃ staff**. `require_roles(Role.ADMIN)` must also admit
  owners. Don't hand-roll the containment check at a call site.
- The `ktc-org-` prefix exists so these don't collide with the IdP's built-in role names.
  Keep it on any new role.
- Roles reach the backend through a configurable claim: `AUTH_ROLE_CLAIM` (default
  `cognito:groups`, falling back to `realm_access.roles`) for Keycloak. The
  `DescopeClaimsReader` ignores it — Descope roles come from `tenants[<dct>].roles`.
  A new role must be granted in whichever reader applies, not just defined in the enum.

## If you are changing a role name

Do all four, in this order:

1. `roles.py`
2. `roles.ts`
3. The IdP (Descope console / Keycloak realm) — **the step that gets forgotten**
4. Grep for stragglers: `rg 'ktc-org-' --hidden -g '!.git'` (hits `docs/`, seed data, and
   the E2E fixtures too)
