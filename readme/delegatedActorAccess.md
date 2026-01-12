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

- Each `securityLabel` whose `system` matches one of the configured `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIERS` contributes a sensitive category code to an **excluded list**.
- That excluded list becomes the delegated-access filtering rules (used downstream to filter out data tagged with those sensitive categories).

## Updating MongoQuery based on filtering rules
TODO

## Config

- `ENABLE_DELEGATED_ACCESS_FILTERING`: enables delegated access filtering.
- `SENSITIVE_CATEGORY_SYSTEM_IDENTIFIERS`: optional list of substrings used when reading denied categories from nested provisions (default includes `CodeSystem/sensitive-data-category`).
