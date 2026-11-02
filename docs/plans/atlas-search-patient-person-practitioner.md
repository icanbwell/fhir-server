# Atlas Search for Patient/Person/Practitioner Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the name/identifier/gender/birthDate/telecom subset of Patient/Person/Practitioner
searches through the MongoDB Atlas `$search` index (`hybrid-full-text-search`) that
`person-matching-service` already maintains on these collections, gated per resource type by new
env vars, with automatic fallback to the existing regex-based path for anything not representable
in the index and on any Atlas error.

**Architecture:** A new pure-logic class, `AtlasSearchQueryBuilder`, inspects a request's parsed
FHIR search args and either returns an Atlas `compound` document (when every supplied parameter
maps onto the index) or `null` (signal to use the existing path unchanged). `SearchManager` calls
it once per request; when non-null, `getCursorForQueryAsync` runs `[$search, $match, $sort, $skip,
$limit, $project]` via the existing `DatabaseQueryManager.findUsingAggregationAsync` /
`matchQueryProvided` escape hatch instead of `collection.find()`. The `$match` stage is always the
exact same tenant/access-tag filter document `constructQueryAsync` already produces today — no new
authorization logic.

**Tech Stack:** Node.js / Express, MongoDB (Atlas `$search` aggregation stage), Jest.

**Spec:** `docs/adr/0003-atlas-search-for-patient-person-practitioner-lookup.md`

## Global Constraints

- Enablement is per resource type, default **off**: `ATLAS_SEARCH_ENABLED_PATIENT`,
  `ATLAS_SEARCH_ENABLED_PERSON`, `ATLAS_SEARCH_ENABLED_PRACTITIONER` (read via the existing
  `isTrue()` helper).
- Applies transparently to all eligible queries once a resource type's flag is on — no
  per-request opt-in.
- The compound builder must preserve FHIR AND/OR search semantics: every *distinct* supplied
  search parameter becomes a required (`must`) clause; only repeated/comma-separated values of
  the *same* parameter become a nested `should` (OR). Never put multiple distinct parameters into
  one `should` group — that would silently turn an AND query into an OR query.
- v1 eligibility is a strict allow-list, not a deny-list: any parsed search parameter not
  explicitly recognized (including `_id`, bare `name`, `phonetic`, any `address*` param, and any
  modifier such as `:exact`/`:contains`/`:missing`/`:not`) disqualifies the request from the Atlas
  path and it falls back to the existing query builder unchanged. Never silently drop a filter
  condition.
- The `$match` stage in the Atlas pipeline must be byte-for-byte the same query document
  `constructQueryAsync` already builds today (tenant/access-tag filtering) — this is what keeps
  `review.md` §A's requirement satisfied: the new path reuses the existing shared tenant-scoping
  mechanism rather than building an independent one.
- Any Mongo error running the `$search` pipeline (index missing, `INITIAL_SYNC`, etc.) falls back
  to the standard `find()` path for that request, logged, never surfaced to the caller as an error.
- No GraphQL-specific code needed — both `src/graphql/dataSource.js` and
  `src/graphqlv2/dataSource.js` delegate through `SearchBundleOperation.searchBundleAsync` to the
  same `SearchManager` methods this plan modifies.

---

## Task 1: `ConfigManager.isAtlasSearchEnabled(resourceType)`

**Files:**
- Modify: `src/utils/configManager.js:97` (add new method right after `accessTagsIndexed`)
- Test: `src/tests/unit/utils/configManager.test.js`

