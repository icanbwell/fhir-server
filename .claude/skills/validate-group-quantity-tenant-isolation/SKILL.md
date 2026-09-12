---
name: validate-group-quantity-tenant-isolation
description: Validate EA-2335 fix - tenant filtering for Group.quantity enrichment from ClickHouse. Tests all three code paths (searchById, $everything, $graph) that call GroupMemberEnrichmentProvider._getMemberCount. Use when validating EA-2335 defense-in-depth security, testing Group operations with useExternalStorage header, or verifying ClickHouse tenant filtering works correctly.
type: validation
---

# Validate Group.quantity Tenant Isolation (EA-2335 Fix)

Validates that EA-2335 defense-in-depth tenant filtering works correctly for Group.quantity enrichment from ClickHouse across all three affected code paths.

## Overview

**EA-2335 Issue:** `GroupMemberEnrichmentProvider._getMemberCount` computed Group.quantity without tenant filtering, potentially disclosing member counts across tenants.

**Fix:** Two-layer defense-in-depth:
1. **Layer 1 (MongoDB):** Authorization filters Groups BEFORE enrichment runs (primary defense)
2. **Layer 2 (ClickHouse):** Tenant filtering in `_getMemberCount` with `hasAny(argMaxMerge(access_tags))` (backup defense)

**Impact:** Only affects Groups with `useExternalStorage: true` header (ClickHouse-backed Groups)

**Affected Code Paths:**
- `GET /Group/{id}` - searchById.js
- `GET /Patient/{id}/$everything` - everythingHelper.js (2 call sites)
- `GET /$graph` - graphHelpers.js

## Prerequisites

