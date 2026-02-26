# FHIR $merge endpoint

The b.well FHIR server implements the $merge endpoint. This endpoint allows clients to send a list of resources (which do not need to be of the same type) and the FHIR server will compare those to the data it has and choose to:

1. Add a new resource
2. Update an existing resource

3. Ignore the request because the resource sent is same as the resource in the FHIR server already

Note: The client can send ONLY the properties it knows about the resource and the FHIR server will merge that with the properties it already has about the resource. Hence there is no need for the client to retrieve the whole resource from FHIR server, update the properties and send the whole resource back. This also avoids the timing issue where the resource may have been changed by another client between the client retrieving the resource and sending an updated resource.

Note: Make sure you set `Content-Type: application/fhir+json` in your HTTP call.

Note: Any insert or update requires write permission on that resource.

### Payload

The $merge endpoint accepts data in following formats:
1. A FHIR Bundle resource: https://www.hl7.org/fhir/bundle.html
2. A of list of resources at top level (sample here: https://github.com/icanbwell/fhir-server/blob/main/src/tests/graphql/condition/fixtures/conditions.json)

For each resource in the bundle, the FHIR server checks:

1. If a resource with that id exists in the FHIR server. If not, the FHIR server adds that resource.
2. If the data the client has sent is exactly the same as the data already in the FHIR server. If yes, the FHIR server ignores the request.
3. The FHIR server compares the resource the client has sent with the resource in the FHIR server and creates a patch containing any changes. It then applies this patch. Note that since a patch is created, the client can send ONLY the properties it wants to change and not the whole resource.

    - If the change is in an array property then:

        - If array contains primitive types (e.g., string) then replace whole array with new array
        - FHIR server tries to find a match on the id of the item in the array. If a match is found then the FHIR server updates that item in the array.
        - FHIR server tries to find a match on sequence of the item in the array. If a match is found then the FHIR server updates that item in the array.
        - If no match is found then the FHIR server adds the item as a new item at the end of the array.
        - Note: If an item does not have id or sequence AND it does not match any existing item exactly then the FHIR server will create a new item. There is no way for it to know that you want to update an item vs add an item. Hence we recommend using id or sequence on items in an array whenever possible to minimize the chance of duplications in array items.
        - If new array contains one or more items that end in "-delete" then find those items in the old array and remove them.

    - How to delete an object from an array property that does not contain an id column.

        - In order to delete an object from the array, we need to add ID fields to each object within the array using the update/patch endpoint. Once that is done, we can utilize the merge endpoint and pass "-delete" with a specific ID to remove the object from the array.
        - The update and patch functions can be used to directly update the array fields without creating/modifying the id fields.

    - Note this is done in a recursive manner so changes are detected in array any levels deep.

4. The FHIR server returns a list showing the outcome for each passed in resource showing:
    - id
    - created: whether this resource was created
    - updated: whether this resource was updated
    - resource_version: current version of the resource after this update

Note: $merge operation performs optimally with payload of 100 resources.

### Streaming $merge
The $merge operation also supports streaming, whenever the Content-Type is `application/fhir+ndjson`. Using this, payload can be streamed to FHIR Server and response will also be streamed to the client in ndjson format only.

Example Request
```
{"resourceType":"Observation","id":"b19f1689-afd5-4fe9-80e2-f1919ebb3dcf",...}
{"resourceType":"Observation","id":"f679299f-b1f5-4f5a-83ee-62cbfb910372",...}
{"resourceType":"Condition","id":"ed90ab69-3685-490a-9b98-5bb797d41c9e",...}
```

Example Response
```
{"created":true,"id":"b19f1689-afd5-4fe9-80e2-f1919ebb3dcf","uuid":"b19f1689-afd5-4fe9-80e2-f1919ebb3dcf","resourceType":"Observation","updated":false,"sourceAssigningAuthority":"bwell"}
{"created":true,"id":"f679299f-b1f5-4f5a-83ee-62cbfb910372","uuid":"f679299f-b1f5-4f5a-83ee-62cbfb910372","resourceType":"Observation","updated":false,"sourceAssigningAuthority":"bwell"}
{"created":true,"id":"ed90ab69-3685-490a-9b98-5bb797d41c9e","uuid":"ed90ab69-3685-490a-9b98-5bb797d41c9e","resourceType":"Condition","updated":false,"sourceAssigningAuthority":"bwell"}
```

Note: In streaming $merge, the response is always returned as ndjson only.

### Notes:

1. A FHIR resource must be specified in the URL in order for the $merge call to be processed.
    * ex. http://localhost:3000/4_0_0/Encounter/$merge (in this example, 'Encounter' is the FHIR resource) \* The FHIR resource passed in the URL is heterogeneous, although in the example we use 'Encounter' as the FHIR resource, that does not mean we can only pass in Encounters within the FHIR resource bundle. A user can pass in any valid FHIR resources within the bundle. (sample here: https://www.npoint.io/docs/f7efe4bb5e42355aaa1a).

2. If 'Bundle' resource containing different resources in entry is sent inside an array in payload, then it is treated as a single bundle resource and its containing entry resources are not treated as individual resources.

3. The $merge endpoint in the FHIR server behaves differently from other endpoints when it comes to HTTP status codes. Instead of returning 403 Forbidden or 400 Bad Request for validation errors or forbidden actions, it always returns a 200 OK status code. However, details related to validation and forbidden actions are included in the response body as operation outcome.
    * Example of $merge response in case of validation error
    ```json
    {
        "operationOutcome": {
            "resourceType": "OperationOutcome",
            "issue": [
                {
                    "severity": "error",
                    "code": "invalid",
                    "details": {
                        "text": "/4_0_0/MedicationStatement/$merge should have required property 'status' :{\"missingProperty\":\"status\"}: at position root"
                    }
                },
                {
                    "severity": "error",
                    "code": "invalid",
                    "details": {
                        "text": "/4_0_0/MedicationStatement/$merge should match exactly one schema in oneOf :{\"passingSchemas\":null}: at position root"
                    }
                }
            ]
        },
        "issue": {
            "severity": "error",
            "code": "invalid",
            "details": {
                "text": "/4_0_0/MedicationStatement/$merge should have required property 'status' :{\"missingProperty\":\"status\"}: at position root"
            }
        },
        "created": false,
        "id": "2bd12e28-0fe9-4436-9d40-52b5995db598",
        "uuid": "2bd12e28-0fe9-4436-9d40-52b5995db598",
        "resourceType": "MedicationStatement",
        "updated": false,
        "sourceAssigningAuthority": "client"
    }
    ```

    * Example of $merge response in case of forbidden error
    ```json
    {
        "operationOutcome": {
            "resourceType": "OperationOutcome",
            "issue": [
                {
                    "severity": "error",
                    "code": "forbidden",
                    "details": {
                        "text": "None of the provided scopes matched an allowed scope.: user test with scopes [patient/*.read] failed access check to [Patient.write]"
                    },
                    "diagnostics": "None of the provided scopes matched an allowed scope.: user test with scopes [patient/*.read] failed access check to [Patient.write]"
                }
            ]
        },
        "issue": {
            "severity": "error",
            "code": "forbidden",
            "details": {
                "text": "None of the provided scopes matched an allowed scope.: user test with scopes [patient/*.read] failed access check to [Patient.write]"
            },
            "diagnostics": "None of the provided scopes matched an allowed scope.: user test with scopes [patient/*.read] failed access check to [Patient.write]"
        },
        "created": false,
        "id": "3da9c5e3-db83-4788-8f06-6d574e5e49f3",
        "resourceType": "Patient",
        "updated": false
    }
    ```

### Implementation in FHIR server

[src/operations/merge/merge.js](../src/operations/merge/merge.js)

### unit tests

[src/tests/claims](../src/tests/claims)
