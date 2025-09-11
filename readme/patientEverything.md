# FHIR GET Patient $everything endpoint

The FHIR server supports the Patient GET $everything endpoint of the FHIR specification (https://www.hl7.org/fhir/R4B/patient-operation-everything.html). This operation is used to retrieve all resources related to the provided patient. Along with the linked non-clinical resources upto depth 3.

It is mandatory to provide `id` either in search query parameter or in path parameter.
For example:

-   <base_url>/4_0_0/Patient/\<patient1>/$everything
-   <base_url>/4_0_0/Patient/$everything?id=\<patient1>

Sample $everything result for patient

```
{
  "entry": [
    {
      "id": "patient1",
      "resource": {
        "resourceType": "Patient",
        "id": "patient1"
        // <rest of resource fields>
      }
    },
    {
      "id": "example",
      "resource": {
        "resourceType": "Account",
        "id": "example"
        // <rest of resource fields>
      }
    },
    {
      "id": "2354-InAgeCohort",
      "resource": {
        "resourceType": "Observation",
        "id": "2354-InAgeCohort"
        // <rest of resource fields>
      }
    },
    {
      "id": "person1",
      "resource": {
        "resourceType": "Person",
        "id": "person1"
        // <rest of resource fields>
      }
    },
    // rest of resources
  ],
  "resourceType": "Bundle",
  "type": "searchset",
  "timestamp": "2025-04-20T03:31:07.077Z",
  "total": 4,
  "link": [
    {
      "relation": "self",
      "url": "<base_url>/4_0_0/Patient/patient1/$everything"
    }
  ]
}
```

## Notes
- If loading the result of each resource for $everything to node.js takes more than the specified time in MONGO_TIMEOUT (default 2 mins), a error is returned.
- Non-clinical resources are fetched for all references in the clinical resources except for references in these type of fields: Extension, ModifierExtension and Identifier. 
- All non-clinical references in a resource are fetched upto recursive depth of 3 in case type is infinitely recursive. Otherwise references are fetched till max depth possible.
  Eg: in case of Consent resource, references upto depth `provision.provision.provision` are fetched but references in `provision.provision.provision.provision` are ignored.

## Search query parameters

### id

It can be used if data related to more than one patient resources provided needs to be fetched. If `id` search query parameter is passed, then the path parameter is ignored.

For example: <base_url>/4_0_0/Patient/$everything?id=patient1,patient2

### \_type

This parameter can be used to narrow down the result of resources to the provided list of resources. 
For clinical resources the result of only top level resources will be narrowed 
and for non-clinical resources, it will searched for 3 level down starting from top-level clinical resources

_type would be preferred over _includePatientLinkedOnly if user request a non-clinical resource and also passes _includePatientLinkedOnly.

For example: <base_url>/4_0_0/Patient/\<patient1>/$everything?\_type=Person,Account,Observation

### \_since

This parameter can be used to only get resources which are updated after the given period. The intent of this parameter is to allow a client to request only records that have changed since the last request. Accepts FHIR [instant](https://www.hl7.org/fhir/R4B/datatypes.html#instant) type input for param.

For example: <base_url>/4_0_0/Patient/\<patient1>/$everything?\_since=2025-06-01T00:00:00Z

## Custom Search query parameters

### \_debug

The `_debug` parameter is used to get debugging information with the result.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/\<patient1>/$everything?\_debug=true

### \_explain

The `_explain` parameter is used to explain the query made by everything operation. When `_explain` parameter is passed, all resources are not returned but one of each type of resource is returned. When this is used, non-clinical resources linked for only included resources will be fetched.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/\<patient1>/$everything?\_explain=true

### \_includePatientLinkedOnly

This parameter is used to find all get only the clinical resources which are linked to patient directly. It can be used when linked non-clinical resources of Patient resources are not needed.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/\<patient_id>/$everything?\_includePatientLinkedOnly=true

### \_rewritePatientReference

This parameter is used to replace the ids and references of patient with that of proxy patient that is provided in the search params.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/person.\<person_id>/$everything?\_rewritePatientReference=true

### \_includeHidden

This parameter is used to include the resources having hidden tag in meta.tag field. These resources are excluded by default.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/\<patient_id>/$everything?\_includeHidden=true

### \_includeProxyPatientLinkedOnly

This parameter is used to restrict the result to only include resources which are linked to given proxy patient (and their linked non-clinical resources if requested). No Patient resource is returned with param.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/person.\<patient_id>/$everything?\_includeProxyPatientLinkedOnly=true

### \_excludeProxyPatientLinked

This parameter is used to exclude resources which are linked to given proxy patient (and their linked non-clinical resources). And only include the patient resources and their linked clinical and non-clinical resources.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/person.\<patient_id>/$everything?\_excludeProxyPatientLinked=true

### \_includePatientLinkedUuidOnly

This parameter is used to only include id and resourceType field of clinical resources in result. Where id field will contain uuid only. Non-clinical resources are excluded when using this param.
<br> 
Default: false

For example: <base_url>/4_0_0/Patient/\<patient_id>/$everything?\_includePatientLinkedUuidOnly=true

## Custom Headers

### Global ID
In `id` field, `uuid` is returned by default for all resources. This behaviour can be reverted by sending the following in headers of request.
```
{
    prefer: 'global_id=false'
}
```
