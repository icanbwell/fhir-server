# Delegated Actor Consent Based Filtering

A delegated access token is a patient-scoped token which has an `act` and `sub` field indicating an actor acting on behalf of `clientFhirPersonId`.

```
// JWT Payload
{
  "clientFhirPersonId": <personId>,
  "act": {
    "reference": "RelatedPerson/<id>",
    "sub": "<sub claim>"
  },
  "entitlements": ["<entitlement code>"] // optional; recorded on the audit event (see Audit Logging)
  // rest of the payload
}
```

When we access the patient data using a delegated access token, it will look up a consent related to grantor and grantee and based on that:

- Add restrictions to accessing data
- Hiding sensitive tagged resources
- Generate audit logs for the delegated actor

Given below is the detailed process that will happen once a delegated token is detected.

## Delegated Actor Detection

When `ENABLE_DELEGATED_ACCESS_DETECTION` is enabled, the server inspects the JWT `act` claim during authentication:

1. **No `act` claim**: proceeds normally (no delegated actor)
2. **`act` is a string**: logged and skipped (future format, not yet supported)
3. **`act` is an object with `reference: "RelatedPerson/<id>"` (or, since DCON-5395, `"Organization/<id>"`) and `sub: "<sub>"`**: delegated actor is detected and set on `context.actor`
4. **Any other format**: authentication fails (401) with message indicating the expected format

Two actor shapes are supported for `act.reference`:

- **`RelatedPerson/<id>`** — a human delegate acting on a grantor's behalf, via the Health Circle / Appointment-of-Representative flow (PARS/BIG's `POST /token/delegate`).
- **`Organization/<id>`** (DCON-5395/DCON-5236) — a backend/service-integration client acting on a Person it has itself onboarded, with no human grantee anywhere in the flow. Minted by BIG's RFC 8693 token-exchange grant for client-initiated access (see [RFC: Delegated Token Generation for Client-Initiated Access](https://icanbwell.atlassian.net/wiki/spaces/ENTARCH/pages/6652493827)). See "Organization Actors" below — the Consent lookup and filtering-rules flow differ for this actor type.

When a delegated actor is detected, `userType` is set to `delegatedUser` regardless of what the token claims.

When `ENABLE_DELEGATED_ACCESS_DETECTION` is disabled, the `act` claim is completely ignored.

## Delegated Actor Consent Fetching

When a delegated actor is detected, the server looks up a single active `Consent` that ties:

- grantor person (as a proxy `Patient/person.<personIdFromJwtToken>`)
- grantee delegated actor (from the JWT `act.reference` reference)


## Consent Query

The delegated actor Consent lookup is a MongoDB query against `Consent_<base_version>` with these constraints:

- `status` must be `active`
- `provision.type` must be `permit`
- `patient` must match the proxy patient for the requesting person:
  - `patient.reference = Patient/person.<personIdFromJwtToken>`
- `provision.actor.reference` must match the delegated actor reference (`act.reference`):
  - `provision.actor.reference._uuid = <delegatedActor>`
- `category.coding` must contain the data sharing access consent category:
  - `system = http://www.icanbwell.com/consent-category` and `code` in configured `DATA_SHARING_ACCESS_CONSENT_CODES`
- the Consent must be currently effective (open-ended allowed):
  - `provision.period.start <= now` OR `provision.period.start` is missing
  - `provision.period.end >= now` OR `provision.period.end` is missing

### What Happens Next

After the query returns:

- If **no Consent** is found: delegated access is treated as **not permitted** (request fails authorization).
- If **exactly one Consent** is found: it is used to build delegated-access filtering rules.
- If **multiple Consents** are found: access is rejected as ambiguous.

### Error Cases
- No active Consent found: Forbidden 403 — `"actor {actor} doesn't have enough permissions to perform this action"`
- Multiple Consents found: Forbidden 403 — `"ambiguous permissions found for the actor {actor}"`
- Invalid `act` claim format (when detection enabled): 401 Unauthorized — the `act` must be an object with `reference` and `sub` field.

## Organization Actors (DCON-5395/DCON-5236)

The Consent Query above ties a grantor **person** to a delegated actor via a `patient`-scoped Consent. That model doesn't apply when the delegated actor is an `Organization` (BIG's token-exchange grant for client-initiated access): the authorizing Consent for that flow is an **org-level grant, established once at client onboarding, with no `patient` field at all** — it authorizes the Organization generally, not a specific person (see the RFC for the full Consent shape).

