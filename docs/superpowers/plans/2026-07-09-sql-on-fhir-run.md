# SQL on FHIR — `ViewDefinition/$run` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spec-conformant HL7 SQL-on-FHIR v2 `$run` operation that evaluates an inline `ViewDefinition` (FHIRPath columns/filters) over stored or inline FHIR resources and streams a flat table as NDJSON or CSV.

**Architecture:** A pure streaming engine (`ViewRunner`) ports medplum's `evalSqlOnFhir` row-expansion algorithm but yields rows lazily (`AsyncIterable`) instead of materializing them. A thin `FhirPathEvaluator` wraps the `fhirpath` npm library and adds the SQL-on-FHIR helper functions. The orchestrator (`SqlOnFhirRunOperation`) fetches stored resources through the **same** secured query path as `$search` (`searchManager.constructQueryAsync`) — never a hand-rolled Mongo query — and pipes engine output to NDJSON/CSV row writers. Wiring mirrors the existing `$export`/`$everything` operations.

**Tech Stack:** Node.js (CommonJS), Express, MongoDB, `fhirpath` (new dep), `@json2csv/node` (already present), Jest + MongoDB Memory Server.

**Reference spec:** `docs/superpowers/specs/2026-07-09-sql-on-fhir-run-design.md`

## Global Constraints

- Node >= 24.14; CommonJS (`require`/`module.exports`); Prettier: 100-char width, semicolons, single quotes, 4-space indent, ES5 trailing commas.
- Logging via `logInfo`/`logDebug`/`logError`/`logWarn` from `src/operations/common/logging.js`.
- New classes MUST be registered in `src/createContainer.js`; test overrides in `src/tests/createTestContainer.js`.
- New dependencies: edit `package.json`, then run `make update` (do NOT hand-edit `yarn.lock`).
- Tests run with `--runInBand`; use MongoDB Memory Server (no external DB); custom matcher `toHaveResponse` available.
- **Security (non-negotiable):** stored `$run` MUST build its Mongo query via `searchManager.constructQueryAsync(...)`. Never query a collection directly for stored resources.
- **Decision D1:** a per-resource FHIRPath runtime error fails the whole request (do not silently skip rows).
- **Decision D2:** stored `$run` with no filter and no explicit `_count` is rejected with 400 before streaming.
- **Decision D3 (CSV collections):** a `collection: true` column value is JSON-encoded into its cell (`JSON.stringify(array)`).

---

## File Structure

**New files:**
- `src/utils/fhirPathEvaluator.js` — wraps `fhirpath`; binds `constant`s; registers SoF functions. One job: `(expression, node, variables) → values[]`.
- `src/fhir/classes/4_0_0/custom_resources/viewDefinition.js` — `ViewDefinition` custom resource class (typing/validation only).
- `src/operations/sqlOnFhir/viewDefinitionValidator.js` — structural validation, fail-fast.
- `src/operations/sqlOnFhir/viewRunner.js` — pure streaming engine `(view, asyncResources, {fhirPathEvaluator}) → AsyncIterable<row>`.
- `src/operations/sqlOnFhir/viewResolver.js` — the seam; phase 1 returns the inline view + inline resources parsed from the request `Parameters`.
- `src/operations/sqlOnFhir/rowNdJsonWriter.js` — `Transform` (object → `JSON.stringify(row)+'\n'`).
- `src/operations/sqlOnFhir/rowCsvWriter.js` — `Transform` wrapping `@json2csv/node` with explicit `fields`.
- `src/operations/sqlOnFhir/sqlOnFhirRunOperation.js` — orchestrator.
- `src/middleware/fhir/sqlOnFhir/sqlOnFhir.config.js` — route config.
- Tests under `src/tests/sqlOnFhir/` (unit + conformance + integration) and fixtures under `src/tests/sqlOnFhir/fixtures/`.

**Modified files:**
- `src/fhir/classes/4_0_0/custom_resources/index.js` — register `viewdefinition`.
- `src/operations/fhirOperationsManager.js` — add `run` method + constructor param.
- `src/createContainer.js` — register new services + inject into `fhirOperationsManager`.
- `src/middleware/fhir/router.js` — add `enableSqlOnFhirRoutes` + call in `setRoutes`.
- `package.json` — add `fhirpath`.

---

## Task 1: `fhirpath` dependency + `FhirPathEvaluator` service

**Files:**
- Modify: `package.json`
- Create: `src/utils/fhirPathEvaluator.js`
- Test: `src/tests/sqlOnFhir/fhirPathEvaluator.test.js`

**Interfaces:**
- Produces:
  - `class FhirPathEvaluator` with `evaluate({ node, expression, variables = {} }) => any[]` — returns the FHIRPath result as an array (possibly empty).
  - Registers SoF functions `getResourceKey()` and `getReferenceKey(resourceType?)` so they are callable inside expressions.

- [ ] **Step 1: Add the dependency**

Edit `package.json` `dependencies`, add (pin the version):
```json
"fhirpath": "3.15.2"
```
Then run:
```bash
nvm use && make update
```
Expected: `yarn.lock` updated, `node_modules/fhirpath` present.

- [ ] **Step 2: Write the failing test**

Create `src/tests/sqlOnFhir/fhirPathEvaluator.test.js`:
```javascript
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

describe('FhirPathEvaluator', () => {
    const evaluator = new FhirPathEvaluator();
    const patient = {
        resourceType: 'Patient',
        id: 'p1',
        name: [{ use: 'official', family: 'Smith', given: ['Jane'] }],
        managingOrganization: { reference: 'Organization/o1' }
    };

    test('evaluates a simple path to a scalar array', () => {
        expect(evaluator.evaluate({ node: patient, expression: 'name.family' })).toEqual(['Smith']);
    });

    test('returns empty array when path yields nothing', () => {
        expect(evaluator.evaluate({ node: patient, expression: 'birthDate' })).toEqual([]);
    });

    test('binds constants as %variables', () => {
        expect(
            evaluator.evaluate({ node: patient, expression: "name.where(use = %u).family", variables: { u: 'official' } })
        ).toEqual(['Smith']);
    });

    test('getResourceKey returns the resource id', () => {
        expect(evaluator.evaluate({ node: patient, expression: 'getResourceKey()' })).toEqual(['p1']);
    });

    test('getReferenceKey extracts the id from a reference', () => {
        expect(
            evaluator.evaluate({ node: patient, expression: 'managingOrganization.getReferenceKey()' })
        ).toEqual(['o1']);
    });

    test('getReferenceKey with matching type returns id, non-matching returns empty', () => {
        expect(
            evaluator.evaluate({ node: patient, expression: "managingOrganization.getReferenceKey('Organization')" })
        ).toEqual(['o1']);
        expect(
            evaluator.evaluate({ node: patient, expression: "managingOrganization.getReferenceKey('Patient')" })
        ).toEqual([]);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/fhirPathEvaluator.test.js -v`
