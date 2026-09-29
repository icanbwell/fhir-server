# Delegated Organization-Actor Access (Consent-Reference Entitlements)

> **Status:** Implemented. This document is a retrospective record of the design and the
> work done — checkboxes are marked complete rather than used for tracking in-progress work.

**Goal:** Support a second delegated-actor token shape alongside the existing human-delegate
(`RelatedPerson`) flow: a service/organization principal acting on a Person it manages, with
no human grantee. This flow's token carries `act.reference` = `Organization/<id>` instead of
`RelatedPerson/<id>`, and its `entitlements` claim carries a `Consent/<id>` reference instead
of a bare purpose-of-use code.

**Architecture:** The `entitlements` Consent reference is resolved once, at authentication
time (`AuthService.processUserInfo`), into the real `provision.purpose` code — never at
audit-log-build time — so there is exactly one code path that guarantees a raw resource
reference never reaches `purposeOfEvent`. The per-person Consent search
(`DelegatedAccessRulesManager.fetchConsentResourcesAsync`) is skipped entirely for an
`Organization` actor rather than adapted, since that flow's authorizing Consent is org-level
(no `patient` field) and could never satisfy that query anyway — fhir-server trusts the
issuing service's own verification for this actor type instead of re-deriving it.

**Tech Stack:** Node.js / CommonJS, passport-jwt, MongoDB, Jest.

## Global Constraints

- A bare-code (legacy) `entitlements` value must stay byte-for-byte unchanged and fully
  synchronous — `processUserInfo` only awaits anything when a `Consent/<id>`-shaped entry is
  actually present, so pre-existing synchronous test assertions across the codebase don't
  need to change.
- `null` vs `[]` is a load-bearing distinction throughout: `null` = "genuinely unresolvable"
  (not found, or ambiguous) → caller fails closed; `[]` = "resolved successfully, no codes" →
  request still succeeds with an empty `purposeOfEvent`.
- A transient DB/lookup failure must never be indistinguishable from "Consent not found" —
  it rejects (`isTransient`/`statusCode: 503`, this codebase's existing convention for
  transient-infra failures) rather than resolving to `null`, since `verify()` re-resolves
  entitlements on every request (no cross-request caching) and a permanent 401 for a brief
  DB hiccup would be wrong.
- No tenant/access-tag re-validation of the entitlements Consent's authorization itself — that
  was already verified by the issuing service before minting the token; fhir-server only
  guards against resolving to the *wrong* resource (ambiguous bare-id match), not re-deriving
  authorization.

---

## Task 1: Accept `Organization` as a valid delegated-actor type

- [x] Added an allow-list of valid `act.reference` resource types (`RelatedPerson`,
      `Organization`) in `src/constants.js`.
- [x] `AuthService.processForDelegatedActor` checks the JWT `act.reference`'s resource type
      against that allow-list instead of a hardcoded `RelatedPerson`-only check
      (`src/strategies/authService.js`).

## Task 2: Resolve `Consent/<id>` entitlements into `purposeOfEvent`

- [x] `DelegatedAccessRulesManager.resolvePurposeOfEventCodesAsync` / `resolveConsentPurposeCodesAsync`
      (`src/utils/delegatedAccessRulesManager.js`): dispatches per-entitlement (bare code
      passthrough vs. Consent dereference by id), returns `null` on unresolvable/ambiguous,
      `[]` on resolved-but-empty, and rethrows (marked transient/503) on a genuine lookup error.
- [x] `AuthService.processUserInfo` calls it only when an entitlement actually parses to a
      `Consent` reference; on `null` it rejects with `done(null, false, { reason:
      'delegated_actor_consent_not_found' })` (401); on a rejection it lets the promise
      propagate to `verify()`'s existing `.catch()` chain (503).
- [x] `verify()`'s three call sites into `processUserInfo` updated (`return`/`.catch()`) so a
      rejection from the now-`async` `processUserInfo` can't become an unhandled rejection.

## Task 3: Skip the per-person Consent gate for `Organization` actors

- [x] `DelegatedAccessRulesManager.getFilteringRulesAsync` returns a trust-everything result
      (no `consentId`, empty `deniedSensitiveCategories`) without querying Mongo when the actor
      is `Organization/<id>`.
- [x] `hasValidConsentAsync` guards `actor.consentPolicy` assignment behind `if (consentId)` so
      it doesn't produce `"Consent/null"` for this actor type.

## Task 4: Surface the entitlements Consent as `agent.policy`

- [x] `AuthService.processUserInfo` stores the raw, successfully-resolved Consent reference on
      `context.actor.consentPolicy` — the same field the per-person `RelatedPerson` flow
      already used, since the two flows never both apply to the same actor.
- [x] `AuditLogger.buildAgents` already surfaced `actor.consentPolicy` as the delegated actor
      agent's `agent.policy`; no change needed there.

## Task 5: Correctness/security hardening on the Consent lookup

- [x] Distinguished a transient DB/lookup failure from a genuine "not found": the former
      rethrows marked `isTransient`/`statusCode: 503` instead of resolving to `null`, so it
      surfaces as a retryable error rather than a permanent-looking 401.
- [x] The bare, authority-less Consent id lookup (no UUID, no source-authority qualifier) now
      checks for multiple matches and returns `null` instead of blindly taking the first
      result — prevents a same-id Consent collision across tenants from substituting the
      wrong tenant's `provision.purpose` codes into this request's audit trail.
- [x] That lookup queries by `_sourceId` rather than the FHIR-facing `id`, and its Consent
      fetch is wrapped in the same `customTracer.trace(...)` call used by the existing
      per-person Consent lookup.

## Task 6: Local testing infrastructure

- [x] Local Keycloak realm/compose config gained a second delegated-access test user minting
      an `Organization` actor + `Consent/<id>` entitlement token, alongside the existing
      `RelatedPerson` one.
- [x] `readme/delegatedActorAccess.md`: documents both actor shapes, both entitlements shapes,
      the fail-closed behavior, the Organization Consent-gate bypass, and `agent.policy`.
- [x] Verified end-to-end against a local stack: seeded a matching `Consent`, generated a
      token via the new test user, confirmed a protected read succeeds and the resulting
      AuditEvent's `purposeOfEvent` resolves to the real purpose code (not the raw reference);
      confirmed an unresolvable Consent now rejects at auth time instead of succeeding with an
      empty `purposeOfEvent`.

## Explicitly out of scope

- Re-validating the entitlements Consent's own authorization shape (status/category/period) —
  that's the issuing service's job at mint time; fhir-server only dereferences it for the
  purpose code.
- Deployment.
