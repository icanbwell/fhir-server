# Patient Data View Control

A member can hide specific resources (for example the records from one data connection) with a
data view control Consent. Every resource the Consent references is left out of what the member
reads, on every read path the member can use.

## Who it applies to

- **Member tokens** (patient-scoped tokens with a person id) whose Person's owner is listed in
  `CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL`. The owner is the Person's `owner` security tag.
  Members of other clients are unaffected, and with no client listed the feature is off.
- **Service and admin tokens are not filtered.** Pipelines, deletion and other internal flows need
  the full record. A service reading on a member's behalf can opt in on Person `$everything` with
  `_applyDataViewControl=true`; the Person in the URL is then filtered as the member would be. See
  [patientEverything.md](patientEverything.md#_applydataviewcontrol) and
  `docs/adr/0004-service-token-opt-in-for-data-view-control-on-person-everything.md`.

## Format of the Consent

- `status`: `active`. A Consent with any other status (`inactive`, `draft`, `rejected`,
  `entered-in-error`, ...) hides nothing.
- `category.coding` contains:
```
{
  "system": "http://www.icanbwell.com/consent-category",
  "code": "dataConnectionViewControl"
}
```
- `patient.reference`: the member's [proxy patient](proxyPatient.md), `Patient/person.<person uuid>`.
- `provision.data[].reference.reference`: each resource to hide, as `<ResourceType>/<id>`. The id
  can be the resource's uuid or its source id.

All of the Person's active view control Consents apply, whichever patient they name in
`provision.actor`.

Example Consent:
```
{
  "resourceType": "Consent",
  "id": "924c184e-b830-550b-9296-6480ac5a2df2",
  "meta": {...},
  "status": "active",
  "scope": {
    "coding": [
      {
        "system": "http://terminology.hl7.org/CodeSystem/consentscope",
        "code": "patient-privacy"
      }
    ]
  },
  "category": [
    {
      "coding": [
        {
          "system": "http://www.icanbwell.com/consent-category",
          "code": "dataConnectionViewControl"
        }
      ]
    }
  ],
  "patient": {
    "reference": "Patient/person.f31193f4-95c0-4218-aa7d-a4dc86f4860a"
  },
  "provision": {
    "actor": [
      {
        "id": "Patient/3c776efa-e42f-4351-a850-fdc203a2bf5f",
        "role": {
          "coding": {
            "code": "dependents"
          }
        },
        "reference": {
          "reference": "Patient/3c776efa-e42f-4351-a850-fdc203a2bf5f"
        }
      }
    ],
    "data": [
      {
        "id": "4c4b97e8-29cf-58db-9edd-f8136d19ceb2",
        "meaning": "instance",
        "reference": {
          "reference": "Encounter/24753e41-956d-4c4a-86f4-130920d7ea68"
        }
      }
      //...any more excluded resources
    ]
  }
}
```

With this Consent, the member's reads never return `Encounter/24753e41-956d-4c4a-86f4-130920d7ea68`.

## Read paths

| Path | Behaviour |
|---|---|
| REST search (array, `_bundle`, streaming, ndjson) | the hidden resources are left out |
| REST read-by-id | a hidden resource is a 404, identical to a missing one |
| GraphQL v1 (`/$graphql`) and v2 (`/$graphqlv2`) | left out, including nested reference resolution |
| GraphQL v1 mutations (`updateGeneralPractitioner`, the CareTeam mutation) | the resource to change is looked up with the filter, so a hidden one is reported as not found and is not changed |
| `/mcp` search tools | left out |
| Patient and Person `$everything` | left out, including responses served from the Redis cache |
| Composition sections | see below |

Not filtered:
- History and version reads (`_history`): rejected for member tokens, so they can't return a hidden
  resource.
- `$graph` and `$summary`: not covered yet.
- `_include` and `_revinclude`: accepted but not implemented, so no search returns included
  resources. If they are implemented, the included resources need this filter too (a test fails
  when that happens).

A unit test (`06d_patientDataViewControlConsent.test.js`) lists every call to the search operations
that read paths end in, and requires each to apply the filter or name why it skips it. A new read
path fails that test until someone decides.

The filter is added to the query as an `_id:not` of the hidden ids. A caller's own `_id:not` is
kept alongside it.

## Composition sections

A Composition section with an `entry` that references a hidden resource is removed, whether the
entry uses the uuid or the source id. The whole section goes, because its narrative and other
entries describe the hidden resource. So a section that mixes hidden and visible resources is
removed too.
- Nested sections are judged on their own entries: a hidden child is removed and its parent stays.
- The Composition itself is still returned, without `section` if every section was removed.
- Compositions in `contained` are filtered the same way.
- Only `section.entry` is checked, not `section.focus`, and the Composition's top-level `text` is
  not changed.

This applies on every path above, including `_elements`, and to `$everything` responses replayed from the
Redis cache.

## Loading the Consent

The Consent is looked up once per request, however many resolvers or queries the request runs,
and only for members of enrolled clients. The lookup uses the `consent_of_linked_person`
`{status, patient._uuid}` index.

A replayed `$everything` response from the Redis cache is filtered with the Consent as it is when
the response is replayed: hidden resources are dropped, and so are the Composition sections that reference them.
This holds even when the response was cached before the Consent was written or before the client
was enrolled in `CLIENTS_WITH_DATA_CONNECTION_VIEW_CONTROL`. Each member has their own cache entry,
including for a Patient linked to more than one member, so one member's Consent never shapes
another member's response.

A Consent write invalidates the Person's own `$everything` cache (`Patient/person.<id>`), but not
the cache of `Patient/<id>/$everything`. When a Consent stops hiding a resource, that response can
leave it out until the cache entry expires (`EVERYTHING_CACHE_TTL_SECONDS`, 300 seconds by default).

## Failures

The filter fails closed: if the block can't be determined, no data is returned.
- The member's Person has no owner tag: the request fails (an error status on REST, an `errors`
  entry on GraphQL, an error result on `/mcp`).
- The member's Person does not exist (for example, a token issued before the Person is created):
  this is not a failure. The member is linked to no Patient and has no Consent, so the read runs
  with nothing hidden and returns only what the patient scope allows.
- The Consent lookup fails: REST returns an error status, and GraphQL returns `errors`.
- Member `$everything` writes the response as it goes, so a failure there is a 200 with an error
  OperationOutcome and no clinical resources.
- With the service-token opt-in, the Person and Consent are loaded before the response starts, so a
  failure is an HTTP error.