Expected: FAIL — `Cannot find module '../../utils/fhirPathEvaluator'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/utils/fhirPathEvaluator.js`:
```javascript
const fhirpath = require('fhirpath');
const fhirpathR4Model = require('fhirpath/fhir-context/r4');

/**
 * Parses a FHIR reference string like "Organization/o1" or a full URL into its logical id.
 * @param {string} reference
 * @returns {{ resourceType: string|undefined, id: string }|undefined}
 */
function parseReference(reference) {
    if (!reference || typeof reference !== 'string') {
        return undefined;
    }
    const parts = reference.split('/');
    if (parts.length < 2) {
        return { resourceType: undefined, id: reference };
    }
    const id = parts[parts.length - 1];
    const resourceType = parts[parts.length - 2];
    return { resourceType, id };
}

/**
 * SQL-on-FHIR helper functions registered into the fhirpath userInvocationTable.
 * See https://build.fhir.org/ig/FHIR/sql-on-fhir-v2/#getResourceKey
 */
const sqlOnFhirFunctions = {
    getResourceKey: {
        fn: (nodes) => nodes.map((n) => (n && n.id !== undefined ? n.id : n)).filter((v) => v !== undefined),
        arity: { 0: [] }
    },
    getReferenceKey: {
        fn: (nodes, resourceTypeNode) => {
            const wantedType = Array.isArray(resourceTypeNode) ? resourceTypeNode[0] : resourceTypeNode;
            const out = [];
            for (const n of nodes) {
                const ref = n && (typeof n === 'object' ? n.reference : n);
                const parsed = parseReference(ref);
                if (!parsed) {
                    continue;
                }
                if (wantedType && parsed.resourceType && parsed.resourceType !== wantedType) {
                    continue;
                }
                out.push(parsed.id);
            }
            return out;
        },
        arity: { 0: [], 1: ['String'] }
    }
};

class FhirPathEvaluator {
    constructor() {
        this.options = { userInvocationTable: sqlOnFhirFunctions };
    }

    /**
     * @param {{ node: Object, expression: string, variables?: Object }} params
     * @returns {any[]} FHIRPath result, always an array (possibly empty)
     */
    evaluate({ node, expression, variables = {} }) {
        const result = fhirpath.evaluate(node, expression, variables, fhirpathR4Model, this.options);
        return Array.isArray(result) ? result : [result];
    }
}

module.exports = { FhirPathEvaluator };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/fhirPathEvaluator.test.js -v`
Expected: PASS (6 tests). If `getResourceKey`/`getReferenceKey` semantics differ from the pinned `fhirpath` version's built-ins, adjust `sqlOnFhirFunctions`; the conformance suite in Task 4 is the source of truth.

- [ ] **Step 6: Commit**

```bash
git add package.json yarn.lock src/utils/fhirPathEvaluator.js src/tests/sqlOnFhir/fhirPathEvaluator.test.js
git commit -m "feat(sql-on-fhir): add FhirPathEvaluator wrapping fhirpath with SoF functions"
```

---

## Task 2: `ViewDefinition` custom resource class

**Files:**
- Create: `src/fhir/classes/4_0_0/custom_resources/viewDefinition.js`
- Modify: `src/fhir/classes/4_0_0/custom_resources/index.js`
- Test: `src/tests/sqlOnFhir/viewDefinition.test.js`

**Interfaces:**
- Produces: a `ViewDefinition` resource class instantiable via `FhirResourceCreator.create({ resourceType: 'ViewDefinition', ... })`, with `resourceType` getter returning `'ViewDefinition'` and a `toJSON()` round-trip.

- [ ] **Step 1: Write the failing test**

Create `src/tests/sqlOnFhir/viewDefinition.test.js`:
```javascript
const { FhirResourceCreator } = require('../../fhir/fhirResourceCreator');

describe('ViewDefinition custom resource', () => {
    const raw = {
        resourceType: 'ViewDefinition',
        id: 'v1',
        status: 'active',
        resource: 'Patient',
        select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
    };

    test('is created as a ViewDefinition instance', () => {
        const view = FhirResourceCreator.create(raw);
        expect(view.resourceType).toBe('ViewDefinition');
        expect(view.resource).toBe('Patient');
    });

    test('toJSON round-trips core fields', () => {
        const view = FhirResourceCreator.create(raw);
        const json = view.toJSON();
        expect(json.resourceType).toBe('ViewDefinition');
        expect(json.select[0].column[0].name).toBe('id');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewDefinition.test.js -v`
Expected: FAIL — resourceType `ViewDefinition` not resolvable (`BadRequestError`) or `resource` undefined.

- [ ] **Step 3: Write the resource class**

Create `src/fhir/classes/4_0_0/custom_resources/viewDefinition.js` (mirror the `exportStatus.js` `Object.defineProperty` pattern; store nested `select`/`constant`/`where` as plain objects — they are FHIRPath payloads, not typed FHIR elements):
```javascript
const Resource = require('../resources/resource');

class ViewDefinition extends Resource {
    constructor({
        id,
        meta,
        url,
        name,
        title,
        status,
        resource,
        constant,
        select,
        where,
        _access,
        _sourceAssigningAuthority,
        _sourceId,
        _uuid
    }) {
        super({});

        const defineStringLike = (key, initial) => {
            Object.defineProperty(this, key, {
                enumerable: true,
                configurable: true,
                get: () => this.__data[key],
                set: (valueProvided) => {
                    if (
                        valueProvided === undefined ||
                        valueProvided === null ||
                        (Array.isArray(valueProvided) && valueProvided.length === 0)
                    ) {
                        this.__data[key] = undefined;
                        return;
                    }
                    this.__data[key] = valueProvided;
                }
            });
        };

        this.__data = this.__data || {};
        defineStringLike('id', id);
        defineStringLike('meta', meta);
        defineStringLike('url', url);
        defineStringLike('name', name);
        defineStringLike('title', title);
        defineStringLike('status', status);
        defineStringLike('resource', resource);
        defineStringLike('constant', constant);
        defineStringLike('select', select);
        defineStringLike('where', where);
        defineStringLike('_access', _access);
        defineStringLike('_sourceAssigningAuthority', _sourceAssigningAuthority);
        defineStringLike('_sourceId', _sourceId);
        defineStringLike('_uuid', _uuid);

        Object.defineProperty(this, 'resourceType', {
            value: 'ViewDefinition',
            enumerable: true,
            writable: false,
            configurable: true
        });

        this.id = id;
        this.meta = meta;
        this.url = url;
        this.name = name;
        this.title = title;
        this.status = status;
        this.resource = resource;
        this.constant = constant;
        this.select = select;
        this.where = where;
        this._access = _access;
        this._sourceAssigningAuthority = _sourceAssigningAuthority;
        this._sourceId = _sourceId;
        this._uuid = _uuid;
    }

    toJSON() {
        const { removeNull } = require('../../../../utils/nullRemover.js');
        return removeNull({
            id: this.id,
            resourceType: this.resourceType,
            meta: this.meta && (this.meta.toJSON ? this.meta.toJSON() : this.meta),
            url: this.url,
            name: this.name,
            title: this.title,
            status: this.status,
            resource: this.resource,
            constant: this.constant,
            select: this.select,
            where: this.where
        });
    }
}

module.exports = ViewDefinition;
```

