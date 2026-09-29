# `_content` Search via `fhir-notes-vector-store` Delegation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the FHIR `_content` search parameter for `DocumentReference`/`DiagnosticReport`/
`CarePlan` by delegating to `fhir-notes-vector-store`'s existing MongoDB Atlas Search index, plus
derived-text read enrichment and a `Binary` reverse lookup, all re-authorized through fhir-server's
normal tenant-scoped query path.

**Architecture:** A new, read-only Mongo connection to the `fhir-notes-vector-store` cluster.
`ClinicalNoteSearchClient` runs a `$search`/`queryString` Atlas Search query against that cluster to
get candidate FHIR ids, which `SearchManager.constructQueryAsync` folds into the request as a normal
`_id ∈ [...]` filter (via the existing `FilterById`) *before* tenant/patient/access-tag scoping is
applied — so every candidate is re-authorized by code that already runs for every other search
parameter, never by a separate path. `ClinicalNoteTextRetriever` reassembles chunked text for the
read-enrichment and `Binary` reverse-lookup features, both implemented as `EnrichmentProvider`s that
run after (never before) a resource's own authorized fetch.

**Tech Stack:** Node.js / CommonJS, Jest, MongoDB (`mongodb` driver, Atlas Search `$search`).

**Spec:** `docs/superpowers/specs/2026-09-10-text-content-search-design.md`

## Global Constraints

- **Never assert `instanceof`/`toBeInstanceOf` against any `src/utils/httpErrors.js` class**
  (`BadRequestError`, `ExternalTimeoutError`, etc.) in a test. `ServerError`'s constructor
  (`src/middleware/fhir/utils/server.error.js`) unconditionally calls
  `Object.setPrototypeOf(this, ServerError.prototype)`, which resets every subclass instance's
  prototype chain back to `ServerError.prototype` — a pre-existing, already-documented bug (see
  `src/tests/unit/utils/httpErrors.test.js` and
  `src/tests/unit/operations/query/filters/composite.test.js`). The established convention this
  codebase already uses is to assert on `err.statusCode` instead. Do not work around this at any
  throw site (e.g. via `Object.setPrototypeOf` before throwing) — that would be a one-off
  deviation from how every other part of this codebase already handles it.
- Supported resource types for `_content` search and read enrichment: exactly `DocumentReference`,
  `DiagnosticReport`, `CarePlan` (search) — `CarePlan` needs no read enrichment (its `note[].text` is
  already plain text). `_content` on any other resource type is a `BadRequestError`, never a silent
  no-op and never a silent full scan.
- A candidate resource id returned by the vector-store cluster is **never** the authorization
  boundary — it becomes an ordinary `_id ∈ [...]` filter that flows through the *same, unmodified*
  tenant/patient/access-tag scoping every other search request already goes through. No new
  "vector store says yes" code path is introduced anywhere in this plan.
- An empty vector-store candidate list must produce zero search results (`FilterById.getListFilter([])`
  already returns `{ _uuid: { $in: [] } }` — never "no filter, so return everything").
- If the vector-store cluster is unreachable during a `_content` **search**, fail the request
  (`ExternalTimeoutError`, HTTP 504) — never silently fall back to an unfiltered result set.
- If the vector-store cluster is unreachable during **read enrichment** or the **`Binary` reverse
  lookup**, degrade gracefully: return the base resource without the derived text, log it. This is
  never a request-failing error.
- The read-enrichment / reverse-lookup trigger is `_content` present with an **empty string** value,
  and only applies when the request targets exactly one resource by id — detected via
  `parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id')` having exactly one value (the same
  signal `searchById.js` itself uses to detect a by-id read). This works whether the request reached
  the enrichment provider via a true `read`/`vread` operation or via a `search` with an explicit
  `_id=` param — both are bounded to one resource, so both are safe.
- All new config (`FHIR_NOTES_MONGO_URL`, `FHIR_NOTES_MONGO_DB_NAME`,
  `FHIR_NOTES_MONGO_COLLECTION_NAME`, `FHIR_NOTES_TEXT_SEARCH_INDEX_NAME`) must be set together for
  the feature to be considered "configured"; if any is missing, `_content` search throws
  `BadRequestError` (feature not configured) and the enrichment/reverse-lookup providers no-op.
- The feature also requires an explicit `ENABLE_FULL_TEXT_SEARCH=1` flag, independent of whether the
  connection is wired up — this separates "is the cross-cluster connection configured" from "is the
  feature turned on," mirroring this codebase's existing `enableAuditEventArchiveRead`-style
  kill-switch pattern (`src/utils/configManager.js:566`). An operator can deploy the connection
  config ahead of a rollout and flip this one flag to enable/disable, or use it as an emergency kill
  switch without touching connection env vars. `fhirNotesFullTextSearchConfigured` (Task 3) is `true`
  only when **both** the connection is fully configured **and** this flag is set.

---

## Task 1: `fhirNotesMongoConfig` — config for the read-only cross-cluster connection

**Files:**
- Modify: `src/config.js:216` (insert after `resourceHistoryMongoConfig`, before the whitelist section)
- Test: `src/tests/unit/config/fhirNotesMongoConfig.test.js` (new)

**Interfaces:**
- Produces: `fhirNotesMongoConfig: {connection: string|undefined, db_name: string|undefined,
  collection_name: string|undefined, index_name: string|undefined, options:
  import('mongodb').MongoClientOptions} | {}` exported from `src/config.js`. `connection` is
  `undefined` (object has no `connection` key at all) when `FHIR_NOTES_MONGO_URL` isn't set — this is
  the "feature not configured" signal Task 3's `ConfigManager` getter checks.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect, afterEach } = require('@jest/globals');

describe('fhirNotesMongoConfig', () => {
    const ORIGINAL_ENV = process.env;

    afterEach(() => {
        process.env = ORIGINAL_ENV;
        jest.resetModules();
    });

    test('has no connection when FHIR_NOTES_MONGO_URL is unset', () => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.FHIR_NOTES_MONGO_URL;
        const { fhirNotesMongoConfig } = require('../../../config');
        expect(fhirNotesMongoConfig.connection).toBeUndefined();
    });

    test('builds connection/db_name/collection_name/index_name from env when set', () => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
            FHIR_NOTES_MONGO_URL: 'mongodb://fhir-notes-host:27017',
            FHIR_NOTES_MONGO_DB_NAME: 'fhir_notes',
            FHIR_NOTES_MONGO_COLLECTION_NAME: 'clinical_notes',
            FHIR_NOTES_TEXT_SEARCH_INDEX_NAME: 'fhir-notes-text-search'
        };
        const { fhirNotesMongoConfig } = require('../../../config');
        expect(fhirNotesMongoConfig.connection).toEqual('mongodb://fhir-notes-host:27017');
        expect(fhirNotesMongoConfig.db_name).toEqual('fhir_notes');
        expect(fhirNotesMongoConfig.collection_name).toEqual('clinical_notes');
        expect(fhirNotesMongoConfig.index_name).toEqual('fhir-notes-text-search');
    });

    test('embeds username/password into the connection string when provided', () => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
            FHIR_NOTES_MONGO_URL: 'mongodb://fhir-notes-host:27017',
            FHIR_NOTES_MONGO_USERNAME: 'reader',
            FHIR_NOTES_MONGO_PASSWORD: 'secret',
            FHIR_NOTES_MONGO_DB_NAME: 'fhir_notes',
            FHIR_NOTES_MONGO_COLLECTION_NAME: 'clinical_notes',
            FHIR_NOTES_TEXT_SEARCH_INDEX_NAME: 'fhir-notes-text-search'
        };
        const { fhirNotesMongoConfig } = require('../../../config');
        expect(fhirNotesMongoConfig.connection).toContain('reader:secret@');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/config/fhirNotesMongoConfig.test.js -v`
Expected: FAIL — `fhirNotesMongoConfig` is not exported from `../../../config`.

- [ ] **Step 3: Write minimal implementation**

Insert into `src/config.js`, immediately after the closing brace of the `resourceHistoryMongoConfig`
block (after line 216, before the `// Set up whitelist` comment):

```js
/**
 * @name fhirNotesMongoConfig
 * @summary Configuration for the read-only fhir-notes-vector-store Mongo cluster. Absent
 * `connection` means the feature is not configured in this environment.
 * @type {{connection: string, db_name: string, collection_name: string, index_name: string, options: import('mongodb').MongoClientOptions }}
 */
let fhirNotesMongoConfig = {};
if (env.FHIR_NOTES_MONGO_URL) {
    let fhirNotesMongoUrl = env.FHIR_NOTES_MONGO_URL;
    if (env.FHIR_NOTES_MONGO_USERNAME !== undefined) {
        fhirNotesMongoUrl = fhirNotesMongoUrl.replace(
            'mongodb://',
            `mongodb://${env.FHIR_NOTES_MONGO_USERNAME}:${env.FHIR_NOTES_MONGO_PASSWORD}@`
        );
        fhirNotesMongoUrl = fhirNotesMongoUrl.replace(
            'mongodb+srv://',
            `mongodb+srv://${env.FHIR_NOTES_MONGO_USERNAME}:${env.FHIR_NOTES_MONGO_PASSWORD}@`
        );
    }
    // url-encode the url
    fhirNotesMongoUrl = encodeURI(fhirNotesMongoUrl);
    const fhirNotesQueryParams = getQueryParams(fhirNotesMongoUrl);
    delete fhirNotesQueryParams.w;
    fhirNotesMongoConfig = {
        connection: fhirNotesMongoUrl,
        db_name: env.FHIR_NOTES_MONGO_DB_NAME ? String(env.FHIR_NOTES_MONGO_DB_NAME) : undefined,
        collection_name: env.FHIR_NOTES_MONGO_COLLECTION_NAME
            ? String(env.FHIR_NOTES_MONGO_COLLECTION_NAME)
            : undefined,
        index_name: env.FHIR_NOTES_TEXT_SEARCH_INDEX_NAME
            ? String(env.FHIR_NOTES_TEXT_SEARCH_INDEX_NAME)
            : undefined,
        options: {
            ...options,
            ...fhirNotesQueryParams,
            // read-only workload against a dependency-of-a-dependency cluster: small pool,
            // short timeout so an outage there can't stall fhir-server's primary request path
            minPoolSize: env.FHIR_NOTES_MIN_POOL_SIZE ? parseInt(env.FHIR_NOTES_MIN_POOL_SIZE) : 1,
            maxPoolSize: env.FHIR_NOTES_MAX_POOL_SIZE ? parseInt(env.FHIR_NOTES_MAX_POOL_SIZE) : 10,
            connectTimeoutMS: env.FHIR_NOTES_MONGO_CONNECT_TIMEOUT
                ? parseInt(env.FHIR_NOTES_MONGO_CONNECT_TIMEOUT)
                : 5000,
            serverSelectionTimeoutMS: env.FHIR_NOTES_MONGO_SERVER_SELECTION_TIMEOUT
                ? parseInt(env.FHIR_NOTES_MONGO_SERVER_SELECTION_TIMEOUT)
                : 5000
        }
    };
}
```

Add `fhirNotesMongoConfig` to the `module.exports` block at the bottom of `src/config.js` (alongside
the existing `auditEventMongoConfig, resourceHistoryMongoConfig` export line).

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/config/fhirNotesMongoConfig.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/tests/unit/config/fhirNotesMongoConfig.test.js
git commit -m "feat: add fhirNotesMongoConfig for the read-only vector-store connection"
```

---

## Task 2: `MongoDatabaseManager` — connect to the vector-store cluster

**Files:**
- Modify: `src/utils/mongoDatabaseManager.js`
- Test: `src/tests/unit/utils/mongoDatabaseManager.test.js` (existing file — add new test cases)

**Interfaces:**
- Consumes: `fhirNotesMongoConfig` from Task 1.
- Produces: `MongoDatabaseManager.getFhirNotesDbAsync(): Promise<import('mongodb').Db|null>` — `null`
  when `fhirNotesMongoConfig.connection` is unset (feature not configured). Task 5/7 consume this.

