---
name: cleanup-descope-e2e-data
description: Use when asked to clean up, delete, or purge leftover Descope E2E test data — the "E2E Test Clinic" tenants and their users that ui-tests-descope leaves behind (no auto-cleanup; the test stack's management key is IP-restricted, error E023017). Drives the Descope MCP tools.
---

# Clean up Descope E2E test data

## Overview

`make ui-tests-descope` signs up real tenants + users in the live Descope project
(`dev-kill-the-clipboard-scanner`) and **cannot clean up after itself** — the test stack's
management key is IP-restricted (`E023017`). This skill deletes that residue through the
**Descope MCP** tools (a different, working credential path).

E2E data is named with a stable prefix:
- **Tenants:** `E2E Test Clinic <unique>`
- **Users:** owner `E2E Test User <unique>` + invitee, both with `*@inbox.testmail.app` login IDs,
  and (for fresh test data) belonging **only** to their E2E tenant.

**Core mechanism:** `DeleteTenant` with `cascade: true` deletes users attached *only* to that
tenant and merely detaches shared ones — so deleting an `E2E` tenant removes its users in one
call without ever touching a user who also belongs to a protected tenant.

## NEVER delete (hard guardrails)

- **Wrong project.** Only ever run against project `dev-kill-the-clipboard-scanner`
  (id `P3EgKEuFdQFLSuhXYk7KNsvlroTd`). If `whoami` shows any other project — **especially
  production** — STOP and tell the user. Never `selectProject` to a prod project to delete.
- **`test-tenant-001` and `test-tenant-002`** — the seeded local multi-tenant dev fixtures.
- **Any tenant whose name does not start with `E2E`** (case-sensitive prefix). When in doubt, skip it.

## Workflow

This is a **destructive, confirmation-gated** operation. Do the read/plan steps, show the user
exactly what will be deleted, get an explicit "yes", then elevate and delete.

### 1. Confirm the project (read-only)
```
session({action: "whoami"})
```
Verify `project` / `projectId` is `dev-kill-the-clipboard-scanner` / `P3EgKEuFdQFLSuhXYk7KNsvlroTd`.
If not → STOP, report to user.

### 2. Find E2E tenants (read-only, no elevation)
```
tenants_read({operation: "LoadAllTenants"})
```
Filter `data.tenants` to those whose `name` starts with `E2E`. There is no server-side prefix
filter — filter client-side. Exclude everything in the guardrails list above.

### 3. Enumerate each tenant's members (read-only) — for the report + leftover sweep
```
users_read({operation: "SearchUsers", args: {tenantIds: ["<tenantId>"], limit: 100}})
```
Collect `userId`, `email`, and `userTenants` for each. (`userTenants` with a single entry ⇒
`cascade` will delete that user; multiple entries ⇒ it will only be detached.)

### 4. Present the plan and get explicit confirmation
List each tenant (`name` + `id`) and its users (`email` + `userId`). Ask the user to confirm,
citing the exact targets. **Wait for an affirmative reply.** Do not elevate before this.

### 5. Elevate write mode (only after confirmation)
```
session({action: "elevate", args: {reason: "<verbatim user request>"}})
```

### 6. Delete each tenant (cascades to single-tenant users)
```
tenants_write({operation: "DeleteTenant", args: {id: "<tenantId>", cascade: true}})
```

### 7. Sweep leftover E2E users (only if step 3 found shared/multi-tenant users `cascade` left behind)
Re-run `SearchUsers` (e.g. `args: {text: "E2E", limit: 100}`), keep only users still present whose
`name`/`email` is unmistakably E2E test data, then:
```
users_write({operation: "DeleteUsers", args: {userIds: ["<userId>", ...]}})
```

### 8. Verify
Re-run `tenants_read({operation: "LoadAllTenants"})` and confirm no `E2E`-prefixed tenants remain
(and `test-tenant-001/002` are untouched).

## Quick reference

| Step | MCP call | Elevation? |
|------|----------|------------|
| Check project | `session(whoami)` | no |
| List tenants | `tenants_read(LoadAllTenants)` | no |
| List a tenant's users | `users_read(SearchUsers, {tenantIds:[id]})` | no |
| Unlock writes | `session(elevate, {reason})` | — |
| Delete tenant + its users | `tenants_write(DeleteTenant, {id, cascade:true})` | yes |
| Delete specific users | `users_write(DeleteUsers, {userIds:[...]})` | yes |

## Common mistakes

- **Skipping the project check.** `whoami` first, every time. Deleting from the wrong project is unrecoverable.
- **Substring instead of prefix match.** Match names that *start with* `E2E`, not just contain it.
- **Elevating before confirmation.** The MCP elevation contract requires discovery → prepare →
  ask → elevate. Never elevate autonomously.
- **Expecting `DeleteTenant` to delete every user.** It only deletes users attached solely to that
  tenant; shared users are detached. Use the step-7 sweep for any genuinely-E2E shared/orphaned users.
- **Forgetting verification.** Re-list tenants at the end to prove the cleanup worked.