**Interfaces:**
- Produces: `ConfigManager.isAtlasSearchEnabled(resourceType: string): boolean` — later tasks call
  this exact method name/signature.

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/unit/utils/configManager.test.js` (inside the existing `describe('ConfigManager', ...)` block, using the file's existing `setEnv` helper):

```javascript
describe('isAtlasSearchEnabled', () => {
    test('returns false by default for Patient/Person/Practitioner', () => {
        expect(configManager.isAtlasSearchEnabled('Patient')).toBe(false);
        expect(configManager.isAtlasSearchEnabled('Person')).toBe(false);
        expect(configManager.isAtlasSearchEnabled('Practitioner')).toBe(false);
    });

    test('returns false for a resource type with no Atlas Search support', () => {
        setEnv('ATLAS_SEARCH_ENABLED_OBSERVATION', 'true');
        expect(configManager.isAtlasSearchEnabled('Observation')).toBe(false);
    });

    test('returns true only for the resource type whose env var is set', () => {
        setEnv('ATLAS_SEARCH_ENABLED_PATIENT', 'true');
        expect(configManager.isAtlasSearchEnabled('Patient')).toBe(true);
        expect(configManager.isAtlasSearchEnabled('Person')).toBe(false);
        expect(configManager.isAtlasSearchEnabled('Practitioner')).toBe(false);
    });

    test('supports Person and Practitioner independently', () => {
        setEnv('ATLAS_SEARCH_ENABLED_PERSON', 'true');
        setEnv('ATLAS_SEARCH_ENABLED_PRACTITIONER', '1');
        expect(configManager.isAtlasSearchEnabled('Person')).toBe(true);
        expect(configManager.isAtlasSearchEnabled('Practitioner')).toBe(true);
        expect(configManager.isAtlasSearchEnabled('Patient')).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js -t "isAtlasSearchEnabled"`
Expected: FAIL with `configManager.isAtlasSearchEnabled is not a function`

- [ ] **Step 3: Implement `isAtlasSearchEnabled`**

In `src/utils/configManager.js`, immediately after the closing brace of `accessTagsIndexed(resourceType) { ... }` (the method starting at line 97), add:

```javascript
    /**
     * Whether Patient/Person/Practitioner search should route eligible queries through the
     * MongoDB Atlas Search index (`hybrid-full-text-search`) instead of the regex-based path.
     * Gated per resource type; default false everywhere. See
     * docs/adr/0003-atlas-search-for-patient-person-practitioner-lookup.md
     * @param {string} resourceType
     * @returns {boolean}
     */
    isAtlasSearchEnabled(resourceType) {
        switch (resourceType) {
            case 'Patient':
                return isTrue(env.ATLAS_SEARCH_ENABLED_PATIENT);
            case 'Person':
                return isTrue(env.ATLAS_SEARCH_ENABLED_PERSON);
            case 'Practitioner':
                return isTrue(env.ATLAS_SEARCH_ENABLED_PRACTITIONER);
            default:
                return false;
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js -t "isAtlasSearchEnabled"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/configManager.js src/tests/unit/utils/configManager.test.js
git commit -m "Add ConfigManager.isAtlasSearchEnabled(resourceType)"
```

---

## Task 2: `AtlasSearchQueryBuilder` — eligibility check

**Files:**
- Create: `src/operations/search/atlasSearchQueryBuilder.js`
- Test: `src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`

**Interfaces:**
- Consumes: `ConfigManager.isAtlasSearchEnabled(resourceType)` (Task 1); `ParsedArgs.parsedArgItems`
  (each item has `.queryParameter: string`, `.modifiers: string[]`,
  `.queryParameterValue.values: string[]|null` — see `src/operations/query/parsedArgs.js`,
  `parsedArgsItem.js`, `queryParameterValue.js`).
- Produces: `AtlasSearchQueryBuilder.getEligibleParsedArgItemsOrNull({ resourceType, parsedArgs }): ParsedArgsItem[]|null` —
  Task 3 consumes this exact method.

This task builds only the eligibility gate (returns the filtered list of parsedArgItems, or
`null` to signal "fall back"). Task 3 turns an eligible list into the actual Atlas compound.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`:

```javascript
const { describe, test, expect, beforeEach } = require('@jest/globals');
const { AtlasSearchQueryBuilder } = require('../../../../operations/search/atlasSearchQueryBuilder');
const { ConfigManager } = require('../../../../utils/configManager');
const { ParsedArgs } = require('../../../../operations/query/parsedArgs');
const { ParsedArgsItem } = require('../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

function makeParsedArgs(items) {
    const parsedArgs = new ParsedArgs({ base_version: '4_0_0' });
    for (const { queryParameter, values, modifiers = [] } of items) {
        parsedArgs.add(new ParsedArgsItem({
            queryParameter,
            queryParameterValue: new QueryParameterValue({ value: values.join(',') }),
            propertyObj: undefined,
            modifiers,
            references: []
        }));
    }
    return parsedArgs;
}

describe('AtlasSearchQueryBuilder', () => {
    let configManager;
    let builder;

    beforeEach(() => {
        configManager = Object.create(ConfigManager.prototype);
        configManager.isAtlasSearchEnabled = () => true;
        builder = new AtlasSearchQueryBuilder({ configManager });
    });

    describe('getEligibleParsedArgItemsOrNull', () => {
        test('returns null when the resource type flag is disabled', () => {
            configManager.isAtlasSearchEnabled = () => false;
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('returns null for a resource type Atlas does not cover', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Observation', parsedArgs })).toBeNull();
        });

        test('returns the eligible items for a simple family+given query', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'given', values: ['John'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).toHaveLength(2);
            expect(result.map(r => r.queryParameter).sort()).toEqual(['family', 'given']);
        });

        test('ignores harmless pagination/system params', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: '_count', values: ['10'] },
                { queryParameter: '_sort', values: ['family'] },
                { queryParameter: '_total', values: ['accurate'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).toHaveLength(1);
            expect(result[0].queryParameter).toBe('family');
        });

        test('falls back (returns null) when _id is present', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: '_id', values: ['abc-123'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back for bare name, address, and phonetic params', () => {
            for (const queryParameter of ['name', 'address', 'address-city', 'phonetic']) {
                const parsedArgs = makeParsedArgs([{ queryParameter, values: ['Smith'] }]);
                expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
            }
        });

        test('falls back when any eligible param has a modifier', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'], modifiers: ['contains'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back for identifier with a system component (system|value)', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'identifier', values: ['http://hl7.org/fhir/sid/us-npi|1234567890'] }
            ]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Practitioner', parsedArgs })).toBeNull();
        });

        test('allows a plain-value identifier', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'identifier', values: ['1234567890'] }]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Practitioner', parsedArgs });
            expect(result).toHaveLength(1);
        });

        test('falls back for a birthdate with a comparator prefix', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'birthdate', values: ['ge2020-01-01'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('falls back for a partial-precision birthdate', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'birthdate', values: ['2020'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('allows a full-precision exact birthdate', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'birthdate', values: ['2020-01-15'] }]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs });
            expect(result).toHaveLength(1);
        });

        test('allows gender, telecom, email, phone', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'gender', values: ['male'] },
                { queryParameter: 'telecom', values: ['555-1234'] },
                { queryParameter: 'email', values: ['a@b.com'] },
                { queryParameter: 'phone', values: ['555-1234'] }
            ]);
            const result = builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Person', parsedArgs });
            expect(result).toHaveLength(4);
        });

        test('returns null when there are no eligible items at all', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: '_count', values: ['10'] }]);
            expect(builder.getEligibleParsedArgItemsOrNull({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`
Expected: FAIL with `Cannot find module '../../../../operations/search/atlasSearchQueryBuilder'`

- [ ] **Step 3: Implement the eligibility check**

Create `src/operations/search/atlasSearchQueryBuilder.js`:

```javascript
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');

/**
 * Name of the MongoDB Atlas Search index person-matching-service maintains on
 * Patient_4_0_0 / Person_4_0_0 / Practitioner_4_0_0. Not owned by this repo.
 * See docs/adr/0003-atlas-search-for-patient-person-practitioner-lookup.md
 */
const ATLAS_SEARCH_INDEX_NAME = 'hybrid-full-text-search';

const ATLAS_SEARCH_ELIGIBLE_RESOURCE_TYPES = ['Patient', 'Person', 'Practitioner'];

/** FHIR search parameter code -> Atlas Search field path, for fuzzy/prefix name matching */
const ATLAS_NAME_FIELDS = {
    family: 'name.family',
    given: 'name.given'
};

/** FHIR search parameter code -> Atlas Search field path, for exact token matching */
const ATLAS_TOKEN_FIELDS = {
    identifier: 'identifier.value',
    gender: 'gender'
};

/** FHIR search parameter codes handled as telecom lookups */
const ATLAS_TELECOM_PARAMS = ['telecom', 'email', 'phone'];

const ATLAS_DATE_FIELDS = {
    birthdate: 'birthDate'
};

/**
 * System/pagination search parameter codes that don't contribute to the Mongo filter and may
 * freely coexist with the Atlas Search path.
 */
const ATLAS_SEARCH_IGNORABLE_PARAMS = [
    '_sort', '_count', '_getpagesoffset', '_elements', '_total',
    '_cursorBatchSize', '_bundle', '_format', '_includeHidden',
    '_isGraphQLRequest', '_explain', '_debug', '_streamResponse'
];

/** Full-precision, no-comparator-prefix ISO date -- the only birthdate shape v1 supports */
const EXACT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

class AtlasSearchQueryBuilder {
    /**
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Returns the list of parsedArgItems that are representable in the Atlas Search index for
     * this resourceType, or null if the request should fall back to the standard query path --
     * either because the feature is disabled, or because some supplied search parameter (or
     * modifier) has no equivalent in the index. Never drops a filter condition silently: any
     * parameter not explicitly recognized disqualifies the whole request.
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {import('../query/parsedArgsItem').ParsedArgsItem[]|null}
     */
    getEligibleParsedArgItemsOrNull ({ resourceType, parsedArgs }) {
        if (!ATLAS_SEARCH_ELIGIBLE_RESOURCE_TYPES.includes(resourceType)) {
            return null;
        }
        if (!this.configManager.isAtlasSearchEnabled(resourceType)) {
            return null;
        }

        const eligibleItems = [];
        for (const parsedArg of parsedArgs.parsedArgItems) {
            const code = parsedArg.queryParameter;

            if (ATLAS_SEARCH_IGNORABLE_PARAMS.includes(code)) {
                continue;
            }

            const isNameField = code in ATLAS_NAME_FIELDS;
            const isTokenField = code in ATLAS_TOKEN_FIELDS;
            const isTelecomParam = ATLAS_TELECOM_PARAMS.includes(code);
            const isDateField = code in ATLAS_DATE_FIELDS;

            if (!isNameField && !isTokenField && !isTelecomParam && !isDateField) {
                // Any other parameter (_id, bare name, phonetic, address*, etc.) has no
                // representation in the Atlas index -- fall back rather than drop it.
                return null;
            }

            if (parsedArg.modifiers && parsedArg.modifiers.length > 0) {
                // v1 does not translate modifiers (:exact, :contains, :missing, :not, ...)
                return null;
            }

            const values = parsedArg.queryParameterValue && parsedArg.queryParameterValue.values;
            if (!values || values.length === 0) {
                continue;
            }

            if (code === 'identifier' && values.some(v => v.includes('|'))) {
                // v1 only supports plain-value identifier search (no system|value form) --
                // the index maps identifier.value only for Patient/Person.
                return null;
            }

            if (isDateField && !values.every(v => EXACT_DATE_REGEX.test(v))) {
                // v1 only supports a full-precision exact date -- no comparator prefixes
                // (ge/le/...) and no partial precision (YYYY, YYYY-MM), since the index maps
                // birthDate as an exact token, not a range-queryable date.
                return null;
            }

            eligibleItems.push(parsedArg);
        }

        return eligibleItems.length > 0 ? eligibleItems : null;
    }
}

module.exports = {
    AtlasSearchQueryBuilder,
    ATLAS_SEARCH_INDEX_NAME
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`
Expected: PASS (all tests in `getEligibleParsedArgItemsOrNull`)

- [ ] **Step 5: Commit**

```bash
git add src/operations/search/atlasSearchQueryBuilder.js src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js
git commit -m "Add AtlasSearchQueryBuilder eligibility check"
```

---

## Task 3: `AtlasSearchQueryBuilder` — compound builder + public API

**Files:**
- Modify: `src/operations/search/atlasSearchQueryBuilder.js`
- Test: `src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`

**Interfaces:**
- Consumes: `getEligibleParsedArgItemsOrNull` (Task 2).
- Produces: `AtlasSearchQueryBuilder.buildSearchQuery({ resourceType, parsedArgs }): { must: object[] } | null` —
  Task 5 (`SearchManager.constructQueryAsync`) calls this exact method; the returned object is the
  Atlas `compound` document (or `null`).

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`, inside the outer
`describe('AtlasSearchQueryBuilder', ...)` block:

```javascript
    describe('buildSearchQuery', () => {
        test('returns null when ineligible', () => {
            configManager.isAtlasSearchEnabled = () => false;
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            expect(builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs })).toBeNull();
        });

        test('builds a required fuzzy clause for a single family value', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith'] }]);
            const compound = builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs });
            expect(compound).toEqual({
                must: [
                    {
                        compound: {
                            should: [
                                { autocomplete: { path: 'name.family', query: 'Smith', fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                                { text: { path: 'name.family', query: 'Smith' } }
                            ],
                            minimumShouldMatch: 1
                        }
                    }
                ]
            });
        });

        test('AND-s across distinct parameters: family AND given each become their own must entry', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'family', values: ['Smith'] },
                { queryParameter: 'given', values: ['John'] }
            ]);
            const compound = builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs });
            expect(compound.must).toHaveLength(2);
            const familyClause = compound.must.find(
                m => m.compound.should[0].autocomplete.path === 'name.family'
            );
            const givenClause = compound.must.find(
                m => m.compound.should[0].autocomplete.path === 'name.given'
            );
            expect(familyClause.compound.should[0].autocomplete.query).toBe('Smith');
            expect(givenClause.compound.should[0].autocomplete.query).toBe('John');
        });

        test('OR-s repeated values of the SAME parameter inside a nested should', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'family', values: ['Smith', 'Jones'] }]);
            const compound = builder.buildSearchQuery({ resourceType: 'Patient', parsedArgs });
            expect(compound.must).toHaveLength(1);
            const outer = compound.must[0].compound;
            expect(outer.minimumShouldMatch).toBe(1);
            expect(outer.should).toHaveLength(2);
            expect(outer.should[0].compound.should[0].autocomplete.query).toBe('Smith');
            expect(outer.should[1].compound.should[0].autocomplete.query).toBe('Jones');
        });

        test('builds an exact equals clause for identifier/gender/birthdate', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'identifier', values: ['1234567890'] },
                { queryParameter: 'gender', values: ['male'] },
                { queryParameter: 'birthdate', values: ['2020-01-15'] }
            ]);
            const compound = builder.buildSearchQuery({ resourceType: 'Practitioner', parsedArgs });
            expect(compound.must).toEqual(
                expect.arrayContaining([
                    { equals: { path: 'identifier.value', value: '1234567890' } },
                    { equals: { path: 'gender', value: 'male' } },
                    { equals: { path: 'birthDate', value: '2020-01-15' } }
                ])
            );
        });

        test('builds a system+value clause for email and phone', () => {
            const parsedArgs = makeParsedArgs([
                { queryParameter: 'email', values: ['a@b.com'] },
                { queryParameter: 'phone', values: ['555-1234'] }
            ]);
            const compound = builder.buildSearchQuery({ resourceType: 'Person', parsedArgs });
            expect(compound.must).toEqual(
                expect.arrayContaining([
                    {
                        compound: {
                            must: [
                                { equals: { path: 'telecom.system', value: 'email' } },
                                { text: { path: 'telecom.value', query: 'a@b.com' } }
                            ]
                        }
                    },
                    {
                        compound: {
                            must: [
                                { equals: { path: 'telecom.system', value: 'phone' } },
                                { text: { path: 'telecom.value', query: '555-1234' } }
                            ]
                        }
                    }
                ])
            );
        });

        test('builds a bare telecom clause (any system) for the telecom parameter', () => {
            const parsedArgs = makeParsedArgs([{ queryParameter: 'telecom', values: ['555-1234'] }]);
            const compound = builder.buildSearchQuery({ resourceType: 'Person', parsedArgs });
            expect(compound.must).toEqual([
                { text: { path: 'telecom.value', query: '555-1234' } }
            ]);
        });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js -t "buildSearchQuery"`
Expected: FAIL with `builder.buildSearchQuery is not a function`

- [ ] **Step 3: Implement the compound builder**

In `src/operations/search/atlasSearchQueryBuilder.js`, add these methods to the
`AtlasSearchQueryBuilder` class (after `getEligibleParsedArgItemsOrNull`):

```javascript
    /**
     * Returns the Atlas Search `compound` document for this request, or null if the request
     * should fall back to the standard query path.
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {{must: object[]}|null}
     */
    buildSearchQuery ({ resourceType, parsedArgs }) {
        const eligibleItems = this.getEligibleParsedArgItemsOrNull({ resourceType, parsedArgs });
        if (!eligibleItems) {
            return null;
        }

        const must = [];
        for (const parsedArg of eligibleItems) {
            const code = parsedArg.queryParameter;
            const values = parsedArg.queryParameterValue.values;

            if (code in ATLAS_NAME_FIELDS) {
                const path = ATLAS_NAME_FIELDS[code];
                must.push(this._orClause(values, v => this._nameClause(path, v)));
            } else if (code in ATLAS_TOKEN_FIELDS) {
                const path = ATLAS_TOKEN_FIELDS[code];
                must.push(this._orClause(values, v => ({ equals: { path, value: v } })));
            } else if (code in ATLAS_DATE_FIELDS) {
                const path = ATLAS_DATE_FIELDS[code];
                must.push(this._orClause(values, v => ({ equals: { path, value: v } })));
            } else if (code === 'telecom') {
                must.push(this._orClause(values, v => ({ text: { path: 'telecom.value', query: v } })));
            } else if (code === 'email' || code === 'phone') {
                must.push(this._orClause(values, v => this._telecomSystemClause(code, v)));
            }
        }

        return { must };
    }

    /**
     * Wraps a per-value clause builder so that multiple values of the SAME parameter combine
     * with OR (nested should/minimumShouldMatch), while a single value contributes its clause
     * directly. Distinct parameters are never combined here -- each call to this method produces
     * exactly one `must` entry for one parameter.
     * @param {string[]} values
     * @param {function(string): object} clauseFn
     * @returns {object}
     */
    _orClause (values, clauseFn) {
        if (values.length === 1) {
            return clauseFn(values[0]);
        }
        return {
            compound: {
                should: values.map(clauseFn),
                minimumShouldMatch: 1
            }
        };
    }

    /**
     * Fuzzy/prefix name match: FHIR's default (no-modifier) string search is case-insensitive
     * prefix matching (see FilterByString / stringQueryBuilder) -- `autocomplete` is Atlas's
     * prefix+fuzzy operator, the direct semantic match. `text` is added for token-level recall.
     * @param {string} path
     * @param {string} value
     * @returns {object}
     */
    _nameClause (path, value) {
        return {
            compound: {
                should: [
                    { autocomplete: { path, query: value, fuzzy: { maxEdits: 1, prefixLength: 2 } } },
                    { text: { path, query: value } }
                ],
                minimumShouldMatch: 1
            }
        };
    }

    /**
     * @param {'email'|'phone'} system
     * @param {string} value
     * @returns {object}
     */
    _telecomSystemClause (system, value) {
        return {
            compound: {
                must: [
                    { equals: { path: 'telecom.system', value: system } },
                    { text: { path: 'telecom.value', query: value } }
                ]
            }
        };
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/operations/search/atlasSearchQueryBuilder.js src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js
git commit -m "Add AtlasSearchQueryBuilder compound construction"
```

---

## Task 4: Wire `AtlasSearchQueryBuilder` into the DI container and `SearchManager`

**Files:**
- Modify: `src/createContainer.js:340` (new registration), `src/createContainer.js:503-524`
  (`searchManager` registration)
- Modify: `src/operations/search/searchManager.js:48-186` (constructor)
- Modify: `src/tests/unit/operations/search/searchManager.test.js:46-113` (beforeEach)

**Interfaces:**
- Consumes: `AtlasSearchQueryBuilder` (Tasks 2-3).
- Produces: `SearchManager` instances now require an `atlasSearchQueryBuilder` constructor option;
  `this.atlasSearchQueryBuilder` is available to every `SearchManager` method from Task 5 onward.

- [ ] **Step 1: Write the failing test**

In `src/tests/unit/operations/search/searchManager.test.js`, this existing test (inside
`beforeEach`) will start failing once the constructor requires the new dependency. First add a
new assertion-only test to `describe('SearchManager', ...)` (top level, alongside other
`describe` blocks) that pins the requirement:

```javascript
    describe('constructor', () => {
        it('requires an AtlasSearchQueryBuilder', () => {
            const { AtlasSearchQueryBuilder } = require('../../../../operations/search/atlasSearchQueryBuilder');
            expect(searchManager.atlasSearchQueryBuilder).toBeInstanceOf(AtlasSearchQueryBuilder);
        });
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js -t "requires an AtlasSearchQueryBuilder"`
Expected: FAIL — `searchManager.atlasSearchQueryBuilder` is `undefined`

- [ ] **Step 3: Wire the dependency through**

In `src/operations/search/searchManager.js`, add the import near the other search imports (after
the `SearchQueryBuilder` require):

```javascript
const { AtlasSearchQueryBuilder } = require('./atlasSearchQueryBuilder');
```

Add `atlasSearchQueryBuilder` to the constructor's JSDoc param list and destructured options
(right after `searchQueryBuilder`), and add the corresponding assignment/assertion in the
constructor body (right after the existing `this.searchQueryBuilder = ...` /
`assertTypeEquals(searchQueryBuilder, SearchQueryBuilder);` block):

```javascript
        /**
         * @type {AtlasSearchQueryBuilder}
         */
        this.atlasSearchQueryBuilder = atlasSearchQueryBuilder;
        assertTypeEquals(atlasSearchQueryBuilder, AtlasSearchQueryBuilder);
```

In `src/createContainer.js`, add the require near the `SearchQueryBuilder` require (line ~100):

```javascript
const {AtlasSearchQueryBuilder} = require('./operations/search/atlasSearchQueryBuilder');
```

Add the registration right after the existing `searchQueryBuilder` registration (line ~340-342):

```javascript
    container.register('atlasSearchQueryBuilder', (c) => new AtlasSearchQueryBuilder({
        configManager: c.configManager
    }));
```

Add `atlasSearchQueryBuilder: c.atlasSearchQueryBuilder` to the `searchManager` registration's
options object (line ~503-524), alongside `searchQueryBuilder: c.searchQueryBuilder`.

In `src/tests/unit/operations/search/searchManager.test.js`, add the import at the top (after the
`SearchQueryBuilder` import):

```javascript
const { AtlasSearchQueryBuilder } = require('../../../../operations/search/atlasSearchQueryBuilder');
```

Add a `mockAtlasSearchQueryBuilder` declaration alongside the other `let mock...` declarations,
and inside `beforeEach`, create the mock and pass it into the constructor:

```javascript
    let mockAtlasSearchQueryBuilder;
    // ...
    beforeEach(() => {
        // ... existing mocks ...
        mockAtlasSearchQueryBuilder = Object.create(AtlasSearchQueryBuilder.prototype);
        mockAtlasSearchQueryBuilder.buildSearchQuery = () => null;

        searchManager = new SearchManager({
            // ... existing options ...
            atlasSearchQueryBuilder: mockAtlasSearchQueryBuilder
        });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js`
Expected: PASS — the new constructor test passes, and every pre-existing test in the file still
passes (they never touch `atlasSearchQueryBuilder`, and the mock's `buildSearchQuery` defaults to
`null`, matching today's behavior exactly).

Run the full suite once to confirm nothing else constructs `SearchManager` directly with a bare
options object that would now fail `assertTypeEquals`:

Run: `grep -rln "new SearchManager(" src/ --include="*.js"`
Expected: only `src/createContainer.js` and `src/tests/unit/operations/search/searchManager.test.js`
construct it directly — both already updated above.

- [ ] **Step 5: Commit**

```bash
git add src/createContainer.js src/operations/search/searchManager.js src/tests/unit/operations/search/searchManager.test.js
git commit -m "Wire AtlasSearchQueryBuilder into SearchManager and the DI container"
```

---

## Task 5: `SearchManager.constructQueryAsync` computes the Atlas compound

**Files:**
- Modify: `src/operations/search/searchManager.js:212-384` (`constructQueryAsync`)
- Test: `src/tests/unit/operations/search/searchManager.test.js`

**Interfaces:**
- Consumes: `this.atlasSearchQueryBuilder.buildSearchQuery({ resourceType, parsedArgs })` (Task 3).
- Produces: `constructQueryAsync(...)` now resolves
  `{ base_version, query, columns, atlasSearchCompound }` — `atlasSearchCompound` is `null` unless
  this is a READ, non-history-table, Patient/Person/Practitioner request that
  `AtlasSearchQueryBuilder` accepted. Task 6 consumes this exact field name.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/unit/operations/search/searchManager.test.js`, inside
`describe('constructQueryAsync', ...)`:

```javascript
        it('returns atlasSearchCompound from the builder for an eligible READ request', async () => {
            mockAtlasSearchQueryBuilder.buildSearchQuery = jest.fn().mockReturnValue({ must: [{ equals: { path: 'gender', value: 'male' } }] });
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({ query: {}, columns: new Set() });
            mockSecurityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue([]);
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(false);
            mockQueryRewriterManager.rewriteQueryAsync = jest.fn().mockResolvedValue({ query: {}, columns: new Set() });

            const result = await searchManager.constructQueryAsync({
                user: 'user1', scope: 'scope1', isUser: false, userType: null,
                resourceType: 'Patient', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req1', parsedArgs: mockParsedArgs, operation: 'READ'
            });

            expect(result.atlasSearchCompound).toEqual({ must: [{ equals: { path: 'gender', value: 'male' } }] });
            expect(mockAtlasSearchQueryBuilder.buildSearchQuery).toHaveBeenCalledWith({
                resourceType: 'Patient', parsedArgs: mockParsedArgs
            });
        });

        it('returns null atlasSearchCompound for a WRITE operation without calling the builder', async () => {
            mockAtlasSearchQueryBuilder.buildSearchQuery = jest.fn().mockReturnValue({ must: [] });
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({ query: {}, columns: new Set() });
            mockSecurityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue([]);
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(false);
            mockQueryRewriterManager.rewriteQueryAsync = jest.fn().mockResolvedValue({ query: {}, columns: new Set() });

            const result = await searchManager.constructQueryAsync({
                user: 'user1', scope: 'scope1', isUser: false, userType: null,
                resourceType: 'Patient', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req1', parsedArgs: mockParsedArgs, operation: 'WRITE'
            });

            expect(result.atlasSearchCompound).toBeNull();
            expect(mockAtlasSearchQueryBuilder.buildSearchQuery).not.toHaveBeenCalled();
        });

        it('returns null atlasSearchCompound when useHistoryTable is true', async () => {
            mockAtlasSearchQueryBuilder.buildSearchQuery = jest.fn().mockReturnValue({ must: [] });
            mockSearchQueryBuilder.buildSearchQueryBasedOnVersion = jest.fn().mockReturnValue({ query: {}, columns: new Set() });
            mockSecurityTagManager.getSecurityTagsFromScope = jest.fn().mockReturnValue([]);
            mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(false);
            mockQueryRewriterManager.rewriteQueryAsync = jest.fn().mockResolvedValue({ query: {}, columns: new Set() });

            const result = await searchManager.constructQueryAsync({
                user: 'user1', scope: 'scope1', isUser: false, userType: null,
                resourceType: 'Patient', useAccessIndex: false, personIdFromJwtToken: null,
                requestId: 'req1', parsedArgs: mockParsedArgs, operation: 'READ', useHistoryTable: true
            });

            expect(result.atlasSearchCompound).toBeNull();
            expect(mockAtlasSearchQueryBuilder.buildSearchQuery).not.toHaveBeenCalled();
        });
```

(These reuse `mockParsedArgs` and the mock wiring already established earlier in the existing
`describe('constructQueryAsync', ...)` block's `beforeEach`/setup — check the surrounding tests in
the file for the exact `mockParsedArgs` shape already in use, and match it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js -t "atlasSearchCompound"`
Expected: FAIL — `result.atlasSearchCompound` is `undefined`, not matching expectations.

- [ ] **Step 3: Implement**

In `src/operations/search/searchManager.js`, inside `constructQueryAsync`, immediately before the
final `return { base_version, query, columns };` (this replaces that line):

```javascript
            /**
             * @type {{must: object[]}|null}
             */
            let atlasSearchCompound = null;
            if (
                operation === READ &&
                !useHistoryTable &&
                ['Patient', 'Person', 'Practitioner'].includes(resourceType)
            ) {
                atlasSearchCompound = this.atlasSearchQueryBuilder.buildSearchQuery({
                    resourceType,
                    parsedArgs
                });
            }

            return { base_version, query, columns, atlasSearchCompound };
```

Add `READ` to the destructured constants import at the top of the file if not already present —
it already is, via `OPERATIONS: { READ }` in the existing `require('../../constants')` block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js`
Expected: PASS — new tests pass, and every pre-existing test in `describe('constructQueryAsync', ...)`
still passes (they destructure only `query`/`columns` and never assert on the full return shape,
so the added field is additive).

- [ ] **Step 5: Commit**

```bash
git add src/operations/search/searchManager.js src/tests/unit/operations/search/searchManager.test.js
git commit -m "SearchManager.constructQueryAsync computes the Atlas Search compound for eligible reads"
```

---

## Task 6: `SearchManager.getCursorForQueryAsync` executes the Atlas pipeline, with fallback

**Files:**
- Modify: `src/operations/search/searchManager.js:402-574` (`getCursorForQueryAsync`)
- Modify: `src/operations/search/searchBundle.js:186-249` (thread `atlasSearchCompound` through)
- Modify: `src/operations/search/searchStreaming.js:178-249` (thread `atlasSearchCompound` through)
- Test: `src/tests/unit/operations/search/searchManager.test.js`

**Interfaces:**
- Consumes: `atlasSearchCompound` from `constructQueryAsync` (Task 5);
  `ATLAS_SEARCH_INDEX_NAME` (exported from `atlasSearchQueryBuilder.js`, Task 2);
  `DatabaseQueryManager.findUsingAggregationAsync({ query, projection, options, extraInfo })` with
  `extraInfo.matchQueryProvided: true` (already exists, `src/dataLayer/databaseQueryManager.js:169-204`).
- Produces: `getCursorForQueryAsync` accepts a new optional `atlasSearchCompound` param.
  `mongoStreamReader.js` needs no change — it re-invokes `getCursorForQueryAsync` with
  `{...this.params}`, and `this.params` is exactly whatever object `searchStreaming.js` builds, so
  including `atlasSearchCompound` there is sufficient for the retry path too.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/unit/operations/search/searchManager.test.js`, inside
`describe('getCursorForQueryAsync', ...)` (reuse whatever mock `databaseQueryManager`/cursor
setup the existing tests in that block already establish — match their pattern for
`mockDatabaseQueryFactory.createQuery`):

```javascript
        it('runs the $search + $match pipeline via findUsingAggregationAsync when atlasSearchCompound is present', async () => {
            const atlasSearchCompound = { must: [{ equals: { path: 'gender', value: 'male' } }] };
            const mockCursor = {
                maxTimeMS: jest.fn().mockReturnThis(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0')
            };
            const mockDatabaseQueryManager = {
                findUsingAggregationAsync: jest.fn().mockResolvedValue(mockCursor),
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            await searchManager.getCursorForQueryAsync({
                resourceType: 'Patient', base_version: '4_0_0', parsedArgs: mockParsedArgs,
                columns: new Set(), options: { limit: 10, sort: { _uuid: 1 } }, query: { 'meta.security': 'x' },
                maxMongoTimeMS: 30000, user: 'user1', isStreaming: false, useAccessIndex: false,
                atlasSearchCompound
            });

            expect(mockDatabaseQueryManager.findUsingAggregationAsync).toHaveBeenCalledTimes(1);
            const callArgs = mockDatabaseQueryManager.findUsingAggregationAsync.mock.calls[0][0];
            expect(callArgs.extraInfo.matchQueryProvided).toBe(true);
            expect(callArgs.query[0]).toEqual({
                $search: { index: 'hybrid-full-text-search', compound: atlasSearchCompound }
            });
            expect(callArgs.query[1]).toEqual({ $match: { 'meta.security': 'x' } });
            expect(mockDatabaseQueryManager.findAsync).not.toHaveBeenCalled();
        });

        it('falls back to findAsync when the Atlas pipeline throws', async () => {
            const atlasSearchCompound = { must: [{ equals: { path: 'gender', value: 'male' } }] };
            const mockCursor = {
                maxTimeMS: jest.fn().mockReturnThis(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0')
            };
            const mockDatabaseQueryManager = {
                findUsingAggregationAsync: jest.fn().mockRejectedValue(new Error('index not found')),
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            const result = await searchManager.getCursorForQueryAsync({
                resourceType: 'Patient', base_version: '4_0_0', parsedArgs: mockParsedArgs,
                columns: new Set(), options: { limit: 10, sort: { _uuid: 1 } }, query: { 'meta.security': 'x' },
                maxMongoTimeMS: 30000, user: 'user1', isStreaming: false, useAccessIndex: false,
                atlasSearchCompound
            });

            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledWith({
                query: { 'meta.security': 'x' }, options: expect.any(Object), extraInfo: expect.any(Object)
            });
            expect(result.cursor).toBe(mockCursor);
        });

        it('uses findAsync directly when atlasSearchCompound is null (unchanged behavior)', async () => {
            const mockCursor = {
                maxTimeMS: jest.fn().mockReturnThis(),
                getCollection: jest.fn().mockReturnValue('Patient_4_0_0')
            };
            const mockDatabaseQueryManager = {
                findUsingAggregationAsync: jest.fn(),
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            await searchManager.getCursorForQueryAsync({
                resourceType: 'Patient', base_version: '4_0_0', parsedArgs: mockParsedArgs,
                columns: new Set(), options: { limit: 10, sort: { _uuid: 1 } }, query: { 'meta.security': 'x' },
                maxMongoTimeMS: 30000, user: 'user1', isStreaming: false, useAccessIndex: false,
                atlasSearchCompound: null
            });

            expect(mockDatabaseQueryManager.findUsingAggregationAsync).not.toHaveBeenCalled();
            expect(mockDatabaseQueryManager.findAsync).toHaveBeenCalledTimes(1);
        });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js -t "atlasSearchCompound"`
Expected: FAIL — today's code always calls `findAsync`/ignores `atlasSearchCompound`.

- [ ] **Step 3: Implement**

In `src/operations/search/searchManager.js`, add the import:

```javascript
const { AtlasSearchQueryBuilder, ATLAS_SEARCH_INDEX_NAME } = require('./atlasSearchQueryBuilder');
```

Add `atlasSearchCompound` to `getCursorForQueryAsync`'s destructured params and JSDoc (alongside
`useAggregationPipeline`). Replace the existing cursor-building block:

```javascript
        if (useAggregationPipeline) {
            // Projection arguement to be used for aggregation query
            let projection = parsedArgs.projection || {};
            if (options.projection) {
                projection = { ...projection, ...options.projection };
            }
            cursorQuery = await databaseQueryManager.findUsingAggregationAsync({
                query,
                projection,
                options,
                extraInfo
            });
        } else {
            cursorQuery = await databaseQueryManager.findAsync({ query, options, extraInfo });
        }
```

with:

```javascript
        if (atlasSearchCompound) {
            try {
                const pipeline = [
                    { $search: { index: ATLAS_SEARCH_INDEX_NAME, compound: atlasSearchCompound } },
                    { $match: query },
                    ...(options.sort && Object.keys(options.sort).length ? [{ $sort: options.sort }] : []),
                    ...(options.skip ? [{ $skip: options.skip }] : []),
                    { $limit: options.limit },
                    { $project: options.projection || {} }
                ];
                cursorQuery = await databaseQueryManager.findUsingAggregationAsync({
                    query: pipeline,
                    projection: options.projection || {},
                    options: {},
                    extraInfo: { ...extraInfo, matchQueryProvided: true }
                });
            } catch (e) {
                logWarn(
                    'Atlas $search pipeline failed; falling back to the standard query path',
                    { user, args: { resourceType, error: e.message } }
                );
                cursorQuery = await databaseQueryManager.findAsync({ query, options, extraInfo });
            }
        } else if (useAggregationPipeline) {
            // Projection arguement to be used for aggregation query
            let projection = parsedArgs.projection || {};
            if (options.projection) {
                projection = { ...projection, ...options.projection };
            }
            cursorQuery = await databaseQueryManager.findUsingAggregationAsync({
                query,
                projection,
                options,
                extraInfo
            });
        } else {
            cursorQuery = await databaseQueryManager.findAsync({ query, options, extraInfo });
        }
```

`logWarn` is already imported at the top of `searchManager.js` (see the existing
`logDebug, logError, logInfo, logWarn` import). Also guard the existing `_setIndexHint` block a
few lines below (`if (isTrue(process.env.SET_INDEX_HINTS) || parsedArgs._setIndexHint) { ... }`)
so it never runs for the Atlas path — an index hint has no meaning once `$search` is driving the
plan:

```javascript
        if (!atlasSearchCompound && (isTrue(process.env.SET_INDEX_HINTS) || parsedArgs._setIndexHint)) {
```

Now thread `atlasSearchCompound` through the two call sites that reach `getCursorForQueryAsync`
for actual multi-resource search (searchById/patch/update/remove/validate/graphHelpers/everythingHelper
call only `constructQueryAsync` directly and never call `getCursorForQueryAsync`, so they need no
change):

In `src/operations/search/searchBundle.js`, add `atlasSearchCompound` to the `constructQueryAsync`
destructure (~line 186-192) and pass it through to `getCursorForQueryAsync` (~line 236-249):

```javascript
            ({
                query,
                columns,
                atlasSearchCompound
            } = await this.searchManager.constructQueryAsync(
```

(declare `let atlasSearchCompound = null;` alongside the existing `let query = {};` / `let columns;`
declarations a few lines above), and add `atlasSearchCompound` into the `getCursorForQueryAsync`
call's options object, alongside `useAggregationPipeline`.

In `src/operations/search/searchStreaming.js`, make the identical change: declare
`let atlasSearchCompound = null;` near `let columns = new Set();`, destructure it from
`constructQueryAsync`'s result, and add it to the `params` object (~line 236-248) that gets passed
to `getCursorForQueryAsync` and later reused verbatim by `mongoStreamReader.js`'s retry path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js`
Expected: PASS — new tests pass; existing `getCursorForQueryAsync` tests still pass since
`atlasSearchCompound` defaults to `undefined`/falsy in any test that doesn't pass it, taking the
unchanged `else` branches.

Run the broader search test suite to check the two call-site changes didn't break anything:
`nvm use && node node_modules/.bin/jest src/tests/unit/operations/search -t ""`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/operations/search/searchManager.js src/operations/search/searchBundle.js src/operations/search/searchStreaming.js src/tests/unit/operations/search/searchManager.test.js
git commit -m "SearchManager.getCursorForQueryAsync runs the Atlas Search pipeline with fallback"
```

---

## Task 7: `_total=accurate` under the Atlas pipeline

**Files:**
- Modify: `src/operations/search/searchManager.js:698-722` (`handleGetTotalsAsync`), and its one
  call site inside `getCursorForQueryAsync` (~line 544-553)
- Test: `src/tests/unit/operations/search/searchManager.test.js`

**Interfaces:**
- Consumes: `atlasSearchCompound` (already in scope inside `getCursorForQueryAsync`, Task 6);
  `DatabaseCursor.hasNext()`/`.next()` (already used elsewhere in `searchManager.js`, e.g.
  `fetchResourcesByArgsAsync`).
- Produces: `handleGetTotalsAsync` accepts a new optional `atlasSearchCompound` param.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/unit/operations/search/searchManager.test.js`, inside
`describe('handleGetTotalsAsync', ...)` if it exists, otherwise as a new top-level `describe`:

```javascript
    describe('handleGetTotalsAsync', () => {
        it('runs a $count pipeline when atlasSearchCompound is present', async () => {
            const atlasSearchCompound = { must: [{ equals: { path: 'gender', value: 'male' } }] };
            const mockCursor = {
                maxTimeMS: jest.fn().mockReturnThis(),
                hasNext: jest.fn().mockResolvedValue(true),
                next: jest.fn().mockResolvedValue({ total: 42 })
            };
            const mockDatabaseQueryManager = {
                findUsingAggregationAsync: jest.fn().mockResolvedValue(mockCursor),
                exactDocumentCountAsync: jest.fn()
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            const total = await searchManager.handleGetTotalsAsync({
                resourceType: 'Patient', base_version: '4_0_0', query: { 'meta.security': 'x' },
                maxMongoTimeMS: 30000, atlasSearchCompound
            });

            expect(total).toBe(42);
            const callArgs = mockDatabaseQueryManager.findUsingAggregationAsync.mock.calls[0][0];
            expect(callArgs.query).toEqual([
                { $search: { index: 'hybrid-full-text-search', compound: atlasSearchCompound } },
                { $match: { 'meta.security': 'x' } },
                { $count: 'total' }
            ]);
            expect(mockDatabaseQueryManager.exactDocumentCountAsync).not.toHaveBeenCalled();
        });

        it('returns 0 when the $count pipeline has no results', async () => {
            const atlasSearchCompound = { must: [] };
            const mockCursor = {
                maxTimeMS: jest.fn().mockReturnThis(),
                hasNext: jest.fn().mockResolvedValue(false)
            };
            const mockDatabaseQueryManager = {
                findUsingAggregationAsync: jest.fn().mockResolvedValue(mockCursor)
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            const total = await searchManager.handleGetTotalsAsync({
                resourceType: 'Patient', base_version: '4_0_0', query: {},
                maxMongoTimeMS: 30000, atlasSearchCompound
            });

            expect(total).toBe(0);
        });

        it('uses exactDocumentCountAsync when atlasSearchCompound is absent (unchanged behavior)', async () => {
            const mockDatabaseQueryManager = {
                exactDocumentCountAsync: jest.fn().mockResolvedValue(7),
                findUsingAggregationAsync: jest.fn()
            };
            mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue(mockDatabaseQueryManager);

            const total = await searchManager.handleGetTotalsAsync({
                resourceType: 'Patient', base_version: '4_0_0', query: {}, maxMongoTimeMS: 30000
            });

            expect(total).toBe(7);
            expect(mockDatabaseQueryManager.findUsingAggregationAsync).not.toHaveBeenCalled();
        });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js -t "handleGetTotalsAsync"`
Expected: FAIL — today's `handleGetTotalsAsync` always calls `exactDocumentCountAsync` and ignores
`atlasSearchCompound`.

- [ ] **Step 3: Implement**

Replace `handleGetTotalsAsync` in `src/operations/search/searchManager.js`:

```javascript
    /**
     * handle request to return totals for the query
     * @param {string} resourceType
     * @param {string} base_version
     * @param {Object} query
     * @param {number} maxMongoTimeMS
     * @param {{must: object[]}|null} [atlasSearchCompound]
     * @return {Promise<number>}
     */
    async handleGetTotalsAsync (
        {
            resourceType, base_version,
            query, maxMongoTimeMS, extraInfo, atlasSearchCompound
        }
    ) {
        try {
            // https://www.hl7.org/fhir/search.html#total
            // if _total is passed then calculate the total count for matching records also
            // don't use the options since they set a limit and skip
            const databaseQueryManager = this.databaseQueryFactory.createQuery(
                { resourceType, base_version }
            );
            if (atlasSearchCompound) {
                const pipeline = [
                    { $search: { index: ATLAS_SEARCH_INDEX_NAME, compound: atlasSearchCompound } },
                    { $match: query },
                    { $count: 'total' }
                ];
                let countCursor = await databaseQueryManager.findUsingAggregationAsync({
                    query: pipeline,
                    projection: {},
                    options: {},
                    extraInfo: { ...extraInfo, matchQueryProvided: true }
                });
                countCursor = countCursor.maxTimeMS({ milliSecs: maxMongoTimeMS });
                if (!(await countCursor.hasNext())) {
                    return 0;
                }
                const result = await countCursor.next();
                return result.total || 0;
            }
            return await databaseQueryManager.exactDocumentCountAsync({
                query,
                options: { maxTimeMS: maxMongoTimeMS },
                extraInfo
            });
        } catch (e) {
            throw new RethrownError({
                message: `Error getting totals for ${resourceType} with query: ${mongoQueryStringify(query)}`,
                error: e
            });
        }
    }
```

Update its one call site inside `getCursorForQueryAsync` (~line 544-553) to pass
`atlasSearchCompound` through:

```javascript
            total_count = await this.handleGetTotalsAsync(
                {
                    resourceType,
                    base_version,
                    query,
                    maxMongoTimeMS,
                    extraInfo,
                    atlasSearchCompound
                });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js`
Expected: PASS — all tests in the file, including the full pre-existing suite.

- [ ] **Step 5: Run the full unit test suite for the search directory once more, then commit**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search`
Expected: PASS

```bash
git add src/operations/search/searchManager.js src/tests/unit/operations/search/searchManager.test.js
git commit -m "Compute _total=accurate via a \$count pipeline under the Atlas Search path"
```

---

## Manual / follow-up verification (not automated in CI)

MongoDB Memory Server (used by `make tests`) does not run Atlas — there is no `$search` stage
available in the automated test database, so nothing above is integration-tested by Jest against a
real index. Everything in this plan is unit-tested against mocked `DatabaseQueryManager`/cursor
objects, which verifies the pipeline shape and fallback behavior but not actual Atlas
relevance/ranking.

**Update:** `docker-compose.yml`'s `mongo` service now runs `mongodb/mongodb-atlas-local:8.2.5`
instead of plain `mongo:8.0.15` — a real local Atlas Search engine (`mongot`), not a mock. This
makes the manual checks below actually runnable via `make up` (once port/isolation conflicts with
any other running worktree are resolved), without needing a real hosted Atlas dev/staging cluster
for basic functional verification. Confirmed standalone (outside `make up`, to avoid a port
conflict with another active worktree on this machine): pulled the image, created a real Atlas
Search index with the same `compound`/`must`/`should`/`autocomplete`/`fuzzy` shape
`AtlasSearchQueryBuilder` produces, and it correctly fuzzy-matched `"Smit"` to `"Smith"`. Still
worth validating against a real hosted Atlas cluster before production traffic, since local Atlas
and hosted Atlas can differ in version/behavior/performance characteristics — but the basic
correctness checks below no longer require coordinating cluster access first.

Before enabling any `ATLAS_SEARCH_ENABLED_*` flag in an environment with real traffic:

- [x] Automated: `make create_atlas_search_indexes` (after `make create_all_collections`, or
      just `make up` which runs both) creates the `hybrid-full-text-search` index on
      `Patient_4_0_0`/`Person_4_0_0`/`Practitioner_4_0_0` against the local `mongodb-atlas-local`
      instance, reading definitions from `src/admin/scripts/atlasSearchIndexes/*.json`, and waits
      for each to become `READY`. Idempotent (drops and recreates if already present, so editing
      a definition file and re-running picks up the change). Verified end-to-end outside `make up`
      (to avoid a port conflict with another worktree's containers): connected across a real
      Docker network via the `mongo` alias, created all three indexes, and ran the exact
      `must`-per-parameter/nested-`should` pipeline shape `AtlasSearchQueryBuilder` produces
      against a real inserted Patient document — correctly matched. These local dev index
      definitions include `_uuid` (for the `ATLAS_SEARCH_NATIVE_SORT_ENABLED` follow-up, Decision
      Log #8) even though the real, `person-matching-service`-owned production index does not
      have that field yet — don't confuse the two.
- [x] **Now automated** (no longer manual-only): `yarn test:atlas-search`
      (`src/tests/integration/atlasSearch/`) starts a real `mongodb-atlas-local` container via
      `testcontainers`, creates the indexes, `$merge`s two Patients, and confirms
      `GET /4_0_0/Patient?family=Smith&given=John` returns exactly the AND-combined match through
      the real `$search` pipeline (not a mock) — asserted by checking `logWarn` was *not* called
      with the fallback message, since a correct fallback would produce an identical response
      body. Had to poll/retry past Atlas's real indexing lag (confirmed via `_debug=1` explain
      showing `lucene.totalDocs: 0` immediately after write) rather than assume immediate
      consistency.
- [ ] Run these checks locally, with the indexes created above:
  - `GET /4_0_0/Patient?family=Smith,Jones` returns the OR-combined result set.
  - A request outside the eligible field set (e.g. `?address-city=Boston`) still returns identical
    results to today (fallback path), confirmed by diffing against the flag turned off.
  - Killing/renaming the index (or testing against a cluster where it doesn't exist) still returns
    correct results via automatic fallback, with a `logWarn` line in the logs. **Known gap:**
    attempted to automate this specific check and could not make it reliable against
    `mongodb-atlas-local` — even after `listSearchIndexes()` confirmed the index gone from
    `mongod`'s own metadata, `mongot` kept transparently honoring `$search` against it well past
    a 15s poll. This may be a local-dev-image-only propagation quirk, or it may mean a real
    hosted Atlas cluster behaves differently — worth confirming manually against one before
    relying on this fallback path for the specific "index doesn't exist" failure mode (as opposed
    to connection/syntax errors, which the mocked unit tests in `searchManager.test.js` do cover
    deterministically).
- [ ] Additionally repeat the above against a real Atlas-backed dev/staging Mongo cluster before
      enabling in an environment with real traffic (coordinate with whoever owns the index in
      `person-matching-service` for read access — see the ADR's accepted cross-repo-ownership
      risk), specifically to catch any local-vs-hosted-Atlas behavioral differences local testing
      can't surface.
- [ ] Confirm with whoever owns `person-matching-service`'s index that fhir-server reading from it
      is expected and won't be surprised by unrelated query volume.