- [ ] **Step 1: Write the failing test**

Read the existing `src/tests/unit/utils/mongoDatabaseManager.test.js` first to match its exact mocking
style for `MongoClient`/`connectAsync`, then add:

```js
test('getFhirNotesDbAsync returns null when fhirNotesMongoConfig has no connection', async () => {
    jest.doMock('../../../config', () => ({
        ...jest.requireActual('../../../config'),
        fhirNotesMongoConfig: {}
    }));
    jest.resetModules();
    const { MongoDatabaseManager } = require('../../../utils/mongoDatabaseManager');
    const { ConfigManager } = require('../../../utils/configManager');
    const mongoDatabaseManager = new MongoDatabaseManager({ configManager: new ConfigManager() });
    const db = await mongoDatabaseManager.getFhirNotesDbAsync();
    expect(db).toBeNull();
});
```

(This test's exact double-mocking mechanics must match whatever pattern the existing file already
uses to stub `MongoClient.connect` for the primary/audit/history connections — reuse that pattern
rather than introducing a new one, since `connectAsync()` will call `createClientAsync` for every
configured cluster including this new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/mongoDatabaseManager.test.js -v`
Expected: FAIL — `getFhirNotesDbAsync is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/mongoDatabaseManager.js`:

1. Add `fhirNotesMongoConfig` to the destructured import on line 1.
2. Add a new module-level `let fhirNotesDb = null;` near the other `let ...Db = null;` declarations.
3. Add:

```js
/**
 * Gets the fhir-notes-vector-store db (read-only). Returns null when the feature isn't
 * configured in this environment (FHIR_NOTES_MONGO_URL unset).
 * @returns {Promise<import('mongodb').Db|null>}
 */
async getFhirNotesDbAsync () {
    if (!this.configManager.fhirNotesFullTextSearchConfigured) {
        return null;
    }
    if (!fhirNotesDb) {
        await this.connectAsync();
    }
    return fhirNotesDb;
}

async getFhirNotesConfigAsync () {
    return fhirNotesMongoConfig;
}
```

4. In `connectAsync()`, after the `resourceHistoryDb` block, add:

```js
if (this.configManager.fhirNotesFullTextSearchConfigured) {
    const fhirNotesConfig = await this.getFhirNotesConfigAsync();
    const fhirNotesClient = await this.createClientAsync(fhirNotesConfig);
    fhirNotesDb = fhirNotesClient.db(fhirNotesConfig.db_name);
}
```

(Note: unlike `resourceHistoryConfig`/`auditConfig`, there is deliberately no
"fall back to the primary `client` if not configured" branch — this is a genuinely separate,
externally-owned cluster with its own schema; there is no sensible fallback, only "configured" or
"feature unavailable.")

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/mongoDatabaseManager.test.js -v`
Expected: PASS (this step depends on Task 3's `configManager.fhirNotesFullTextSearchConfigured`
getter existing — do Task 3 first if running tests standalone, or stub it in this test file).

- [ ] **Step 5: Commit**

```bash
git add src/utils/mongoDatabaseManager.js src/tests/unit/utils/mongoDatabaseManager.test.js
git commit -m "feat: connect MongoDatabaseManager to the fhir-notes-vector-store cluster"
```

---

## Task 3: `ConfigManager` getters

**Files:**
- Modify: `src/utils/configManager.js`
- Test: `src/tests/unit/utils/configManager.test.js` (existing — add new `describe` block)

**Interfaces:**
- Consumes: `fhirNotesMongoConfig` from Task 1 (via `require('../config')`, matching how other
  getters in this file already read from `../config`), `env.ENABLE_FULL_TEXT_SEARCH`.
- Produces: `ConfigManager.fhirNotesFullTextSearchConfigured: boolean`,
  `ConfigManager.fhirNotesMongoCollectionName: string|undefined`,
  `ConfigManager.fhirNotesTextSearchIndexName: string|undefined`. Tasks 2, 5, 7 consume these.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect } = require('@jest/globals');

