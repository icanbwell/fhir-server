# Delegated Actor Consent Based Filtering (Upcoming Changes)

A delegated access token is a patient-scoped token which has an `act` field indicating an actor acting on behalf of `clientFhirPersonId`.

```
// JWT Payload
{
  "clientFhirPersonId": <personId>,
  "act": {
    "reference": <Reference to delegated actor>
  }
  // rest of the payload
}
```

When we access the patient data using a delegated access token, it will look up a consent related to grantor and grantee and based on that:

- Add restrictions to accessing data
- Hiding sensitive tagged resources
- Generate audit logs for the delegated actor

Given below is the detailed process that will happen once a delegated token is detected.

## Delegated Actor Consent Fetching

When **delegated access filtering** is enabled, the server looks up a single active `Consent` that ties:

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
- Invalid `act.reference` format (when filtering enabled): 401 Unauthorized — the `act.reference` must be a valid `ResourceType/id` string
- Malformed `act` claim (missing `reference` field): 401 Unauthorized only when `VALIDATE_DELEGATED_ACCESS_TOKEN` is enabled; otherwise silently ignored
- `ENABLE_DELEGATED_ACCESS_FILTERING` disabled: the `act` claim is completely ignored, no error is thrown

## Building Filtering Rules

When a single matching `Consent` is found, the server extracts filtering rules used to **exclude sensitive categories** from delegated access.

In particular, it walks **nested provisions** under `Consent.provision.provision` and looks for `deny` provisions that contain `securityLabel` entries.

- Each `securityLabel` whose `system` matches the configured `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIER` contributes a sensitive category code to an **excluded list**.
- That excluded list becomes the delegated-access filtering rules (used downstream to filter out data tagged with those sensitive categories).

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
        system: sensitiveCategorySystemIdentifier,
        code: { $in: deniedSensitiveCategories }
      }
    }
  }
}
```

### Behavior

- If **no delegated actor** is present (normal user request): the original query is returned unchanged.
- If **no denied categories** exist: the original query is returned unchanged.
- If **denied categories** exist: the filter is applied to exclude those resources.

## Audit Logging
When a delegated actor is present, the audit event contains **two agents**:
- **Patient agent** (`requestor: false`): the patient on whose behalf the action is performed (`Patient/person.<personId>`)
- **Delegated actor agent** (`requestor: true`): the actor from `act.reference`

The `source.observer` references the delegated actor.

## Config

- `ENABLE_DELEGATED_ACCESS_FILTERING`: true/false — **enables the delegated access logic**. When `false`, the `act` claim in the JWT is completely ignored and no delegated actor detection, consent lookup, or filtering occurs. When `true`, the server parses the `act.reference` field, performs consent lookups, applies filtering rules, and generates two-agent audit events.
- `VALIDATE_DELEGATED_ACCESS_TOKEN`: true/false — **controls strict validation of the `act` claim format**. Only relevant when the `act` claim is present but malformed (e.g. missing `reference` field, or `reference` is not a string). When `true`, a malformed `act` claim causes authentication failure (401). When `false` and `ENABLE_DELEGATED_ACCESS_FILTERING` is `true`, a malformed `act` claim is silently ignored (the request proceeds without a delegated actor).
- `DATA_SHARING_ACCESS_CONSENT_CODES`: comma-separated list of consent category codes used to identify data-sharing-access consents. Defaults to `dataSharingAccess`. Used in `category.coding` filter when querying for delegated actor consents.
- `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIER`: the system URI for sensitive data category codes in `meta.security`. Defaults to `https://fhir.icanbwell.com/4_0_0/CodeSystem/sensitive-data-category`.
- `DELEGATED_ACCESS_FILTERING_RULES_CACHE_TTL_SECONDS`: TTL (in seconds) for caching filtering rules in Redis. Defaults to `300`.
- `ENABLE_REDIS_CACHE_READ_FOR_DATA_SHARING_ACCESS_CONSENT`: true/false — **gates reading cached filtering rules from Redis**. Requires `ENABLE_REDIS` to also be `true`. When disabled, filtering rules are always fetched from the database (but still written to Redis for warming). When enabled, cached rules are read from Redis to avoid repeated database lookups.
