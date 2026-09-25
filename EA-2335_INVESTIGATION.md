# EA-2335 Investigation: MongoDB Authorization Before Enrichment

## Question
Does `GET /Group/{id}` filter at MongoDB level BEFORE enrichment runs, or can enrichment run for unauthorized Groups?

## Answer: ✅ MongoDB Filters FIRST (Defense in Depth)

EA-2335 is **defense-in-depth**, NOT an exploitable vulnerability.

## Evidence

### Authorization Flow in searchById.js

**File:** `src/operations/searchById/searchById.js`

**Line 187-199:** Construct tenant-filtered query
```javascript
const { query } = await this.searchManager.constructQueryAsync({
    user,
    scope,
    isUser,
    userType,
    resourceType,
    useAccessIndex,
    personIdFromJwtToken,
    parsedArgs,
    operation: READ,
    requestId,
    actor
});
```

**Line 207:** Execute MongoDB query with tenant filters
```javascript
const cursor = await databaseQueryManager.findAsync({ query, extraInfo });
```

**Line 212:** Convert results to array
```javascript
const resources = await cursor.toArrayAsync();
```

**Line 239:** Get first resource (or null)
```javascript
resource = getFirstResourceOrNull(resources);
```

**Line 241-256:** Enrichment runs **ONLY IF** resource exists
```javascript
if (resource) {
    // ... removeNull ...

    // Enrichment runs here - ONLY for authorized resources
    resource = (await this.enrichmentManager.enrichAsync({
        resources: [resource],
        parsedArgs,
        enrichmentContext: { userType, actor }
    }))[0];

    if (!resource) {
        throw new NotFoundError(`Resource not found: ${resourceType}/${id}`);
    }
    // ... continue processing ...
}
```

**Line 288:** If resource is null (unauthorized), throw 404 **BEFORE** enrichment
```javascript
else {
    throw new NotFoundError(`Resource not found: ${resourceType}/${id}`);
}
```

### Tenant Filtering in searchManager.constructQueryAsync

**File:** `src/operations/search/searchManager.js`

**Line 231:** Extract security tags from JWT scope
```javascript
const securityTags = this.securityTagManager.getSecurityTagsFromScope({
    user, scope, accessRequested
});
```

**Line 296:** Apply security tag filter to MongoDB query
```javascript
query = this.securityTagManager.getQueryWithSecurityTags({
    resourceType,
    securityTags,
    query,
    useAccessIndex,
    useHistoryTable
});
```

This query with tenant filtering is what gets passed to `findAsync()`.

## Attack Scenario (BLOCKED)

**Attacker attempts:**
```bash
GET /4_0_0/Group/test-group-a
Authorization: Bearer <token with scope: access/client-b.*>
```

Where `test-group-a` has `security.code: "client-a"` (different tenant).

**Defense sequence:**
1. ✅ `searchManager.constructQueryAsync()` adds tenant filter: `meta.security: { $elemMatch: { code: 'client-b' } }`
2. ✅ `databaseQueryManager.findAsync({ query })` executes MongoDB query with tenant filter
3. ✅ MongoDB returns `null` (Group not visible to client-b)
4. ✅ Line 239: `resource = null`
5. ✅ Line 288: Throws `NotFoundError` **BEFORE** enrichment runs
6. ✅ **No PHI disclosure** - enrichment never executes, quantity never computed

## Other Enrichment Paths

All enrichment call sites follow the same pattern:

1. **searchById** (line 247) - Enrichment after MongoDB findAsync returns authorized resource
2. **expand** - Enrichment after MongoDB findAsync returns authorized resource
3. **searchByVersionId** - Enrichment after MongoDB findAsync returns authorized resource
4. **everything** (bundle) - Enrichment after MongoDB findAsync returns authorized resources
5. **graph** (bundle) - Enrichment after MongoDB findAsync returns authorized resources
6. **export** - Enrichment after MongoDB findAsync returns authorized resources

**Pattern:** MongoDB authorization ALWAYS precedes enrichment.

## Conclusion

### Impact: Defense in Depth (Not Exploitable)

**Current State:**
- ✅ MongoDB authorization blocks unauthorized Group reads BEFORE enrichment
- ❌ `GroupMemberEnrichmentProvider._getMemberCount` queries ClickHouse without tenant filtering
- ✅ But unauthorized callers never reach this code path (404 first)

**Why Fix Anyway:**
1. **Consistency:** All ClickHouse queries should have tenant filtering (EA-2333 pattern)
2. **Defense in depth:** If MongoDB authorization is ever bypassed (e.g., internal API call), ClickHouse still enforces tenant scope
3. **Code clarity:** Makes security invariants explicit and auditable
4. **Future-proof:** Prevents regressions if code paths change

### Severity: Low (Defense in Depth)

- **NOT** a cross-tenant PHI disclosure vulnerability (MongoDB blocks first)
- **IS** a missing layer of defense if MongoDB authorization is bypassed
- **SHOULD** be fixed to complete the EA-2333 tenant isolation work

## Next Steps

Proceed with Task #2: Add tenant filtering to `_getMemberCount` to complete defense-in-depth hardening.