describe('ConfigManager fhirNotes getters', () => {
    const ORIGINAL_ENV = process.env;

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    function loadFreshConfigManager ({ fhirNotesMongoConfig, enableFullTextSearch }) {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
        if (enableFullTextSearch === undefined) {
            delete process.env.ENABLE_FULL_TEXT_SEARCH;
        } else {
            process.env.ENABLE_FULL_TEXT_SEARCH = enableFullTextSearch;
        }
        jest.doMock('../../../config', () => ({
            ...jest.requireActual('../../../config'),
            fhirNotesMongoConfig
        }));
        const { ConfigManager: FreshConfigManager } = require('../../../utils/configManager');
        return new FreshConfigManager();
    }

    test('fhirNotesFullTextSearchConfigured is false when config is empty, even if the flag is on', () => {
        const configManager = loadFreshConfigManager({ fhirNotesMongoConfig: {}, enableFullTextSearch: '1' });
        expect(configManager.fhirNotesFullTextSearchConfigured).toBe(false);
    });

    test('fhirNotesFullTextSearchConfigured is false when fully configured but ENABLE_FULL_TEXT_SEARCH is unset', () => {
        const configManager = loadFreshConfigManager({
            fhirNotesMongoConfig: {
                connection: 'mongodb://host:27017', db_name: 'fhir_notes',
                collection_name: 'clinical_notes', index_name: 'fhir-notes-text-search'
            }
        });
        expect(configManager.fhirNotesFullTextSearchConfigured).toBe(false);
    });

    test('fhirNotesFullTextSearchConfigured is true only when both fully configured and ENABLE_FULL_TEXT_SEARCH=1', () => {
        const configManager = loadFreshConfigManager({
            fhirNotesMongoConfig: {
                connection: 'mongodb://host:27017', db_name: 'fhir_notes',
                collection_name: 'clinical_notes', index_name: 'fhir-notes-text-search'
            },
            enableFullTextSearch: '1'
        });
        expect(configManager.fhirNotesFullTextSearchConfigured).toBe(true);
        expect(configManager.fhirNotesMongoCollectionName).toEqual('clinical_notes');
        expect(configManager.fhirNotesTextSearchIndexName).toEqual('fhir-notes-text-search');
    });

    test('fhirNotesFullTextSearchConfigured is false when any required connection field is missing, even with the flag on', () => {
        const configManager = loadFreshConfigManager({
            fhirNotesMongoConfig: { connection: 'mongodb://host:27017', db_name: 'fhir_notes' },
            enableFullTextSearch: '1'
        });
        expect(configManager.fhirNotesFullTextSearchConfigured).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/configManager.test.js -v`
Expected: FAIL — `fhirNotesFullTextSearchConfigured` is undefined, not `false`/`true`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/utils/configManager.js` (find the `require('../config')` destructuring at the top of the
file and add `fhirNotesMongoConfig` to it; add these getters anywhere in the class body, near the
other feature-flag-style getters):

```js
/**
 * True only when every field needed to reach the fhir-notes-vector-store cluster and its
 * Atlas Search index is present, AND the ENABLE_FULL_TEXT_SEARCH flag is explicitly on. The
 * flag is separate from connection config so an operator can deploy the connection ahead of a
 * rollout and flip this one flag to enable/disable, or use it as an emergency kill switch
 * without touching connection env vars (mirrors enableAuditEventArchiveRead's pattern above).
 * `_content` search and derived-text enrichment/reverse-lookup are all gated on this.
 * @returns {boolean}
 */
get fhirNotesFullTextSearchConfigured () {
    if (!isTrue(env.ENABLE_FULL_TEXT_SEARCH)) {
        return false;
    }
    return Boolean(
        fhirNotesMongoConfig.connection &&
        fhirNotesMongoConfig.db_name &&
        fhirNotesMongoConfig.collection_name &&
        fhirNotesMongoConfig.index_name
    );
}

get fhirNotesMongoCollectionName () {
    return fhirNotesMongoConfig.collection_name;
}

get fhirNotesTextSearchIndexName () {
    return fhirNotesMongoConfig.index_name;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/configManager.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/configManager.js src/tests/unit/utils/configManager.test.js
git commit -m "feat: add ConfigManager getters for fhir-notes-vector-store configuration"
```

---

## Task 4: `FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES` constant

**Files:**
- Modify: `src/constants.js` (add near `SPECIFIED_QUERY_PARAMS`)
- Test: `src/tests/unit/constants.test.js` (new, or add to existing constants test if one exists)

**Interfaces:**
- Produces: `FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES: string[]` = exactly
  `['DocumentReference', 'DiagnosticReport', 'CarePlan']`. Tasks 5, 8 consume this.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect } = require('@jest/globals');
const { FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES } = require('../../constants');

describe('FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES', () => {
    test('is exactly the three resource types fhir-notes-vector-store indexes', () => {
        expect(FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES).toEqual(
            ['DocumentReference', 'DiagnosticReport', 'CarePlan']
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/constants.test.js -v`
Expected: FAIL — not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/constants.js`, near `SPECIFIED_QUERY_PARAMS`:

```js
/**
 * Resource types fhir-notes-vector-store extracts and Atlas-Search-indexes attachment/note
 * text for. `_content` search and derived-text enrichment are only supported for these.
 * @type {string[]}
 */
FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES: ['DocumentReference', 'DiagnosticReport', 'CarePlan'],
```

(Add as a new top-level key in the exported constants object, matching `SPECIFIED_QUERY_PARAMS`'s
style.)

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/constants.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants.js src/tests/unit/constants.test.js
git commit -m "feat: add FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES constant"
```

---

## Task 5: `ClinicalNoteSearchClient`

**Files:**
- Create: `src/utils/clinicalNoteSearchClient.js`
- Test: `src/tests/unit/utils/clinicalNoteSearchClient.test.js` (new)

**Interfaces:**
- Consumes: `MongoDatabaseManager.getFhirNotesDbAsync()` (Task 2),
  `configManager.fhirNotesMongoCollectionName`/`fhirNotesTextSearchIndexName` (Task 3).
- Produces: `ClinicalNoteSearchClient.findMatchingResourceIdsAsync({ resourceType: string,
  contentQuery: string }): Promise<string[]>` — deduped FHIR ids (resourceType prefix stripped),
  throws `ExternalTimeoutError` on any Mongo error. Task 6 consumes this.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect, jest: jestGlobal } = require('@jest/globals');
const { ClinicalNoteSearchClient } = require('../../../utils/clinicalNoteSearchClient');
const { ExternalTimeoutError } = require('../../../utils/httpErrors');

function makeFakeDb (docs, { shouldThrow = false } = {}) {
    return {
        collection: () => ({
            aggregate: () => {
                if (shouldThrow) {
                    return { toArray: async () => { throw new Error('connection reset'); } };
                }
                return { toArray: async () => docs };
            }
        })
    };
}

function makeConfigManager ({ collectionName = 'clinical_notes', indexName = 'fhir-notes-text-search' } = {}) {
    return { fhirNotesMongoCollectionName: collectionName, fhirNotesTextSearchIndexName: indexName };
}

describe('ClinicalNoteSearchClient', () => {
    test('extracts and dedupes ids from debug.resource_reference', async () => {
        const fakeDb = makeFakeDb([
            { debug: { resource_reference: 'DocumentReference/abc123' } },
            { debug: { resource_reference: 'DocumentReference/abc123' } },
            { debug: { resource_reference: 'DocumentReference/def456' } }
        ]);
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        const ids = await client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: '(bone OR liver) AND metastases'
        });

        expect(ids.sort()).toEqual(['abc123', 'def456']);
    });

    test('returns empty array when no chunks match', async () => {
        const fakeDb = makeFakeDb([]);
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        const ids = await client.findMatchingResourceIdsAsync({
            resourceType: 'DocumentReference',
            contentQuery: 'nonexistent-term'
        });

        expect(ids).toEqual([]);
    });

    test('throws ExternalTimeoutError when the vector-store aggregate call fails', async () => {
        const fakeDb = makeFakeDb([], { shouldThrow: true });
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        // NOTE: ServerError's constructor (src/middleware/fhir/utils/server.error.js) calls
        // `Object.setPrototypeOf(this, ServerError.prototype)` unconditionally, resetting the
        // prototype chain on every subclass instance (including ExternalTimeoutError) back to
        // ServerError.prototype. `instanceof ExternalTimeoutError`/`toBeInstanceOf` is therefore
        // always false for this pre-existing, unrelated reason -- already documented in
        // src/tests/unit/utils/httpErrors.test.js and src/tests/unit/operations/query/filters/composite.test.js
        // (see their `expectBadRequestError`-style helpers). Follow that same established
        // convention: assert on `statusCode` instead. Do not work around the prototype bug
        // (e.g. via `Object.setPrototypeOf` at the throw site) -- that would be a one-off
        // deviation from how the rest of this codebase already handles it.
        let thrownError;
        try {
            await client.findMatchingResourceIdsAsync({
                resourceType: 'DocumentReference',
                contentQuery: 'diabetes'
            });
            throw new Error('expected findMatchingResourceIdsAsync to throw');
        } catch (e) {
            thrownError = e;
        }
        expect(thrownError.statusCode).toBe(504);
    });

    test('builds the compound/queryString/filter shape against the configured index and collection', async () => {
        let capturedPipeline = null;
        const fakeCollection = {
            aggregate: (pipeline) => {
                capturedPipeline = pipeline;
                return { toArray: async () => [] };
            }
        };
        const fakeDb = { collection: (name) => { expect(name).toEqual('clinical_notes'); return fakeCollection; } };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const client = new ClinicalNoteSearchClient({ mongoDatabaseManager, configManager: makeConfigManager() });

        await client.findMatchingResourceIdsAsync({ resourceType: 'DiagnosticReport', contentQuery: 'diabetes' });

        expect(capturedPipeline[0].$search.index).toEqual('fhir-notes-text-search');
        expect(capturedPipeline[0].$search.compound.must[0].queryString.query).toEqual('diabetes');
        expect(capturedPipeline[0].$search.compound.must[0].queryString.defaultPath).toEqual('text');
        expect(capturedPipeline[0].$search.compound.filter).toContainEqual(
            { equals: { path: 'meta.resource_type', value: 'DiagnosticReport' } }
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/clinicalNoteSearchClient.test.js -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/utils/clinicalNoteSearchClient.js
const { ExternalTimeoutError } = require('./httpErrors');

/**
 * Delegates full-text search candidate lookup to fhir-notes-vector-store's existing Atlas
 * Search index. Returned ids are candidates only -- callers must re-authorize every id through
 * the normal tenant-scoped query path before using them (see review.md, Search / read).
 */
class ClinicalNoteSearchClient {
    /**
     * @param {Object} params
     * @param {import('./mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     * @param {import('./configManager').ConfigManager} params.configManager
     */
    constructor ({ mongoDatabaseManager, configManager }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
        this.configManager = configManager;
    }

    /**
     * @param {Object} params
     * @param {string} params.resourceType
     * @param {string} params.contentQuery Lucene-syntax query string (the raw `_content` value)
     * @returns {Promise<string[]>} deduped FHIR ids (resourceType prefix stripped)
     */
    async findMatchingResourceIdsAsync ({ resourceType, contentQuery }) {
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const pipeline = [
                {
                    $search: {
                        index: this.configManager.fhirNotesTextSearchIndexName,
                        compound: {
                            must: [
                                { queryString: { defaultPath: 'text', query: contentQuery } }
                            ],
                            filter: [
                                { equals: { path: 'meta.resource_type', value: resourceType } }
                            ]
                        }
                    }
                },
                { $project: { 'debug.resource_reference': 1 } }
            ];
            const docs = await collection.aggregate(pipeline).toArray();
            const ids = new Set();
            for (const doc of docs) {
                const reference = doc.debug && doc.debug.resource_reference;
                if (reference && reference.includes('/')) {
                    ids.add(reference.split('/')[1]);
                }
            }
            return Array.from(ids);
        } catch (e) {
            throw new ExternalTimeoutError(
                `_content search is temporarily unavailable (resourceType=${resourceType}): ${e.message}`
            );
        }
    }
}

module.exports = { ClinicalNoteSearchClient };
```

Throw `ExternalTimeoutError` directly — do not wrap it in `RethrownError`, and do not try to make
`instanceof`/`toBeInstanceOf` work via a prototype workaround at the throw site. See the test's own
inline note above: this codebase has a known, already-documented, pre-existing bug where
`ServerError`'s constructor resets every subclass instance's prototype back to `ServerError.prototype`,
so `instanceof` checks against any `httpErrors.js` class are unreliable everywhere in this codebase,
not just here. The established convention (already used in `httpErrors.test.js` and
`composite.test.js`) is to assert on `err.statusCode` instead — this task's test does exactly that.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/clinicalNoteSearchClient.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/clinicalNoteSearchClient.js src/tests/unit/utils/clinicalNoteSearchClient.test.js
git commit -m "feat: add ClinicalNoteSearchClient for delegated _content search"
```

---

## Task 6: Wire `_content` search into `SearchManager`

**Files:**
- Modify: `src/operations/search/searchManager.js`
- Modify: `src/createContainer.js:503-524` (add `clinicalNoteSearchClient` to the `SearchManager`
  registration, and register `clinicalNoteSearchClient` itself)
- Modify: `src/tests/unit/operations/search/searchManager.test.js:94` (existing `new SearchManager({...})`
  call — add `clinicalNoteSearchClient: createMockInstance(ClinicalNoteSearchClient)`)
- Modify: `src/tests/unit/resourceAuthorization/03_scopesAndAuditEventGate.test.js:333` (existing
  `new SearchManager({...})` call — add the same)
- Modify: `src/tests/unit/resourceAuthorization/06b_cmsPartnerConsent.test.js:128` (existing
  `new SearchManager({...})` call — add the same)
- Test: `src/tests/unit/operations/search/searchManager.test.js` (add new test cases per Step 1 below)

**IMPORTANT — pre-flight finding:** `SearchManager` is constructed directly (not via the DI
container) in three existing test files beyond the one this task already modifies. Adding
`clinicalNoteSearchClient` as a new constructor dependency with an `assertTypeEquals` guard (Step 3
below) will break all three at construction time unless each is updated to pass one. All three
already use this suite's `createMockInstance(SomeClass)` convention for other constructor deps
(see `03_scopesAndAuditEventGate.test.js:333` and `06b_cmsPartnerConsent.test.js:128` for the exact
existing shape) — add `clinicalNoteSearchClient: createMockInstance(ClinicalNoteSearchClient)` to
all three `new SearchManager({...})` call sites, plus the corresponding
`const { ClinicalNoteSearchClient } = require(...)` import in each file. Run each of these three
test files (not just the one this task's new tests live in) before considering this task done.

**Interfaces:**
- Consumes: `ClinicalNoteSearchClient.findMatchingResourceIdsAsync` (Task 5),
  `FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES` (Task 4), `configManager.fhirNotesFullTextSearchConfigured`
  (Task 3), `FilterById.getListFilter` (existing, `src/operations/query/filters/id.js:18`),
  `this.r4SearchQueryCreator.appendAndQuery` (existing, `src/operations/query/r4.js`).
- Produces: `SearchManager.buildContentSearchIdFilterAsync({ resourceType, parsedArgs }):
  Promise<import('mongodb').Document|null>` — `null` when `_content` isn't present on the request
  (no-op); otherwise a `{_uuid: {$in: [...]}}`-shaped filter (via `FilterById.getListFilter`), or
  throws `BadRequestError`/`ExternalTimeoutError`.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect } = require('@jest/globals');
const { SearchManager } = require('../../../../operations/search/searchManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');
const { ExternalTimeoutError } = require('../../../../utils/httpErrors');

function makeParsedArgsWithContent (value) {
    const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
    parsedArgs.add(new ParsedArgsItem({
        queryParameter: '_content',
        queryParameterValue: new QueryParameterValue({ value, operator: '$and' })
    }));
    return parsedArgs;
}

// NOTE: ServerError's constructor (src/middleware/fhir/utils/server.error.js) calls
// `Object.setPrototypeOf(this, ServerError.prototype)` unconditionally, resetting the prototype
// chain on every subclass instance (including BadRequestError/ExternalTimeoutError) back to
// ServerError.prototype. `instanceof`/`toBeInstanceOf` against any httpErrors.js class is
// therefore always false, for this pre-existing, unrelated reason -- already documented in
// src/tests/unit/utils/httpErrors.test.js and
// src/tests/unit/operations/query/filters/composite.test.js. Follow that same established
// convention here: assert on `statusCode` instead of `instanceof`. Do not work around the
// prototype bug at any throw site (e.g. via `Object.setPrototypeOf`) -- that would be a one-off
// deviation from how the rest of this codebase already handles it.
async function expectRejectionWithStatusCode (promise, statusCode) {
    let thrownError;
    try {
        await promise;
        throw new Error(`expected promise to reject with statusCode ${statusCode}, but it resolved`);
    } catch (e) {
        thrownError = e;
    }
    expect(thrownError.statusCode).toBe(statusCode);
}

// Minimal SearchManager instantiation helper: fill every other constructor dependency with a
// harmless stub object, since buildContentSearchIdFilterAsync only touches configManager and
// clinicalNoteSearchClient. Follow this file's existing full-constructor test setup if one exists
// instead of duplicating stubs here.
function makeSearchManager ({ configManager, clinicalNoteSearchClient }) {
    return new SearchManager({
        databaseQueryFactory: {}, resourceLocatorFactory: {}, securityTagManager: {},
        resourcePreparer: {}, indexHinter: {}, r4SearchQueryCreator: {}, configManager,
        queryRewriterManager: {}, scopesManager: {}, databaseAttachmentManager: {},
        base64DataManager: {}, fhirResourceWriterFactory: {}, dataSharingManager: {},
        searchQueryBuilder: {}, patientScopeManager: {}, patientQueryCreator: {},
        searchParametersManager: {}, clinicalNoteSearchClient
    });
}

describe('SearchManager.buildContentSearchIdFilterAsync', () => {
    test('returns null when _content is not present', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient: {}
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: new ParsedArgs({ base_version: '4_0_0' })
        });
        expect(result).toBeNull();
    });

    test('throws BadRequestError for an unsupported resourceType', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient: {}
        });
        await expectRejectionWithStatusCode(searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'Condition',
            parsedArgs: makeParsedArgsWithContent('diabetes')
        }), 400);
    });

    test('throws BadRequestError when the feature is not configured', async () => {
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: false },
            clinicalNoteSearchClient: {}
        });
        await expectRejectionWithStatusCode(searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes')
        }), 400);
    });

    test('returns an _uuid $in filter built from candidate ids', async () => {
        const clinicalNoteSearchClient = {
            findMatchingResourceIdsAsync: async () => ['abc123', 'def456']
        };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes')
        });
        expect(result.$or || result._uuid).toBeDefined();
    });

    test('returns a filter matching nothing when candidate list is empty', async () => {
        const clinicalNoteSearchClient = { findMatchingResourceIdsAsync: async () => [] };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        const result = await searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes')
        });
        expect(result).toEqual({ _uuid: { $in: [] } });
    });

    test('propagates ExternalTimeoutError from the search client unchanged', async () => {
        const clinicalNoteSearchClient = {
            findMatchingResourceIdsAsync: async () => { throw new ExternalTimeoutError('down'); }
        };
        const searchManager = makeSearchManager({
            configManager: { fhirNotesFullTextSearchConfigured: true },
            clinicalNoteSearchClient
        });
        await expectRejectionWithStatusCode(searchManager.buildContentSearchIdFilterAsync({
            resourceType: 'DocumentReference',
            parsedArgs: makeParsedArgsWithContent('diabetes')
        }), 504);
    });
});
```

Before writing this test, read `src/operations/query/parsedArgsItem.js` and
`src/operations/query/queryParameterValue.js` constructors to confirm the exact param names used
above (`queryParameter`, `queryParameterValue`, `value`, `operator`) match reality — adjust the test
setup to match if they differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/operations/search/searchManager.test.js -v`
Expected: FAIL — `buildContentSearchIdFilterAsync is not a function`, and the constructor rejects the
unknown `clinicalNoteSearchClient` param (or ignores it, depending on whether `assertTypeEquals`
guards are strict) until Step 3 is done.

- [ ] **Step 3: Write minimal implementation**

In `src/operations/search/searchManager.js`:

1. Add imports:
```js
const { FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES } = require('../../constants');
const { FilterById } = require('../query/filters/id');
const { BadRequestError } = require('../../utils/httpErrors');
```

2. Add `clinicalNoteSearchClient` to the constructor's destructured params and JSDoc, with an
   `assertTypeEquals(clinicalNoteSearchClient, ClinicalNoteSearchClient)` guard (import
   `ClinicalNoteSearchClient` from `../../utils/clinicalNoteSearchClient`), following the exact
   pattern every other constructor dependency in this class already uses (see
   `this.configManager = configManager; assertTypeEquals(configManager, ConfigManager);` for the
   template).

3. Add the new method, anywhere in the class body:

```js
/**
 * Resolves the `_content` search parameter (if present) into an `_id`-shaped Mongo filter by
 * delegating candidate lookup to fhir-notes-vector-store's Atlas Search index. The returned
 * filter is meant to be AND'd into the request's normal query via
 * `this.r4SearchQueryCreator.appendAndQuery` -- every candidate id still passes through the
 * same tenant/patient/access-tag scoping every other search parameter goes through.
 * @param {Object} params
 * @param {string} params.resourceType
 * @param {ParsedArgs} params.parsedArgs
 * @returns {Promise<import('mongodb').Document|null>} null when `_content` is absent
 */
async buildContentSearchIdFilterAsync ({ resourceType, parsedArgs }) {
    const contentArg = parsedArgs.get('_content');
    if (!contentArg) {
        return null;
    }
    if (!FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES.includes(resourceType)) {
        throw new BadRequestError(new Error(
            `_content search is not supported for resourceType=${resourceType}. ` +
            `Supported types: ${FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES.join(', ')}`
        ));
    }
    if (!this.configManager.fhirNotesFullTextSearchConfigured) {
        throw new BadRequestError(new Error(
            '_content search is not configured in this environment'
        ));
    }
    const contentQuery = contentArg.queryParameterValue.value;
    if (Array.isArray(contentQuery)) {
        throw new BadRequestError(new Error(
            '_content does not support multiple repeated values'
        ));
    }
    // The empty-string form is the derived-text read-enrichment trigger (see
    // AttachmentTextEnrichmentProvider), not a search filter -- do not attempt a vector-store
    // search for it.
    if (!contentQuery) {
        return null;
    }
    const candidateIds = await this.clinicalNoteSearchClient.findMatchingResourceIdsAsync({
        resourceType,
        contentQuery
    });
    return FilterById.getListFilter(candidateIds);
}
```

4. In `constructQueryAsync`, immediately after the existing
   `assertIsValid(base_version, 'base_version is not set');` line and before the
   `this.searchQueryBuilder.buildSearchQueryBasedOnVersion(...)` call, add:

```js
const contentSearchIdFilter = await this.buildContentSearchIdFilterAsync({ resourceType, parsedArgs });
```

5. Immediately after the `({ query, columns } = this.searchQueryBuilder.buildSearchQueryBasedOnVersion({...}));`
   call, add:

```js
if (contentSearchIdFilter) {
    query = this.r4SearchQueryCreator.appendAndQuery({ query, andQuery: contentSearchIdFilter });
}
```

In `src/createContainer.js`, register the new client and add it to `SearchManager`'s registration:

```js
container.register('clinicalNoteSearchClient', (c) => new ClinicalNoteSearchClient({
    mongoDatabaseManager: c.mongoDatabaseManager,
    configManager: c.configManager
}));
```

and add `clinicalNoteSearchClient: c.clinicalNoteSearchClient` to the existing `searchManager`
registration's params object (`src/createContainer.js:503-524`). Add the corresponding
`const { ClinicalNoteSearchClient } = require('./utils/clinicalNoteSearchClient');` near the other
`require`s at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/operations/search/searchManager.test.js -v`
Expected: PASS

- [ ] **Step 5: Integration test — end-to-end against `mongodb-atlas-local`**

Add `src/tests/integration/search/contentSearch.test.js` reusing whatever Atlas-local test
infrastructure already exists in this repo (check for `jest.atlasSearch.config.js` /
`atlasSearchGlobalSetup.js` under `src/tests/` — these were referenced as existing infra by the
`atlas-search-tech-design` branch; if that branch is still unmerged and this infra doesn't exist on
`main` yet, this integration test instead needs to spin up its own local Atlas Search index against
a `mongodb-atlas-local` test container, mirroring `create_text_search_index`'s mapping from
`fhir-notes-vector-store`'s `mongo_atlas_vector_store.py:599-657` — `{mappings: {fields: {text:
{type: 'string'}, patient_id: {type: 'token'}, meta.resource_type: {type: 'token'}}}}`). Cover:
- A `_content=diabetes` search on `DocumentReference` returns only ids the vector store matched.
- An empty candidate list yields zero results, not everything.
- `_content` on `Condition` is rejected with `BadRequestError`.
- Simulated vector-store connection failure yields `ExternalTimeoutError` (504), not an unfiltered
  result set.

- [ ] **Step 6: Cross-tenant regression test**

Add to the same integration test file: seed a `ClinicalNote` chunk whose `debug.resource_reference`
points at a `DocumentReference` belonging to tenant B, then issue a `_content` search as a
service-account scoped only to tenant A. Assert the response is empty — proving the `_id ∈ [...]`
filter is genuinely re-authorized through the normal access-tag query path, not just present in code.

- [ ] **Step 7: Commit**

```bash
git add src/operations/search/searchManager.js src/createContainer.js \
    src/tests/unit/operations/search/searchManager.test.js \
    src/tests/integration/search/contentSearch.test.js
git commit -m "feat: resolve _content search via ClinicalNoteSearchClient in SearchManager"
```

---

## Task 7: `ClinicalNoteTextRetriever` — chunk reassembly

**Files:**
- Create: `src/utils/clinicalNoteTextRetriever.js`
- Test: `src/tests/unit/utils/clinicalNoteTextRetriever.test.js` (new)

**Interfaces:**
- Consumes: `MongoDatabaseManager.getFhirNotesDbAsync()` (Task 2), `configManager` getters (Task 3).
- Produces:
  - `ClinicalNoteTextRetriever.getReassembledTextAsync({ chunkGroupId: string }): Promise<string|null>`
    — `null` when no chunks exist for that group (not yet indexed, or indexing failed).
  - `ClinicalNoteTextRetriever.getReassembledTextForBinaryAsync({ binaryReference: string }):
    Promise<string|null>` — `binaryReference` is e.g. `"Binary/abc123"`.
  Task 8 and Task 9 consume both.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect } = require('@jest/globals');
const { ClinicalNoteTextRetriever } = require('../../../utils/clinicalNoteTextRetriever');

function makeConfigManager () {
    return { fhirNotesFullTextSearchConfigured: true, fhirNotesMongoCollectionName: 'clinical_notes' };
}

describe('ClinicalNoteTextRetriever.getReassembledTextAsync', () => {
    test('concatenates chunks in chunk_index order', async () => {
        const docs = [
            { meta: { chunk_index: 1 }, text: 'second. ' },
            { meta: { chunk_index: 0 }, text: 'first. ' }
        ];
        const fakeCollection = {
            find: () => ({
                sort: () => ({ toArray: async () => docs.sort((a, b) => a.meta.chunk_index - b.meta.chunk_index) })
            })
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'docRef123-0' });

        expect(text).toEqual('first. second. ');
    });

    test('returns null when no chunks exist for the group', async () => {
        const fakeCollection = { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'missing-0' });

        expect(text).toBeNull();
    });

    test('returns null when the feature is not configured, without querying', async () => {
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => { throw new Error('should not be called'); } };
        const retriever = new ClinicalNoteTextRetriever({
            mongoDatabaseManager,
            configManager: { fhirNotesFullTextSearchConfigured: false }
        });

        const text = await retriever.getReassembledTextAsync({ chunkGroupId: 'docRef123-0' });

        expect(text).toBeNull();
    });
});

describe('ClinicalNoteTextRetriever.getReassembledTextForBinaryAsync', () => {
    test('finds the owning attachment via debug.resource.content.attachment.url and reassembles it', async () => {
        const docs = [
            { meta: { chunk_index: 0, chunk_group_id: 'docRef123-1' }, text: 'note text' }
        ];
        const fakeCollection = {
            find: (query) => {
                expect(query['debug.resource.content.attachment.url']).toEqual({ $in: ['Binary/bin789', '#bin789'] });
                return { toArray: async () => docs };
            }
        };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({ binaryReference: 'Binary/bin789' });

        expect(text).toEqual('note text');
    });

    test('returns null when no attachment references this Binary', async () => {
        const fakeCollection = { find: () => ({ toArray: async () => [] }) };
        const fakeDb = { collection: () => fakeCollection };
        const mongoDatabaseManager = { getFhirNotesDbAsync: async () => fakeDb };
        const retriever = new ClinicalNoteTextRetriever({ mongoDatabaseManager, configManager: makeConfigManager() });

        const text = await retriever.getReassembledTextForBinaryAsync({ binaryReference: 'Binary/unreferenced' });

        expect(text).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/clinicalNoteTextRetriever.test.js -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/utils/clinicalNoteTextRetriever.js
const { logWarn } = require('../operations/common/logging');

/**
 * Reassembles chunked clinical-note text from fhir-notes-vector-store's ClinicalNote
 * collection. Used only for read-time enrichment/reverse-lookup, both of which run after a
 * resource's own authorized fetch has already succeeded -- this class never gates access to
 * anything, it only fetches more data about a resource the caller can already see.
 */
class ClinicalNoteTextRetriever {
    /**
     * @param {Object} params
     * @param {import('./mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     * @param {import('./configManager').ConfigManager} params.configManager
     */
    constructor ({ mongoDatabaseManager, configManager }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
        this.configManager = configManager;
    }

    /**
     * @param {Object} params
     * @param {string} params.chunkGroupId `"{resourceId}-{contentIndex}"`
     * @returns {Promise<string|null>}
     */
    async getReassembledTextAsync ({ chunkGroupId }) {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const chunks = await collection
                .find({ 'meta.chunk_group_id': chunkGroupId })
                .sort({ 'meta.chunk_index': 1 })
                .toArray();
            if (chunks.length === 0) {
                return null;
            }
            return chunks.map(c => c.text || '').join('');
        } catch (e) {
            logWarn(`Failed to reassemble clinical note text for chunkGroupId=${chunkGroupId}`, { error: e });
            return null;
        }
    }

    /**
     * @param {Object} params
     * @param {string} params.binaryReference e.g. "Binary/abc123"
     * @returns {Promise<string|null>}
     */
    async getReassembledTextForBinaryAsync ({ binaryReference }) {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        const binaryId = binaryReference.split('/')[1];
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const urlVariants = [`Binary/${binaryId}`, `#${binaryId}`];
            const matches = await collection.find({
                $or: [
                    { 'debug.resource.content.attachment.url': { $in: urlVariants } },
                    { 'debug.resource.presentedForm.url': { $in: urlVariants } }
                ]
            }).toArray();
            if (matches.length === 0) {
                return null;
            }
            const chunkGroupId = matches[0].meta.chunk_group_id;
            return this.getReassembledTextAsync({ chunkGroupId });
        } catch (e) {
            logWarn(`Failed to reverse-lookup clinical note text for binaryReference=${binaryReference}`, { error: e });
            return null;
        }
    }
}

module.exports = { ClinicalNoteTextRetriever };
```

Note the first unit test above (`'debug.resource.content.attachment.url'` query assertion) expects
`getReassembledTextForBinaryAsync` to call `collection.find` with a `$or` at the top level, but the
mock in that test asserts on `query['debug.resource.content.attachment.url']` directly rather than
`query.$or[0][...]` — fix the mock's assertion to match the actual `$or` shape this implementation
produces (`query.$or[0]['debug.resource.content.attachment.url']`) before running Step 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/clinicalNoteTextRetriever.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/clinicalNoteTextRetriever.js src/tests/unit/utils/clinicalNoteTextRetriever.test.js
git commit -m "feat: add ClinicalNoteTextRetriever for chunk reassembly"
```

---

## Task 8: `AttachmentTextEnrichmentProvider` (`DocumentReference` / `DiagnosticReport`) — SUPERSEDED

> **This task's deliverable was built, reviewed, and approved, then removed.** A final
> whole-branch review found that its trigger (`_content=` empty value) never actually reaches this
> provider in production — `r4ArgsParser.js` drops every empty-string query parameter value before
> a `ParsedArgsItem` is ever created, so every test for this provider had exercised a
> `ParsedArgsItem` shape the real parser can never produce. See the design spec's Revision History
> (2026-09-10 (b)) for the full explanation. **Task 11 removes this provider entirely** and
> replaces its capability with `_format=text/plain` content negotiation in the response-writing
> layer. The task text below is kept for historical record — do not implement it.

**Files:**
- Create: `src/enrich/providers/attachmentTextEnrichmentProvider.js`
- Modify: `src/createContainer.js` (register provider, add to `enrichmentManager`'s provider list)
- Test: `src/tests/unit/enrich/providers/attachmentTextEnrichmentProvider.test.js` (new)

**Interfaces:**
- Consumes: `ClinicalNoteTextRetriever.getReassembledTextAsync` (Task 7),
  `FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES` (Task 4), `EnrichmentProvider` base class
  (`src/enrich/providers/enrichmentProvider.js`).
- Produces: an `EnrichmentProvider` subclass consumed only by `createContainer.js`'s
  `enrichmentManager` registration.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect } = require('@jest/globals');
const { AttachmentTextEnrichmentProvider } = require('../../../../enrich/providers/attachmentTextEnrichmentProvider');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

function makeSingleIdParsedArgs (id) {
    const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
    parsedArgs.add(new ParsedArgsItem({
        queryParameter: 'id',
        queryParameterValue: new QueryParameterValue({ value: id, operator: '$and' })
    }));
    parsedArgs.add(new ParsedArgsItem({
        queryParameter: '_content',
        queryParameterValue: new QueryParameterValue({ value: '', operator: '$and' })
    }));
    return parsedArgs;
}

describe('AttachmentTextEnrichmentProvider', () => {
    test('adds a derived text/plain sibling attachment per content entry with reassembled text', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextAsync: async ({ chunkGroupId }) =>
                chunkGroupId === 'doc1-0' ? 'the extracted note text' : null
        };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'doc1',
            content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }]
        };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('doc1'),
            enrichmentContext: undefined
        });

        expect(enriched.content.length).toEqual(2);
        const derived = enriched.content[1].attachment;
        expect(derived.contentType).toEqual('text/plain');
        expect(Buffer.from(derived.data, 'base64').toString('utf-8')).toEqual('the extracted note text');
        expect(derived.extension).toContainEqual({
            url: 'https://www.icanbwell.com/attachment-derived-text',
            valueBoolean: true
        });
    });

    test('adds a derived sibling per presentedForm entry for DiagnosticReport', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextAsync: async () => 'lab narrative text'
        };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DiagnosticReport',
            id: 'diag1',
            presentedForm: [{ contentType: 'application/pdf', data: 'JVBER...' }]
        };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('diag1'),
            enrichmentContext: undefined
        });

        expect(enriched.presentedForm.length).toEqual(2);
        expect(enriched.presentedForm[1].contentType).toEqual('text/plain');
    });

    test('skips silently when no clinical note exists yet for an attachment', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => null };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'doc1',
            content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }]
        };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('doc1'),
            enrichmentContext: undefined
        });

        expect(enriched.content.length).toEqual(1);
    });

    test('does not run when _content is absent', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = {
            resourceType: 'DocumentReference',
            id: 'doc1',
            content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }]
        };
        const parsedArgsWithoutContent = new ParsedArgs({ base_version: '4_0_0' });
        parsedArgsWithoutContent.add(new ParsedArgsItem({
            queryParameter: 'id',
            queryParameterValue: new QueryParameterValue({ value: 'doc1', operator: '$and' })
        }));

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: parsedArgsWithoutContent,
            enrichmentContext: undefined
        });

        expect(enriched.content.length).toEqual(1);
    });

    test('does not run when _content is non-empty (that is a search filter, not an enrichment trigger)', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: { contentType: 'application/pdf', data: 'JVBER...' } }] };
        const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
        parsedArgs.add(new ParsedArgsItem({ queryParameter: 'id', queryParameterValue: new QueryParameterValue({ value: 'doc1', operator: '$and' }) }));
        parsedArgs.add(new ParsedArgsItem({ queryParameter: '_content', queryParameterValue: new QueryParameterValue({ value: 'diabetes', operator: '$and' }) }));

        const [enriched] = await provider.enrichAsync({ resources: [resource], parsedArgs, enrichmentContext: undefined });

        expect(enriched.content.length).toEqual(1);
    });

    test('does not run for CarePlan (its note text is already plain)', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const provider = new AttachmentTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'CarePlan', id: 'cp1', note: [{ text: 'already plain' }] };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgs('cp1'),
            enrichmentContext: undefined
        });

        expect(enriched.note).toEqual([{ text: 'already plain' }]);
    });
});
```

Before finalizing this test file, read `src/operations/query/parsedArgsItem.js` and
`src/operations/query/queryParameterValue.js` to confirm the constructor argument names
(`queryParameter`, `queryParameterValue`, `value`, `operator`) match what Task 6's test already
assumed — reuse the exact same construction helper across both test files rather than diverging.

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/enrich/providers/attachmentTextEnrichmentProvider.test.js -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/enrich/providers/attachmentTextEnrichmentProvider.js
const { EnrichmentProvider } = require('./enrichmentProvider');

const DERIVED_TEXT_EXTENSION_URL = 'https://www.icanbwell.com/attachment-derived-text';
const ENRICHABLE_RESOURCE_TYPES = new Set(['DocumentReference', 'DiagnosticReport']);

/**
 * Attaches reassembled attachment text (from fhir-notes-vector-store) as a sibling
 * text/plain content/presentedForm entry, triggered by an empty `_content` value on a
 * single-resource request. Runs after the resource's own authorized fetch -- see
 * docs/superpowers/specs/2026-09-10-text-content-search-design.md, "Security model".
 */
class AttachmentTextEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../utils/clinicalNoteTextRetriever').ClinicalNoteTextRetriever} params.clinicalNoteTextRetriever
     */
    constructor ({ clinicalNoteTextRetriever }) {
        super();
        this.clinicalNoteTextRetriever = clinicalNoteTextRetriever;
    }

    /**
     * True only when the caller asked for exactly one specific resource by id -- whether via a
     * true read/vread operation or a search with an explicit `_id=`/`id=` param. Both are
     * bounded to one resource, so both are safe triggers; a broad search is never a trigger
     * even if it happens to return exactly one bundle entry.
     * @param {ParsedArgs} parsedArgs
     * @returns {boolean}
     */
    static isSingleResourceRequest (parsedArgs) {
        const idArg = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
        return Boolean(
            idArg &&
            idArg.queryParameterValue &&
            idArg.queryParameterValue.values &&
            idArg.queryParameterValue.values.length === 1
        );
    }

    /**
     * @param {ParsedArgs} parsedArgs
     * @returns {boolean}
     */
    static isDerivedTextTrigger (parsedArgs) {
        const contentArg = parsedArgs.get('_content');
        return Boolean(contentArg && contentArg.queryParameterValue.value === '');
    }

    /**
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync ({ resources, parsedArgs, enrichmentContext }) {
        if (!AttachmentTextEnrichmentProvider.isDerivedTextTrigger(parsedArgs) ||
            !AttachmentTextEnrichmentProvider.isSingleResourceRequest(parsedArgs)) {
            return resources;
        }
        for (const resource of resources) {
            if (!resource || !ENRICHABLE_RESOURCE_TYPES.has(resource.resourceType)) {
                continue;
            }
            if (resource.resourceType === 'DocumentReference' && Array.isArray(resource.content)) {
                await this.enrichAttachmentArrayAsync({
                    resourceId: resource.id,
                    array: resource.content,
                    getAttachment: (entry) => entry.attachment,
                    wrapAttachment: (attachment) => ({ attachment })
                });
            } else if (resource.resourceType === 'DiagnosticReport' && Array.isArray(resource.presentedForm)) {
                await this.enrichAttachmentArrayAsync({
                    resourceId: resource.id,
                    array: resource.presentedForm,
                    getAttachment: (entry) => entry,
                    wrapAttachment: (attachment) => attachment
                });
            }
        }
        return resources;
    }

    /**
     * Mutates `array` in place, appending a derived text/plain sibling per original entry that
     * has reassembled text available.
     * @param {Object} params
     * @param {string} params.resourceId
     * @param {Array<Object>} params.array
     * @param {(entry: Object) => Object} params.getAttachment
     * @param {(attachment: Object) => Object} params.wrapAttachment
     */
    async enrichAttachmentArrayAsync ({ resourceId, array, getAttachment, wrapAttachment }) {
        const originalLength = array.length;
        for (let index = 0; index < originalLength; index++) {
            const chunkGroupId = `${resourceId}-${index}`;
            const text = await this.clinicalNoteTextRetriever.getReassembledTextAsync({ chunkGroupId });
            if (!text) {
                continue;
            }
            const derivedAttachment = {
                contentType: 'text/plain',
                data: Buffer.from(text, 'utf-8').toString('base64'),
                extension: [{ url: DERIVED_TEXT_EXTENSION_URL, valueBoolean: true }]
            };
            array.push(wrapAttachment(derivedAttachment));
        }
    }

    /**
     * @param {Object} params
     * @param {BundleEntry[]} params.entries
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries, parsedArgs, enrichmentContext }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync({
                    resources: [entry.resource], parsedArgs, enrichmentContext
                }))[0];
            }
        }
        return entries;
    }
}

module.exports = { AttachmentTextEnrichmentProvider };
```

