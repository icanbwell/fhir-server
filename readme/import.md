# FHIR $import endpoint (Upcoming)

> **Status:** This endpoint is under active development and not yet available.

The FHIR Server will support bulk data import from S3, modeled after the [Azure FHIR $import operation](https://learn.microsoft.com/en-us/azure/healthcare-apis/fhir/import-data). It allows high-throughput ingestion of FHIR resources in NDJSON format.

## API Overview

Bulk data import is triggered by a POST request:

`POST /4_0_0/$import`

The server creates one FHIR Task per input file, publishes processing messages to Kafka, and returns immediately with a `202 Accepted` response. Kafka consumers process the files asynchronously, streaming each file from S3 line-by-line and writing resources to MongoDB in batches.

Note: This endpoint is not allowed for patient-scoped tokens.

## Request

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <token>` |
| `Prefer` | `respond-async` |

### Body

```json
{
    "filepaths": [
        "s3://my-bucket/run-20260601/Patient.ndjson",
        "s3://my-bucket/run-20260601/Condition.ndjson",
        "s3://my-bucket/run-20260601/Observation.ndjson"
    ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filepaths` | string[] | Yes | Array of S3 URIs (`s3://bucket/key`). Each must have a non-empty bucket and key. Bucket must be in the server's allow-list (`BULK_IMPORT_ALLOWED_S3_BUCKETS`). |

### Validation Rules

- `filepaths` must be a non-empty array
- Each filepath must be a valid S3 URI matching `s3://bucket/key`
- Each bucket must be in the configured allow-list
- Patient-scoped tokens are rejected (403)

## Response

### 202 Accepted

The response body is a FHIR Bundle containing one Task resource per input file:

```json
{
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [
        {
            "resource": {
                "resourceType": "Task",
                "id": "import-task-001",
                "status": "requested",
                "intent": "order",
                "code": {
                    "coding": [
                        {
                            "system": "https://www.icanbwell.com/task-type",
                            "code": "bulk-import"
                        }
                    ]
                },
                "input": [
                    {
                        "type": { "text": "filepath" },
                        "valueString": "s3://my-bucket/run-20260601/Patient.ndjson"
                    }
                ]
            }
        }
    ]
}
```

### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Missing `filepaths`, empty array, invalid S3 URI, or bucket not in allow-list |
| 401 | Missing or invalid Bearer token |
| 403 | Patient-scoped token |
| 500 | Internal server error (e.g. Kafka unavailable, MongoDB write failure) |

## Polling Import Status

Use the standard FHIR Task read endpoint to check progress:

`GET /4_0_0/Task/{task-id}`

### Task Statuses

| Status | Meaning |
|--------|---------|
| `requested` | Task created, not yet picked up by a consumer |
| `in-progress` | Consumer is actively processing the file |
| `completed` | All resources processed (check output for partial failures) |
| `failed` | Unrecoverable error (e.g. S3 file not found, auth failure) |

### Completed Task Example

```json
{
    "resourceType": "Task",
    "id": "import-task-001",
    "status": "completed",
    "intent": "order",
    "code": {
        "coding": [
            {
                "system": "https://www.icanbwell.com/task-type",
                "code": "bulk-import"
            }
        ]
    },
    "input": [
        {
            "type": { "text": "filepath" },
            "valueString": "s3://my-bucket/run-20260601/Patient.ndjson"
        }
    ],
    "output": [
        {
            "type": { "text": "resourcesProcessed" },
            "valueInteger": 49980
        },
        {
            "type": { "text": "resourcesFailed" },
            "valueInteger": 20
        },
        {
            "type": { "text": "totalResources" },
            "valueInteger": 50000
        },
        {
            "type": { "text": "errorFile" },
            "valueString": "s3://my-bucket/run-20260601/errors/Patient-errors.ndjson"
        }
    ]
}
```

## NDJSON File Format

Each input file must be NDJSON (newline-delimited JSON) with one FHIR resource per line:

```
{"resourceType":"Patient","id":"patient-001","name":[{"family":"Smith","given":["John"]}]}
{"resourceType":"Patient","id":"patient-002","name":[{"family":"Johnson","given":["Sarah"]}]}
```

### Duplicate Prevention (ifNoneExist wrapper)

Lines can optionally use a wrapper format for conditional creation:

```
{"ifNoneExist":"identifier=https://www.icanbwell.com/person_id|abc123","resource":{"resourceType":"Patient","id":"patient-001","name":[{"family":"Smith","given":["John"]}]}}
```

If a line's parsed JSON has an `ifNoneExist` key, it is treated as a wrapper. Otherwise the entire line is treated as a FHIR resource.

## Performance Guidance

- **Partition files at the source.** Parallelism comes from processing multiple files across Kafka consumers, not from splitting individual files server-side. Source pipelines (e.g. Databricks) should partition output by resource type or row count so each file maps to one consumer.
- **Use large files.** Following Azure FHIR's guidance, prefer files >= 50MB. Combining many small files into fewer large ones reduces per-file overhead.
- **Submit all files in one request.** Import all files for a run in a single `$import` call rather than multiple calls.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ENABLE_BULK_IMPORT` | `false` | Feature gate for the `/$import` endpoint |
| `BULK_IMPORT_ALLOWED_S3_BUCKETS` | `''` | Comma-separated list of allowed S3 bucket names |
| `BULK_IMPORT_BATCH_SIZE` | `100` | Number of resources per MongoDB write batch |
