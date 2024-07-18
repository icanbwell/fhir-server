# FHIR $everything endpoint

The Helix FHIR server supports the $everything endpoint of the FHIR specification (https://www.hl7.org/fhir/resource-operation-graph.html). This operation is used to retrieve all resources related to the provided resource. The $everything operation internally uses graphs to fetch or delete all the resources. Here are the graphs that $everything uses underneath: https://github.com/icanbwell/fhir-server/tree/main/src/graphs

It is mandatory to provide `id` either in query parameter or in search parameter.
For example:

-   <base_url>/4_0_0/Patient/patient1/$everything
-   <base_url>/4_0_0/Patient/$everything?id=patient1

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
      "id": "person2",
      "resource": {
        "resourceType": "Person",
        "id": "person2"
        // <rest of resource fields>
      }
    },
    {
      "id": "personTopLevel",
      "resource": {
        "resourceType": "Person",
        "id": "personTopLevel"
        // <rest of resource fields>
      }
    }
    // rest of resources
  ],
  "resourceType": "Bundle",
  "type": "searchset",
  "timestamp": "2023-12-20T03:31:07.077Z",
  "total": 4,
  "link": [
    {
      "relation": "self",
      "url": "<base_url>/4_0_0/Patient/patient1/$everything"
    }
  ]
}
```

## Resources supported by $everything

-   Practitioner
-   Organization
-   Slot
-   Person
-   Patient

## Supported query parameters

### id

It can be used if data related to more than one resource provided needs to be fetched. If `id` query param is passed, then the serach param is ignored.

For example: <base_url>/4_0_0/Patient/$everything?id=patient1,patient2

### contained

By default, the FHIR returns all the related resources in the top level bundle.  
However if you pass in the `contained` query parameter then the FHIR server will put the related resources in a `contained` field under each resource.

For example: <base_url>/4_0_0/Patient/patient1/$everything?contained=true

```
{
    "entry": [
        {
            "id": "patient1",
            "resource": {
                "resourceType": "Patient",
                "id": "patient1",
                // <rest of resource fields>
                "contained": [
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
                        "id": "person2",
                        "resource": {
                            "resourceType": "Person",
                            "id": "person2"
                            // <rest of resource fields>
                        }
                    },
                    {
                        "id": "personTopLevel",
                        "resource": {
                            "resourceType": "Person",
                            "id": "personTopLevel"
                            // <rest of resource fields>
                        }
                    }
                    // rest of resources
                ]
            }
        }
    ],
    "resourceType": "Bundle",
    "type": "searchset",
    "timestamp": "2023-12-20T03:31:07.077Z",
    "total": 4,
    "link": [
        {
            "relation": "self",
            "url": "<base_url>/4_0_0/Patient/patient1/$everything?contained=true"
        }
    ]
}
```

### \_debug

The `_debug` parameter is used to get debugging information with the result.

For example: <base_url>/4_0_0/Patient/patient1/$everything?\_debug=true

### \_explain

The `_explain` parameter is used explain the query made by everything operation. When `_explain` param is passes, all resources are not returned but one of each type of resource is returned.

For example: <base_url>/4_0_0/Organization/organization1/$everything?\_explain=true

### \_type

This parameter can be used to narrow down the result of resources to the provided list of resources.

For example: <base_url>/4_0_0/Patient/patient1/$everything?\_type=Person,Account,Observation

## Note

When `_type` parameter is used then the `contained` parameter is ignored.