In `src/createContainer.js`, register `clinicalNoteTextRetriever` itself first (this task is its
first consumer; Task 9 reuses this same registration rather than re-registering it):
```js
const { ClinicalNoteTextRetriever } = require('./utils/clinicalNoteTextRetriever');
const { AttachmentTextEnrichmentProvider } = require('./enrich/providers/attachmentTextEnrichmentProvider');
// ...
container.register('clinicalNoteTextRetriever', (c) => new ClinicalNoteTextRetriever({
    mongoDatabaseManager: c.mongoDatabaseManager,
    configManager: c.configManager
}));
container.register('attachmentTextEnrichmentProvider', (c) => new AttachmentTextEnrichmentProvider({
    clinicalNoteTextRetriever: c.clinicalNoteTextRetriever
}));
```
and add `c.attachmentTextEnrichmentProvider` to the `enrichmentProviders` array in the
`enrichmentManager` registration (`src/createContainer.js:208-224`).

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/enrich/providers/attachmentTextEnrichmentProvider.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/enrich/providers/attachmentTextEnrichmentProvider.js src/createContainer.js \
    src/tests/unit/enrich/providers/attachmentTextEnrichmentProvider.test.js
git commit -m "feat: add AttachmentTextEnrichmentProvider for derived-text reads"
```

---

## Task 9: `BinaryDerivedTextEnrichmentProvider` (`Binary` reverse lookup) — SUPERSEDED

> **This task's deliverable was built, reviewed, and approved, then removed.** A final
> whole-branch review found that `Binary` extends `Resource`, not `DomainResource`, in FHIR R4 — it
> has no `extension` element at all, so the top-level extension this provider wrote was silently
> dropped by `toJSON()` on every response; the derived text never actually reached a caller. See
> the design spec's Revision History (2026-09-10 (b)). **Task 11 removes this provider entirely**
> and replaces its capability with `_format=text/plain` content negotiation, reusing
> `ClinicalNoteTextRetriever.getReassembledTextForBinaryAsync` (Task 7, unchanged and still valid)
> from the response-writing layer instead. The task text below is kept for historical record — do
> not implement it.

**Files:**
- Create: `src/enrich/providers/binaryDerivedTextEnrichmentProvider.js`
- Modify: `src/createContainer.js` (register provider, add to `enrichmentManager`'s provider list)
- Test: `src/tests/unit/enrich/providers/binaryDerivedTextEnrichmentProvider.test.js` (new)

**Interfaces:**
- Consumes: `ClinicalNoteTextRetriever.getReassembledTextForBinaryAsync` (Task 7, already registered
  as `clinicalNoteTextRetriever` in the container by Task 8 — do not re-register it here), the same
  `isSingleResourceRequest`/`isDerivedTextTrigger` gating logic as Task 8. This logic is
  intentionally duplicated (not extracted to a shared helper) — it's two 6-line static methods, this
  provider only ever handles `resourceType === 'Binary'` with no other coupling to Task 8's
  provider, and introducing a shared base class for two call sites this small is unnecessary
  indirection. Treat this as a deliberate, plan-mandated decision, not a gap to fix.
- Produces: an `EnrichmentProvider` subclass consumed only by `createContainer.js`.

- [ ] **Step 1: Write the failing test**

```js
const { describe, test, expect } = require('@jest/globals');
const { BinaryDerivedTextEnrichmentProvider } = require('../../../../enrich/providers/binaryDerivedTextEnrichmentProvider');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

