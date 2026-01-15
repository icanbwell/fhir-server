# Delegated Actor Consent Based Filtering

## Delegated Actor Consent Fetching

When **delegated access filtering** is enabled, the server looks up a single active `Consent` that ties:

- grantor person (as a proxy `Patient/person.<personIdFromJwtToken>`)
- grantee delegated actor (from the JWT `act.sub` reference)

This logic is implemented in [src/utils/delegatedActorRulesManager.js](../src/utils/delegatedActorRulesManager.js) and is used as part of request authorization.

## Consent Query

The delegated actor Consent lookup is a MongoDB query against `Consent_<base_version>` with these constraints:

- `status` must be `active`
- `provision.type` must be `permit`
- `patient` must match the proxy patient for the requesting person:
  - `patient.reference = Patient/person.<personIdFromJwtToken>`
- `provision.actor.reference` must match the delegated actor reference (`act.sub`):
  - `provision.actor.reference._uuid = <delegatedActor>`
- the Consent must be currently effective (open-ended allowed):
  - `provision.period.start <= now` OR `provision.period.start` is missing
  - `provision.period.end >= now` OR `provision.period.end` is missing

Operational details:

- The cursor uses `MONGO_TIMEOUT` via `configManager.mongoTimeout`.
- The cursor hints `CONSENT_OF_LINKED_PERSON_INDEX` (`consent_of_linked_person`).

### What Happens Next

After the query returns:

- If **no Consent** is found: delegated access is treated as **not permitted** (request fails authorization).
- If **exactly one Consent** is found: it is used to build delegated-access filtering rules.
- If **multiple Consents** are found: access is rejected as ambiguous.
  - The code throws a `503` error ("Multiple active Consent resources found...") to avoid choosing an arbitrary Consent.

## Building Filtering Rules

When a single matching `Consent` is found, the server extracts filtering rules used to **exclude sensitive categories** from delegated access.

In particular, it walks **nested provisions** under `Consent.provision.provision` and looks for `deny` provisions that contain `securityLabel` entries.

- Each `securityLabel` whose `system` matches the configured `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIER` contributes a sensitive category code to an **excluded list**.
- That excluded list becomes the delegated-access filtering rules (used downstream to filter out data tagged with those sensitive categories).

## Applying Filtering Rules to Search Queries

When filtering rules contain denied sensitive categories, the server modifies the MongoDB search query to exclude resources tagged with those categories.

This logic is implemented in [src/operations/search/delegatedAccessQueryManager.js](../src/operations/search/delegatedAccessQueryManager.js) via `updateQueryForSensitiveDataAsync()`.

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

The `sensitiveDataExclusionFilter` includes resources that either:

1. **Have no sensitive-category tags** (no `meta.security` entry matching the sensitive category system), OR
2. **Have sensitive-category tags** but the `code` is **not in the denied list**

```javascript
{
  $or: [
    // Case 1: No sensitive-category tag at all
    {
      'meta.security': {
        $not: {
          $elemMatch: {
            system: sensitiveCategorySystemIdentifier
          }
        }
      }
    },
    // Case 2: Has sensitive-category tag, but code is allowed
    {
      'meta.security': {
        $elemMatch: {
          system: sensitiveCategorySystemIdentifier,
          code: { $nin: deniedSensitiveCategories }
        }
      }
    }
  ]
}
```

### Behavior

- If **no delegated actor** is present (normal user request): the original query is returned unchanged.
- If **no denied categories** exist: the original query is returned unchanged.
- If **denied categories** exist: the filter is applied to exclude those resources.

## Config

- `ENABLE_DELEGATED_ACCESS_FILTERING`: enables delegated access filtering.
- `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIER`: the system URI used to identify sensitive data categories in `meta.security` codings (default: `https://fhir.icanbwell.com/4_0_0/CodeSystem/sensitive-data-category`).
