# FHIR GET Person $everything endpoint

The FHIR server supports the Person GET $everything endpoint of the FHIR specification (https://www.hl7.org/fhir/R4B/patient-operation-everything.html). It is used to retrieve all resources related to the provided person(s).

Internally, Person GET $everything is mapped to Patient GET $everything using a [proxy patient](proxyPatient.md) id (`person.<person_id>`):

`<base_url>/4_0_0/Person/<person1>/$everything` resolves the same underlying patient graph as `<base_url>/4_0_0/Patient/person.<person1>/$everything`

Because of this, all the general behavior, resources returned, and search/custom query parameters documented in [Patient $everything](patientEverything.md) apply equally here. This document only covers the behavior that is **specific to Person $everything**.

The two request forms are not fully interchangeable: `Subscription`, `SubscriptionStatus` and `SubscriptionTopic` are returned **only** when the request is made against the `Person` resource type. The proxy patient id form is a request against the `Patient` endpoint, so it does not return them.

It is mandatory to provide `id` either in the search query parameter or in the path parameter.
For example:

- <base_url>/4_0_0/Person/\<person1>/$everything
- <base_url>/4_0_0/Person/$everything?id=\<person1>
- <base_url>/4_0_0/Person/\<person1>,\<person2>/$everything (multiple persons)

## Person scoping (result narrowed to the requested person(s))

A single underlying Patient can be linked to more than one Person resource. When calling **Patient** $everything, all of those linked Person resources are returned, since the traversal has no notion of "which person the caller asked about."

**Person** $everything is different: the result is scoped down to only the Person id(s) that were explicitly requested (in the path or the `id`/`_id` query parameter). This scoping affects two things:

1. **Person resources returned** — only the requested Person(s) are included in the response. Any other Person resource that is also linked to the same underlying patient(s) (e.g. a sibling person) is fetched internally (to resolve the patient graph) but is **not** included in the response.

2. **Subscription / SubscriptionStatus / SubscriptionTopic** — these resource types identify the owning person via a `client_person_id` extension/identifier, and are matched on that alone. A resource of these types is returned if (and only if) its `client_person_id` refers to one of the explicitly requested person(s). Two consequences:

   - A subscription belonging to a sibling person that shares the same underlying patient is **not** returned, even though that sibling person's patient graph was traversed to build the response.
   - A subscription is still returned when the patient named by its `source_patient_id` is no longer linked to the requested person, because the patient graph is not part of the match.

   These three resource types are returned **only** for a request against the `Person` resource type. `Patient` $everything does not return them — including the proxy patient id form (`/4_0_0/Patient/person.<person_id>/$everything`), and regardless of the `Subscription`/`SubscriptionStatus`/`SubscriptionTopic` scopes on the token.

   The usual access control still applies on top of the `client_person_id` match: a requested person's subscriptions are only returned if the caller is permitted to read them, so data-sharing consent between clients gates them the same way it gates every other resource type.

### Example

Suppose `PersonA` and `PersonB` are both linked to the same `Patient/X` (e.g. two client persons sharing one connected patient record), and `PersonA` has its own `Subscription` (`client_person_id` = PersonA).

- `GET /4_0_0/Patient/X/$everything` returns `PersonA` and `PersonB`, and no `Subscription`.
- `GET /4_0_0/Patient/person.PersonA/$everything` returns only `PersonA` (not `PersonB`), and no `Subscription`.
- `GET /4_0_0/Person/PersonA/$everything` returns only `PersonA` (not `PersonB`) and `PersonA`'s `Subscription`.
- `GET /4_0_0/Person/PersonB/$everything` returns only `PersonB`, and no `Subscription` (the only subscription belongs to `PersonA`).
- `GET /4_0_0/Person/PersonA,PersonB/$everything` returns both `PersonA` and `PersonB` (both were explicitly requested) and `PersonA`'s `Subscription`.

### Notes

- Person resource scoping (point 1) applies both when the request is made against the `Person` resource type (path or `id`/`_id` on `/4_0_0/Person/$everything`) and when the same operation is requested via the equivalent proxy patient id form directly against the Patient endpoint (`/4_0_0/Patient/person.<person_id>/$everything`).
- Subscription family scoping (point 2) is different: those three resource types are returned only for a request against the `Person` resource type, not for the proxy patient id form.
- This scoping does not affect any other resource type — clinical and non-clinical resources linked to the resolved patient(s) are returned the same way as for Patient $everything.
- All other parameters (`_type`, `_since`, `_debug`, `_explain`, `_includePatientLinkedOnly`, etc.) and response headers work the same as documented in [Patient $everything](patientEverything.md).

## See also

- [Patient $everything](patientEverything.md) — shared mechanics, resources returned, and all search/custom query parameters.
- [Proxy Patient](proxyPatient.md) — how a Person id is resolved into the underlying linked Patient(s).