function makeSingleIdParsedArgsWithContentTrigger (id) {
    const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
    parsedArgs.add(new ParsedArgsItem({ queryParameter: 'id', queryParameterValue: new QueryParameterValue({ value: id, operator: '$and' }) }));
    parsedArgs.add(new ParsedArgsItem({ queryParameter: '_content', queryParameterValue: new QueryParameterValue({ value: '', operator: '$and' }) }));
    return parsedArgs;
}

describe('BinaryDerivedTextEnrichmentProvider', () => {
    test('adds a top-level extension with the reassembled plain text', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextForBinaryAsync: async ({ binaryReference }) =>
                binaryReference === 'Binary/bin789' ? 'reassembled plain text' : null
        };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('bin789'),
            enrichmentContext: undefined
        });

        expect(enriched.extension).toContainEqual({
            url: 'https://www.icanbwell.com/attachment-derived-text',
            valueString: 'reassembled plain text'
        });
        // original fields untouched -- never repurpose Binary's own contentType/data
        expect(enriched.contentType).toEqual('application/pdf');
        expect(enriched.data).toEqual('JVBER...');
    });

    test('does not add an extension when no attachment referenced this Binary', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextForBinaryAsync: async () => null };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('bin789'),
            enrichmentContext: undefined
        });

        expect(enriched.extension).toBeUndefined();
    });

    test('does not run for non-Binary resources', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextForBinaryAsync: async () => { throw new Error('should not be called'); } };
        const provider = new BinaryDerivedTextEnrichmentProvider({ clinicalNoteTextRetriever });
        const resource = { resourceType: 'DocumentReference', id: 'doc1' };

        const [enriched] = await provider.enrichAsync({
            resources: [resource],
            parsedArgs: makeSingleIdParsedArgsWithContentTrigger('doc1'),
            enrichmentContext: undefined
        });

        expect(enriched.extension).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/enrich/providers/binaryDerivedTextEnrichmentProvider.test.js -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

