# FHIR Server Manual Test Runbook

This runbook covers every endpoint exposed by the FHIR server with concrete `curl` commands for manual testing.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [System Endpoints](#2-system-endpoints)
3. [FHIR Metadata](#3-fhir-metadata)
4. [Standard FHIR CRUD Operations](#4-standard-fhir-crud-operations)
5. [FHIR Search](#5-fhir-search)
6. [History Operations](#6-history-operations)
7. [FHIR Custom Operations ($)](#7-fhir-custom-operations-)
8. [Batch / Transaction Bundle](#8-batch--transaction-bundle)
9. [Bulk Export](#9-bulk-export)
10. [GraphQL Endpoints](#10-graphql-endpoints)
11. [Admin Endpoints](#11-admin-endpoints)
12. [SMART on FHIR / OAuth](#12-smart-on-fhir--oauth)
13. [Supported FHIR Resource Types](#13-supported-fhir-resource-types)

---

## 1. Prerequisites

### Start the Local Stack

```bash
make up
```

This starts: FHIR Server (:3000), MongoDB (:27017), Keycloak (:8080), Kafka (:9092), Redis (:6379), ClickHouse (:8123).

### Verify Server is Running

```bash
curl http://localhost:3000/health
curl http://localhost:3000/version
```

### Obtain an Access Token

**Service account (full access):**

```bash
TOKEN=$(curl -s --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/*.* access/*.*' | jq -r '.access_token')

echo $TOKEN
```

**Patient token (scoped access):**

```bash
PATIENT_TOKEN=$(curl -s --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data username=patient \
  --data password=password \
  --data grant_type=password | jq -r '.access_token')
```

### Common Variables

```bash
BASE=http://localhost:3000/4_0_0
CONTENT_TYPE="Content-Type: application/fhir+json"
AUTH="Authorization: Bearer $TOKEN"
```

### Accepted Content Types

- `application/fhir+json`
- `application/json+fhir`
- `application/json-patch+json` (for PATCH)
- `application/fhir+ndjson` (for bulk export)

---

## 2. System Endpoints

These endpoints do **not** require authentication.

### 2.1 Health Check

```bash
curl http://localhost:3000/health
```

**Expected:** `200 OK` with health status JSON.

### 2.2 Full Health Check

```bash
curl http://localhost:3000/full-healthcheck
```

**Expected:** `200 OK` with comprehensive status of MongoDB, Redis, Kafka, etc.

### 2.3 Liveness Probe

```bash
curl http://localhost:3000/live
```

**Expected:** `200 OK` — used by Kubernetes liveness probes.

### 2.4 Version

```bash
curl http://localhost:3000/version
```

**Expected:** `200 OK` with server version info.

### 2.5 Robots.txt

```bash
curl http://localhost:3000/robots.txt
```

**Expected:** `404` (disallows all crawlers).

### 2.6 Swagger Docs (if enabled)

Requires `ENABLE_SWAGGER_DOC=1` environment variable.

```bash
curl http://localhost:3000/api-docs
```

**Expected:** Swagger UI HTML page.

### 2.7 Stats (if enabled)

Requires `ENABLE_STATS_ENDPOINT=true` in config.

```bash
curl -H "$AUTH" http://localhost:3000/stats
```

---

## 3. FHIR Metadata

### 3.1 CapabilityStatement

```bash
curl "$BASE/metadata"
```

**Expected:** `200 OK` with a FHIR `CapabilityStatement` resource listing all supported resources, operations, and search parameters.

**What to verify:**
- `resourceType` is `CapabilityStatement`
- `rest[0].resource[]` lists all 140 supported resource types
- Each resource entry shows supported interactions (read, search-type, create, update, delete, patch)
- Search parameters are listed for each resource

---

## 4. Standard FHIR CRUD Operations

All examples use `Patient` but apply to any of the 140 supported resource types.

### 4.1 Create (POST)

```bash
curl -X POST "$BASE/Patient" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Patient",
    "id": "test-patient-1",
    "meta": {
      "source": "http://test-source"
    },
    "name": [{"family": "Smith", "given": ["John"]}],
    "gender": "male",
    "birthDate": "1990-01-01",
    "active": true
  }'
```

**Expected:** `201 Created` with the created Patient in the response body.
**Verify:** Response includes `id`, `meta.versionId`, and `meta.lastUpdated`.

### 4.2 Read by ID (GET)

```bash
curl "$BASE/Patient/test-patient-1" \
  -H "$AUTH"
```

**Expected:** `200 OK` with the Patient resource.
**Verify:** Resource matches what was created.

### 4.3 Update (PUT)

```bash
curl -X PUT "$BASE/Patient/test-patient-1" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Patient",
    "id": "test-patient-1",
    "meta": {
      "source": "http://test-source"
    },
    "name": [{"family": "Smith", "given": ["John", "Michael"]}],
    "gender": "male",
    "birthDate": "1990-01-01",
    "active": true
  }'
```

**Expected:** `200 OK` with the updated resource.
**Verify:** `meta.versionId` has incremented.

### 4.4 Patch (PATCH)

Uses JSON Patch (RFC 6902):

```bash
curl -X PATCH "$BASE/Patient/test-patient-1" \
  -H "$AUTH" \
  -H "Content-Type: application/json-patch+json" \
  -d '[
    {"op": "replace", "path": "/birthDate", "value": "1990-06-15"}
  ]'
```

**Expected:** `200 OK` with the patched resource.
**Verify:** `birthDate` has changed, `meta.versionId` incremented.

### 4.5 Delete (DELETE)

```bash
curl -X DELETE "$BASE/Patient/test-patient-1" \
  -H "$AUTH"
```

**Expected:** `204 No Content` or `200 OK`.
**Verify:** Subsequent GET returns `404` or a deleted resource.

### 4.6 Version Read (vread)

```bash
curl "$BASE/Patient/test-patient-1/_history/1" \
  -H "$AUTH"
```

**Expected:** `200 OK` with version 1 of the resource.

### 4.7 Error Cases

**Missing auth:**
```bash
curl "$BASE/Patient/test-patient-1"
```
**Expected:** `401 Unauthorized`.

**Invalid content type on POST:**
```bash
curl -X POST "$BASE/Patient" \
  -H "$AUTH" \
  -H "Content-Type: text/plain" \
  -d '{"resourceType":"Patient"}'
```
**Expected:** `400 Bad Request` with content-type error message.

**Resource not found:**
```bash
curl "$BASE/Patient/nonexistent-id-12345" \
  -H "$AUTH"
```
**Expected:** `404 Not Found` with an `OperationOutcome`.

---

## 5. FHIR Search

### 5.1 Search via GET

```bash
# Search Patients by family name
curl "$BASE/Patient?family=Smith" \
  -H "$AUTH"

# Search with multiple parameters
curl "$BASE/Patient?family=Smith&gender=male&birthdate=1990-01-01" \
  -H "$AUTH"

# Search with token (identifier)
curl "$BASE/Patient?identifier=http://example.org/mrn|12345" \
  -H "$AUTH"
```

**Expected:** `200 OK` with a `Bundle` of type `searchset`.

### 5.2 Search via POST

```bash
curl -X POST "$BASE/Patient/_search" \
  -H "$AUTH" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "family=Smith&gender=male"
```

**Expected:** Same as GET search — a `Bundle` of type `searchset`.

### 5.3 Common Search Parameters (all resources)

| Parameter | Type | Example |
|-----------|------|---------|
| `_id` | token | `?_id=abc123` |
| `_lastUpdated` | date | `?_lastUpdated=gt2024-01-01` |
| `_source` | uri | `?_source=http://example.org` |
| `_security` | token | `?_security=http://example.org/security\|code` |
| `_count` | number | `?_count=10` |
| `_getpagesoffset` | number | `?_getpagesoffset=20` |
| `_sort` | string | `?_sort=-_lastUpdated` |
| `_total` | string | `?_total=accurate` |
| `_elements` | string | `?_elements=id,name,birthDate` |
| `_summary` | token | `?_summary=count` |

### 5.4 Patient-Specific Search Parameters

```bash
# By name (searches across family, given, prefix, suffix)
curl "$BASE/Patient?name=John" -H "$AUTH"

# By family name
curl "$BASE/Patient?family=Smith" -H "$AUTH"

# By given name
curl "$BASE/Patient?given=John" -H "$AUTH"

# By birth date with modifiers
curl "$BASE/Patient?birthdate=gt1990-01-01&birthdate=lt2000-01-01" -H "$AUTH"

# By gender
curl "$BASE/Patient?gender=male" -H "$AUTH"

# By active status
curl "$BASE/Patient?active=true" -H "$AUTH"

# By identifier system|value
curl "$BASE/Patient?identifier=http://hospital.org/mrn|12345" -H "$AUTH"

# By address city
curl "$BASE/Patient?address-city=Boston" -H "$AUTH"

# By managing organization
curl "$BASE/Patient?organization=Organization/org-1" -H "$AUTH"

# By phone/email
curl "$BASE/Patient?telecom=555-1234" -H "$AUTH"
```

### 5.5 Observation Search Parameters

```bash
# By code (LOINC)
curl "$BASE/Observation?code=http://loinc.org|85354-9" -H "$AUTH"

# By patient reference
curl "$BASE/Observation?patient=Patient/test-patient-1" -H "$AUTH"

# By date range
curl "$BASE/Observation?date=ge2024-01-01&date=le2024-12-31" -H "$AUTH"

# By category
curl "$BASE/Observation?category=vital-signs" -H "$AUTH"

# By status
curl "$BASE/Observation?status=final" -H "$AUTH"

# Combined
curl "$BASE/Observation?patient=Patient/test-patient-1&code=http://loinc.org|85354-9&date=ge2024-01-01" -H "$AUTH"
```

### 5.6 Condition Search Parameters

```bash
# By code
curl "$BASE/Condition?code=http://snomed.info/sct|73211009" -H "$AUTH"

# By patient
curl "$BASE/Condition?patient=Patient/test-patient-1" -H "$AUTH"

# By clinical status
curl "$BASE/Condition?clinical-status=active" -H "$AUTH"

# By category
curl "$BASE/Condition?category=encounter-diagnosis" -H "$AUTH"

# By onset date
curl "$BASE/Condition?onset-date=ge2024-01-01" -H "$AUTH"
```

### 5.7 Pagination

```bash
# First page (10 results)
curl "$BASE/Patient?_count=10" -H "$AUTH"

# Second page
curl "$BASE/Patient?_count=10&_getpagesoffset=10" -H "$AUTH"
```

**Verify:** Bundle contains `link` entries for `self`, `next`, and `previous` where applicable.

---

## 6. History Operations

### 6.1 Instance History

```bash
curl "$BASE/Patient/test-patient-1/_history" \
  -H "$AUTH"
```

**Expected:** `200 OK` with a `Bundle` of type `history` containing all versions of the resource.

### 6.2 Type History

```bash
curl "$BASE/Patient/_history" \
  -H "$AUTH"
```

**Expected:** `200 OK` with a `Bundle` containing history of all Patient resources.

### 6.3 Version-Specific Read

```bash
curl "$BASE/Patient/test-patient-1/_history/2" \
  -H "$AUTH"
```

**Expected:** `200 OK` with version 2 of the Patient resource.

---

## 7. FHIR Custom Operations ($)

Every resource type supports these custom operations. Examples below use `Patient` but apply universally.

### 7.1 $merge (POST)

Merge/upsert resources. This is the primary way to create or update resources in bulk.

**Single resource merge:**

```bash
curl -X POST "$BASE/Patient/\$merge" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [
      {
        "resource": {
          "resourceType": "Patient",
          "id": "merge-test-1",
          "meta": {
            "source": "http://test-source"
          },
          "name": [{"family": "Doe", "given": ["Jane"]}],
          "gender": "female",
          "birthDate": "1985-03-15"
        }
      }
    ]
  }'
```

**Instance-level merge:**

```bash
curl -X POST "$BASE/Patient/merge-test-1/\$merge" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Bundle",
    "type": "collection",
    "entry": [
      {
        "resource": {
          "resourceType": "Patient",
          "id": "merge-test-1",
          "meta": {
            "source": "http://test-source"
          },
          "name": [{"family": "Doe", "given": ["Jane", "Marie"]}],
          "gender": "female",
          "birthDate": "1985-03-15"
        }
      }
    ]
  }'
```

**Expected:** `200 OK` with a Bundle containing merge results (created/updated).

### 7.2 $everything (GET)

Retrieve all resources related to a specific resource instance.

```bash
# Patient $everything
curl "$BASE/Patient/test-patient-1/\$everything" \
  -H "$AUTH"

# Type-level $everything
curl "$BASE/Patient/\$everything?id=test-patient-1" \
  -H "$AUTH"
```

**Expected:** `200 OK` with a `Bundle` containing the Patient and all related resources (Observations, Conditions, Encounters, etc.).

### 7.3 $everything (DELETE)

Delete a resource and all related resources.

```bash
# Delete patient and all related resources
curl -X DELETE "$BASE/Patient/test-patient-1/\$everything" \
  -H "$AUTH"

# Type-level
curl -X DELETE "$BASE/Patient/\$everything?id=test-patient-1" \
  -H "$AUTH"
```

**Expected:** `200 OK` with an `OperationOutcome` confirming deletion.

### 7.4 $validate (POST)

Validate a resource against FHIR profiles.

```bash
curl -X POST "$BASE/Patient/\$validate" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Patient",
    "name": [{"family": "Test"}],
    "gender": "male"
  }'
```

**Expected:** `200 OK` with an `OperationOutcome` listing validation issues (if any).

### 7.5 $validate (GET) — Instance-level

```bash
curl "$BASE/Patient/test-patient-1/\$validate" \
  -H "$AUTH"
```

**Expected:** `200 OK` with an `OperationOutcome` for the stored resource.

### 7.6 $graph (POST)

Retrieve a resource and its referenced resources as a graph.

```bash
curl -X POST "$BASE/Patient/\$graph" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "GraphDefinition",
    "id": "test-graph",
    "name": "PatientGraph",
    "status": "active",
    "start": "Patient",
    "link": [
      {
        "path": "Patient.managingOrganization",
        "target": [{"type": "Organization"}]
      }
    ]
  }'
```

**Instance-level:**

```bash
curl -X POST "$BASE/Patient/test-patient-1/\$graph" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "GraphDefinition",
    "id": "test-graph",
    "name": "PatientGraph",
    "status": "active",
    "start": "Patient",
    "link": [
      {
        "path": "Patient.managingOrganization",
        "target": [{"type": "Organization"}]
      }
    ]
  }'
```

**Expected:** `200 OK` with a Bundle containing the graph of related resources.

### 7.7 $graph (DELETE)

Delete resources based on a graph definition.

```bash
curl -X DELETE "$BASE/Patient/test-patient-1/\$graph" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "GraphDefinition",
    "id": "test-graph",
    "name": "PatientGraph",
    "status": "active",
    "start": "Patient"
  }'
```

### 7.8 $expand (GET)

Primarily used with `ValueSet` and `CodeSystem`, but available on all resources.

```bash
curl "$BASE/ValueSet/my-valueset/\$expand" \
  -H "$AUTH"
```

**Expected:** `200 OK` with the expanded ValueSet.

### 7.9 $summary (GET)

Get a summary view of a resource (following the IPS OperationDefinition).

```bash
curl "$BASE/Patient/test-patient-1/\$summary" \
  -H "$AUTH"
```

**Expected:** `200 OK` with a summary Bundle.

### 7.10 remove_by_query (DELETE)

Delete resources matching search criteria.

```bash
curl -X DELETE "$BASE/Patient/?identifier=http://example.org|temp-12345" \
  -H "$AUTH"
```

**Expected:** `200 OK` with count of deleted resources.

---

## 8. Batch / Transaction Bundle

### 8.1 POST a Batch Bundle

```bash
curl -X POST "$BASE" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [
      {
        "request": {
          "method": "POST",
          "url": "Patient"
        },
        "resource": {
          "resourceType": "Patient",
          "id": "batch-patient-1",
          "meta": {"source": "http://test"},
          "name": [{"family": "Batch", "given": ["Test1"]}]
        }
      },
      {
        "request": {
          "method": "POST",
          "url": "Observation"
        },
        "resource": {
          "resourceType": "Observation",
          "id": "batch-obs-1",
          "meta": {"source": "http://test"},
          "status": "final",
          "code": {
            "coding": [{"system": "http://loinc.org", "code": "85354-9"}]
          },
          "subject": {"reference": "Patient/batch-patient-1"}
        }
      },
      {
        "request": {
          "method": "GET",
          "url": "Patient?family=Batch"
        }
      }
    ]
  }'
```

**Expected:** `200 OK` with a `Bundle` of type `batch-response`. Each entry has its own status code.

### 8.2 PUT a Bundle

```bash
curl -X PUT "$BASE/" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [
      {
        "request": {
          "method": "PUT",
          "url": "Patient/batch-patient-1"
        },
        "resource": {
          "resourceType": "Patient",
          "id": "batch-patient-1",
          "meta": {"source": "http://test"},
          "name": [{"family": "BatchUpdated", "given": ["Test1"]}]
        }
      }
    ]
  }'
```

### 8.3 $question (if enabled)

```bash
# GET
curl "$BASE/\$question?q=What+patients+have+diabetes" \
  -H "$AUTH"

# POST
curl -X POST "$BASE/\$question" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -d '{"question": "What patients have diabetes?"}'
```

---

## 9. Bulk Export

Requires `ENABLE_BULK_EXPORT=1` environment variable.

### 9.1 System-Level Export (POST)

```bash
curl -X POST "$BASE/\$export" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -H "Prefer: respond-async" \
  -d '{
    "_type": "Patient,Observation",
    "_since": "2024-01-01T00:00:00Z"
  }'
```

**Expected:** `202 Accepted` with a `Content-Location` header pointing to the status polling URL.

### 9.2 Patient-Level Export (POST)

```bash
curl -X POST "$BASE/Patient/\$export" \
  -H "$AUTH" \
  -H "$CONTENT_TYPE" \
  -H "Prefer: respond-async" \
  -d '{
    "_type": "Patient,Observation,Condition"
  }'
```

### 9.3 Poll Export Status (GET)

```bash
# Use the ID from the Content-Location header
curl "$BASE/\$export/{export-job-id}" \
  -H "$AUTH"
```

**Expected:**
- `202 Accepted` — Export still in progress
- `200 OK` — Export complete with download URLs in the response

---

## 10. GraphQL Endpoints

Requires `ENABLE_GRAPHQL=1` and/or `ENABLE_GRAPHQLV2=1` environment variables.

### 10.1 GraphQL v1

```bash
curl -X POST "http://localhost:3000/\$graphql" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ patient(id: \"test-patient-1\") { id name { family given } gender birthDate } }"
  }'
```

### 10.2 GraphQL v2

```bash
curl -X POST "http://localhost:3000/4_0_0/\$graphqlv2" \
  -H "$AUTH" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ patient(id: \"test-patient-1\") { id name { family given } gender birthDate } }"
  }'
```

### 10.3 GraphQL Playground

If `ENABLE_GRAPHQL_PLAYGROUND=1`, navigate in a browser:
- v1: `http://localhost:3000/$graphql`
- v2: `http://localhost:3000/4_0_0/$graphqlv2`

---

## 11. Admin Endpoints

All admin endpoints require JWT authentication with `admin/*.*` scopes.

```bash
ADMIN_AUTH="Authorization: Bearer $TOKEN"
ADMIN_BASE=http://localhost:3000/admin
ADMIN_CONTENT="Content-Type: application/fhir+json"
```

### 11.1 Indexes

**View all indexes:**
```bash
curl "$ADMIN_BASE/indexes" -H "$ADMIN_AUTH"
```

**View index problems:**
```bash
curl "$ADMIN_BASE/indexProblems" -H "$ADMIN_AUTH"
```

**Synchronize indexes:**
```bash
curl "$ADMIN_BASE/synchronizeIndexes" -H "$ADMIN_AUTH"
```

**With audit logging:**
```bash
curl "$ADMIN_BASE/indexes?audit=true" -H "$ADMIN_AUTH"
```

### 11.2 Audit Logs

```bash
curl "$ADMIN_BASE/searchLogResults?id={audit-log-id}" \
  -H "$ADMIN_AUTH"
```

### 11.3 Person-to-Person Link Management

**Show links:**
```bash
curl "$ADMIN_BASE/showPersonToPersonLink?bwellPersonId=person-123" \
  -H "$ADMIN_AUTH"
```

**Create Person-to-Person link:**
```bash
curl -X POST "$ADMIN_BASE/createPersonToPersonLink" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"bwellPersonId": "person-master-1", "externalPersonId": "person-ext-1"}'
```

**Remove Person-to-Person link:**
```bash
curl -X POST "$ADMIN_BASE/removePersonToPersonLink" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"bwellPersonId": "person-master-1", "externalPersonId": "person-ext-1"}'
```

### 11.4 Person-to-Patient Link Management

**Create Person-to-Patient link:**
```bash
curl -X POST "$ADMIN_BASE/createPersonToPatientLink" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"externalPersonId": "person-ext-1", "patientId": "patient-1"}'
```

**Remove Person-to-Patient link:**
```bash
curl -X POST "$ADMIN_BASE/removePersonToPatientLink" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"personId": "person-ext-1", "patientId": "patient-1"}'
```

### 11.5 Patient Reference Update

```bash
curl -X POST "$ADMIN_BASE/updatePatientReference" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"patientId": "patient-1", "resourceType": "Observation", "resourceId": "obs-1"}'
```

### 11.6 Person Match

**One-to-one match:**
```bash
curl "$ADMIN_BASE/runPersonMatch?sourceType=Patient&sourceId=patient-1&targetType=Patient&targetId=patient-2" \
  -H "$ADMIN_AUTH"

# With match request details
curl "$ADMIN_BASE/runPersonMatch?sourceType=Patient&sourceId=patient-1&targetType=Patient&targetId=patient-2&includeMatchRequest=true" \
  -H "$ADMIN_AUTH"
```

**One-to-N match:**
```bash
curl "$ADMIN_BASE/runPersonOneToNMatch?id=patient-1&resourceType=Patient" \
  -H "$ADMIN_AUTH"

# With specific match resource type
curl "$ADMIN_BASE/runPersonOneToNMatch?id=patient-1&resourceType=Patient&matchResourceType=Person&includeMatchRequest=true" \
  -H "$ADMIN_AUTH"
```

### 11.7 Export Management

**Get export status:**
```bash
curl "$ADMIN_BASE/ExportStatus/{export-id}" \
  -H "$ADMIN_AUTH"
```

**Trigger export job:**
```bash
curl -X POST "$ADMIN_BASE/triggerExport/{export-id}" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT"
```

**Update export status:**
```bash
curl -X PUT "$ADMIN_BASE/ExportStatus/{export-id}" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"status": "completed"}'
```

### 11.8 Cache Management

**Get cache keys for a resource:**
```bash
curl "$ADMIN_BASE/getCacheKeys?resourceType=Patient&resourceId=test-patient-1" \
  -H "$ADMIN_AUTH"
```

**Invalidate cache by resource:**
```bash
curl -X POST "$ADMIN_BASE/invalidateCache" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"resourceType": "Patient", "resourceId": "test-patient-1"}'
```

**Invalidate cache by keys:**
```bash
curl -X POST "$ADMIN_BASE/invalidateCache" \
  -H "$ADMIN_AUTH" \
  -H "$ADMIN_CONTENT" \
  -d '{"cacheKeys": ["cache-key-1", "cache-key-2"]}'
```

### 11.9 Delete Operations

**Delete a Person:**
```bash
curl -X DELETE "$ADMIN_BASE/deletePerson?personId=person-123" \
  -H "$ADMIN_AUTH"
```

**Delete a Patient data graph:**
```bash
curl -X DELETE "$ADMIN_BASE/deletePatientDataGraph?id=patient-1" \
  -H "$ADMIN_AUTH"

# Synchronous mode
curl -X DELETE "$ADMIN_BASE/deletePatientDataGraph?id=patient-1&sync=true" \
  -H "$ADMIN_AUTH"
```

---

## 12. SMART on FHIR / OAuth

### 12.1 SMART Configuration

```bash
curl http://localhost:3000/.well-known/smart-configuration
```

**Expected:** `200 OK` with SMART configuration JSON containing `authorization_endpoint`, `token_endpoint`, `scopes_supported`, etc.

### 12.2 OAuth Callback

```bash
# Browser-based: navigate to
http://localhost:3000/authcallback?code=AUTH_CODE&state=STATE
```

### 12.3 FHIR Login Redirect

```bash
# Browser-based: navigate to
http://localhost:3000/fhir?resource=Patient
```

Redirects to OAuth provider for authentication.

### 12.4 Logout

```bash
curl http://localhost:3000/logout
curl http://localhost:3000/logout_action
```

---

## 13. Supported FHIR Resource Types

All 140 FHIR R4 resource types are supported. Each supports the full set of CRUD, search, history, and custom operations listed above.

Replace `Patient` in any of the above examples with any resource type from this list:

| Group | Resources |
|-------|-----------|
| **Individuals** | Patient, Practitioner, PractitionerRole, RelatedPerson, Person, Group |
| **Entities** | Organization, OrganizationAffiliation, HealthcareService, Endpoint, Location |
| **Workflow** | Task, Appointment, AppointmentResponse, Schedule, Slot, ServiceRequest, RequestGroup |
| **Clinical** | Condition, Procedure, Observation, DiagnosticReport, Specimen, BodyStructure, ImagingStudy, Media, MolecularSequence, FamilyMemberHistory, ClinicalImpression, DetectedIssue, AllergyIntolerance, AdverseEvent |
| **Diagnostics** | Observation, DiagnosticReport, Specimen, BodyStructure |
| **Medications** | Medication, MedicationRequest, MedicationAdministration, MedicationDispense, MedicationStatement, MedicationKnowledge, Immunization, ImmunizationEvaluation, ImmunizationRecommendation |
| **Care Provision** | CarePlan, CareTeam, Goal, NutritionOrder, VisionPrescription, RiskAssessment |
| **Financial** | Coverage, CoverageEligibilityRequest, CoverageEligibilityResponse, Claim, ClaimResponse, ExplanationOfBenefit, PaymentNotice, PaymentReconciliation, Account, ChargeItem, ChargeItemDefinition, Contract, InsurancePlan, Invoice |
| **Documents** | Composition, DocumentManifest, DocumentReference, Binary |
| **Encounters** | Encounter, EpisodeOfCare, Flag |
| **Conformance** | CapabilityStatement, StructureDefinition, OperationDefinition, SearchParameter, CompartmentDefinition, ImplementationGuide, CodeSystem, ValueSet, ConceptMap, NamingSystem, TerminologyCapabilities |
| **Events** | Communication, CommunicationRequest, AuditEvent, Provenance, Consent, Subscription, SubscriptionStatus, SubscriptionTopic |
| **Research** | ResearchStudy, ResearchSubject, ResearchDefinition, ResearchElementDefinition, Evidence, EvidenceVariable, EvidenceReport |
| **Other** | Basic, Bundle, List, Linkage, MessageDefinition, MessageHeader, OperationOutcome, Questionnaire, QuestionnaireResponse, VerificationResult, and more |

---

## Quick Smoke Test Script

Run this after `make up` to validate the core happy path:

```bash
#!/bin/bash
set -e

BASE=http://localhost:3000/4_0_0

# 1. Get token
echo "=== Getting token ==="
TOKEN=$(curl -s --request POST \
  --url http://localhost:8080/realms/master/protocol/openid-connect/token \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data client_id=bwell-client-id \
  --data client_secret=bwell-secret \
  --data grant_type=client_credentials \
  --data 'scope=user/*.* access/*.*' | jq -r '.access_token')

AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/fhir+json"

# 2. Health check
echo "=== Health Check ==="
curl -s $BASE/../health | jq .

# 3. Metadata
echo "=== Metadata ==="
curl -s "$BASE/metadata" | jq '.resourceType'

# 4. Create Patient
echo "=== Create Patient ==="
curl -s -X POST "$BASE/Patient" \
  -H "$AUTH" -H "$CT" \
  -d '{"resourceType":"Patient","id":"smoke-test-1","meta":{"source":"http://smoke-test"},"name":[{"family":"Smoke","given":["Test"]}],"gender":"male","birthDate":"2000-01-01"}' | jq '.id'

# 5. Read Patient
echo "=== Read Patient ==="
curl -s "$BASE/Patient/smoke-test-1" -H "$AUTH" | jq '.name[0].family'

# 6. Search Patient
echo "=== Search Patient ==="
curl -s "$BASE/Patient?family=Smoke" -H "$AUTH" | jq '.total'

# 7. Update Patient
echo "=== Update Patient ==="
curl -s -X PUT "$BASE/Patient/smoke-test-1" \
  -H "$AUTH" -H "$CT" \
  -d '{"resourceType":"Patient","id":"smoke-test-1","meta":{"source":"http://smoke-test"},"name":[{"family":"Smoke","given":["Test","Updated"]}],"gender":"male","birthDate":"2000-01-01"}' | jq '.meta.versionId'

# 8. History
echo "=== History ==="
curl -s "$BASE/Patient/smoke-test-1/_history" -H "$AUTH" | jq '.total'

# 9. Validate
echo "=== Validate ==="
curl -s -X POST "$BASE/Patient/\$validate" \
  -H "$AUTH" -H "$CT" \
  -d '{"resourceType":"Patient","name":[{"family":"Valid"}],"gender":"male"}' | jq '.resourceType'

# 10. Merge
echo "=== Merge ==="
curl -s -X POST "$BASE/Patient/\$merge" \
  -H "$AUTH" -H "$CT" \
  -d '{"resourceType":"Bundle","type":"collection","entry":[{"resource":{"resourceType":"Patient","id":"smoke-merge-1","meta":{"source":"http://smoke-test"},"name":[{"family":"Merged"}]}}]}' | jq '.resourceType'

# 11. Delete
echo "=== Delete ==="
curl -s -X DELETE "$BASE/Patient/smoke-test-1" -H "$AUTH" | head -c 200

# 12. Create Observation
echo -e "\n=== Create Observation ==="
curl -s -X POST "$BASE/Observation" \
  -H "$AUTH" -H "$CT" \
  -d '{"resourceType":"Observation","id":"smoke-obs-1","meta":{"source":"http://smoke-test"},"status":"final","code":{"coding":[{"system":"http://loinc.org","code":"85354-9","display":"Blood pressure"}]},"subject":{"reference":"Patient/smoke-merge-1"}}' | jq '.id'

# 13. Search Observation by patient
echo "=== Search Observation ==="
curl -s "$BASE/Observation?patient=Patient/smoke-merge-1" -H "$AUTH" | jq '.total'

# Cleanup
echo "=== Cleanup ==="
curl -s -X DELETE "$BASE/Patient/smoke-merge-1" -H "$AUTH" > /dev/null
curl -s -X DELETE "$BASE/Observation/smoke-obs-1" -H "$AUTH" > /dev/null
echo "Done!"
```

---

## Notes

- **Base version:** All FHIR endpoints use `4_0_0` as the base version path segment (R4).
- **Content types:** Always use `application/fhir+json` for POST/PUT. Use `application/json-patch+json` for PATCH.
- **Authentication:** Every FHIR endpoint (except health/version/metadata) requires a valid JWT Bearer token.
- **Scopes:** Service accounts need `user/*.*` for full access. Patient tokens are scoped to `patient/*.read`. Admin endpoints need `admin/*.*`.
- **Error responses:** All errors return FHIR `OperationOutcome` resources with `severity`, `code`, and `diagnostics`.
- **Rate limiting:** Configured per pod via `NO_OF_REQUESTS_PER_POD` environment variable.
- **The `meta.source` field** is required on all resources to track data provenance.