Because that Consent can never satisfy the `patient.reference` match above, `DelegatedAccessRulesManager.getFilteringRulesAsync` **skips the per-person Consent lookup entirely** when the actor reference is `Organization/<id>`, rather than trying to adapt the query. This is a deliberate trust boundary, not an oversight: BIG already verifies Person ownership and an active org-level Consent (`dataSharingAccess` category, Treatment scope, matching `provision.actor`) before it ever mints the token — fhir-server trusts that mint-time verification for this actor type, the same way it trusts every other signed JWT claim, rather than re-deriving a per-person consent that was never meant to exist.

Consequences of the skip:
- `hasValidConsentAsync` returns `true` unconditionally for an `Organization` actor — no database query, no ambiguous/no-consent rejection path.
- No `deniedSensitiveCategories` are derived from a Consent (there is no nested `provision.provision` to walk) — the sensitive-data exclusion filter falls back to its always-on `unclassified` exclusion only (see "Filtering of Unclassified Resources" below).
- `actor.consentPolicy` is left unset for this actor type — there is no per-person Consent reference to point at.
- The org-level Consent named in the JWT's `entitlements` claim is unrelated to this gate (`hasValidConsentAsync` never dereferences it). It's used for two other things instead: `purposeOfEvent` resolution, and populating `agent.policy` on the AuditEvent (see below) — both handled in `AuthService.processUserInfo` at authentication time, not here.

## Building Filtering Rules

When a single matching `Consent` is found, the server extracts filtering rules used to **exclude sensitive categories** from delegated access.

In particular, it walks **nested provisions** under `Consent.provision.provision` and looks for `deny` provisions that contain `securityLabel` entries.

- Each `securityLabel` whose `system` matches the configured `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIER` contributes a sensitive category code to an **excluded list**.
- That excluded list becomes the delegated-access filtering rules (used downstream to filter out data tagged with those sensitive categories).

## Filtering of Unclassified Resources

Resources tagged with `unclassified` in `meta.security` are **always filtered out** for delegated users, regardless of what the Consent's denied categories contain. If a resource has an `unclassified` tag under the sensitivity category system (`https://www.icanbwell.com/sensitivity-category`), it will not be returned to the delegated user.

This is enforced by always appending `unclassified` to the list of codes to exclude in the sensitive data exclusion filter.

## Applying Filtering Rules to Search Queries

When filtering rules contain denied sensitive categories, the server modifies the MongoDB search query to exclude resources tagged with those categories.

- Resources that don't contain any sensitive tag are included.
- Resources that contain sensitive tags which are not present in excluded categories are included.

### Filter Logic

The sensitive data exclusion filter is appended to the search query using `$and` composition:

```javascript
{
  $and: [
    originalQuery,
    sensitiveDataExclusionFilter
  ]
}
```

The `sensitiveDataExclusionFilter` **excludes any resource that contains at least one denied sensitive category**.

This correctly handles resources that may have **multiple** sensitive-category codings in `meta.security`: if **any** coding is denied, the entire resource is excluded.

```javascript
{
  'meta.security': {
    $not: {
      $elemMatch: {
        system: SENSITIVE_CATEGORY.SYSTEM,
        code: { $in: deniedSensitiveCategories }
      }
    }
  }
}
```

### Behavior

- If **no delegated actor** is present (normal user request): the original query is returned unchanged.
- If a delegated actor is present, resources tagged as `unclassified` are **always excluded**, regardless of whether the Consent has any denied categories.
- If **denied categories** exist: those categories are excluded in addition to `unclassified`.
- Filtering is **only applied to patient-scoped resources** (e.g., Observation, Condition). Non-patient-scoped resources (e.g., Practitioner) are not filtered.

## Operation Access Control

Delegated users are restricted to **read-only** operations. Access is enforced by `OperationAccessManager` which delegates to `DelegatedAccessManager`.

| Allowed | Denied |
|---------|--------|
| `search` | `create` |
| `searchById` | `update` |
| `everything` | `merge` |
| `graph` | `patch` |
| `graphql v1 queries` | `remove` |
| `graphql v2 queries`| `history` |
| | `historyById` |
| | `searchByVersionId` |
| | `graphql mutation` |