```js
// src/enrich/providers/binaryDerivedTextEnrichmentProvider.js
const { EnrichmentProvider } = require('./enrichmentProvider');

const DERIVED_TEXT_EXTENSION_URL = 'https://www.icanbwell.com/attachment-derived-text';

/**
 * Reverse-lookup for `Binary` resources: fhir-notes-vector-store never indexes Binary as an
 * independent source (see design doc's "Binary reverse lookup" section) -- its content only
 * appears indirectly, as bytes resolved from a DocumentReference/DiagnosticReport attachment
 * `url`. This finds whichever attachment referenced this Binary and reuses its derived text,
 * via a top-level extension since Binary's own `contentType`/`data` describe its actual stored
 * bytes and must not be repurposed. Runs after the Binary's own authorized fetch.
 */
class BinaryDerivedTextEnrichmentProvider extends EnrichmentProvider {
    /**
     * @param {Object} params
     * @param {import('../../utils/clinicalNoteTextRetriever').ClinicalNoteTextRetriever} params.clinicalNoteTextRetriever
     */
    constructor ({ clinicalNoteTextRetriever }) {
        super();
        this.clinicalNoteTextRetriever = clinicalNoteTextRetriever;
    }

    static isSingleResourceRequest (parsedArgs) {
        const idArg = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
        return Boolean(
            idArg && idArg.queryParameterValue &&
            idArg.queryParameterValue.values && idArg.queryParameterValue.values.length === 1
        );
    }

    static isDerivedTextTrigger (parsedArgs) {
        const contentArg = parsedArgs.get('_content');
        return Boolean(contentArg && contentArg.queryParameterValue.value === '');
    }

    /**
     * @param {Object} params
     * @param {Resource[]} params.resources
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<Resource[]>}
     */
    async enrichAsync ({ resources, parsedArgs, enrichmentContext }) {
        if (!BinaryDerivedTextEnrichmentProvider.isDerivedTextTrigger(parsedArgs) ||
            !BinaryDerivedTextEnrichmentProvider.isSingleResourceRequest(parsedArgs)) {
            return resources;
        }
        for (const resource of resources) {
            if (!resource || resource.resourceType !== 'Binary') {
                continue;
            }
            const text = await this.clinicalNoteTextRetriever.getReassembledTextForBinaryAsync({
                binaryReference: `Binary/${resource.id}`
            });
            if (!text) {
                continue;
            }
            resource.extension = resource.extension || [];
            resource.extension.push({ url: DERIVED_TEXT_EXTENSION_URL, valueString: text });
        }
        return resources;
    }

    /**
     * @param {Object} params
     * @param {BundleEntry[]} params.entries
     * @param {ParsedArgs} params.parsedArgs
     * @param {EnrichmentContext|undefined} params.enrichmentContext
     * @returns {Promise<BundleEntry[]>}
     */
    async enrichBundleEntriesAsync ({ entries, parsedArgs, enrichmentContext }) {
        for (const entry of entries) {
            if (entry.resource) {
                entry.resource = (await this.enrichAsync({
                    resources: [entry.resource], parsedArgs, enrichmentContext
                }))[0];
            }
        }
        return entries;
    }
}

module.exports = { BinaryDerivedTextEnrichmentProvider };
```

In `src/createContainer.js`:
```js
const { BinaryDerivedTextEnrichmentProvider } = require('./enrich/providers/binaryDerivedTextEnrichmentProvider');
// ...
container.register('binaryDerivedTextEnrichmentProvider', (c) => new BinaryDerivedTextEnrichmentProvider({
    clinicalNoteTextRetriever: c.clinicalNoteTextRetriever
}));
```
and add `c.binaryDerivedTextEnrichmentProvider` to the `enrichmentProviders` array alongside
`c.attachmentTextEnrichmentProvider` from Task 8. `clinicalNoteTextRetriever` is already registered
in the container by Task 8 — reuse `c.clinicalNoteTextRetriever` here, do not register it again.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/enrich/providers/binaryDerivedTextEnrichmentProvider.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/enrich/providers/binaryDerivedTextEnrichmentProvider.js src/createContainer.js \
    src/tests/unit/enrich/providers/binaryDerivedTextEnrichmentProvider.test.js
git commit -m "feat: add BinaryDerivedTextEnrichmentProvider reverse lookup"
```

---

## Task 10: Config documentation

**Files:**
- Modify: `readme/cheatsheet.md` (or wherever this repo documents environment configuration —
  check for an existing `.env.example`/config reference doc and mirror whichever already documents
  `RESOURCE_HISTORY_MONGO_URL`/`AUDIT_EVENT_MONGO_URL`)

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add a new section documenting `_content` search**

Document: the four required connection env vars (`FHIR_NOTES_MONGO_URL`, `FHIR_NOTES_MONGO_DB_NAME`,
`FHIR_NOTES_MONGO_COLLECTION_NAME`, `FHIR_NOTES_TEXT_SEARCH_INDEX_NAME`, all required together) plus
the separate `ENABLE_FULL_TEXT_SEARCH=1` kill-switch flag required on top of them; the three
supported resource types; the Lucene `queryString` syntax with the spec's own example; the
empty-`_content` derived-text trigger and its single-resource-only restriction; the
`attachment-derived-text` extension marker semantics for both the `content[]` sibling-attachment
case and the `Binary` top-level-extension case.

- [ ] **Step 2: Commit**

```bash
git add readme/cheatsheet.md
git commit -m "docs: document _content search and derived-text enrichment"
```

---

## Task 11: Replace enrichment providers with `_format=text/plain` delivery

> **Context:** A final whole-branch review of Tasks 1-10 found that Task 8's
> `AttachmentTextEnrichmentProvider` and Task 9's `BinaryDerivedTextEnrichmentProvider` are dead
> code in production — their trigger (`_content=` empty value) is stripped by `r4ArgsParser.js`
> before a `ParsedArgsItem` is ever created (this parser drops every empty-string query parameter
> value, for every parameter — not `_content`-specific), and separately, `Binary` has no
> `extension` element in FHIR R4 (it extends `Resource`, not `DomainResource`), so the derived text
> the Binary provider wrote was silently dropped by `toJSON()` regardless. See the design spec's
> Revision History (2026-09-10 (b)) for the full account. This task removes both providers and
> replaces their capability with `_format=text/plain` content negotiation in the response-writing
> layer — a normal, non-empty query parameter value that needs no special-casing in the parser, and
> a response format that never touches the resource's JSON shape at all.

**Files:**
- Delete: `src/enrich/providers/attachmentTextEnrichmentProvider.js`,
  `src/tests/unit/enrich/providers/attachmentTextEnrichmentProvider.test.js`
- Delete: `src/enrich/providers/binaryDerivedTextEnrichmentProvider.js`,
  `src/tests/unit/enrich/providers/binaryDerivedTextEnrichmentProvider.test.js`
- Modify: `src/createContainer.js` (remove `attachmentTextEnrichmentProvider`/
  `binaryDerivedTextEnrichmentProvider` registrations and their two `require`s; remove both from
  the `enrichmentManager`'s `enrichmentProviders` array; **keep** the `clinicalNoteTextRetriever`
  registration — this task reuses it directly)
- Modify: `src/utils/contentTypes.js` (add a `plainText` format + `hasPlainTextContentType` helper)
- Modify: `src/middleware/fhir/fhirResponseWriter.js` (add a constructor, add the `_format`
  branch to `readOne`)
- Modify: `src/createContainer.js` (update the `fhirResponseWriter` registration to inject
  `clinicalNoteTextRetriever`/`configManager`)
- Modify: `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js:24` (existing bare
  `new FhirResponseWriter()` construction — add the new constructor deps)
- Test: `src/tests/unit/utils/contentTypes.test.js` (new, or add to an existing test file if one
  already covers `contentTypes.js` — check first)
- Test: extend `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js` with the new `readOne`
  behavior (Step 1 below)

**Interfaces:**
- Consumes: `ClinicalNoteTextRetriever.getReassembledTextAsync`/`getReassembledTextForBinaryAsync`
  (Task 7, unchanged), `configManager.fhirNotesFullTextSearchConfigured` (Task 3, unchanged).
- Produces: `hasPlainTextContentType(text): boolean` (mirrors `hasCsvContentType`'s exact shape),
  and `FhirResponseWriter.readOne`'s new behavior — no new public methods beyond that.

**Verified facts this task's implementation relies on** (confirmed by direct code reading, not
assumed — re-verify if anything looks different by the time you implement this):
- `req.sanitized_args` (available on `req` inside `readOne` already, since `readOne` already
  receives `req`) is the raw merged query/path-param object set by
  `src/middleware/fhir/utils/getArgs.utils.js:61` — `req.sanitized_args._format` gives the raw
  `_format` string with **no signature changes needed anywhere upstream** of `readOne`.
  `resource.resourceType` is already on the resource object passed into `readOne` — no need to
  thread `resourceType` through separately either.
- `FhirResponseWriter` currently has no explicit constructor (implicit default) and is constructed
  in exactly two places: `src/createContainer.js:1092` (`new FhirResponseWriter()`) and
  `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js:24` (`new FhirResponseWriter()`) — both
  need updating, low blast radius.
- Single-resource reads (`searchById`/`searchByVersionId`) both call `readOne`
  (`src/middleware/fhir/4_0_0/controllers/generic.controller.js`) — this task's change applies to
  both automatically, which is correct (a `GET .../{id}/_history/{vid}?_format=text/plain` should
  behave the same way as a plain read).

- [ ] **Step 1: Write the failing tests**

`src/tests/unit/utils/contentTypes.test.js` (check first whether a test file for `contentTypes.js`
already exists elsewhere — if so, add to it instead of creating a new one):

```js
const { describe, test, expect } = require('@jest/globals');
const { hasPlainTextContentType, fhirContentTypes } = require('../../../utils/contentTypes');

