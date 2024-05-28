# (WIP) FHIR $export endpoint

The Helix FHIR Server supports the Bulk Export functionality of FHIR Specification [https://build.fhir.org/ig/HL7/bulk-data/export.html].

## Api Overview:

Bulk data export can be triggered by POST request using below 3 endpoints:

1. `/$export` - This endpoint will allow data export for all the resources accessible via provided jwt scopes.

2. `/Patient/$export` - This endpoint will allow data export for all the patients data accessible via provided jwt scopes.

3. `/Group/:id/$export` - This endpoint will allow data export for resources related to the members of the provided group which are accessible via provided jwt scopes.

Whenever a request is received for data export, firstly an `ExportStatus` resource is created which contains details related to the export.

Note: It will be allowed for non-patient REST requests only.

## Supported Query Params:

1. `_since` - This accepts a date value and indicates that all the resource which were created/modified after this date needs to be exported

2. `_outputFormat` - This params is used to specify the format in which data should be exported. Currently, FHIR Server supports only ndjson format, so by default it will be set to ndjson

3. `patient` - This param takes comma separated patient references and only data related to the provided patients will be exported

4. `_type` - This param takes resource types to be exported, other resourceTypes will be ignored

## S3 File Structure Overview:

S3 will have an `exports` folder where all the exported data will be uploaded. Inside exports folder, multiple folders with `ExportStatus` resource id as names will be created to store data of the export request for which the specified `ExportStatus` resource was created. Inside these folders the exported data files will be stored. The files will be kept for 7 days and will get automatically deleted through S3 configuration so that we are not wasting space since these might be large files.

#### Directory Structure:

```
S3 Bucket/
     |-- exports/owner-tag/
     |     |-- 14fa7e93-14d5-41fc-93b0-ecbb7219c3d2/
     |     |     |-- patient_file.ndjson
     |     |     |-- observation_file.ndjson
     |     |     |-- error_file.ndjson
     |     |-- e9c7a29f-b0a6-4678-a1a8-c8c4578b8880/
     |     |     |-- patient_file.ndjson
```

## Example Flow:

Suppose a Walgreen wants to export data of all the patients modified after 2023-10-10, then they will follow the below steps(scope: `user/Patient.read access/walgreen.read`):

1. Walgreen will make a POST request to `/$export?since=2023-10-10&type=Patient`, if this endpoint returns `202` that means the request was accepted and they can note the url present in `Content-Location` header for checking the status of the export. If status code `4XX` or `5XX` is received then they will have to request again for the export.

2. Now, They will make GET request to the url noted from Content-Location header in the first step to check the status of the export.
   Status of the export will be present in X-Progress header of the response. Once user receives completed status then user must check response body for S3 links to access the exported data.

-   Example Response body:

```json
{
    "transactionTime": "2024-01-01T00:00:00.000Z",
    "request": "https://fhir.prod.icanbwell.com/4_0_0/Patient/$export?_since=2023-10-10&_type=Patient",
    "requiresAccessToken": false,
    "output": [
        {
            "type": "Patient",
            "url": "https://s3.amazonaws.com/fhir-server/exports/walgreen/14fa7e93-14d5-41fc-93b0-ecbb7219c3d2/patient_file.ndjson"
        }
    ],
    "error": [ // This field will be empty in case of no errors
        {
            "type": "OperationOutcome",
            "url": "https://s3.amazonaws.com/fhir-server/exports/walgreen/14fa7e93-14d5-41fc-93b0-ecbb7219c3d2/error_file.ndjson"
        }
    ]
}
```

3. Now, Walgreen can access the exported data by using the urls present in the response body.

##### Note: To access exported data Walgreen must have access(AWS credential) to S3.
