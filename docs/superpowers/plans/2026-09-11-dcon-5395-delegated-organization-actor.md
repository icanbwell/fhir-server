# DCON-5395: Delegated Organization-Actor Access (Consent-Reference Entitlements)

> **Status:** Implemented. This document is a retrospective record of the design and the
> work done — checkboxes are marked complete rather than used for tracking in-progress work.

**Ticket:** [DCON-5395](https://icanbwell.atlassian.net/browse/DCON-5395)
**RFC:** [RFC: Delegated Token Generation for Client-Initiated Access](https://icanbwell.atlassian.net/wiki/spaces/ENTARCH/pages/6652493827)
**Related:** DCON-5236 (BIG's token-exchange grant), [CIE-8632](https://icanbwell.atlassian.net/browse/CIE-8632) (FHIR app scopes for CRS/BIG)
**PR:** [icanbwell/fhir-server#2576](https://github.com/icanbwell/fhir-server/pull/2576) (branch `SC-DCON-5395`)

**Goal:** Support a second delegated-actor shape alongside the existing human `RelatedPerson`
flow — a backend/service-integration client (`Organization`) acting on a Person it has itself
onboarded, with no human grantee. BIG's token-exchange grant for this flow mints an
`entitlements` claim carrying a `Consent/<id>` reference instead of a bare `v3-ActReason`
code, and an `act.reference` of `Organization/<id>` instead of `RelatedPerson/<id>`.

**Architecture:** The `entitlements` Consent reference is resolved once, at authentication
time (`AuthService.processUserInfo`), into the real `provision.purpose` code — never at
audit-log-build time — so there is exactly one code path that guarantees a raw resource
reference never reaches `purposeOfEvent`. The per-person Consent search
(`DelegatedAccessRulesManager.fetchConsentResourcesAsync`) is skipped entirely for an
`Organization` actor rather than adapted, since that flow's authorizing Consent is org-level
(no `patient` field) and could never satisfy that query anyway — fhir-server trusts BIG's
mint-time verification for this actor type instead.

**Tech Stack:** Node.js / CommonJS, passport-jwt, MongoDB, Jest.

## Global Constraints

- A bare-code (legacy) `entitlements` value must stay byte-for-byte unchanged and fully
  synchronous — `processUserInfo` only awaits anything when a `Consent/<id>`-shaped entry is
  actually present, so ~40+ pre-existing synchronous test assertions across the codebase
  don't need to change.
- `null` vs `[]` is a load-bearing distinction throughout: `null` = "genuinely unresolvable"
  (not found, or ambiguous) → caller fails closed; `[]` = "resolved successfully, no codes" →
  request still succeeds with an empty `purposeOfEvent`.
- A transient DB/lookup failure must never be indistinguishable from "Consent not found" —
  it rejects (`isTransient`/`statusCode: 503`, this codebase's INC-322 convention) rather than
  resolving to `null`, since `verify()` re-resolves entitlements on every request (no
  cross-request caching) and a permanent 401 for a brief Mongo hiccup would be wrong.
- No tenant/access-tag re-validation of the entitlements Consent's authorization itself — that
  was already verified by BIG before minting the token; fhir-server only guards against
  resolving to the *wrong* resource (ambiguous bare-id match), not re-deriving authorization.

---

## Task 1: Accept `Organization` as a valid delegated-actor type

- [x] Added `DELEGATED_ACCESS.ALLOWED_ACTOR_RESOURCE_TYPES: ['RelatedPerson', 'Organization']`
      (`src/constants.js`).
- [x] `AuthService.processForDelegatedActor` checks the JWT `act.reference`'s resource type
      against that allow-list instead of a hardcoded `.startsWith('RelatedPerson/')`
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

- [x] `AuthService.processUserInfo` stores the raw (successfully-resolved) Consent reference(s)
      on `context.actor.entitlementsConsentPolicies`.
- [x] `AuditLogger.buildAgents` merges `actor.consentPolicy` (per-person, `RelatedPerson` flow)
      and `actor.entitlementsConsentPolicies` (org-level, `entitlements`-derived) into a single
      `agent.policy` array — either, both, or neither may be present.

## Task 5: Security-review fixes (from `claude[bot]`'s review of PR #2576)

- [x] Transient-error/401 conflation: fixed as described under Global Constraints.
- [x] Bare, authority-less Consent id lookup (`{ id }`, no UUID/authority) now checks for
      multiple matches and returns `null` instead of blindly taking `consents[0]` — mirrors
      `getFilteringRulesAsync`'s existing ambiguous-match handling; prevents a same-id Consent
      collision across tenants from substituting the wrong org's `provision.purpose` codes.

## Task 6: Local testing infrastructure

- [x] `keycloak-config/realm-import.json` + `docker-compose.yml`: new `delegated-org-client`
      test user minting an `Organization` actor + `Consent/<id>` entitlement token.
- [x] `readme/delegatedActorAccess.md`: documents both actor shapes, both entitlements shapes,
      the fail-closed behavior, the Organization Consent-gate bypass, and `agent.policy`.
- [x] Verified end-to-end against the local stack: seeded a matching `Consent`, generated a
      token via the new Keycloak user, confirmed `$everything` succeeds and the resulting
      AuditEvent's `purposeOfEvent` resolves to `TREAT` (not the raw reference); confirmed an
      unresolvable Consent now rejects at auth time instead of succeeding with an empty
      `purposeOfEvent`.
- [x] Verified against `fhir.dev.bwell.zone`: confirmed `Organization/50d67a31-af1f-4f30-8d41-51e90a5054fa`
      ("Network Demo") is a real dev tenant, created a matching org-level `Consent`
      (`Consent/9334b9dc-ea90-4a26-b1a0-1011c586c6ff`) there for future end-to-end testing.

## Task 7: Cross-team follow-up

- [x] Filed [CIE-8632](https://icanbwell.atlassian.net/browse/CIE-8632) asking Cloud
      Infrastructure Engineering to register FHIR app scopes for CRS (`user/Consent.*`, since it
      creates the org-level Consent at onboarding) and BIG (`user/Consent.read` only, since it
      only ever verifies the Consent — never creates/modifies it, per the RFC's
      self-approval-loop closure).

## Explicitly out of scope

- BIG/CRS's own client registration and scope configuration (tracked in CIE-8632, owned by
  another team).
- Re-validating the entitlements Consent's own authorization shape (status/category/period) —
  that's BIG's job at mint time; fhir-server only dereferences it for the purpose code.
- Deploying to sandbox (a deployment step, not a code change).