describe('hasPlainTextContentType', () => {
    test('matches the plainText content type exactly', () => {
        expect(hasPlainTextContentType(fhirContentTypes.plainText)).toBe(true);
        expect(hasPlainTextContentType('text/plain')).toBe(true);
    });

    test('does not match other content types', () => {
        expect(hasPlainTextContentType('application/fhir+json')).toBe(false);
        expect(hasPlainTextContentType('text/csv')).toBe(false);
    });

    test('returns false for empty/undefined input', () => {
        expect(hasPlainTextContentType('')).toBe(false);
        expect(hasPlainTextContentType(undefined)).toBe(false);
    });

    test('matches within an array (multi-valued _format)', () => {
        expect(hasPlainTextContentType(['application/fhir+json', 'text/plain'])).toBe(true);
    });
});
```

Add to `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js` (read the existing file first —
it already constructs `new FhirResponseWriter()` bare at line 24; you'll need to build test doubles
for the two new constructor deps and pass them in, following whatever mocking convention that file
already uses elsewhere, or a plain stub object if it's a very simple file):

```js
describe('readOne with _format=text/plain', () => {
    function makeReq ({ format, base_version = '4_0_0' }) {
        return {
            params: { base_version },
            sanitized_args: format ? { _format: format } : {},
            id: null
        };
    }
    function makeRes () {
        const res = {
            _status: null, _type: null, _sentText: null, _json: null, headersSent: false,
            set: () => res,
            setHeader: () => res,
            type: function (t) { this._type = t; return this; },
            status: function (s) { this._status = s; return this; },
            json: function (body) { this._json = body; return this; },
            send: function (body) { this._sentText = body; return this; },
            sendStatus: function (s) { this._status = s; return this; }
        };
        return res;
    }

    test('returns reassembled text for a DocumentReference when _format=text/plain', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextAsync: async ({ chunkGroupId }) =>
                chunkGroupId === 'doc1-0' ? 'the extracted note text' : null
        };
        const configManager = { fhirNotesFullTextSearchConfigured: true };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
        const res = makeRes();

        await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

        expect(res._type).toEqual('text/plain');
        expect(res._status).toEqual(200);
        expect(res._sentText).toEqual('the extracted note text');
        expect(res._json).toBeNull();
    });

    test('returns reassembled text for a Binary when _format=text/plain', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextForBinaryAsync: async ({ binaryReference }) =>
                binaryReference === 'Binary/bin789' ? 'binary derived text' : null
        };
        const configManager = { fhirNotesFullTextSearchConfigured: true };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = { resourceType: 'Binary', id: 'bin789', contentType: 'application/pdf', data: 'JVBER...' };
        const res = makeRes();

        await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

        expect(res._sentText).toEqual('binary derived text');
        // original Binary fields untouched in the resource object itself
        expect(resource.contentType).toEqual('application/pdf');
    });

    test('returns an empty text/plain body (200) when the resource has no derived text yet', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => null };
        const configManager = { fhirNotesFullTextSearchConfigured: true };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
        const res = makeRes();

        await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

        expect(res._status).toEqual(200);
        expect(res._sentText).toEqual('');
        expect(res._json).toBeNull();
    });

    test('falls through to normal JSON when the feature is not configured', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const configManager = { fhirNotesFullTextSearchConfigured: false };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
        const res = makeRes();

        await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

        expect(res._json).toEqual(resource);
        expect(res._sentText).toBeNull();
    });

    test('falls through to normal JSON for an unsupported resourceType', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const configManager = { fhirNotesFullTextSearchConfigured: true };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = { resourceType: 'Patient', id: 'p1', name: [] };
        const res = makeRes();

        await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

        expect(res._json).toEqual(resource);
    });

    test('normal JSON path is completely unaffected when _format is absent', async () => {
        const clinicalNoteTextRetriever = { getReassembledTextAsync: async () => { throw new Error('should not be called'); } };
        const configManager = { fhirNotesFullTextSearchConfigured: true };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = { resourceType: 'DocumentReference', id: 'doc1', content: [{ attachment: {} }] };
        const res = makeRes();

        await writer.readOne({ req: makeReq({}), res, resource });

        expect(res._json).toEqual(resource);
        expect(res._sentText).toBeNull();
    });

    test('concatenates text across multiple attachments with a blank line', async () => {
        const clinicalNoteTextRetriever = {
            getReassembledTextAsync: async ({ chunkGroupId }) => ({
                'doc1-0': 'first attachment text',
                'doc1-1': 'second attachment text'
            }[chunkGroupId] || null)
        };
        const configManager = { fhirNotesFullTextSearchConfigured: true };
        const writer = new FhirResponseWriter({ clinicalNoteTextRetriever, configManager });
        const resource = {
            resourceType: 'DocumentReference', id: 'doc1',
            content: [{ attachment: {} }, { attachment: {} }]
        };
        const res = makeRes();

        await writer.readOne({ req: makeReq({ format: 'text/plain' }), res, resource });

        expect(res._sentText).toEqual('first attachment text\n\nsecond attachment text');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/contentTypes.test.js src/tests/unit/middleware/fhir/fhirResponseWriter.test.js -v
```
Expected: FAIL — `hasPlainTextContentType` doesn't exist; `FhirResponseWriter` constructor doesn't accept the new deps yet.

- [ ] **Step 3: Delete the superseded providers**

```bash
git rm src/enrich/providers/attachmentTextEnrichmentProvider.js \
    src/tests/unit/enrich/providers/attachmentTextEnrichmentProvider.test.js \
    src/enrich/providers/binaryDerivedTextEnrichmentProvider.js \
    src/tests/unit/enrich/providers/binaryDerivedTextEnrichmentProvider.test.js
```

In `src/createContainer.js`: remove the `require`s for `AttachmentTextEnrichmentProvider` and
`BinaryDerivedTextEnrichmentProvider`, remove their two `container.register(...)` calls, and remove
`c.attachmentTextEnrichmentProvider`/`c.binaryDerivedTextEnrichmentProvider` from the
`enrichmentManager`'s `enrichmentProviders` array. **Do not remove** the `clinicalNoteTextRetriever`
registration — this task's own `FhirResponseWriter` wiring (Step 5) needs it.

- [ ] **Step 4: Add `hasPlainTextContentType` to `contentTypes.js`**

In `src/utils/contentTypes.js`, add to the `fhirContentTypes` object:
```js
plainText: 'text/plain',
```
and add, following the exact shape of `hasCsvContentType`:
```js
/**
 * @param {string[]|string} text
 * @returns {boolean}
 */
const hasPlainTextContentType = (text) => {
    if (!text) {
        return false;
    }
    const text_url_decoded = decodeURIComponent(text);
    if (Array.isArray(text_url_decoded)) {
        return text_url_decoded.some(item => item === fhirContentTypes.plainText);
    }
    return text_url_decoded === fhirContentTypes.plainText;
};
```
Add `hasPlainTextContentType` to the file's `module.exports`.

- [ ] **Step 5: Add `_format=text/plain` handling to `FhirResponseWriter`**

In `src/middleware/fhir/fhirResponseWriter.js`, add imports:
```js
const { hasPlainTextContentType } = require('../../utils/contentTypes');
const { logWarn } = require('../../operations/common/logging');
```

Add a constructor and the resourceType allowlist:
```js
const PLAIN_TEXT_SUPPORTED_RESOURCE_TYPES = new Set(['DocumentReference', 'DiagnosticReport', 'Binary']);

class FhirResponseWriter {
    /**
     * @param {Object} params
     * @param {import('../../utils/clinicalNoteTextRetriever').ClinicalNoteTextRetriever} params.clinicalNoteTextRetriever
     * @param {import('../../utils/configManager').ConfigManager} params.configManager
     */
    constructor ({ clinicalNoteTextRetriever, configManager }) {
        this.clinicalNoteTextRetriever = clinicalNoteTextRetriever;
        this.configManager = configManager;
    }

    // ...existing getContentType() unchanged...
```

Modify `readOne` — insert the new branch before the existing `if (resource) { res.status(200).json(resource); }`:
```js
readOne ({ req, res, resource }) {
    const fhirVersion = req.params.base_version;

    if (resource && resource.meta) {
        res.set('Last-Modified', resource.meta.lastUpdated);
        res.set('ETag', `W/"${resource.meta.versionId}"`);
    }

    if (!res.headersSent) {
        res.type(this.getContentType(fhirVersion));
    }
    if (req.id && !res.headersSent) {
        res.setHeader('X-Request-ID', String(httpContext.get(REQUEST_ID_TYPE.USER_REQUEST_ID)));
    }

    if (!resource) {
        res.sendStatus(404);
        return;
    }

    const format = req.sanitized_args && req.sanitized_args._format;
    if (hasPlainTextContentType(format) &&
        PLAIN_TEXT_SUPPORTED_RESOURCE_TYPES.has(resource.resourceType) &&
        this.configManager.fhirNotesFullTextSearchConfigured) {
        res.status(200).type('text/plain');
        this.resolveDerivedTextAsync({ resource }).then(text => {
            res.send(text || '');
        }).catch(e => {
            logWarn(`Failed to resolve derived text for ${resource.resourceType}/${resource.id}`, { error: e });
            res.send('');
        });
        return;
    }

    res.status(200).json(resource);
}

/**
 * @param {Object} params
 * @param {Resource} params.resource
 * @returns {Promise<string>}
 */
async resolveDerivedTextAsync ({ resource }) {
    if (resource.resourceType === 'Binary') {
        return (await this.clinicalNoteTextRetriever.getReassembledTextForBinaryAsync({
            binaryReference: `Binary/${resource.id}`
        })) || '';
    }
    const attachmentArray = resource.resourceType === 'DocumentReference'
        ? resource.content
        : resource.presentedForm;
    if (!Array.isArray(attachmentArray)) {
        return '';
    }
    const texts = [];
    for (let index = 0; index < attachmentArray.length; index++) {
        const text = await this.clinicalNoteTextRetriever.getReassembledTextAsync({
            chunkGroupId: `${resource.id}-${index}`
        });
        if (text) {
            texts.push(text);
        }
    }
    return texts.join('\n\n');
}
```

**Note the change from synchronous to asynchronous response writing**: `readOne`'s existing callers
(`GenericController.searchById`/`searchByVersionId`) call it synchronously
(`this.fhirResponseWriter.readOne({ req, res, resource });`, no `await`) and rely on it writing the
response before returning. The `.then()`/`.catch()` chain above still writes the response
eventually, but `readOne` itself now returns before the response is sent in the `text/plain` case.
**Before finalizing this step, verify this doesn't race with anything in `GenericController`'s
`finally` block** (which runs `postRequestProcessor.executeAsync`/`requestSpecificCache.clearAsync`
after calling `readOne`) — if request-scoped cache is cleared before the async
`resolveDerivedTextAsync` call resolves and it depends on that cache, this would break. The
simplest fix if that's a real risk: make `readOne` itself `async` and have both call sites
`await this.fhirResponseWriter.readOne(...)` instead of calling it synchronously — check both call
sites in `generic.controller.js` and update them consistently if you take this route.

In `src/createContainer.js`, update the `fhirResponseWriter` registration:
```js
container.register('fhirResponseWriter', (c) => new FhirResponseWriter({
    clinicalNoteTextRetriever: c.clinicalNoteTextRetriever,
    configManager: c.configManager
}));
```

Update `src/tests/unit/middleware/fhir/fhirResponseWriter.test.js:24`'s existing
`new FhirResponseWriter()` call to pass stub `clinicalNoteTextRetriever`/`configManager` objects
(read the surrounding test file first to match its existing conventions), so the file's other,
pre-existing tests (which don't exercise `_format=text/plain` at all) keep passing unmodified.

- [ ] **Step 6: Run tests to verify they pass**

```
nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/utils/contentTypes.test.js src/tests/unit/middleware/fhir/fhirResponseWriter.test.js -v
```
Expected: PASS. Also run the full `src/tests/unit/enrich` and `src/tests/unit/middleware` suites to
confirm the provider deletion and `FhirResponseWriter` constructor change didn't break anything
else:
```
nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/enrich src/tests/unit/middleware -v
```

- [ ] **Step 7: Integration-level test using the real parser**

The whole reason Tasks 8/9's tests missed the empty-`_content` defect is that they hand-built
`ParsedArgsItem`s instead of going through the real request-parsing path. Add at least one test
(integration-level, or a focused unit test that constructs args the way `getArgsMiddleware`/
`R4ArgsParser` actually would — e.g. a plain `{ id: 'doc1', _format: 'text/plain' }` object passed
through the real parsing chain if that's feasible without full HTTP infrastructure, or a real
supertest-style HTTP integration test if this repo's existing integration test conventions make
that straightforward) that proves `GET DocumentReference/{id}?_format=text/plain` produces a
`text/plain` response end-to-end, not just that `FhirResponseWriter.readOne` behaves correctly in
isolation with hand-built inputs. If a true end-to-end HTTP test is impractical within this task's
scope, at minimum confirm via `R4ArgsParser`/`getArgsMiddleware` directly that `_format=text/plain`
survives parsing and lands on `req.sanitized_args`/`parsedArgs` as expected — do not rely solely on
another hand-built object matching what you assume the real pipeline produces.

- [ ] **Step 8: Commit**

```bash
git add src/enrich/providers src/tests/unit/enrich/providers src/createContainer.js \
    src/utils/contentTypes.js src/tests/unit/utils/contentTypes.test.js \
    src/middleware/fhir/fhirResponseWriter.js src/tests/unit/middleware/fhir/fhirResponseWriter.test.js
git commit -m "feat: replace _content-triggered enrichment with _format=text/plain delivery"
```

---

## Task 12: Fix `_content` search's flag-off/allowlist ordering

**Files:**
- Modify: `src/operations/search/searchManager.js` (`buildContentSearchIdFilterAsync`)
- Modify: `src/tests/unit/operations/search/searchManager.test.js` (add/adjust tests)
- Modify: `readme/cheatsheet.md` (correct the now-stale `_content=` empty-value / extension-marker
  documentation from Task 10, to describe `_format=text/plain` instead — see Task 11's design)

**Context:** the final whole-branch review found that `buildContentSearchIdFilterAsync`
(`src/operations/search/searchManager.js`, built in Task 6) checks the resourceType allowlist and
the `fhirNotesFullTextSearchConfigured` flag *before* checking whether `_content` even has a
non-empty value — and, independent of that ordering, checks the allowlist even when
`ENABLE_FULL_TEXT_SEARCH` is entirely off. On `main` today, `_content` is a recognized-but-unresolved
parameter that's silently ignored for every resourceType. With the flag off (the default —
correct rollout posture), that must remain true; instead, today, `_content=<anything>` on an
unsupported resourceType (or when the connection isn't configured) throws `BadRequestError`
regardless of the flag, which is a behavior regression on deploy, before anyone has opted in to
anything.

Additionally, per Task 11's redesign, `_content` is unconditionally a search parameter now — the
old "empty value means something else" escape hatch (`if (!contentQuery) return null`) was already
dead code (an empty `_content` value never reaches this function at all, since `r4ArgsParser.js`
never constructs a `ParsedArgsItem` for it), so it should be deleted rather than reordered.

**Interfaces:** no signature change to `buildContentSearchIdFilterAsync` — same
`{ resourceType, parsedArgs }` in, same `Promise<import('mongodb').Document|null>` out.

- [ ] **Step 1: Write the failing test**

Read `src/operations/search/searchManager.js`'s current `buildContentSearchIdFilterAsync` first
(it was written in Task 6) to see its exact current structure before editing. Add this test to the
existing `describe('SearchManager.buildContentSearchIdFilterAsync', ...)` block in
`src/tests/unit/operations/search/searchManager.test.js`:

```js
test('ignores _content silently (returns null) when the feature flag is off, even for an unsupported resourceType', async () => {
    const searchManager = makeSearchManager({
        configManager: { fhirNotesFullTextSearchConfigured: false },
        clinicalNoteSearchClient: { findMatchingResourceIdsAsync: async () => { throw new Error('should not be called'); } }
    });
    const result = await searchManager.buildContentSearchIdFilterAsync({
        resourceType: 'Condition',
        parsedArgs: makeParsedArgsWithContent('diabetes')
    });
    expect(result).toBeNull();
});
```

(Reuse the existing `makeSearchManager`/`makeParsedArgsWithContent` helpers already in that test
file from Task 6 — don't redefine them.)

Also update the existing Task 6 test `'throws BadRequestError for an unsupported resourceType'` —
it currently constructs `makeSearchManager({ configManager: { fhirNotesFullTextSearchConfigured: true }, ... })`
already (the flag is already `true` in that test), so it should keep passing unmodified once the
ordering is fixed; re-run it to confirm rather than assuming.

- [ ] **Step 2: Run the new test to verify it fails**

```
nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/operations/search/searchManager.test.js -v
```
Expected: FAIL on the new test — today's code throws `BadRequestError` regardless of the flag.

- [ ] **Step 3: Fix the ordering in `buildContentSearchIdFilterAsync`**

Reorder so `fhirNotesFullTextSearchConfigured` is checked **before** the resourceType allowlist
(when the flag is off, `_content` is ignored full stop, regardless of resourceType), and delete the
now-dead empty-value branch:

```js
async buildContentSearchIdFilterAsync ({ resourceType, parsedArgs }) {
    const contentArg = parsedArgs.get('_content');
    if (!contentArg) {
        return null;
    }
    if (!this.configManager.fhirNotesFullTextSearchConfigured) {
        return null;
    }
    if (!FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES.includes(resourceType)) {
        throw new BadRequestError(new Error(
            `_content search is not supported for resourceType=${resourceType}. ` +
            `Supported types: ${FULL_TEXT_SEARCH_SUPPORTED_RESOURCE_TYPES.join(', ')}`
        ));
    }
    const contentQuery = contentArg.queryParameterValue.value;
    if (Array.isArray(contentQuery)) {
        throw new BadRequestError(new Error(
            '_content does not support multiple repeated values'
        ));
    }
    const candidateIds = await this.clinicalNoteSearchClient.findMatchingResourceIdsAsync({
        resourceType,
        contentQuery
    });
    return FilterById.getListFilter(candidateIds);
}
```

Note this changes the semantics of "not configured" from `BadRequestError` to a silent no-op
(matching pre-existing `_content` behavior when the feature doesn't exist at all) — this is a
deliberate correction, not a regression introduced by this fix. Verify against the design spec's
Error Handling section (updated by this same review round) that this matches the intended posture.

- [ ] **Step 4: Run tests to verify they pass**

```
nvm use && node node_modules/.bin/jest --config jest.unit.config.js src/tests/unit/operations/search/searchManager.test.js -v
```
Expected: PASS, all tests including the pre-existing ones from Task 6.

- [ ] **Step 5: Fix `readme/cheatsheet.md`'s now-stale documentation**

Task 10 documented the empty-`_content=` trigger and the `attachment-derived-text` extension
marker (both `content[]`-sibling and `Binary`-top-level forms) — all now removed by Task 11. Update
section 1.10 to describe `_format=text/plain` instead: the same three resource types
(`DocumentReference`/`DiagnosticReport`/`Binary`), the response is a plain-text HTTP body (not a
JSON resource with an embedded attachment/extension), and it's restricted to single-resource reads.
Remove the now-inaccurate `attachment-derived-text` extension JSON examples entirely — read the
current file first, since Task 10's exact wording needs replacing, not just appending to.

- [ ] **Step 6: Commit**

```bash
git add src/operations/search/searchManager.js src/tests/unit/operations/search/searchManager.test.js \
    readme/cheatsheet.md
git commit -m "fix: ignore _content when the feature flag is off, regardless of resourceType"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage check:** every capability in the spec's Scope section (§`_content` search on the
  three resource types, derived-text read enrichment, `Binary` reverse lookup) has a task; every
  item in Error Handling has an explicit test (Task 5 Step 1's `BadRequestError`/`ExternalTimeoutError`
  cases, Task 6's graceful-degradation-on-failure behavior baked into `ClinicalNoteTextRetriever`
  catching and logging rather than throwing).
- **Deliberate scope simplification vs. the spec's exact wording:** the spec's "Security model"
  section describes the vector-store candidate query as patient-scoped (`patientIds` filter) as a
  defense-in-depth measure. Task 5's actual `SearchManager.constructQueryAsync` hook point runs
  *before* `allPatientIdsFromJwtToken` is computed in that function today (patient-scope resolution
  currently happens only inside the `buildSearchQueryBasedOnVersion`-dependent branch). Rather than
  reordering `constructQueryAsync`'s existing, security-sensitive logic to hoist that computation
  earlier -- a change with its own regression risk -- this plan omits the patient-scoped pre-filter
  for v1 and relies entirely on the mandatory `_id ∈ [...]` post-filter re-validation for
  correctness and security (which is unaffected by this simplification: every candidate id is still
  fully re-authorized). The vector-store query is somewhat less precise as a result (candidates
  aren't narrowed by patient before the Atlas Search call). Hoisting patient-scope resolution to
  enable a patient-scoped pre-filter is a reasonable fast-follow, not required for correctness.
- **Type consistency check:** `ClinicalNoteSearchClient.findMatchingResourceIdsAsync` (Task 5) and
  `ClinicalNoteTextRetriever.getReassembledTextAsync`/`getReassembledTextForBinaryAsync` (Task 7) are
  the only two consumer-facing methods introduced by the new utility classes, and both are called
  with the exact same parameter names throughout Tasks 6, 8, and 9 — verified consistent.
