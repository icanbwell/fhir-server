# (WIP) FHIR $export endpoint

The Helix FHIR Server supports the Bulk Export functionality of FHIR Specification [https://build.fhir.org/ig/HL7/bulk-data/export.html].

## Api Overview:

Bulk data export can be triggered by POST request using below 3 endpoints:

1. `/$export` - This endpoint will allow data export for all the resources accessible via provided jwt scopes.

2. `/Patient/$export` - This endpoint will allow data export for all the patients data accessible via provided jwt scopes.

3. `/Group/:id/$export` - This endpoint will allow data export for resources related to the members of the provided group which are accessible via provided jwt scopes.

POST request payload will be a Parameter resource
```json
{
    "id": "1",
    "resourceType": "Parameters",
    "meta": {
        "source": "client",
        "security": [
            {
                "system": "https://www.icanbwell.com/owner",
                "code": "client"
            }
        ]
    }
}
```

Note: It will be allowed for non-patient REST requests only.

## Supported Query Params:

| Param | use | description |
|-------|-----|-------------|
| `_since` | `?_since=2023-10-10`| This accepts a date value and indicates that all the resource which were created/modified after this date needs to be exported |
| `_outputFormat` | `?_outputFormat=ndjson` | This params is used to specify the format in which data should be exported. Currently, FHIR Server supports only ndjson format, so by default it will be set to ndjson |
| `patient` | `?patient=patient/1,2` | This param takes comma separated patient references and only data related to the provided patients will be exported |
| `_type` | `?_type=Patient,Person` | This param takes resource types to be exported, other resourceTypes will be ignored |

## Example Flow:

Suppose a client wants to export data of all the patients modified after 2023-10-10, then they will follow the below steps(scope: `user/Patient.read access/client.read`):

1. Client will make a POST request to `/$export?_since=2023-10-10&type=Patient`, if this endpoint returns `202` that means the request was accepted and they can note the url present in `Content-Location` header for checking the status of the export. If status code `4XX` or `5XX` is received then they will have to request again for the export.

2. Now, They will make GET request to the url noted from Content-Location header in the first step to check the status of the export.
   Status of the export will be present in `X-Progress` header of the response. Once user receives completed status then user must check response body for S3 links to access the exported data.

-   Example Response body:

```json
{
    "transactionTime": "2024-01-01T00:00:00.000Z",
    "request": "https://fhir.prod.icanbwell.com/4_0_0/Patient/$export?_since=2023-10-10&_type=Patient",
    "requiresAccessToken": false,
    "output": [
        {
            "type": "Patient",
            "url": "<s3 url for patient data>"
        }
    ],
    "error": [ // This field will be empty in case of no errors
        {
            "type": "OperationOutcome",
            "url": "<s3 url for error data>"
        }
    ]
}
```

3. Now, Client can access the exported data by using the urls present in the response body.

##### Note: To access exported data Client must have access(AWS credential) to S3.