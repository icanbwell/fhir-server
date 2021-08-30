# FHIR Server Cheatsheet

## Searching for Resources
You can search for patients by going to the /4_0_0/{resource} url e.g., 
https://fhir.prod-mstarvac.icanbwell.com/4_0_0/Patient

### Specifying the records you want
Use the _count query parameter e.g., 
https://fhir.dev.icanbwell.com/4_0_0/Practitioner?_count=10

The default is 10

### To select only specific fields from the resource e.g., id
Specify a comma separated list in `_elements` query parameter e.g.,
https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_elements=id

### Sorting records
Specify a comma separated list in `_sort` query parameter e.g.,
https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_count=10&_sort=meta.lastUpdated (ascending)
To specify sorted a field descending, prepend the field name with `-`
https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_count=10&_sort=-meta.lastUpdated 

Multiple sort fields can be specified:
https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_count=10&_sort=-meta.lastUpdated,id 


#### Additional Filters

| Filter By | Query Parameter | Example | Supported for Resources  |  |
|---|---|---|---|---|
| By ids or list of ids  | id=a,b | https://fhir.dev.icanbwell.com/4_0_0/Practitioner?id=1194724047,546333  | All |  |
| By name | name=Jordan | https://fhir.dev.icanbwell.com/4_0_0/Practitioner?name=Jordan | Patient, Practitioner |  |
| By family name | family=Jordan | https://fhir.dev.icanbwell.com/4_0_0/Practitioner?family=Jordan | Patient, Practitioner |  |
| By identifier | identifier=system&#124;value | https://fhir.dev.icanbwell.com/4_0_0/Practitioner/?identifier=http://hl7.org/fhir/sid/us-npi&#124;1487831681 | All |  |
| By source |  source=url | https://fhir.dev.icanbwell.com/4_0_0/Practitioner?source=http://medstarhealth.org/insurance  | All |  |
| By security tag | _security=https://www.icanbwell.com/{access or owner or vendor}|{value} | https://fhir.staging.bwell.zone/4_0_0/Organization?_security=https://www.icanbwell.com/access|medstar | All |  |
| By versionId | versionId=x | https://fhir.dev.icanbwell.com/4_0_0/Practitioner?versionId=2 | All |  |
| Updated after a datetime | _lastUpdated=gt{date} | https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_lastUpdated=gt2021-01-18 | All |  |
| Updated before a datetime | _lastUpdated=lt{date} | https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_lastUpdated=lt2021-01-18 | All |  |
| Updated between dates | _lastUpdated=lt{date}&_lastUpdated=gt{date} | https://fhir.prod-mstarvac.bwell.zone/4_0_0/QuestionnaireResponse?_lastUpdated=gt2021-01-16&_lastUpdated=lt2021-01-17 | All |  |
| By missing field | {field_name}:missing={true or false} | https://fhir.staging.bwell.zone/4_0_0/ExplanationOfBenefit?patient:missing=true |  |  |
| By field and value | {field name}={field value} | https://fhir.dev.icanbwell.com/4_0_0/PractitionerRole?organization=-824888254&practitioner=1487831681 | All |  |


## Requesting a single resource
Add the id of the resource in the url e.g.,
https://fhir.dev.icanbwell.com/4_0_0/HealthcareService/1952669236-MGB-MGTB

#### Getting history for a resource
Add `/_history` to a resource url to get the history of changes to that resource e.g.,
https://fhir.dev.icanbwell.com/4_0_0/HealthcareService/1952669236-MGB-MGTB/_history

## Creating a resource
There are two ways to do this:
1. (Recommended) Use the $merge endpoint which handles both creating a new resource and updating an existing resource.  This is the recommended path to avoid the timing issue where someone else may add that resource between the time you checked the resource exists and sent the call to add it.
2. Use the POST method.  You can POST the resource as the body to /4_0_0/{resource} e.g., /4_0_0/Patient.


## Updating a resource
There are two ways to do this:
1. (Recommended) Use the $merge endpoint which handles both creating a new resource and updating an existing resource.  This is the recommended path to avoid the timing issue where someone else may update that resource between the time you checked the resource exists and sent the call to add it.
2. Use the PUT method.  You can PUT the resource as the body to /4_0_0/{resource}/{id} e.g., /4_0_0/Patient/123

## Updating a set of resources
The $merge method supports sending a list of resources (which can be of different resource types).

## Deleting a resource
The DELETE method allows you to logically delete a resource.  You can send a DELETE call to /4_0_0/{resource}/{id} e.g., /4_0_0/Patient/123

## Requesting a graph
Use the $graph endpoint which accepts a GraphDefinition as the body.

## Paging
To page through the data specify the `_count` and the `_getpageoffset` query parameters e.g., https://fhir.staging.bwell.zone/4_0_0/ExplanationOfBenefit?_count=2&_getpagesoffset=2

## Fhir Client SDK
This is a python package that can make it easier to talk to FHIR servers.  Note this is optional; You can talk to our FHIR server using standard HTTP REST API.
https://github.com/icanbwell/helix.fhir.client.sdk