- FHIR server running (local: http://localhost:3000, or remote)
- Keycloak running (local: http://localhost:8080)
- `curl`, `jq` available
- ClickHouse container running
- Client credentials: `bwell` / `bwell-secret` (default local dev)

## Test Procedure

### Step 1: Generate Tokens with Different Tenant Scopes

```bash
KEYCLOAK_URL="http://localhost:8080/realms/master/protocol/openid-connect/token"
FHIR_URL="http://localhost:3000/4_0_0"

# Token A - access to client-a resources
curl -s --request POST \
  --url "$KEYCLOAK_URL" \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data grant_type=client_credentials \
  --data client_id=bwell \
  --data client_secret=bwell-secret \
  --data "scope=user/*.* access/client-a.*" \
  | jq -r '.access_token' > /tmp/token_client_a.txt

# Token B - access to client-b resources
curl -s --request POST \
  --url "$KEYCLOAK_URL" \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data grant_type=client_credentials \
  --data client_id=bwell \
  --data client_secret=bwell-secret \
  --data "scope=user/*.* access/client-b.*" \
  | jq -r '.access_token' > /tmp/token_client_b.txt

TOKEN_A=$(cat /tmp/token_client_a.txt)
TOKEN_B=$(cat /tmp/token_client_b.txt)

if [ -z "$TOKEN_A" ] || [ -z "$TOKEN_B" ]; then
  echo "❌ Token generation failed. Check Keycloak:"
  echo "   docker ps | grep keycloak"
  exit 1
fi

echo "✅ Tokens generated"
echo "Token A: ${TOKEN_A:0:50}..."
echo "Token B: ${TOKEN_B:0:50}..."
```

**Verify scopes (optional):**

```bash
python3 << 'PYEOF'
import base64, json
for tenant in ['a', 'b']:
    with open(f'/tmp/token_client_{tenant}.txt') as f:
        token = f.read().strip()
    payload = token.split('.')[1] + '=' * (4 - len(token.split('.')[1]) % 4)
    claims = json.loads(base64.b64decode(payload))
    print(f"Token {tenant.upper()}: {claims.get('scope', 'N/A')}")
PYEOF
```

Expected:
```
Token A: user/*.* access/client-a.*
Token B: user/*.* access/client-b.*
```

### Step 2: Create Test Data

Create Patient and Group with ClickHouse storage (both client-a tenant):

```bash
TIMESTAMP=$(date +%s)
PATIENT_ID="ea2335-patient-$TIMESTAMP"
GROUP_ID="ea2335-group-$TIMESTAMP"

# Create Patient (client-a tenant)
curl -X PUT "$FHIR_URL/Patient/$PATIENT_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/fhir+json" \
  -s -o /dev/null -w "Patient: %{http_code}\n" \
  -d '{
    "resourceType": "Patient",
    "id": "'$PATIENT_ID'",
    "meta": {
      "security": [
        {"system": "https://www.icanbwell.com/access", "code": "client-a"},
        {"system": "https://www.icanbwell.com/owner", "code": "client-a"}
      ]
    },
    "name": [{"family": "TestPatient", "given": ["EA2335"]}]
  }'

# Create Group with Patient as member (client-a tenant, ClickHouse storage)
curl -X PUT "$FHIR_URL/Group/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/fhir+json" \
  -H "useExternalStorage: true" \
  -s -o /dev/null -w "Group: %{http_code}\n" \
  -d '{
    "resourceType": "Group",
    "id": "'$GROUP_ID'",
    "type": "person",
    "actual": true,
    "name": "EA-2335 Test Group",
    "meta": {
      "security": [
        {"system": "https://www.icanbwell.com/access", "code": "client-a"},
        {"system": "https://www.icanbwell.com/owner", "code": "client-a"}
      ]
    },
    "member": [
      {"entity": {"reference": "Patient/'$PATIENT_ID'"}},
      {"entity": {"reference": "Patient/test-patient-2"}},
      {"entity": {"reference": "Patient/test-patient-3"}}
    ]
  }'

echo "✅ Test data created"
echo "Patient ID: $PATIENT_ID"
echo "Group ID: $GROUP_ID"
echo ""
echo "Waiting 3 seconds for ClickHouse to process member events..."
sleep 3
```

Expected: Both HTTP 200 or 201

### Test Path 1: GET /Group/{id} (searchById.js)

#### Test 1.1: Same-Tenant Read (Should Succeed)

```bash
echo "=== Test 1.1: GET /Group/{id} with client-a token ==="

curl -s -X GET "$FHIR_URL/Group/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "useExternalStorage: true" \
  -w "\nHTTP: %{http_code}\n" \
  | jq '{id, type, quantity, hasMemberArray: (.member != null), security: [.meta.security[]?.code]}'
```

**Expected:**
```json
{
  "id": "ea2335-group-1234567890",
  "type": "person",
  "quantity": 3,
  "hasMemberArray": false,
  "security": ["client-a", "client-a"]
}
HTTP: 200
```

✅ **PASS Criteria:**
- HTTP 200
- `quantity: 3` (ClickHouse count with tenant filtering)
- `hasMemberArray: false` (member array removed)
- Security tags match token scope

#### Test 1.2: Cross-Tenant Read (Should Be Blocked)

```bash
echo "=== Test 1.2: GET /Group/{id} with client-b token ==="

curl -s -X GET "$FHIR_URL/Group/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "useExternalStorage: true" \
  -w "\nHTTP: %{http_code}\n" \
  | jq '.'
```

**Expected:**
```json
{
  "resourceType": "OperationOutcome",
  "issue": [{
    "severity": "error",
    "code": "not-found",
    "details": {"text": "Resource not found: Group/ea2335-group-1234567890"}
  }]
}
HTTP: 404
```

✅ **PASS Criteria:**
- HTTP 404
- MongoDB (Layer 1) blocked BEFORE enrichment
- No PHI disclosure (quantity never computed)

### Test Path 2: GET /Patient/{id}/$everything (everythingHelper.js)

#### Test 2.1: Same-Tenant $everything (Should Include Group)

```bash
echo "=== Test 2.1: GET /Patient/{id}/\$everything with client-a token ==="

curl -s -X GET "$FHIR_URL/Patient/$PATIENT_ID/\$everything" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "useExternalStorage: true" \
  -w "\nHTTP: %{http_code}\n" \
  | jq '{
    resourceType,
    type,
    total,
    groups: [.entry[]? | select(.resource.resourceType == "Group") | {
      id: .resource.id,
      quantity: .resource.quantity,
      hasMemberArray: (.resource.member != null)
    }]
  }'
```

**Expected:**
```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 2,
  "groups": [{
    "id": "ea2335-group-1234567890",
    "quantity": 3,
    "hasMemberArray": false
  }]
}
HTTP: 200
```

✅ **PASS Criteria:**
- HTTP 200
- Bundle contains Group with `quantity: 3`
- Group has `hasMemberArray: false`
- everythingHelper.js securityContext propagation working

#### Test 2.2: Cross-Tenant $everything (Should NOT Include Group)

```bash
echo "=== Test 2.2: GET /Patient/{id}/\$everything with client-b token ==="

curl -s -X GET "$FHIR_URL/Patient/$PATIENT_ID/\$everything" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "useExternalStorage: true" \
  -w "\nHTTP: %{http_code}\n" \
  | jq '.'
```

**Expected:**
```json
{
  "resourceType": "OperationOutcome",
  "issue": [{
    "severity": "error",
    "code": "not-found",
    "details": {"text": "Resource not found: Patient/ea2335-patient-1234567890"}
  }]
}
HTTP: 404
```

✅ **PASS Criteria:**
- HTTP 404 (Patient not visible to client-b)
- MongoDB (Layer 1) blocks access to Patient
- $everything never runs, Group never returned
- No PHI disclosure

**Alternative scenario:** If Patient had `client-b` security tag but Group has `client-a`:
```bash
# Create Patient with client-b tag
PATIENT_B_ID="ea2335-patient-b-$TIMESTAMP"
curl -X PUT "$FHIR_URL/Patient/$PATIENT_B_ID" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/fhir+json" \
  -s -o /dev/null \
  -d '{
    "resourceType": "Patient",
    "id": "'$PATIENT_B_ID'",
    "meta": {
      "security": [
        {"system": "https://www.icanbwell.com/access", "code": "client-b"},
        {"system": "https://www.icanbwell.com/owner", "code": "client-b"}
      ]
    },
    "name": [{"family": "TestPatient", "given": ["ClientB"]}]
  }'

# Test $everything - should NOT include client-a Group
curl -s -X GET "$FHIR_URL/Patient/$PATIENT_B_ID/\$everything" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "useExternalStorage: true" \
  | jq '{
    total,
    groups: [.entry[]? | select(.resource.resourceType == "Group") | .resource.id]
  }'
```

Expected:
```json
{
  "total": 1,
  "groups": []
}
```

✅ **PASS:** Bundle doesn't include client-a's Group (MongoDB filtered)

### Test Path 3: GET /$graph (graphHelpers.js)

#### Test 3.1: Same-Tenant $graph (Should Include Group)

```bash
echo "=== Test 3.1: GET /\$graph with client-a token ==="

curl -s -X GET "$FHIR_URL/\$graph?subject=Patient/$PATIENT_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "useExternalStorage: true" \
  -w "\nHTTP: %{http_code}\n" \
  | jq '{
    resourceType,
    type,
    total,
    groups: [.entry[]? | select(.resource.resourceType == "Group") | {
      id: .resource.id,
      quantity: .resource.quantity,
      hasMemberArray: (.resource.member != null)
    }]
  }'
```

**Expected:**
```json
{
  "resourceType": "Bundle",
  "type": "searchset",
  "total": 2,
  "groups": [{
    "id": "ea2335-group-1234567890",
    "quantity": 3,
    "hasMemberArray": false
  }]
}
HTTP: 200
```

✅ **PASS Criteria:**
- HTTP 200
- Bundle contains Group with `quantity: 3`
- graphHelpers.js securityContext propagation working

#### Test 3.2: Cross-Tenant $graph (Should NOT Include Group)

```bash
echo "=== Test 3.2: GET /\$graph with client-b token ==="

curl -s -X GET "$FHIR_URL/\$graph?subject=Patient/$PATIENT_ID" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "useExternalStorage: true" \
  -w "\nHTTP: %{http_code}\n" \
  | jq '{
    total,
    groups: [.entry[]? | select(.resource.resourceType == "Group") | .resource.id]
  }'
```

**Expected:**
```json
{
  "total": 0,
  "groups": []
}
```

✅ **PASS Criteria:**
- Empty bundle or no Groups (Patient/Group not visible to client-b)
- MongoDB (Layer 1) filters Groups
- No PHI disclosure

### Step 3: Verify Code Implementation

```bash
# Check 1: GroupMemberEnrichmentProvider has tenant filtering
docker exec fhir-dev-fhir-1 grep -A 10 "Add tenant filtering:" \
  /srv/src/src/enrich/providers/groupMemberEnrichmentProvider.js | grep "hasAny"

# Expected: hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})

# Check 2: searchById derives securityContext
docker exec fhir-dev-fhir-1 grep -A 5 "Derive security context for enrichment" \
  /srv/src/src/operations/searchById/searchById.js

# Expected: getAccessCodesFromScopes, getSecurityTagsFromScope

# Check 3: everythingHelper derives securityContext (2 call sites)
docker exec fhir-dev-fhir-1 grep -n "Derive security context for enrichment" \
  /srv/src/src/operations/everything/everythingHelper.js

# Expected: Lines ~1087 and ~1918

# Check 4: graphHelpers derives securityContext
docker exec fhir-dev-fhir-1 grep -A 5 "Derive security context for enrichment" \
  /srv/src/src/operations/graph/graphHelpers.js

# Expected: getAccessCodesFromScopes, getSecurityTagsFromScope
```

### Cleanup

```bash
# Delete test resources
curl -X DELETE "$FHIR_URL/Patient/$PATIENT_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -s -o /dev/null -w "Patient deleted: %{http_code}\n"

curl -X DELETE "$FHIR_URL/Group/$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  -s -o /dev/null -w "Group deleted: %{http_code}\n"
```

## Defense-in-Depth Architecture

### Layer 1: MongoDB Authorization (Primary)

- Group/Patient loaded via tenant-scoped `findAsync()` with security tag filters
- Query includes: `meta.security: { $elemMatch: { code: 'client-a' } }`
- Returns `null` if caller cannot see the resource
- Throws 404 BEFORE enrichment runs
- **Result:** Unauthorized callers never reach ClickHouse query path

### Layer 2: ClickHouse Tenant Filtering (Backup)

- `_getMemberCount` receives `securityContext` from JWT
- Extracts `accessTags`, `ownerTags`, `hasFullAccess`
- ClickHouse query includes: `hasAny(argMaxMerge(access_tags), {accessTags:Array(String)})`
- Admin bypass: `hasFullAccess: true` → no tag filter
- **Result:** Even if Layer 1 bypassed, Layer 2 filters by tenant scope

### Why Both Layers Matter

- **Layer 1 is primary:** Most efficient, blocks at earliest point
- **Layer 2 is backup:** Protects against MongoDB bugs, internal API calls, future code changes
- **Fail-closed:** Non-admin with no tags → ClickHouse filter still applies

## Expected Results Summary

| Test Path | Operation | Client | Group Security | Expected HTTP | Expected quantity | Layer 1 | Layer 2 |
|-----------|-----------|--------|----------------|---------------|-------------------|---------|---------|
| **1.1** | GET /Group/{id} | client-a | client-a | 200 | 3 | ✅ Authorized | ✅ Filtered |
| **1.2** | GET /Group/{id} | client-b | client-a | 404 | N/A | ✅ Blocked | N/A |
| **2.1** | $everything | client-a | client-a | 200 | 3 | ✅ Authorized | ✅ Filtered |
| **2.2** | $everything | client-b | client-a | 404 or empty | N/A | ✅ Blocked | N/A |
| **3.1** | $graph | client-a | client-a | 200 | 3 | ✅ Authorized | ✅ Filtered |
| **3.2** | $graph | client-b | client-a | Empty | N/A | ✅ Blocked | N/A |

## Troubleshooting

### Quantity is 0 for same-tenant reads

**Diagnosis:**
```bash
# Check ClickHouse events
docker exec -it fhir-clickhouse clickhouse-client --query \
  "SELECT count(*) FROM fhir.Group_4_0_0_MemberEvents WHERE group_id = '$GROUP_ID'"

# Should return 3
```

**Fixes:**
- Wait longer (5-10 seconds) for async sync
- Check `ENABLE_CLICKHOUSE=1` env var
- Check ClickHouse logs: `docker logs fhir-clickhouse`

### Client-b can read client-a's Group (CRITICAL)

**This is a security vulnerability!**

**Fixes:**
- Verify EA-2335 code is deployed (branch EA-2335, commits 9d715c36f+)
- Rebuild container: `make down && docker-compose build fhir && make up`
- Check all 4 code verification steps pass

### $everything or $graph doesn't include Group

**Diagnosis:**
```bash
# Verify Group exists and is queryable
curl -s -X GET "$FHIR_URL/Group?_id=$GROUP_ID" \
  -H "Authorization: Bearer $TOKEN_A" \
  | jq '.total'

# Should return 1
```

**Fixes:**
- Verify Group has correct security tags
- Check $everything/$graph includes Group resource type
- Verify `useExternalStorage: true` header present

## Files Modified (EA-2335)

- `src/enrich/providers/groupMemberEnrichmentProvider.js` - Tenant filtering in _getMemberCount
- `src/operations/searchById/searchById.js` - Security context derivation
- `src/operations/everything/everythingHelper.js` - Security context derivation (2 sites)
- `src/operations/graph/graphHelpers.js` - Security context derivation

## Success Criteria

✅ **All 6 tests pass:**
1. Test 1.1: GET /Group/{id} with client-a → 200 with quantity: 3
2. Test 1.2: GET /Group/{id} with client-b → 404
3. Test 2.1: $everything with client-a → Group in bundle with quantity: 3
4. Test 2.2: $everything with client-b → 404 or empty bundle
5. Test 3.1: $graph with client-a → Group in bundle with quantity: 3
6. Test 3.2: $graph with client-b → empty bundle

✅ **Code verification checks pass:**
- Tenant filtering present in _getMemberCount
- Security context derived in all 3 operations
- Uses hasAny(argMaxMerge(access_tags)) pattern

✅ **EA-2335 cross-tenant member count disclosure vulnerability is FIXED**

**Key principle:** Group.quantity computed with tenant scope enforcement through defense-in-depth (MongoDB + ClickHouse) across all three affected code paths.
