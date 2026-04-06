# Delegated Actor Consent Based Filtering

A delegated access token is a patient-scoped token which has an `act` and `sub` field indicating an actor acting on behalf of `clientFhirPersonId`.

```
// JWT Payload
{
  "clientFhirPersonId": <personId>,
  "act": {
    "reference": "RelatedPerson/<id>",
    "sub": "<sub claim>"
  }
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
3. **`act` is an object with `reference: "RelatedPerson/<id>" and sub: "<sub>"`**: delegated actor is detected and set on `context.actor`
4. **Any other format**: authentication fails (401) with message indicating the expected format

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
        system: SENSITIVE_CATEGORY.SYSTEM,
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

## Audit Logging
When a delegated actor is present, the audit event contains **two agents**:
- **Patient agent** (`requestor: false`): the patient on whose behalf the action is performed (`Patient/person.<personId>`)
- **Delegated actor agent** (`requestor: true`): the actor from `act.reference`

The `source.observer` references the delegated actor.

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
  }
}
```

## Config

- `ENABLE_DELEGATED_ACCESS_DETECTION`: true/false — **gates the entire delegated access flow**. When `false`, the `act` claim in the JWT is completely ignored. When `true`, the server parses the `act` claim, validates it, detects the delegated actor, performs consent lookups, applies filtering rules, and generates two-agent audit events. Invalid `act` formats result in 401 Unauthorized.