- [ ] **Step 4: Register in the index**

Modify `src/fhir/classes/4_0_0/custom_resources/index.js`:
```javascript
const exportstatusentry = require('./exportStatusEntry');
const exportstatus = require('./exportStatus');
const viewdefinition = require('./viewDefinition');

module.exports = {
    exportstatusentry,
    exportstatus,
    viewdefinition
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewDefinition.test.js -v`
Expected: PASS (2 tests). If `Resource` base import path differs, match the path used at the top of `exportStatus.js`.

- [ ] **Step 6: Commit**

```bash
git add src/fhir/classes/4_0_0/custom_resources/viewDefinition.js src/fhir/classes/4_0_0/custom_resources/index.js src/tests/sqlOnFhir/viewDefinition.test.js
git commit -m "feat(sql-on-fhir): add ViewDefinition custom resource class"
```

---

## Task 3: `ViewDefinitionValidator`

**Files:**
- Create: `src/operations/sqlOnFhir/viewDefinitionValidator.js`
- Test: `src/tests/sqlOnFhir/viewDefinitionValidator.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `class ViewDefinitionValidator` with `validate(view) => void` — throws `BadRequestError` (from `src/utils/httpErrors.js`) with a clear message on the first structural problem. Checks: `view.resource` is a non-empty string; `view.select` is a non-empty array; every column has a non-empty `name` and `path`; column `name`s are unique across the whole view (including nested `select`/`unionAll`/`forEach`).

- [ ] **Step 1: Write the failing test**

Create `src/tests/sqlOnFhir/viewDefinitionValidator.test.js`:
```javascript
const { ViewDefinitionValidator } = require('../../operations/sqlOnFhir/viewDefinitionValidator');

