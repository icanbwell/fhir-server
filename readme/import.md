# FHIR $import endpoint (Upcoming)

> **Status:** This endpoint is under active development and not yet available.

The FHIR Server will support bulk data import from S3. It allows high-throughput ingestion of FHIR resources in NDJSON format.

**References:**
- [SMART on FHIR Bulk Import (Ping and Pull)](https://github.com/smart-on-fhir/bulk-import/blob/master/import-pnp.md)
- [HL7 Bulk Data Submit](https://build.fhir.org/ig/HL7/bulk-data/branches/argo25/en/submit.html)

## API Overview

Bulk data import is triggered by a POST request:

`POST /4_0_0/$import`

The server validates the request, creates a single FHIR Task to track the import, fans out processing across Kafka consumers, and returns immediately with a `202 Accepted` response containing the Task resource. Clients poll the Task to monitor progress.

Each input file is supplied as a repeating `input` parameter whose `valueUri` is the file's S3 URI. Input files are always `application/fhir+ndjson`; the resource type of each record is read from its own `resourceType` field, so no `inputFormat` or per-file `type` is required.

Note: This endpoint is not allowed for patient-scoped tokens.

## Request

### Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/fhir+json` |
| `Authorization` | `Bearer <token>` |
| `Prefer` | `respond-async` |

### Body

The request body is a FHIR [Parameters](https://www.hl7.org/fhir/parameters.html) resource. Each input file is a repeating `input` parameter carrying the S3 URI directly in `valueUri`:

```json
{
    "resourceType": "Parameters",
    "id": "3f8a1c2e-9b7d-4e6a-bf21-5c0d9a4e7b13",
    "parameter": [
        {
            "name": "input",
            "valueUri": "s3://my-bucket/run-20260601/Patient.ndjson"
        },
        {
            "name": "input",
            "valueUri": "s3://my-bucket/run-20260601/Condition.ndjson"
        },
        {
            "name": "input",
            "valueUri": "s3://my-bucket/run-20260601/Observation.ndjson"
        }
    ]
}
```

| Field | Type | Cardinality | Description |
|-------|------|-------------|-------------|
| `id` | Resource.id | 0..1 | Optional client-supplied id (UUID recommended) for request correlation. Not used by the server for processing; the server mints its own `Task` id. |
| `input` | valueUri | 1..* | One per input file (max 100). The S3 URI (`s3://bucket/key`) of an NDJSON file. Bucket must be in the server's allow-list. |

> **Note:** Files are always NDJSON. The resource type of each record is taken from its `resourceType`, so there is no `inputFormat` parameter and no per-file `type`.

### Validation Rules

- At least one `input` parameter is required, up to 100
- Each `input` `valueUri` must be a valid S3 URI matching `s3://bucket/key`
- Each bucket must be in the configured allow-list (`BULK_IMPORT_ALLOWED_S3_BUCKETS`)
- Patient-scoped tokens are rejected (403)

## Response

### 202 Accepted

The response body is the FHIR Task resource created for this import:

```json
{
    "resourceType": "Task",
    "id": "import-task-abc123",
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
    "authoredOn": "2026-06-22T14:30:00.000Z",
    "input": [
        {
            "type": { "text": "url" },
            "valueUri": "s3://my-bucket/run-20260601/Patient.ndjson"
        },
        {
            "type": { "text": "url" },
            "valueUri": "s3://my-bucket/run-20260601/Condition.ndjson"
        },
        {
            "type": { "text": "url" },
            "valueUri": "s3://my-bucket/run-20260601/Observation.ndjson"
        }
    ]
}
```

### Error Responses

| Code | Condition |
|------|-----------|
| 400 | Missing or invalid Parameters resource, no `input` entries, invalid S3 URI, bucket not in allow-list, file size out of range |
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
| `in-progress` | Consumer is actively processing files |
| `completed` | All files processed (check output for partial failures) |
| `failed` | Unrecoverable error (e.g. S3 file not found, auth failure) |

### Completed Task Example

```json
{
    "resourceType": "Task",
    "id": "import-task-abc123",
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
    "authoredOn": "2026-06-22T14:30:00.000Z",
    "input": [
        {
            "type": { "text": "url" },
            "valueUri": "s3://my-bucket/run-20260601/Patient.ndjson"
        },
        {
            "type": { "text": "url" },
            "valueUri": "s3://my-bucket/run-20260601/Condition.ndjson"
        }
    ],
    "output": [
        {
            "type": { "text": "result" },
            "valueUri": "s3://my-bucket/run-20260601/output/Patient-001.ndjson"
        },
        {
            "type": { "text": "result" },
            "valueUri": "s3://my-bucket/run-20260601/output/Patient-002.ndjson"
        },
        {
            "type": { "text": "result" },
            "valueUri": "s3://my-bucket/run-20260601/output/Condition-001.ndjson"
        },
        {
            "type": { "text": "error" },
            "valueUri": "s3://my-bucket/run-20260601/output/errors/Patient-errors.ndjson"
        }
    ]
}
```

Each input file may produce multiple output files. Output files contain merge result entries in NDJSON format (same format as `$merge` output):

```
{"created":true,"id":"patient-001","uuid":"849cb4f0-033b-5d6e-a614-9bbbbb3ba11e","resourceType":"Patient","updated":false,"sourceAssigningAuthority":"bwell"}
{"created":false,"id":"patient-002","uuid":"9575d139-6c60-52e4-83fb-f8534727fbab","resourceType":"Patient","updated":true,"sourceAssigningAuthority":"bwell"}
```

Error output files contain FHIR OperationOutcome resources in NDJSON format.

## NDJSON Input File Format

Each input file must be NDJSON (newline-delimited JSON) with one FHIR resource per line:

```
{"resourceType":"Patient","id":"patient-001","name":[{"family":"Smith","given":["John"]}]}
{"resourceType":"Patient","id":"patient-002","name":[{"family":"Johnson","given":["Sarah"]}]}
```

### Duplicate Prevention

- **Within a single processing batch (~100MB):** Duplicate resources are rejected.
- **Across different batches:** Duplicates are processed normally via merge.
- **Concurrent duplicates:** Rejected after 3 retries. Errors are recorded as OperationOutcome entries in the error output file.

## Limitations

| Constraint | Value |
|------------|-------|
| Minimum file size | 50 MB |
| Maximum file size | 5 GB |
| Maximum NDJSON line size | 16 MB |
| Maximum files per request | 100 |
| Maximum total data per request | ~500 GB |

Files smaller than 50 MB should be combined before submission. Each NDJSON line must be under 16 MB — lines exceeding this may cause unexpected behavior.

## Performance Guidance

- **Partition files at the source.** Source pipelines (e.g. Databricks) should partition output by resource type or row count, keeping files between 50 MB and 5 GB.
- **Submit all files in one request.** Import all files for a run in a single `$import` call rather than multiple calls.
- **Parallelism is server-controlled.** Once a request is accepted, the server fans out processing internally. Clients do not need to manage parallelism.
- **Estimated throughput.** At full capacity with 100 files (~500 GB), processing takes approximately 3 hours.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `ENABLE_BULK_IMPORT` | `false` | Feature gate for the `/$import` endpoint |
| `BULK_IMPORT_ALLOWED_S3_BUCKETS` | `''` | Comma-separated list of allowed S3 bucket names |