Any denied operation returns **403 Forbidden**. GraphQL mutations return an error in the GraphQL response body.

## Redis Caching

Redis response caching is **disabled** for delegated users. The `$everything` and `$summary` operations skip both cache reads and writes when the requesting user is a delegated actor.

## Audit Logging
When a delegated actor is present, the audit event contains **two agents**:
- **Patient agent** (`requestor: false`): the patient on whose behalf the action is performed (`Patient/person.<personId>`)
- **Delegated actor agent** (`requestor: true`): the actor from `act.reference`

The `source.observer` references the delegated actor.

### Purpose of Event (Entitlements)

If the delegated user's JWT carries an `entitlements` array, those values are copied into `context.purposeOfUse` during authentication and then surface as `purposeOfEvent.coding` on the two-agent AuditEvent. `entitlements` supports two shapes:

1. **Legacy: bare v3-ActReason code(s)** — e.g. `"entitlements": ["FAMRQT"]`. Each code is copied through **as-is**, with no validation or mapping, and becomes one `purposeOfEvent[].coding[]` entry.
2. **Consent reference (DCON-5395)** — e.g. `"entitlements": ["Consent/<id>"]`. This is the shape minted by BIG's token-exchange grant for client-initiated access (DCON-5236): the token has no live end-user session to carry a bare ActReason code, so it instead points at the org-level `Consent` created during client onboarding. During authentication, `AuthService.processUserInfo` detects the `Consent/<id>` shape and calls `DelegatedAccessRulesManager.resolvePurposeOfEventCodesAsync` to dereference the `Consent`, substituting its `provision.purpose[].code` values in place of the raw reference before it is ever stored on `context.purposeOfUse`. A bare-code `entitlements` array skips this resolution entirely and stays synchronous.

**If the Consent named in `entitlements` cannot be resolved** (deleted, wrong id, transient DB error), authentication fails closed: `processUserInfo` rejects with `done(null, false, { reason: 'delegated_actor_consent_not_found' })` (401), the same way any other malformed/unverifiable claim is rejected. This is a fail-closed change from an earlier iteration that silently proceeded with an empty `purposeOfEvent` — a `Consent/<id>` entitlement is supposed to be verifiable proof of a purpose, so failing to verify it now denies the request rather than degrading quietly. This is distinct from "the Consent was found but has no `provision.purpose` codes," which still just produces an empty `purposeOfEvent` on an otherwise-successful request (a data-quality issue, not an authorization failure).

In both cases the resulting codes are rendered into `purposeOfEvent[].coding[]` with `system` always `http://terminology.hl7.org/CodeSystem/v3-ActReason`. If the JWT has no `entitlements` array (or it is empty), or a resolved Consent has no purpose codes, `purposeOfEvent` is omitted from the audit event.

### Consent Policy (agent.policy)

Separately from `purposeOfEvent`, each successfully-resolved `Consent/<id>` entitlement is also recorded as-is (the raw reference, not dereferenced further) on `context.actor.entitlementsConsentPolicies`, and `AuditLogger.buildAgents` folds it into the delegated actor agent's `agent.policy` — FHIR's designated slot for "the specific patient consent, guarantor funding, etc." that authorized the event. This is independent of the *other* source of `agent.policy`, `actor.consentPolicy` (the per-person grantor↔actor Consent from the `RelatedPerson` flow, set by `hasValidConsentAsync`) — the two are merged into a single array when both happen to be present, but neither implies the other. An `Organization` actor typically has only `entitlementsConsentPolicies` (no per-person consent exists for that flow); a `RelatedPerson` actor typically has only `consentPolicy` (its `entitlements` is usually a bare code, not a Consent reference).

For example, a JWT with `"entitlements": ["FAMRQT"]` produces:

```json
"purposeOfEvent": [
  {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/v3-ActReason",
        "code": "FAMRQT"
      }
    ]
  }
]
```

A JWT with `"entitlements": ["Consent/consent-uuid-123"]`, where that Consent has `provision.purpose: [{ "system": "http://terminology.hl7.org/CodeSystem/v3-ActReason", "code": "TREAT" }]`, produces the same shape but with the Consent's code substituted in:

