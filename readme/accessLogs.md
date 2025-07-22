# Access Logs

The FHIR Server creates comprehensive access logs for all write operations and read operations with payloads to ensure proper audit trails, compliance, and operational monitoring.

## Logged Operations

Currently, access logs are created for the following operations:

- create operation
- update operation
- patch operation
- merge operation
- delete operation
- $graph operation
- delete $graph operation
- delete $everything operation

## Access Log Structure

Each access log entry contains the following key information:

### Root Level Fields
- **recorded** - Timestamp when the log entry was created
- **outcomeDesc** - Result of the operation (Success, Error)
- **agent** - Information about who performed the operation
- **details** - Technical details about the operation
- **request** - Details about the HTTP request

### Agent Information
- **altId** - User identifier
- **networkAddress** - IP address of the client
- **scopes** - OAuth scopes/permissions the user had

### Request Details
- **id** - User-provided request identifier
- **systemGeneratedRequestId** - System-generated unique identifier
- **url** - The endpoint that was called
- **start/end** - Request start and end timestamps
- **duration** - Request processing time in milliseconds
- **method** - HTTP method (GET, POST, PUT, DELETE, etc.)
- **resourceType** - FHIR resource type being operated on
- **operation** - Type of operation (READ, WRITE)

Example access log data:

```json
{
    "recorded": "2025-07-21T07:14:20.044Z",
    "outcomeDesc": "Success",
    "agent": {
        "altId": "imran",
        "networkAddress": "::ffff:127.0.0.1",
        "scopes": "user/*.read user/*.write access/*.*"
    },
    "details": {
        "version": "5.12.16",
        "originService": "test-server",
        "host": "36365f1830b9",
        "contentType": "application/fhir+json",
        "accept": "application/fhir+json",
        "operationResult": "[{\"created\":true,\"id\":\"1\",\"uuid\":\"61abdd48-df46-5e98-ac6c-fde3cace4d07\",\"resourceType\":\"Observation\",\"updated\":false,\"sourceAssigningAuthority\":\"bwell\"}]",
        "body": "{\"resourceType\":\"Observation\",\"id\":\"1\",\"meta\":{\"source\":\"https://www.icanbwell.com\",\"security\":[{\"system\":\"https://www.icanbwell.com/owner\",\"code\":\"bwell\"}]},\"status\":\"final\",\"text\":{\"status\":\"generated\",\"div\":\"<div xmlns=\\\"http://www.w3.org/1999/xhtml\\\"><p>Carbon dioxide in blood</p></div>\"},\"code\":{\"coding\":[{\"system\":\"URN:OID:2.16.840.1.113883.6.96\",\"code\":\"11557-6\",\"display\":\"Carbon dioxide in blood\"}]},\"subject\":{\"reference\":\"Patient/1\",\"display\":\"P. van de Heuvel\"},\"encounter\":{\"reference\":\"Encounter/1\"},\"effectiveDateTime\":\"2013-04-02T10:30:10+01:00\",\"issued\":\"2013-04-03T15:30:10+01:00\",\"performer\":[{\"reference\":\"Practitioner/f005\",\"display\":\"A. Langeveld\"}],\"valueQuantity\":{\"value\":6.2,\"unit\":\"kPa\",\"system\":\"http://unitsofmeasure.org\",\"code\":\"kPa\"},\"interpretation\":[{\"coding\":[{\"system\":\"urn:oid:2.16.840.1.113883.6.96\",\"code\":\"H\",\"display\":\"High\"}]}],\"referenceRange\":[{\"low\":{\"value\":4.8,\"unit\":\"kPa\",\"system\":\"http://unitsofmeasure.org\",\"code\":\"kPa\"},\"high\":{\"value\":6,\"unit\":\"kPa\",\"system\":\"http://unitsofmeasure.org\",\"code\":\"kPa\"}}]}"
    },
    "request": {
        "id": "test-request-id",
        "systemGeneratedRequestId": "30259e6a-bcc5-4115-bd53-8406eb81cc45",
        "url": "/4_0_0/Observation/$merge",
        "start": "2025-07-21T07:14:19.870Z",
        "end": "2025-07-21T07:14:20.044Z",
        "resourceType": "Observation",
        "operation": "WRITE",
        "duration": 174,
        "method": "POST"
    }
}
```

## Need for Access Logs

Access logs serve several critical purposes in the FHIR Server:

### Audit and Compliance
- **Data Integrity** - Track all write operations to ensure data changes can be traced back to specific users and operations
- **Security Monitoring** - Monitor who accessed or modified patient data, when, and from where

### Operational Monitoring
- **Performance Analysis** - Track operation duration and identify slow-performing requests (e.g., monitoring request duration for optimization)
- **Usage Patterns** - Understand which operations are most frequently used and by whom
- **Error Investigation** - When issues occur, access logs provide the complete context of the request, including the full payload and operation details

### Troubleshooting and Support
- **Request Reconstruction** - The complete request body and headers are preserved, allowing developers to reproduce issues
- **Operation Results** - Detailed results show what was created, updated, or modified during each operation
- **User Context** - Each log includes user identity, IP address, and authorization scopes for complete request context

### Data Governance
- **Source Tracking** - Each operation records the source system and assigning authority
- **Change History** - Maintain a complete history of all data modifications with timestamps and user attribution
- **Resource Relationships** - Track operations on related resources and their interconnections

## Querying Access Logs

Access logs can be retrieved for troubleshooting, auditing, or compliance purposes using the request ID. The JWT token must include admin scope (`access/*.*`) to fetch access logs

### API Endpoint
```
GET /admin/searchLogResults?id={request-id}
```

### Example Request
```bash
curl --request GET \
  --url '<baseUrl>/admin/searchLogResults?id=test-request-id' \
  --header 'authorization: Bearer <token-with-admin-scope>' \
  --header 'accept: application/json'
```

### Response
The API returns the complete access log entry as shown in the structure example above, including all request details, user information, and operation results.