describe('ViewDefinitionValidator', () => {
    const validator = new ViewDefinitionValidator();

    test('accepts a valid view', () => {
        expect(() =>
            validator.validate({
                resource: 'Patient',
                select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
            })
        ).not.toThrow();
    });

    test('rejects a missing resource', () => {
        expect(() => validator.validate({ select: [{ column: [{ name: 'id', path: 'id' }] }] })).toThrow(/resource/i);
    });

    test('rejects an empty select', () => {
        expect(() => validator.validate({ resource: 'Patient', select: [] })).toThrow(/select/i);
    });

    test('rejects a column missing name or path', () => {
        expect(() =>
            validator.validate({ resource: 'Patient', select: [{ column: [{ path: 'id' }] }] })
        ).toThrow(/name/i);
    });

    test('rejects duplicate column names across nested selects', () => {
        expect(() =>
            validator.validate({
                resource: 'Patient',
                select: [
                    { column: [{ name: 'id', path: 'getResourceKey()' }] },
                    { select: [{ column: [{ name: 'id', path: 'id' }] }] }
                ]
            })
        ).toThrow(/duplicate/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewDefinitionValidator.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/operations/sqlOnFhir/viewDefinitionValidator.js`:
```javascript
const { BadRequestError } = require('../../utils/httpErrors');

class ViewDefinitionValidator {
    /**
     * @param {Object} view a ViewDefinition (plain object or resource instance)
     * @throws {BadRequestError}
     */
    validate(view) {
        if (!view || typeof view !== 'object') {
            throw new BadRequestError(new Error('ViewDefinition is required'));
        }
        if (!view.resource || typeof view.resource !== 'string') {
            throw new BadRequestError(new Error('ViewDefinition.resource (a FHIR resource type) is required'));
        }
        if (!Array.isArray(view.select) || view.select.length === 0) {
            throw new BadRequestError(new Error('ViewDefinition.select must be a non-empty array'));
        }
        const seen = new Set();
        this._walkSelections(view.select, seen);
    }

    _walkSelections(selections, seen) {
        for (const selection of selections) {
            for (const col of selection.column || []) {
                if (!col.name || typeof col.name !== 'string') {
                    throw new BadRequestError(new Error('Each ViewDefinition column requires a non-empty name'));
                }
                if (!col.path || typeof col.path !== 'string') {
                    throw new BadRequestError(new Error(`Column "${col.name}" requires a non-empty path`));
                }
                if (seen.has(col.name)) {
                    throw new BadRequestError(new Error(`Duplicate column name "${col.name}"`));
                }
                seen.add(col.name);
            }
            if (Array.isArray(selection.select)) {
                this._walkSelections(selection.select, seen);
            }
            if (Array.isArray(selection.unionAll)) {
                // unionAll branches share the same column names by design — validate each branch
                // against a fresh copy so branch columns are consistent but not flagged as dupes of each other.
                for (const branch of selection.unionAll) {
                    this._walkSelections([branch], new Set(seen));
                }
            }
        }
    }
}

module.exports = { ViewDefinitionValidator };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewDefinitionValidator.test.js -v`
Expected: PASS (5 tests). If `BadRequestError`'s constructor signature differs, match the usage in `src/operations/search/` (it typically wraps an `Error`).

- [ ] **Step 5: Commit**

```bash
git add src/operations/sqlOnFhir/viewDefinitionValidator.js src/tests/sqlOnFhir/viewDefinitionValidator.test.js
git commit -m "feat(sql-on-fhir): add ViewDefinitionValidator"
```

---

## Task 4: `ViewRunner` (core streaming engine) + conformance fixtures

**Files:**
- Create: `src/operations/sqlOnFhir/viewRunner.js`
- Create: `src/tests/sqlOnFhir/fixtures/` (vendored official test cases)
- Test: `src/tests/sqlOnFhir/viewRunner.test.js`
- Test: `src/tests/sqlOnFhir/viewRunner.conformance.test.js`

**Interfaces:**
- Consumes: `FhirPathEvaluator` (Task 1).
- Produces: `async function *runView(view, resourceIterable, { fhirPathEvaluator })` yielding plain row objects `{ [columnName]: scalarOrArrayOrNull }`. Row-expansion mirrors medplum `eval.ts`: `where` gate → per selection: determine `foci` (`forEach`/`forEachOrNull`/self) → cartesian product of column partial-rows, nested `select` rows, and `unionAll` rows. A `collection:false` column path yielding >1 value throws (D1). Constants are passed to the evaluator as `variables`.

- [ ] **Step 1: Vendor a small set of official conformance cases**

Download 3 canonical case files from the HL7 SQL-on-FHIR v2 test suite (`https://github.com/FHIR/sql-on-fhir-v2/tree/master/tests`) into `src/tests/sqlOnFhir/fixtures/`: `basic.json`, `where.json`, `fn_reference_keys.json`. (medplum vendors the same suite at `packages/core/src/sql-on-fhir/tests/` — use it as a cross-check.) Each file has shape `{ resources: [...], tests: [{ title, view, expect: [...] }] }`.

```bash
mkdir -p src/tests/sqlOnFhir/fixtures
# fetch the three files via the plan executor's web/gh tooling into that directory
```

- [ ] **Step 2: Write the failing unit test (hand-written cases)**

Create `src/tests/sqlOnFhir/viewRunner.test.js`:
```javascript
const { runView } = require('../../operations/sqlOnFhir/viewRunner');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

const fhirPathEvaluator = new FhirPathEvaluator();

async function collect(view, resources) {
    const rows = [];
    for await (const row of runView(view, resources, { fhirPathEvaluator })) {
        rows.push(row);
    }
    return rows;
}

const patients = [
    { resourceType: 'Patient', id: 'p1', active: true, name: [{ family: 'Smith', given: ['Jane', 'Q'] }] },
    { resourceType: 'Patient', id: 'p2', active: false, name: [{ family: 'Jones' }] }
];

describe('runView', () => {
    test('one row per resource with scalar columns', async () => {
        const view = {
            resource: 'Patient',
            select: [{ column: [{ name: 'id', path: 'getResourceKey()' }, { name: 'family', path: 'name.family.first()' }] }]
        };
        expect(await collect(view, patients)).toEqual([
            { id: 'p1', family: 'Smith' },
            { id: 'p2', family: 'Jones' }
        ]);
    });

    test('where filters resources', async () => {
        const view = {
            resource: 'Patient',
            where: [{ path: 'active = true' }],
            select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
        };
        expect(await collect(view, patients)).toEqual([{ id: 'p1' }]);
    });

    test('collection column yields an array', async () => {
        const view = {
            resource: 'Patient',
            select: [{ column: [{ name: 'given', path: 'name.given', collection: true }] }]
        };
        expect(await collect(view, [patients[0]])).toEqual([{ given: ['Jane', 'Q'] }]);
    });

    test('forEach produces one row per element', async () => {
        const view = {
            resource: 'Patient',
            select: [
                { column: [{ name: 'id', path: 'getResourceKey()' }] },
                { forEach: 'name.given', column: [{ name: 'given', path: '$this' }] }
            ]
        };
        expect(await collect(view, [patients[0]])).toEqual([
            { id: 'p1', given: 'Jane' },
            { id: 'p1', given: 'Q' }
        ]);
    });

    test('scalar column with multiple values throws (D1)', async () => {
        const view = { resource: 'Patient', select: [{ column: [{ name: 'given', path: 'name.given' }] }] };
        await expect(collect(view, [patients[0]])).rejects.toThrow(/single|collection/i);
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewRunner.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the engine**

Create `src/operations/sqlOnFhir/viewRunner.js`:
```javascript
/**
 * Streaming port of medplum's evalSqlOnFhir (packages/core/src/sql-on-fhir/eval.ts).
 * Yields one plain row object at a time instead of materializing OutputRow[].
 */

function buildConstants(view, fhirPathEvaluator) {
    const variables = {};
    for (const c of view.constant || []) {
        // constant value is stored as value[x]; take the first defined value* key
        const valueKey = Object.keys(c).find((k) => k.startsWith('value'));
        variables[c.name] = valueKey ? c[valueKey] : undefined;
    }
    return variables;
}

function columnValue(col, focus, variables, fhirPathEvaluator) {
    const result = fhirPathEvaluator.evaluate({ node: focus, expression: col.path, variables });
    if (col.collection) {
        return result;
    }
    if (result.length > 1) {
        throw new Error(`Column "${col.name}" returned multiple values but is not marked collection:true`);
    }
    return result.length === 1 ? result[0] : null;
}

function cartesian(parts) {
    // parts: Array<Array<row>>; returns Array<row> combining one row from each part
    return parts.reduce(
        (acc, part) => {
            const next = [];
            for (const a of acc) {
                for (const b of part) {
                    next.push({ ...a, ...b });
                }
            }
            return next;
        },
        [{}]
    );
}

function processSelection(selection, node, variables, fhirPathEvaluator) {
    let foci;
    if (selection.forEach) {
        foci = fhirPathEvaluator.evaluate({ node, expression: selection.forEach, variables });
    } else if (selection.forEachOrNull) {
        foci = fhirPathEvaluator.evaluate({ node, expression: selection.forEachOrNull, variables });
    } else {
        foci = [node];
    }

    if (foci.length === 0 && selection.forEachOrNull) {
        // emit a single row with nulls for this selection's own columns
        const nullRow = {};
        for (const col of selection.column || []) {
            nullRow[col.name] = col.collection ? [] : null;
        }
        return [nullRow];
    }

    const rows = [];
    for (const focus of foci) {
        const parts = [];

        if (selection.column && selection.column.length > 0) {
            const colRow = {};
            for (const col of selection.column) {
                colRow[col.name] = columnValue(col, focus, variables, fhirPathEvaluator);
            }
            parts.push([colRow]);
        }

        for (const nested of selection.select || []) {
            parts.push(processSelection(nested, focus, variables, fhirPathEvaluator));
        }

        if (Array.isArray(selection.unionAll) && selection.unionAll.length > 0) {
            const unionRows = [];
            for (const branch of selection.unionAll) {
                unionRows.push(...processSelection(branch, focus, variables, fhirPathEvaluator));
            }
            parts.push(unionRows);
        }

        rows.push(...cartesian(parts));
    }
    return rows;
}

/**
 * @param {Object} view ViewDefinition
 * @param {AsyncIterable<Object>|Iterable<Object>} resourceIterable
 * @param {{ fhirPathEvaluator: import('../../utils/fhirPathEvaluator').FhirPathEvaluator }} deps
 * @returns {AsyncGenerator<Object>} rows
 */
async function *runView(view, resourceIterable, { fhirPathEvaluator }) {
    const variables = buildConstants(view, fhirPathEvaluator);
    for await (const resource of resourceIterable) {
        // where gate: every clause must evaluate to a single boolean true
        let included = true;
        for (const clause of view.where || []) {
            const r = fhirPathEvaluator.evaluate({ node: resource, expression: clause.path, variables });
            if (!(r.length === 1 && r[0] === true)) {
                included = false;
                break;
            }
        }
        if (!included) {
            continue;
        }
        const topRows = cartesian(
            (view.select || []).map((s) => processSelection(s, resource, variables, fhirPathEvaluator))
        );
        for (const row of topRows) {
            yield row;
        }
    }
}

module.exports = { runView };
```

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewRunner.test.js -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the conformance test over vendored fixtures**

Create `src/tests/sqlOnFhir/viewRunner.conformance.test.js`:
```javascript
const fs = require('fs');
const path = require('path');
const { runView } = require('../../operations/sqlOnFhir/viewRunner');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

const fhirPathEvaluator = new FhirPathEvaluator();
const fixturesDir = path.join(__dirname, 'fixtures');

async function collect(view, resources) {
    const rows = [];
    for await (const row of runView(view, resources, { fhirPathEvaluator })) {
        rows.push(row);
    }
    return rows;
}

const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

describe('SQL-on-FHIR v2 conformance fixtures', () => {
    for (const file of files) {
        const suite = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
        describe(file, () => {
            for (const t of suite.tests) {
                // Some official cases assert errors; those are covered by unit tests. Skip and log here.
                const runner = t.expect ? test : test.skip;
                runner(t.title, async () => {
                    const rows = await collect(t.view, suite.resources);
                    expect(rows).toEqual(t.expect);
                });
            }
        });
    }
});
```

- [ ] **Step 7: Run the conformance test**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewRunner.conformance.test.js -v`
Expected: PASS for the vendored cases. Any failure is either an evaluator gap (fix `FhirPathEvaluator`) or an engine gap (fix `viewRunner.js`) — do not edit the fixtures. Document any case intentionally skipped.

- [ ] **Step 8: Commit**

```bash
git add src/operations/sqlOnFhir/viewRunner.js src/tests/sqlOnFhir/viewRunner.test.js src/tests/sqlOnFhir/viewRunner.conformance.test.js src/tests/sqlOnFhir/fixtures
git commit -m "feat(sql-on-fhir): add streaming ViewRunner engine + conformance fixtures"
```

---

## Task 5: Row writers (NDJSON + CSV)

**Files:**
- Create: `src/operations/sqlOnFhir/rowNdJsonWriter.js`
- Create: `src/operations/sqlOnFhir/rowCsvWriter.js`
- Test: `src/tests/sqlOnFhir/rowWriters.test.js`

**Interfaces:**
- Produces:
  - `class RowNdJsonWriter extends stream.Transform` — objectMode in, `JSON.stringify(row)+'\n'` out.
  - `class RowCsvWriter extends stream.Transform` — objectMode in; constructor `{ columns }` (ordered column names for the header); emits a header line then one CSV line per row; `collection:true`/array/object cells are `JSON.stringify`-encoded (D3).

- [ ] **Step 1: Write the failing test**

Create `src/tests/sqlOnFhir/rowWriters.test.js`:
```javascript
const { Readable } = require('stream');
const { RowNdJsonWriter } = require('../../operations/sqlOnFhir/rowNdJsonWriter');
const { RowCsvWriter } = require('../../operations/sqlOnFhir/rowCsvWriter');

async function drain(rows, writer) {
    let out = '';
    const src = Readable.from(rows);
    writer.on('data', (c) => (out += c.toString()));
    src.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('end', resolve);
        writer.on('error', reject);
    });
    return out;
}

describe('row writers', () => {
    test('NDJSON writes one JSON object per line', async () => {
        const out = await drain([{ id: 'p1' }, { id: 'p2' }], new RowNdJsonWriter());
        expect(out).toBe('{"id":"p1"}\n{"id":"p2"}\n');
    });

    test('CSV writes header then rows, JSON-encoding array cells', async () => {
        const out = await drain(
            [{ id: 'p1', given: ['Jane', 'Q'] }, { id: 'p2', given: [] }],
            new RowCsvWriter({ columns: ['id', 'given'] })
        );
        expect(out.split('\n')[0]).toBe('id,given');
        expect(out).toContain('p1,"[""Jane"",""Q""]"');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/rowWriters.test.js -v`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the NDJSON writer**

Create `src/operations/sqlOnFhir/rowNdJsonWriter.js`:
```javascript
const { Transform } = require('stream');

class RowNdJsonWriter extends Transform {
    constructor(options = {}) {
        super({ ...options, writableObjectMode: true, readableObjectMode: false });
    }

    _transform(row, _encoding, callback) {
        try {
            this.push(JSON.stringify(row) + '\n');
            callback();
        } catch (err) {
            callback(err);
        }
    }
}

module.exports = { RowNdJsonWriter };
```

- [ ] **Step 4: Implement the CSV writer**

Create `src/operations/sqlOnFhir/rowCsvWriter.js` (encode array/object cells to a JSON string so `@json2csv` treats them as scalars — satisfies D3):
```javascript
const { Transform } = require('@json2csv/node');

class RowCsvWriter extends Transform {
    /**
     * @param {{ columns: string[] }} params ordered column names for header + field order
     */
    constructor({ columns }) {
        super(
            { fields: columns },
            {},
            { objectMode: true }
        );
        this._columns = columns;
    }

    _transform(row, encoding, done) {
        const encoded = {};
        for (const key of this._columns) {
            const value = row[key];
            encoded[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
        }
        return super._transform(encoded, encoding, done);
    }
}

module.exports = { RowCsvWriter };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/rowWriters.test.js -v`
Expected: PASS (2 tests). If `@json2csv/node`'s `Transform` constructor signature differs, match how `src/operations/streaming/resourceWriters/fhirResourceCsvWriter.js` calls `super(opts, asyncOpts, transformOpts)`.

- [ ] **Step 6: Commit**

```bash
git add src/operations/sqlOnFhir/rowNdJsonWriter.js src/operations/sqlOnFhir/rowCsvWriter.js src/tests/sqlOnFhir/rowWriters.test.js
git commit -m "feat(sql-on-fhir): add NDJSON and CSV row writers"
```

---

## Task 6: `ViewResolver` (request → view + inline resources)

**Files:**
- Create: `src/operations/sqlOnFhir/viewResolver.js`
- Test: `src/tests/sqlOnFhir/viewResolver.test.js`

**Interfaces:**
- Produces: `class ViewResolver` with `resolve({ body }) => { view, inlineResources }`.
  - `body` is the request body — a FHIR `Parameters` resource. Extracts the `viewResource` parameter (`.resource`) as `view`, and all `resource` parameters (`.resource`) as `inlineResources` (array, possibly empty).
  - If `body.resourceType === 'ViewDefinition'`, treat the whole body as `view` with no inline resources (convenience form).
  - Throws `BadRequestError` if no view can be found.

- [ ] **Step 1: Write the failing test**

Create `src/tests/sqlOnFhir/viewResolver.test.js`:
```javascript
const { ViewResolver } = require('../../operations/sqlOnFhir/viewResolver');

describe('ViewResolver', () => {
    const resolver = new ViewResolver();
    const view = { resourceType: 'ViewDefinition', resource: 'Patient', select: [{ column: [{ name: 'id', path: 'id' }] }] };

    test('extracts view + inline resources from Parameters', () => {
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p2' } }
            ]
        };
        const { view: v, inlineResources } = resolver.resolve({ body });
        expect(v.resource).toBe('Patient');
        expect(inlineResources.map((r) => r.id)).toEqual(['p1', 'p2']);
    });

    test('accepts a bare ViewDefinition body', () => {
        const { view: v, inlineResources } = resolver.resolve({ body: view });
        expect(v.resource).toBe('Patient');
        expect(inlineResources).toEqual([]);
    });

    test('throws when no view present', () => {
        expect(() => resolver.resolve({ body: { resourceType: 'Parameters', parameter: [] } })).toThrow(/view/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewResolver.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/operations/sqlOnFhir/viewResolver.js`:
```javascript
const { BadRequestError } = require('../../utils/httpErrors');

class ViewResolver {
    /**
     * Phase 1: inline only. Later phases add stored lookup by id/url behind this same method.
     * @param {{ body: Object }} params
     * @returns {{ view: Object, inlineResources: Object[] }}
     */
    resolve({ body }) {
        if (body && body.resourceType === 'ViewDefinition') {
            return { view: body, inlineResources: [] };
        }
        if (body && body.resourceType === 'Parameters' && Array.isArray(body.parameter)) {
            const viewParam = body.parameter.find((p) => p.name === 'viewResource');
            const view = viewParam && viewParam.resource;
            const inlineResources = body.parameter
                .filter((p) => p.name === 'resource' && p.resource)
                .map((p) => p.resource);
            if (!view) {
                throw new BadRequestError(new Error('$run requires a "viewResource" parameter containing a ViewDefinition'));
            }
            return { view, inlineResources };
        }
        throw new BadRequestError(new Error('$run requires a Parameters body with a viewResource, or a ViewDefinition body'));
    }
}

module.exports = { ViewResolver };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/viewResolver.test.js -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operations/sqlOnFhir/viewResolver.js src/tests/sqlOnFhir/viewResolver.test.js
git commit -m "feat(sql-on-fhir): add ViewResolver (inline view + resources)"
```

---

## Task 7: `SqlOnFhirRunOperation` orchestrator

**Files:**
- Create: `src/operations/sqlOnFhir/sqlOnFhirRunOperation.js`
- Test: `src/tests/sqlOnFhir/sqlOnFhirRunOperation.test.js`

**Interfaces:**
- Consumes: `ViewResolver`, `ViewDefinitionValidator`, `FhirPathEvaluator`, `runView`, `RowNdJsonWriter`, `RowCsvWriter`, and (for stored) `searchManager` + `databaseQueryFactory` + `configManager`.
- Produces: `class SqlOnFhirRunOperation` with:
  - `async runAsync({ requestInfo, parsedArgs, body, resourceType, res })` — resolves + validates the view, builds the resource source (inline or secured stored cursor), runs `runView`, and pipes rows through the chosen writer to `res`. Returns `undefined` (response written directly).
  - `_resourceSource({ view, inlineResources, requestInfo, parsedArgs })` — returns an async iterable of resources. Stored path calls `searchManager.constructQueryAsync(...)` then iterates a `DatabaseCursor`. Applies guardrail D2.
  - `_columnNames(view)` — ordered, de-duplicated column names for the CSV header.

- [ ] **Step 1: Write the failing test (inline path + guardrail, with a fake searchManager)**

Create `src/tests/sqlOnFhir/sqlOnFhirRunOperation.test.js`:
```javascript
const { Writable } = require('stream');
const { SqlOnFhirRunOperation } = require('../../operations/sqlOnFhir/sqlOnFhirRunOperation');
const { ViewResolver } = require('../../operations/sqlOnFhir/viewResolver');
const { ViewDefinitionValidator } = require('../../operations/sqlOnFhir/viewDefinitionValidator');
const { FhirPathEvaluator } = require('../../utils/fhirPathEvaluator');

function fakeRes() {
    const res = new Writable({
        write(chunk, enc, cb) {
            res._body += chunk.toString();
            cb();
        }
    });
    res._body = '';
    res.headers = {};
    res.setHeader = (k, v) => (res.headers[k] = v);
    res.status = (c) => {
        res.statusCode = c;
        return res;
    };
    return res;
}

function makeOperation() {
    return new SqlOnFhirRunOperation({
        viewResolver: new ViewResolver(),
        viewDefinitionValidator: new ViewDefinitionValidator(),
        fhirPathEvaluator: new FhirPathEvaluator(),
        searchManager: { constructQueryAsync: async () => ({ query: {} }) },
        databaseQueryFactory: {},
        configManager: {}
    });
}

const view = {
    resourceType: 'ViewDefinition',
    resource: 'Patient',
    select: [{ column: [{ name: 'id', path: 'getResourceKey()' }] }]
};

describe('SqlOnFhirRunOperation (inline)', () => {
    test('streams NDJSON rows from inline resources', async () => {
        const op = makeOperation();
        const res = fakeRes();
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } }
            ]
        };
        await op.runAsync({
            requestInfo: { accept: ['application/x-ndjson'] },
            parsedArgs: {},
            body,
            resourceType: 'Patient',
            res
        });
        expect(res._body).toBe('{"id":"p1"}\n');
        expect(res.headers['Content-Type']).toMatch(/ndjson/);
    });

    test('rejects an invalid view with 400 before streaming', async () => {
        const op = makeOperation();
        const res = fakeRes();
        const badView = { resourceType: 'ViewDefinition', select: [] }; // no resource
        await expect(
            op.runAsync({
                requestInfo: { accept: ['application/x-ndjson'] },
                parsedArgs: {},
                body: { resourceType: 'ViewDefinition', ...badView },
                resourceType: 'Patient',
                res
            })
        ).rejects.toThrow(/resource/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/sqlOnFhirRunOperation.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `src/operations/sqlOnFhir/sqlOnFhirRunOperation.js`:
```javascript
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { runView } = require('./viewRunner');
const { RowNdJsonWriter } = require('./rowNdJsonWriter');
const { RowCsvWriter } = require('./rowCsvWriter');
const { BadRequestError } = require('../../utils/httpErrors');

class SqlOnFhirRunOperation {
    /**
     * @param {Object} deps
     * @param {import('./viewResolver').ViewResolver} deps.viewResolver
     * @param {import('./viewDefinitionValidator').ViewDefinitionValidator} deps.viewDefinitionValidator
     * @param {import('../../utils/fhirPathEvaluator').FhirPathEvaluator} deps.fhirPathEvaluator
     * @param {Object} deps.searchManager MUST expose constructQueryAsync (authorization gate)
     * @param {Object} deps.databaseQueryFactory
     * @param {Object} deps.configManager
     */
    constructor({ viewResolver, viewDefinitionValidator, fhirPathEvaluator, searchManager, databaseQueryFactory, configManager }) {
        this.viewResolver = viewResolver;
        this.viewDefinitionValidator = viewDefinitionValidator;
        this.fhirPathEvaluator = fhirPathEvaluator;
        this.searchManager = searchManager;
        this.databaseQueryFactory = databaseQueryFactory;
        this.configManager = configManager;
    }

    async runAsync({ requestInfo, parsedArgs, body, resourceType, res }) {
        const { view, inlineResources } = this.viewResolver.resolve({ body });
        this.viewDefinitionValidator.validate(view);

        const wantsCsv = (requestInfo.accept || []).some((a) => String(a).includes('csv'));
        const columns = this._columnNames(view);

        // headers must be set before any bytes are written
        res.setHeader('Content-Type', wantsCsv ? 'text/csv' : 'application/x-ndjson');

        const source = await this._resourceSource({ view, inlineResources, requestInfo, parsedArgs });
        const rows = runView(view, source, { fhirPathEvaluator: this.fhirPathEvaluator });
        const writer = wantsCsv ? new RowCsvWriter({ columns }) : new RowNdJsonWriter();

        await pipeline(Readable.from(rows), writer, res);
        return undefined;
    }

    async _resourceSource({ view, inlineResources, requestInfo, parsedArgs }) {
        if (inlineResources && inlineResources.length > 0) {
            return inlineResources;
        }
        // stored path — guardrail D2: require a filter or an explicit _count
        const hasFilter =
            parsedArgs &&
            Object.keys(parsedArgs).some(
                (k) => !['base_version', 'resourceType', '_format', '_type'].includes(k)
            );
        if (!hasFilter) {
            throw new BadRequestError(
                new Error('stored $run requires a filter (e.g. patient, _lastUpdated) or an explicit _count')
            );
        }

        // AUTHORIZATION GATE — never bypass this for stored resources
        const { query } = await this.searchManager.constructQueryAsync({
            user: requestInfo.user,
            scope: requestInfo.scope,
            isUser: requestInfo.isUser,
            userType: requestInfo.userType,
            resourceType: view.resource,
            useAccessIndex: this.configManager.useAccessIndex,
            personIdFromJwtToken: requestInfo.personIdFromJwtToken,
            requestId: requestInfo.requestId,
            parsedArgs,
            operation: 'READ',
            actor: requestInfo.actor
        });

        const databaseQueryManager = this.databaseQueryFactory.createQuery({
            resourceType: view.resource,
            base_version: '4_0_0'
        });
        const maxTimeMS = (this.configManager.sqlOnFhirMaxTimeMS) || 30000;
        const cursor = await databaseQueryManager.findAsync({ query, options: { maxTimeMS } });

        async function *iterate() {
            while (await cursor.hasNext()) {
                yield await cursor.next();
            }
        }
        return iterate();
    }

    _columnNames(view) {
        const names = [];
        const seen = new Set();
        const walk = (selections) => {
            for (const s of selections || []) {
                for (const c of s.column || []) {
                    if (!seen.has(c.name)) {
                        seen.add(c.name);
                        names.push(c.name);
                    }
                }
                walk(s.select);
                for (const b of s.unionAll || []) {
                    walk([b]);
                }
            }
        };
        walk(view.select);
        return names;
    }
}

module.exports = { SqlOnFhirRunOperation };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/sqlOnFhirRunOperation.test.js -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/operations/sqlOnFhir/sqlOnFhirRunOperation.js src/tests/sqlOnFhir/sqlOnFhirRunOperation.test.js
git commit -m "feat(sql-on-fhir): add SqlOnFhirRunOperation orchestrator with secured stored source + guardrail"
```

---

## Task 8: Container registration + `FhirOperationsManager.run`

**Files:**
- Modify: `src/createContainer.js`
- Modify: `src/operations/fhirOperationsManager.js`

**Interfaces:**
- Consumes: all services from Tasks 1–7.
- Produces: `fhirOperationsManager.run(args, { req, res }, resourceType)` reachable by the router with operation name `run`.

- [ ] **Step 1: Register services in the container**

In `src/createContainer.js`, add registrations near the other operations (mirror the `everythingOperation` block):
```javascript
container.register('fhirPathEvaluator', () => {
    const { FhirPathEvaluator } = require('./utils/fhirPathEvaluator');
    return new FhirPathEvaluator();
});
container.register('viewResolver', () => {
    const { ViewResolver } = require('./operations/sqlOnFhir/viewResolver');
    return new ViewResolver();
});
container.register('viewDefinitionValidator', () => {
    const { ViewDefinitionValidator } = require('./operations/sqlOnFhir/viewDefinitionValidator');
    return new ViewDefinitionValidator();
});
container.register('sqlOnFhirRunOperation', (c) => {
    const { SqlOnFhirRunOperation } = require('./operations/sqlOnFhir/sqlOnFhirRunOperation');
    return new SqlOnFhirRunOperation({
        viewResolver: c.viewResolver,
        viewDefinitionValidator: c.viewDefinitionValidator,
        fhirPathEvaluator: c.fhirPathEvaluator,
        searchManager: c.searchManager,
        databaseQueryFactory: c.databaseQueryFactory,
        configManager: c.configManager
    });
});
```
(Confirm the exact container names `searchManager`, `databaseQueryFactory`, `configManager` by grepping existing `container.register(` calls — they are registered elsewhere in this file.)

- [ ] **Step 2: Inject the operation into `fhirOperationsManager`**

In `src/createContainer.js`, add to the `fhirOperationsManager` registration object (the block at ~lines 968-998):
```javascript
            sqlOnFhirRunOperation: c.sqlOnFhirRunOperation,
```

- [ ] **Step 3: Add the constructor param + `run` method**

In `src/operations/fhirOperationsManager.js`, add `sqlOnFhirRunOperation` to the constructor destructuring (near `exportOperation`) and store it:
```javascript
        this.sqlOnFhirRunOperation = sqlOnFhirRunOperation;
        assertTypeEquals(sqlOnFhirRunOperation, SqlOnFhirRunOperation);
```
(Match the existing `assertTypeEquals` convention used for other operations; add the `require` for `SqlOnFhirRunOperation` at the top alongside the other operation requires. If a given operation is not asserted, follow that lighter pattern instead.)

Then add the method (mirror `everything`’s streaming structure, but the operation owns the response writing):
```javascript
    async run(args, { req, res }, resourceType) {
        const requestInfo = this.getRequestInfo(req);
        this.accessManager.verifyAccess({ requestInfo, resourceType: resourceType || 'ViewDefinition', operation: 'run' });

        let combined_args = get_all_args(req, args);
        combined_args = this.parseParametersFromBody({ req, combined_args });

        // The view's target resourceType drives arg parsing for the stored path.
        const { ViewResolver } = require('./sqlOnFhir/viewResolver');
        const { view } = new ViewResolver().resolve({ body: req.body });
        const targetResourceType = view.resource;

        const parsedArgs = await this.getParsedArgsAsync({
            args: combined_args,
            resourceType: targetResourceType,
            headers: req.headers,
            operation: READ,
            requestInfo
        });

        return await this.sqlOnFhirRunOperation.runAsync({
            requestInfo,
            parsedArgs,
            body: req.body,
            resourceType: targetResourceType,
            res
        });
    }
```
(`READ`, `get_all_args`, `getRequestInfo`, `getParsedArgsAsync`, `parseParametersFromBody` are already imported/defined in this file — reuse them.)

- [ ] **Step 4: Run the full suite to confirm nothing regressed**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir -v`
Expected: PASS (all sql-on-fhir unit tests). Also run a quick container smoke check:
Run: `nvm use && node -e "require('./src/createContainer').createContainer()" && echo OK`
Expected: `OK` (container builds without a missing-registration error).

- [ ] **Step 5: Commit**

```bash
git add src/createContainer.js src/operations/fhirOperationsManager.js
git commit -m "feat(sql-on-fhir): register \$run services and add FhirOperationsManager.run"
```

---

## Task 9: Routes + end-to-end HTTP integration test

**Files:**
- Create: `src/middleware/fhir/sqlOnFhir/sqlOnFhir.config.js`
- Modify: `src/middleware/fhir/router.js`
- Test: `src/tests/sqlOnFhir/run.integration.test.js`

**Interfaces:**
- Consumes: `fhirOperationsManager.run` (Task 8), operation name `run`.
- Produces: live routes `POST /:base_version/$run` and `POST /:base_version/ViewDefinition/$run`.

- [ ] **Step 1: Write the failing integration test**

Create `src/tests/sqlOnFhir/run.integration.test.js` (follow an existing operation integration test — e.g. under `src/tests/` for `$everything`/`$export` — for the exact `createTestRequest`/`getTestContainer` helpers and auth headers):
```javascript
const { commonBeforeEach, commonAfterEach, createTestRequest, getHeaders } = require('../common');

describe('$run integration', () => {
    beforeEach(async () => await commonBeforeEach());
    afterEach(async () => await commonAfterEach());

    const view = {
        resourceType: 'ViewDefinition',
        resource: 'Patient',
        status: 'active',
        select: [{ column: [{ name: 'id', path: 'getResourceKey()' }, { name: 'family', path: 'name.family.first()' }] }]
    };

    test('projects inline resources to NDJSON rows', async () => {
        const request = await createTestRequest();
        const body = {
            resourceType: 'Parameters',
            parameter: [
                { name: 'viewResource', resource: view },
                { name: 'resource', resource: { resourceType: 'Patient', id: 'p1', name: [{ family: 'Smith' }] } }
            ]
        };
        const resp = await request
            .post('/4_0_0/ViewDefinition/$run')
            .set({ ...getHeaders(), Accept: 'application/x-ndjson' })
            .send(body);
        expect(resp.status).toBe(200);
        expect(resp.text.trim()).toBe('{"id":"p1","family":"Smith"}');
    });
});
```
(Import paths/helpers must match this repo’s conventions — copy them from a neighbouring integration test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/run.integration.test.js -v`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Create the route config**

Create `src/middleware/fhir/sqlOnFhir/sqlOnFhir.config.js` (mirror `export.config.js`):
```javascript
const { routeArgs } = require('../route.config.js');
const { VERSIONS } = require('../utils/constants.js');

const routes = [
    {
        path: '/:base_version/$run',
        method: 'POST',
        corsOptions: { methods: ['POST'] },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'run'
    },
    {
        path: '/:base_version/ViewDefinition/$run',
        method: 'POST',
        corsOptions: { methods: ['POST'] },
        args: [routeArgs.BASE],
        versions: [VERSIONS['4_0_0']],
        operation: 'run'
    }
];

module.exports = { routes };
```

- [ ] **Step 4: Register the routes in the router**

In `src/middleware/fhir/router.js`: add the require near the other config requires:
```javascript
const { routes: sqlOnFhirConfig } = require('./sqlOnFhir/sqlOnFhir.config');
```
Add a method mirroring `enableExportRoutes` (without the `ENABLE_BULK_EXPORT` gate):
```javascript
    enableSqlOnFhirRoutes (app, config, corsDefaults) {
        for (const profile of sqlOnFhirConfig) {
            const operationName = profile.operation;
            const corsOptions = Object.assign({}, corsDefaults, profile.corsOptions);
            const operationsControllerRouteHandler = this.customOperationsController.operationsPost({
                name: operationName
            });
            app.options(profile.path, cors(corsOptions));
            app[profile.method.toLowerCase()](
                profile.path,
                cors(corsOptions),
                versionValidationMiddleware(profile),
                getArgsMiddleware(),
                authenticationMiddleware(config),
                sofScopeMiddleware({ route: profile.path, auth: config.auth, name: operationName }),
                operationsControllerRouteHandler
            );
        }
    }
```
Call it in `setRoutes` next to `this.enableExportRoutes(app, config, corsDefaults);`:
```javascript
        this.enableSqlOnFhirRoutes(app, config, corsDefaults);
```
Confirm that `customOperationsController.operationsPost` dispatches by matching the operation name to a `fhirOperationsManager` method — i.e. `run` → `fhirOperationsManager.run`. If dispatch uses an explicit allow-list/map, add `run` there.

- [ ] **Step 5: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/run.integration.test.js -v`
Expected: PASS.

- [ ] **Step 6: Run the whole sql-on-fhir suite + lint**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir -v && make lint`
Expected: all PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/middleware/fhir/sqlOnFhir/sqlOnFhir.config.js src/middleware/fhir/router.js src/tests/sqlOnFhir/run.integration.test.js
git commit -m "feat(sql-on-fhir): expose \$run routes and add end-to-end integration test"
```

---

## Task 10: Stored-path security integration test

**Files:**
- Test: `src/tests/sqlOnFhir/run.security.integration.test.js`

**Interfaces:**
- Consumes: the live `$run` route (Task 9).

- [ ] **Step 1: Write the security test**

Create `src/tests/sqlOnFhir/run.security.integration.test.js`. Seed two Patients with different `meta.security` access tags (or owner tags) matching this repo's access model. Issue `$run` (no inline `resource`, with a filter so the guardrail passes) under a token scoped to only ONE of them. Assert:
- the response contains ONLY the in-scope patient's row,
- an unfiltered stored `$run` returns 400 (guardrail D2),
- a request with no read scope for the target resourceType returns 403.

Copy the access-tag seeding + header/scope helpers verbatim from an existing search-security integration test in `src/tests/` (search for a test that asserts scope-based filtering) so the security model matches exactly.

```javascript
// Structure (fill seeding/headers from an existing search-security test):
// 1. create Patient A (access tag X) and Patient B (access tag Y)
// 2. POST /4_0_0/ViewDefinition/$run with a filtered view under a token with access to X only
// 3. expect(resp.text) to include A's id and NOT B's id
// 4. POST unfiltered stored $run -> expect 400
// 5. POST with a token lacking Patient read scope -> expect 403
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir/run.security.integration.test.js -v`
Expected: initially FAIL if any wiring is off; once green, the secured stored path is proven. If the scope-filtering assertion fails, the bug is that `_resourceSource` is not routing through `searchManager.constructQueryAsync` — fix the operation, never loosen the test.

- [ ] **Step 3: Commit**

```bash
git add src/tests/sqlOnFhir/run.security.integration.test.js
git commit -m "test(sql-on-fhir): assert \$run stored path enforces search authorization"
```

---

## Final verification

- [ ] Run the full sql-on-fhir suite: `nvm use && node node_modules/.bin/jest src/tests/sqlOnFhir -v` → all PASS.
- [ ] Run lint: `make lint` → clean.
- [ ] Manual smoke (optional): `make up`, then `POST /4_0_0/ViewDefinition/$run` with a Parameters body containing `viewResource` + a few `resource` entries; confirm NDJSON and (with `Accept: text/csv`) CSV output.

---

## Notes for the implementer

- **Do not bypass `searchManager.constructQueryAsync`** for stored resources. It is the single authorization gate (`src/operations/search/searchManager.js:189`). If it needs a parameter you don't have on `requestInfo`, get it the way `everything`/`search` do — don't invent a raw query.
- **The conformance fixtures are the source of truth** for engine/evaluator correctness. When a fixture fails, fix `viewRunner.js` or `fhirPathEvaluator.js`, never the fixture.
- **`fhirpath` version:** if the pinned version already ships `getResourceKey`/`getReferenceKey`, the `userInvocationTable` entries may collide — prefer the library's built-ins and delete the custom entries if the conformance suite passes without them.
- **Exact container service names** (`searchManager`, `databaseQueryFactory`, `configManager`): verify by grepping `container.register(` in `src/createContainer.js` before wiring Task 8.