```json
"purposeOfEvent": [
  {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/v3-ActReason",
        "code": "TREAT"
      }
    ]
  }
]
```

## Local Testing

### Generate a delegated access token

```
curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data 'username=delegated-patient@example.com' \
  --data password=password \
  --data grant_type=password \
  --data 'scope=patient/Patient.read patient/Practitioner.write patient/MedicationStatement.read access/*.read patient/Consent.* patient/Condition.* patient/Observation.read'
```

The generated token will contain:
```json
{
  "clientFhirPersonId": "4100e07d-60a8-48b3-840f-8b64e1f7fa16",
  "clientFhirPatientId": "dc75150f-892c-4a34-b9b9-2b21223a21d3",
  "act": {
    "reference": "RelatedPerson/36265db4-0da2-4436-b4e8-85bf7e52a425",
    "sub": "46265db4-0da2-4436-b4e8-85bf7e52a426"
  },
  "entitlements": ["FAMRQT"]
}
```

### Generate a delegated access token (Organization actor, DCON-5395/DCON-5236)

```
curl --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data 'username=delegated-org-client@example.com' \
  --data password=password \
  --data grant_type=password \
  --data 'scope=patient/Patient.read patient/Observation.read patient/Condition.read access/*.read'
```

The generated token will contain:
```json
{
  "clientFhirPersonId": "0b2ad38a-20bc-5cf5-9739-13f242b05892",
  "clientFhirPatientId": "22aa18af-af51-5799-bc55-367c22c85407",
  "act": {
    "reference": "Organization/50d67a31-af1f-4f30-8d41-51e90a5054fa",
    "sub": "client-abc"
  },
  "managingOrganization": "50d67a31-af1f-4f30-8d41-51e90a5054fa",
  "entitlements": ["Consent/8e4a1f26-3c9d-4b7e-9a02-6f1d5c8b2e90"]
}
```

A `Consent` with that exact `id`, matching the RFC's resource shape (org-level, no `patient` field, `provision.actor.reference` = the same `Organization/<id>` as `act.reference`, `provision.purpose` carrying the code you expect to see on the audit event), must actually exist before generating the token -- an unresolvable `Consent/<id>` entitlement now fails authentication closed (401, `delegated_actor_consent_not_found`) rather than just producing an empty `purposeOfEvent`.

## Composition Sensitive Section Filtering

When `ENABLE_DELEGATED_ACCESS_DETECTION` is enabled and the user is a `delegatedUser`, the server removes Composition sections whose sensitivity codes are **denied by the actor's Consent**.

The denied categories come from the Consent's nested `deny` provisions (`securityLabel` entries), pre-loaded onto `actor._filteringRules.deniedSensitiveCategories` by `DataSharingManager`.

**Behavior:**
- Sections with sensitivity codes in the Consent's denied list are removed
- The hardcoded `unclassified` sensitivity code is **always** folded into the denied set as well,
  regardless of what the grantor's Consent actually denies — mirroring the query-level exclusion in
  `DataSharingManager.updateQueryForDelegatedAccessSensitiveData`. This fold-in happens in
  `CompositionSectionFilterEnrichmentProvider.getDeniedSensitiveCategorySet`, not in the shared
  `filterCompositionSensitiveSections`/`shouldRemoveSection` utility itself, which stays a pure
  denylist-membership check.
- If a section has multiple `code.coding` entries and **any** matches a denied code, the section is removed
- Filtering is recursive — nested sections (`section.section`) are checked at every level
- If a parent section itself is sensitive, the entire section (including all children) is removed
- If actor has no `_filteringRules`, sections are returned unchanged

Filtering happens at the **enrichment level** via `EnrichmentManager`, across all read paths (search, searchById, searchByVersionId, history, everything, graph).

## Config

- `ENABLE_DELEGATED_ACCESS_DETECTION`: true/false — **gates the entire delegated access flow**, including Composition section filtering. When `false`, the `act` claim in the JWT is completely ignored. When `true`, the server parses the `act` claim, validates it, detects the delegated actor, performs consent lookups, applies filtering rules (including Composition section filtering), copies any JWT `entitlements` into `context.purposeOfUse` (recorded as `purposeOfEvent` on the audit event), and generates two-agent audit events. Invalid `act` formats result in 401 Unauthorized.
