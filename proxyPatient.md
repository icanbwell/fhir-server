# Proxy Patient

Proxy patient is a virtual resource that does not exist in the FHIR Server. This is a concept that is used to connect clinical resources with the person resource directly without using the patient resource.

`"reference": "Patient/person.<person_id>"`

## Need

Users have patient records at multiple places e.g., health systems, payers, pharmacies etc.  They want to be able to look at their health data across these records and any care needs/tasks should be generated looking at all the user’s data.

A proxy patient is a FHIR Patient resource that acts as a proxy for FHIR Person resource where the FHIR resources do not allow referencing to a Person record.

In summary, if a patient id is prefixed with `person.` then the FHIR server rewrites the query to search all the patient records that are linked to the Person with the id that follows `person.`

## Using proxy patient in query

When a query parameter with proxy patient id is sent, it also includes ids of all Patient which are directly linked to the Person resource. And all resources linked to these Patient or Proxy Patient are returned.

![Proxy Patient Linking Example](src/images/proxyPatient.jpg)

Eg: For the following queries
- GET `<base_url>/Observation?subject=Patient/person.Person1`: All the Observations linked to Person and Patients will be fetched, i.e Observation1, Observation2 and Observation3

- GET `<base_url>/Composition?patient=Patient/person.Person1`: All the Compositions linked to Person and Patients will be fetched, i.e Composition1 and Composition2
