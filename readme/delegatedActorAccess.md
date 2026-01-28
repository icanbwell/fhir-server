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
- the Consent must be currently effective (open-ended allowed):
  - `provision.period.start <= now` OR `provision.period.start` is missing
  - `provision.period.end >= now` OR `provision.period.end` is missing

### What Happens Next

After the query returns:

- If **no Consent** is found: delegated access is treated as **not permitted** (request fails authorization).
- If **exactly one Consent** is found: it is used to build delegated-access filtering rules.
- If **multiple Consents** are found: access is rejected as ambiguous.
  - The code throws a `500` error ("Multiple active Consent resources found...") which indicates a data issue.

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
Audit logs will have the reference of delegated actor as the auditEvent.agent.

## Config

- `ENABLE_DELEGATED_ACCESS_FILTERING`: enables delegated access filtering.
- `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIER`: the system URI used to identify sensitive data categories in `meta.security` codings (default: `https://fhir.icanbwell.com/4_0_0/CodeSystem/sensitive-data-category`).
