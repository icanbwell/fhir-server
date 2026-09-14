# `_text` / `_content` Full-Text Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is not authorized for execution yet.** It ships in its own draft PR (spec + plan,
> no code) per explicit instruction — do not run subagent-driven-development or executing-plans
> against it until a human explicitly asks for implementation.

**Goal:** Implement the FHIR `_text`/`_content` special search parameters
(https://hl7.org/fhir/R4B/search.html#content) generically across all resource types, using a new
fhir-server-owned Atlas Search index for resourceTypes configured for it, falling back to a
Mongo regex tree everywhere else (and on any Atlas error).

**Architecture:** One shared parser (`textQueryParser.js`) turns the `AND`/`OR`/paren/quoted-phrase
grammar into an AST. Two backends translate that AST: `fullTextSearchQueryBuilder.js` → an Atlas
`compound` query, hooked into `SearchManager` exactly where the existing (ADR-0003)
`AtlasSearchQueryBuilder` already hooks in, sharing its `$search`+`$match`+fallback-on-error
pipeline mechanics; `filters/specialText.js` → a Mongo `$and`/`$or` regex tree, wired into
`r4.js`'s normal per-parameter filter switch, used whenever the Atlas path isn't taken.

**Tech Stack:** Node.js / CommonJS, Jest, MongoDB Atlas Search (`$search`/`compound`), the
existing `mongodb-atlas-local` local test setup from ADR-0003.

**Spec:** `docs/superpowers/specs/2026-09-06-text-content-search-design.md`

## Global Constraints

- MongoDB allows only one `$search` stage per pipeline, and it must be the first stage — if the
  existing `AtlasSearchQueryBuilder` (Patient/Person/Practitioner name/identifier search) already
  produced a compound for this request, `_text`/`_content` must fall back to the regex path for
  that request, never attempt a second `$search`.
- The new Atlas Search index (`fhir-full-text-search`) is separate from, and must not modify,
  `hybrid-full-text-search` (owned by `person-matching-service`, used by the existing feature).
- `ATLAS_SEARCH_NATIVE_SORT_ENABLED` (ADR-0003) only applies to `hybrid-full-text-search`'s
  `_uuid` mapping — it must never be applied when this feature's index served the request.
- Which resourceTypes use Atlas vs. regex is a comma-separated config list
  (`FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES`), not a per-resource switch (see spec's "Which
  collections use Atlas Search" section for why).
- Any Atlas error falls back to the regex path for that request, logged, never a user-visible
  error — mirror ADR-0003's existing try/catch in `SearchManager.getCursorForQueryAsync` exactly.

---

## Task 1: `textQueryParser.js` — grammar parser

**Files:**
- Create: `src/utils/textQueryParser.js`
- Test: `src/tests/unit/utils/textQueryParser.test.js` (new)

**Interfaces:**
- Produces: `parseTextQuery(input: string): ASTNode` where `ASTNode` is one of
  `{type: 'term', value: string}`, `{type: 'phrase', value: string}`,
  `{type: 'and', children: ASTNode[]}`, `{type: 'or', children: ASTNode[]}`. Throws
  `BadRequestError` on empty/malformed input. Tasks 3 and 6 both consume this.

- [ ] **Step 1: Write the failing tests**

```js
const { describe, test, expect } = require('@jest/globals');
const { parseTextQuery } = require('../../../utils/textQueryParser');
const { BadRequestError } = require('../../../utils/httpErrors');

describe('textQueryParser', () => {
    test('parses a single term', () => {
        expect(parseTextQuery('diabetes')).toEqual({ type: 'term', value: 'diabetes' });
    });

    test('parses a quoted phrase', () => {
        expect(parseTextQuery('"bone metastases"')).toEqual({ type: 'phrase', value: 'bone metastases' });
    });

    test('parses implicit AND between adjacent terms', () => {
        expect(parseTextQuery('diabetes hypertension')).toEqual({
            type: 'and',
            children: [{ type: 'term', value: 'diabetes' }, { type: 'term', value: 'hypertension' }]
        });
    });

    test('parses explicit OR, case-insensitively', () => {
        expect(parseTextQuery('bone or liver')).toEqual({
            type: 'or',
            children: [{ type: 'term', value: 'bone' }, { type: 'term', value: 'liver' }]
        });
    });

    test('parses the spec example: (bone OR liver) and metastases', () => {
        expect(parseTextQuery('(bone OR liver) and metastases')).toEqual({
            type: 'and',
            children: [
                { type: 'or', children: [{ type: 'term', value: 'bone' }, { type: 'term', value: 'liver' }] },
                { type: 'term', value: 'metastases' }
            ]
        });
    });

    test('AND binds tighter than OR when parens are absent', () => {
        expect(parseTextQuery('bone OR liver and metastases')).toEqual({
            type: 'or',
            children: [
                { type: 'term', value: 'bone' },
                { type: 'and', children: [{ type: 'term', value: 'liver' }, { type: 'term', value: 'metastases' }] }
            ]
        });
    });

    test('throws BadRequestError on unbalanced parentheses', () => {
        expect(() => parseTextQuery('(bone OR liver')).toThrow(BadRequestError);
    });

    test('throws BadRequestError on empty parentheses', () => {
        expect(() => parseTextQuery('()')).toThrow(BadRequestError);
    });

    test('throws BadRequestError on a dangling operator', () => {
        expect(() => parseTextQuery('bone OR')).toThrow(BadRequestError);
    });

    test('throws BadRequestError on an empty string', () => {
        expect(() => parseTextQuery('')).toThrow(BadRequestError);
    });

    test('throws BadRequestError on a whitespace-only string', () => {
        expect(() => parseTextQuery('   ')).toThrow(BadRequestError);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/textQueryParser.test.js`
Expected: FAIL — `Cannot find module '../../../utils/textQueryParser'`

- [ ] **Step 3: Write the implementation**

```js
const { BadRequestError } = require('./httpErrors');

/**
 * Recursive-descent parser for the FHIR _text/_content grammar
 * (https://hl7.org/fhir/R4B/search.html#content): terms, "quoted phrases", AND/OR keywords
 * (case-insensitive), parentheses for grouping, and implicit AND between adjacent
 * terms/phrases/groups with no explicit operator. AND binds tighter than OR (each OR operand is
 * itself a maximal AND-chain) -- this is why the spec's own example needs explicit parens:
 * '(bone OR liver) and metastases' vs. the different meaning of 'bone OR liver and metastases'
 * (bone OR (liver AND metastases)) if the parens were omitted.
 */
class TextQueryParser {
    parse (input) {
        this.tokens = this._tokenize(input);
        this.pos = 0;
        if (this.tokens.length === 0) {
            throw new BadRequestError(new Error('_text/_content search value must be a non-empty string'));
        }
        const ast = this._parseOr();
        if (this.pos < this.tokens.length) {
            const remaining = this.tokens[this.pos];
            throw new BadRequestError(
                new Error(`Unexpected token near '${remaining.value || remaining.type}' in search value '${input}'`)
            );
        }
        return ast;
    }

    _tokenize (input) {
        const regex = /"([^"]*)"|\(|\)|[^\s()]+/g;
        const tokens = [];
        let match;
        while ((match = regex.exec(input)) !== null) {
            const raw = match[0];
            if (raw === '(') {
                tokens.push({ type: 'LPAREN' });
            } else if (raw === ')') {
                tokens.push({ type: 'RPAREN' });
            } else if (match[1] !== undefined) {
                tokens.push({ type: 'PHRASE', value: match[1] });
            } else if (raw.toUpperCase() === 'AND') {
                tokens.push({ type: 'AND' });
            } else if (raw.toUpperCase() === 'OR') {
                tokens.push({ type: 'OR' });
            } else {
                tokens.push({ type: 'TERM', value: raw });
            }
        }
        return tokens;
    }

    _peek () {
        return this.tokens[this.pos];
    }

    _parseOr () {
        const left = this._parseAnd();
        const children = [left];
        while (this._peek() && this._peek().type === 'OR') {
            this.pos++;
            children.push(this._parseAnd());
        }
        return children.length === 1 ? left : { type: 'or', children };
    }

    _parseAnd () {
        const left = this._parseUnary();
        const children = [left];
        while (this._peek() && ['AND', 'TERM', 'PHRASE', 'LPAREN'].includes(this._peek().type)) {
            if (this._peek().type === 'AND') {
                this.pos++;
            }
            children.push(this._parseUnary());
        }
        return children.length === 1 ? left : { type: 'and', children };
    }

    _parseUnary () {
        const token = this._peek();
        if (!token) {
            throw new BadRequestError(new Error('Unexpected end of search value'));
        }
        if (token.type === 'LPAREN') {
            this.pos++;
            const inner = this._parseOr();
            if (!this._peek() || this._peek().type !== 'RPAREN') {
                throw new BadRequestError(new Error('Unbalanced parentheses in search value'));
            }
            this.pos++;
            return inner;
        }
        if (token.type === 'TERM') {
            this.pos++;
            return { type: 'term', value: token.value };
        }
        if (token.type === 'PHRASE') {
            this.pos++;
            return { type: 'phrase', value: token.value };
        }
        throw new BadRequestError(new Error(`Unexpected token '${token.type}' in search value`));
    }
}

/**
 * @param {string} input
 * @return {{type: string, value?: string, children?: object[]}}
 */
function parseTextQuery (input) {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new BadRequestError(new Error('_text/_content search value must be a non-empty string'));
    }
    return new TextQueryParser().parse(input);
}

module.exports = { parseTextQuery };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/textQueryParser.test.js`
Expected: PASS (all 11 tests)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/utils/textQueryParser.js src/tests/unit/utils/textQueryParser.test.js
git commit -m "Add AND/OR/paren/phrase grammar parser for _text/_content"
```

---

## Task 2: `ConfigManager.fullTextSearchAtlasIndexedResources`

**Files:**
- Modify: `src/utils/configManager.js`
- Test: `src/tests/unit/utils/configManager.test.js` (extend)

**Interfaces:**
- Produces: `configManager.fullTextSearchAtlasIndexedResources: string[]` (getter). Task 3
  consumes this.

- [ ] **Step 1: Write the failing tests**

First check whether `ConfigManager` already has a `_parseCommaSeparatedList(envVar, defaultValue)`
helper (it does, per `src/tests/unit/utils/configManager.test.js`'s existing
`describe('_parseCommaSeparatedList', ...)` block) and reuse it rather than hand-rolling
`.split(',')` again. Add a new `describe` block:

```js
    describe('fullTextSearchAtlasIndexedResources', () => {
        test('returns empty array when env var is unset', () => {
            expect(configManager.fullTextSearchAtlasIndexedResources).toEqual([]);
        });

        test('parses a comma-separated list, trimmed', () => {
            setEnv('FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES', 'Condition, DocumentReference');
            expect(configManager.fullTextSearchAtlasIndexedResources).toEqual(['Condition', 'DocumentReference']);
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js -t "fullTextSearchAtlasIndexedResources"`
Expected: FAIL — `configManager.fullTextSearchAtlasIndexedResources is undefined`

- [ ] **Step 3: Write the implementation**

Add near the other comma-list getters (e.g. next to `cloudStorageHistoryResources` or
`accessTagsIndexed`) in `src/utils/configManager.js`:

```js
    /**
     * Resource types whose collections have the fhir-full-text-search Atlas Search index built
     * (see docs/adr and src/admin/scripts/createFullTextSearchIndexes.js) -- _text/_content
     * queries for any other resource type use the Mongo regex fallback instead. Deliberately a
     * single comma-separated list rather than one env var per resource type (contrast
     * isAtlasSearchEnabled/ATLAS_SEARCH_ENABLED_<RESOURCE>): _text/_content apply to far more
     * resource types than that fixed-3 pattern was designed for.
     * @return {string[]}
     */
    get fullTextSearchAtlasIndexedResources () {
        return this._parseCommaSeparatedList(env.FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES, []);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/configManager.test.js`
Expected: PASS (full file)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/utils/configManager.js src/tests/unit/utils/configManager.test.js
git commit -m "Add fullTextSearchAtlasIndexedResources config getter"
```

---

## Task 3: `fullTextSearchQueryBuilder.js` — AST → Atlas `compound`

**Files:**
- Create: `src/operations/search/fullTextSearchQueryBuilder.js`
- Test: `src/tests/unit/operations/search/fullTextSearchQueryBuilder.test.js` (new — mirror
  `src/tests/unit/operations/search/atlasSearchQueryBuilder.test.js`'s mocking conventions)

**Interfaces:**
- Consumes: `parseTextQuery` (Task 1), `ConfigManager.fullTextSearchAtlasIndexedResources` (Task 2).
- Produces: `class FullTextSearchQueryBuilder { buildSearchQuery({resourceType, parsedArgs, existingAtlasSearchCompound}): {must: object[]}|null }` and `FULL_TEXT_SEARCH_INDEX_NAME` (string constant `'fhir-full-text-search'`) — Task 4 consumes both.

- [ ] **Step 1: Write the failing tests**

```js
const { describe, test, expect, jest: jestObj, beforeEach } = require('@jest/globals');
const { FullTextSearchQueryBuilder, FULL_TEXT_SEARCH_INDEX_NAME } = require('../../../../operations/search/fullTextSearchQueryBuilder');
const { QueryParameterValue } = require('../../../../operations/query/queryParameterValue');

describe('FullTextSearchQueryBuilder', () => {
    let configManager;
    let builder;

    beforeEach(() => {
        configManager = { fullTextSearchAtlasIndexedResources: ['Condition'] };
        builder = new FullTextSearchQueryBuilder({ configManager });
    });

    function parsedArgsWith (queryParameter, value) {
        return {
            parsedArgItems: [
                { queryParameter, queryParameterValue: new QueryParameterValue({ value }) }
            ]
        };
    }

    test('returns null when the resourceType is not configured', () => {
        configManager.fullTextSearchAtlasIndexedResources = [];
        const result = builder.buildSearchQuery({
            resourceType: 'Condition', parsedArgs: parsedArgsWith('_content', 'diabetes')
        });
        expect(result).toBeNull();
    });

    test('returns null when an existing Atlas compound already claimed this request', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition',
            parsedArgs: parsedArgsWith('_content', 'diabetes'),
            existingAtlasSearchCompound: { must: [{ text: { path: 'name.family', query: 'x' } } ] }
        });
        expect(result).toBeNull();
    });

    test('returns null when neither _text nor _content is present', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition', parsedArgs: parsedArgsWith('status', 'active')
        });
        expect(result).toBeNull();
    });

    test('builds a wildcard-path compound for a single _content term', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition', parsedArgs: parsedArgsWith('_content', 'diabetes')
        });
        expect(result).toEqual({
            must: [{ text: { query: 'diabetes', path: { wildcard: '*' } } }]
        });
    });

    test('builds a text.div-scoped compound for _text', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition', parsedArgs: parsedArgsWith('_text', 'diabetes')
        });
        expect(result).toEqual({
            must: [{ text: { query: 'diabetes', path: 'text.div' } }]
        });
    });

    test('translates the spec example (bone OR liver) and metastases into nested compound', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition',
            parsedArgs: parsedArgsWith('_content', '(bone OR liver) and metastases')
        });
        expect(result).toEqual({
            must: [{
                compound: {
                    must: [
                        {
                            compound: {
                                should: [
                                    { text: { query: 'bone', path: { wildcard: '*' } } },
                                    { text: { query: 'liver', path: { wildcard: '*' } } }
                                ],
                                minimumShouldMatch: 1
                            }
                        },
                        { text: { query: 'metastases', path: { wildcard: '*' } } }
                    ]
                }
            }]
        });
    });

    test('translates a quoted phrase using the phrase operator', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition', parsedArgs: parsedArgsWith('_content', '"bone metastases"')
        });
        expect(result).toEqual({
            must: [{ phrase: { query: 'bone metastases', path: { wildcard: '*' } } }]
        });
    });

    test('prefers _content over _text when both are present', () => {
        const result = builder.buildSearchQuery({
            resourceType: 'Condition',
            parsedArgs: {
                parsedArgItems: [
                    { queryParameter: '_text', queryParameterValue: new QueryParameterValue({ value: 'ignored' }) },
                    { queryParameter: '_content', queryParameterValue: new QueryParameterValue({ value: 'diabetes' }) }
                ]
            }
        });
        expect(result).toEqual({ must: [{ text: { query: 'diabetes', path: { wildcard: '*' } } }] });
    });

    test('FULL_TEXT_SEARCH_INDEX_NAME is fhir-full-text-search', () => {
        expect(FULL_TEXT_SEARCH_INDEX_NAME).toBe('fhir-full-text-search');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/fullTextSearchQueryBuilder.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { parseTextQuery } = require('../../utils/textQueryParser');

/**
 * Name of the Atlas Search index this repo owns and manages itself for _text/_content --
 * distinct from ATLAS_SEARCH_INDEX_NAME ('hybrid-full-text-search'), which belongs to
 * person-matching-service and is used by AtlasSearchQueryBuilder for a different purpose.
 * See src/admin/scripts/createFullTextSearchIndexes.js.
 */
const FULL_TEXT_SEARCH_INDEX_NAME = 'fhir-full-text-search';

/**
 * Recursively translates a textQueryParser AST node into an Atlas Search clause, scoped to
 * `path`. `path` is 'text.div' for _text, or {wildcard: '*'} for _content -- the same shared,
 * dynamically-mapped index serves both; the distinction is made entirely here, at query time,
 * not via separate indexes.
 * @param {{type: string, value?: string, children?: object[]}} node
 * @param {string|{wildcard: string}} path
 * @return {object}
 */
function astToClause (node, path) {
    switch (node.type) {
        case 'term':
            return { text: { query: node.value, path } };
        case 'phrase':
            return { phrase: { query: node.value, path } };
        case 'and':
            return { compound: { must: node.children.map((c) => astToClause(c, path)) } };
        case 'or':
            return { compound: { should: node.children.map((c) => astToClause(c, path)), minimumShouldMatch: 1 } };
        default:
            throw new Error(`Unknown text query AST node type: ${node.type}`);
    }
}

class FullTextSearchQueryBuilder {
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
     * Returns the Atlas Search `compound` document for a _text/_content request, or null if the
     * request should use the regex fallback instead -- either because this resourceType isn't
     * Atlas-configured, no _text/_content parameter is present, or (mutual exclusion) the
     * existing AtlasSearchQueryBuilder already claimed this request's single allowed $search
     * stage.
     * @param {string} resourceType
     * @param {import('../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {{must: object[]}|null} [existingAtlasSearchCompound]
     * @returns {{must: object[]}|null}
     */
    buildSearchQuery ({ resourceType, parsedArgs, existingAtlasSearchCompound = null }) {
        if (existingAtlasSearchCompound) {
            return null;
        }
        if (!this.configManager.fullTextSearchAtlasIndexedResources.includes(resourceType)) {
            return null;
        }

        const textItem = parsedArgs.parsedArgItems.find((i) => i.queryParameter === '_text');
        const contentItem = parsedArgs.parsedArgItems.find((i) => i.queryParameter === '_content');
        // FHIR's search.html doesn't define combined _text+_content semantics for one request;
        // prefer _content (the broader search) deterministically rather than silently dropping
        // either one.
        const item = contentItem || textItem;
        if (!item || !item.queryParameterValue || !item.queryParameterValue.value) {
            return null;
        }

        const path = item === contentItem ? { wildcard: '*' } : 'text.div';
        const ast = parseTextQuery(item.queryParameterValue.value);
        return { must: [astToClause(ast, path)] };
    }
}

module.exports = {
    FullTextSearchQueryBuilder,
    FULL_TEXT_SEARCH_INDEX_NAME
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/fullTextSearchQueryBuilder.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/operations/search/fullTextSearchQueryBuilder.js src/tests/unit/operations/search/fullTextSearchQueryBuilder.test.js
git commit -m "Add FullTextSearchQueryBuilder: AST to Atlas compound for _text/_content"
```

---

## Task 4: Wire into `SearchManager` and `createContainer.js`

**Files:**
- Modify: `src/operations/search/searchManager.js` (the `constructQueryAsync` block that builds
  `atlasSearchCompound`, and the `getCursorForQueryAsync` block that consumes it — see exact
  current code below, from the `atlas-search-tech-design` branch)
- Modify: `src/createContainer.js` (register `fullTextSearchQueryBuilder`, inject into
  `searchManager`'s registration)
- Test: `src/tests/unit/operations/search/searchManager.test.js` (extend — locate the existing
  tests covering `constructQueryAsync`'s `atlasSearchCompound` assignment and
  `getCursorForQueryAsync`'s `$search` pipeline branch, and add parallel cases per Step 1 below)

**Interfaces:**
- Consumes: `FullTextSearchQueryBuilder`, `FULL_TEXT_SEARCH_INDEX_NAME` (Task 3);
  `AtlasSearchQueryBuilder`, `ATLAS_SEARCH_INDEX_NAME` (already present, from ADR-0003).

**Current code (`constructQueryAsync`, inside the same try block that builds `query`/`columns`):**

```js
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

**Current code (`getCursorForQueryAsync`, the Atlas branch):**

```js
        let effectiveAtlasSearchCompound = atlasSearchCompound;
        if (atlasSearchCompound) {
            try {
                const useNativeSort = this.configManager.isAtlasSearchNativeSortEnabled;
                const searchStage = useNativeSort
                    ? {
                        $search: {
                            index: ATLAS_SEARCH_INDEX_NAME,
                            compound: atlasSearchCompound,
                            sort: { score: { $meta: 'searchScore' }, [defaultSortId]: 1 }
                        }
                    }
                    : { $search: { index: ATLAS_SEARCH_INDEX_NAME, compound: atlasSearchCompound } };
```

- [ ] **Step 1: Write the failing tests**

Locate the existing `constructQueryAsync`/`getCursorForQueryAsync` test blocks in
`src/tests/unit/operations/search/searchManager.test.js` that mock `atlasSearchQueryBuilder` and
assert on `atlasSearchCompound` — reuse their exact `searchManager` construction helper. Add:

```js
        test('falls back to fullTextSearchQueryBuilder when the existing Atlas builder returns null', async () => {
            mockAtlasSearchQueryBuilder.buildSearchQuery.mockReturnValue(null);
            mockFullTextSearchQueryBuilder.buildSearchQuery.mockReturnValue({ must: [{ text: { query: 'x', path: 'text.div' } }] });

            const result = await searchManager.constructQueryAsync({
                /* ...same args the existing atlasSearchCompound test in this file already uses,
                   but resourceType: 'Condition' (not Patient/Person/Practitioner) and
                   parsedArgs containing a _text item... */
            });

            expect(result.atlasSearchCompound).toEqual({ must: [{ text: { query: 'x', path: 'text.div' } }] });
            expect(result.atlasSearchIndexName).toBe(FULL_TEXT_SEARCH_INDEX_NAME);
        });

        test('does not call fullTextSearchQueryBuilder when AtlasSearchQueryBuilder already returned a compound', async () => {
            mockAtlasSearchQueryBuilder.buildSearchQuery.mockReturnValue({ must: [{ equals: { path: 'gender', value: 'male' } }] });

            const result = await searchManager.constructQueryAsync({
                /* ...resourceType: 'Patient', same shape as the existing passing Atlas test... */
            });

            expect(mockFullTextSearchQueryBuilder.buildSearchQuery).not.toHaveBeenCalled();
            expect(result.atlasSearchIndexName).toBe(ATLAS_SEARCH_INDEX_NAME);
        });

        test('getCursorForQueryAsync uses the passed-in index name in the $search stage', async () => {
            /* ...reuse the existing getCursorForQueryAsync-with-atlasSearchCompound test's mock
               database setup, but pass atlasSearchIndexName: FULL_TEXT_SEARCH_INDEX_NAME and
               assert the $search stage built by findUsingAggregationAsync's pipeline argument
               has index: FULL_TEXT_SEARCH_INDEX_NAME, not ATLAS_SEARCH_INDEX_NAME... */
        });

        test('never applies native sort when the full-text-search index served the request', async () => {
            /* ...set configManager.isAtlasSearchNativeSortEnabled to true, pass
               atlasSearchIndexName: FULL_TEXT_SEARCH_INDEX_NAME, and assert the built $search
               stage has no `sort` key... */
        });
```

(These are written as structural skeletons with the exact assertions that must hold, because the
full existing test file's mock-database/mock-cursor scaffolding must be read first and reused
exactly — copying it here without reading the current file would risk silently diverging from
whatever helper functions that file already has. Read the file, find the nearest existing
`atlasSearchCompound` test, and pattern-match its setup precisely before filling in the `/* ... */`
sections with real code.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js -t "fullTextSearchQueryBuilder\|index name\|native sort"`
Expected: FAIL — `atlasSearchIndexName` is `undefined` on the result, `fullTextSearchQueryBuilder`
is not yet a constructor dependency, and the `$search` stage still hardcodes
`ATLAS_SEARCH_INDEX_NAME`.

- [ ] **Step 3: Write the implementation**

In `searchManager.js`, add the import and constructor wiring alongside the existing
`atlasSearchQueryBuilder` ones (find `this.atlasSearchQueryBuilder = atlasSearchQueryBuilder;` /
`assertTypeEquals(atlasSearchQueryBuilder, AtlasSearchQueryBuilder);` and add the parallel lines
immediately after, plus the constructor parameter and its JSDoc `@param`):

```js
const { FullTextSearchQueryBuilder, FULL_TEXT_SEARCH_INDEX_NAME } = require('./fullTextSearchQueryBuilder');
```

```js
        this.fullTextSearchQueryBuilder = fullTextSearchQueryBuilder;
        assertTypeEquals(fullTextSearchQueryBuilder, FullTextSearchQueryBuilder);
```

Replace the `constructQueryAsync` block shown above with:

```js
            /**
             * @type {{must: object[]}|null}
             */
            let atlasSearchCompound = null;
            /**
             * @type {string|null}
             */
            let atlasSearchIndexName = null;
            if (
                operation === READ &&
                !useHistoryTable &&
                ['Patient', 'Person', 'Practitioner'].includes(resourceType)
            ) {
                atlasSearchCompound = this.atlasSearchQueryBuilder.buildSearchQuery({
                    resourceType,
                    parsedArgs
                });
                if (atlasSearchCompound) {
                    atlasSearchIndexName = ATLAS_SEARCH_INDEX_NAME;
                }
            }
            if (!atlasSearchCompound && operation === READ && !useHistoryTable) {
                atlasSearchCompound = this.fullTextSearchQueryBuilder.buildSearchQuery({
                    resourceType,
                    parsedArgs,
                    existingAtlasSearchCompound: atlasSearchCompound
                });
                if (atlasSearchCompound) {
                    atlasSearchIndexName = FULL_TEXT_SEARCH_INDEX_NAME;
                }
            }

            return { base_version, query, columns, atlasSearchCompound, atlasSearchIndexName };
```

Add `atlasSearchIndexName` as a new parameter to `getCursorForQueryAsync`'s destructured argument
object (alongside the existing `atlasSearchCompound` parameter, with the same JSDoc pattern:
`@param {string|null} [atlasSearchIndexName]`).

Replace the Atlas branch's `searchStage` construction:

```js
        let effectiveAtlasSearchCompound = atlasSearchCompound;
        if (atlasSearchCompound) {
            try {
                const useNativeSort = this.configManager.isAtlasSearchNativeSortEnabled;
                const searchStage = useNativeSort
                    ? {
                        $search: {
                            index: ATLAS_SEARCH_INDEX_NAME,
                            compound: atlasSearchCompound,
                            sort: { score: { $meta: 'searchScore' }, [defaultSortId]: 1 }
                        }
                    }
                    : { $search: { index: ATLAS_SEARCH_INDEX_NAME, compound: atlasSearchCompound } };
```

with:

```js
        let effectiveAtlasSearchCompound = atlasSearchCompound;
        if (atlasSearchCompound) {
            try {
                // Native sort's `sort` option requires defaultSortId mapped as a sortable
                // (token-type) field in hybrid-full-text-search specifically (ADR-0003 Decision
                // Log #8) -- fhir-full-text-search has no such mapping, so native sort must never
                // apply when this feature's index served the request.
                const useNativeSort = atlasSearchIndexName === ATLAS_SEARCH_INDEX_NAME &&
                    this.configManager.isAtlasSearchNativeSortEnabled;
                const searchStage = useNativeSort
                    ? {
                        $search: {
                            index: atlasSearchIndexName,
                            compound: atlasSearchCompound,
                            sort: { score: { $meta: 'searchScore' }, [defaultSortId]: 1 }
                        }
                    }
                    : { $search: { index: atlasSearchIndexName, compound: atlasSearchCompound } };
```

Then find every call site of `getCursorForQueryAsync` that currently passes `atlasSearchCompound`
(the caller receives `constructQueryAsync`'s return value and forwards it) — locate them with:

```bash
grep -rn "atlasSearchCompound" src/operations/search/searchManager.js src/operations/search/searchBundle.js
```

and add `atlasSearchIndexName: <same-source>.atlasSearchIndexName` next to each existing
`atlasSearchCompound: <same-source>.atlasSearchCompound` argument.

In `src/createContainer.js`, add the require near the existing `AtlasSearchQueryBuilder` one:

```js
const { FullTextSearchQueryBuilder } = require('./operations/search/fullTextSearchQueryBuilder');
```

Register it right after the existing `atlasSearchQueryBuilder` registration:

```js
    container.register('fullTextSearchQueryBuilder', (c) => new FullTextSearchQueryBuilder({
        configManager: c.configManager
    }));
```

Add `fullTextSearchQueryBuilder: c.fullTextSearchQueryBuilder` next to the existing
`atlasSearchQueryBuilder: c.atlasSearchQueryBuilder` line in `searchManager`'s registration block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/search/searchManager.test.js`
Expected: PASS (full file, including all pre-existing ADR-0003 Atlas tests — the
`atlasSearchIndexName === ATLAS_SEARCH_INDEX_NAME` check must not change behavior for any
existing Patient/Person/Practitioner test case)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/operations/search/searchManager.js src/createContainer.js src/tests/unit/operations/search/searchManager.test.js
git commit -m "Wire FullTextSearchQueryBuilder into SearchManager alongside AtlasSearchQueryBuilder"
```

---

## Task 5: Regex-fallback wiring — `SearchParametersManager`, `customQueries.js`, `r4.js`

**Files:**
- Modify: `src/searchParameters/searchParametersManager.js` (wherever `getPropertyObject` is
  defined — locate with `grep -n "getPropertyObject" src/searchParameters/searchParametersManager.js`)
- Modify: `src/operations/query/customQueries.js` (add `special: 'special'` to `fhirFilterTypes`)
- Modify: `src/operations/query/r4.js` (add a `case fhirFilterTypes.special:` to the switch in
  `getColumnsAndSegmentsForParameterType`, `src/operations/query/r4.js:222-257`)
- Test: `src/tests/unit/searchParameters/searchParametersManager.test.js` and
  `src/tests/unit/operations/query/r4.test.js` (extend both, if they exist — locate with
  `find src/tests/unit -iname "*r4*" -o -iname "*searchParametersManager*"`)

**Interfaces:**
- Produces: `getPropertyObject({resourceType, queryParameter: '_text'|'_content'})` now returns
  `{type: 'special', fields: [...], firstField: ...}` instead of `undefined`. Task 6 (`FilterBySpecialText`) consumes this via the normal `propertyObj` mechanism every other filter type already uses.

- [ ] **Step 1: Write the failing test**

Add to `src/tests/unit/searchParameters/searchParametersManager.test.js`:

```js
    test('getPropertyObject returns a special-type definition for _text', () => {
        const result = searchParametersManager.getPropertyObject({ resourceType: 'Condition', queryParameter: '_text' });
        expect(result.type).toBe('special');
        expect(result.fields).toEqual(['text.div']);
    });

    test('getPropertyObject returns a special-type definition for _content with the resourceType\'s string/token/uri fields', () => {
        const result = searchParametersManager.getPropertyObject({ resourceType: 'Condition', queryParameter: '_content' });
        expect(result.type).toBe('special');
        expect(result.fields.length).toBeGreaterThan(0);
        expect(result.fields).not.toContain('text.div');
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/searchParameters/searchParametersManager.test.js -t "_text\|_content"`
Expected: FAIL — `result` is `undefined`.

- [ ] **Step 3: Write the implementation**

Read `getPropertyObject`'s current body first (it looks up a per-resource generated table). Add,
as the very first check inside it (before the existing lookup):

```js
        if (queryParameter === '_text') {
            return new SearchParameterDefinition({ type: 'special', field: 'text.div', fields: ['text.div'] });
        }
        if (queryParameter === '_content') {
            const resourceFields = this.getAllFieldsForResourceType({ resourceType }) || [];
            const textLikeFields = resourceFields
                .filter((f) => ['string', 'token', 'uri'].includes(f.type))
                .flatMap((f) => f.fields);
            return new SearchParameterDefinition({ type: 'special', field: textLikeFields[0], fields: textLikeFields });
        }
```

(`getAllFieldsForResourceType` doesn't exist yet — check whether `searchParametersManager.js`
already exposes something equivalent, e.g. a method that returns every generated
`SearchParameterDefinition` for a resourceType, by searching for how it builds the table it
looks up in the existing `getPropertyObject` logic. If no such accessor exists, add one:
a `getAllFieldsForResourceType({resourceType})` method that returns the full list of
`SearchParameterDefinition`s already generated into `src/searchParameters/searchParameters.js`
for that resourceType, reusing whatever internal map/lookup `getPropertyObject` itself reads
from — do not re-parse `searchParameters.js` a second way.)

Use the exact `SearchParameterDefinition` constructor shape already used elsewhere in this file
(check an existing `return new SearchParameterDefinition({...})` call for the correct argument
names — likely `field`/`fields`/`type`, matching the composite-params work's own synthetic
definitions in `generate_search_parameters.py`'s output shape).

In `src/operations/query/customQueries.js`, add to the `fhirFilterTypes` object:

```js
    special: 'special',
```

In `src/operations/query/r4.js`, add a new case inside the `switch (propertyObj.type)` block in
`getColumnsAndSegmentsForParameterType` (near the existing `case fhirFilterTypes.string:`):

```js
                case fhirFilterTypes.special:
                    andSegments = new FilterBySpecialText(filterParameters).filter();
                    break;
```

Add the import at the top of `r4.js`, alongside the other `FilterBy*` imports:

```js
const { FilterBySpecialText } = require('./filters/specialText');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/searchParameters/searchParametersManager.test.js`
Expected: PASS

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/searchParameters/searchParametersManager.js src/operations/query/customQueries.js src/operations/query/r4.js src/tests/unit/searchParameters/searchParametersManager.test.js
git commit -m "Resolve _text/_content to a synthetic special-type SearchParameterDefinition"
```

---

## Task 6: `filters/specialText.js` — AST → Mongo regex tree

**Files:**
- Create: `src/operations/query/filters/specialText.js`
- Test: `src/tests/unit/operations/query/filters/specialText.test.js` (new — mirror
  `src/tests/unit/operations/query/filters/composite.test.js`'s `BaseFilter` mocking convention)

**Interfaces:**
- Consumes: `parseTextQuery` (Task 1), `propertyObj.fields` (Task 5's synthetic definition).
- Produces: `class FilterBySpecialText extends BaseFilter { filter(): object[] }` — the shape
  every other `FilterBy*` class already returns to `r4.js`.

- [ ] **Step 1: Write the failing tests**

```js
const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../operations/query/filters/baseFilter', () => ({
    BaseFilter: class BaseFilter {
        constructor (filterParameters) {
            this.propertyObj = filterParameters.propertyObj;
            this.parsedArg = filterParameters.parsedArg;
            this.fieldMapper = filterParameters.fieldMapper;
        }
    }
}));

const { FilterBySpecialText } = require('../../../../operations/query/filters/specialText');
const { BadRequestError } = require('../../../../utils/httpErrors');

describe('FilterBySpecialText', () => {
    function createFilter ({ fields, value, modifiers = [] }) {
        return new FilterBySpecialText({
            propertyObj: { fields },
            parsedArg: { queryParameterValue: { value }, modifiers },
            fieldMapper: { getFieldName: (f) => f }
        });
    }

    test('single term against one field', () => {
        const filter = createFilter({ fields: ['text.div'], value: 'diabetes' });
        expect(filter.filter()).toEqual([
            { $or: [{ 'text.div': { $regex: 'diabetes', $options: 'i' } }] }
        ]);
    });

    test('OR of terms against multiple fields', () => {
        const filter = createFilter({ fields: ['code.text', 'note.text'], value: 'bone OR liver' });
        expect(filter.filter()).toEqual([
            {
                $or: [
                    { $or: [{ 'code.text': { $regex: 'bone', $options: 'i' } }, { 'note.text': { $regex: 'bone', $options: 'i' } }] },
                    { $or: [{ 'code.text': { $regex: 'liver', $options: 'i' } }, { 'note.text': { $regex: 'liver', $options: 'i' } }] }
                ]
            }
        ]);
    });

    test('AND of terms across the field OR-groups', () => {
        const filter = createFilter({ fields: ['text.div'], value: 'diabetes hypertension' });
        expect(filter.filter()).toEqual([
            {
                $and: [
                    { $or: [{ 'text.div': { $regex: 'diabetes', $options: 'i' } }] },
                    { $or: [{ 'text.div': { $regex: 'hypertension', $options: 'i' } }] }
                ]
            }
        ]);
    });

    test('rejects a modifier other than not', () => {
        const filter = createFilter({ fields: ['text.div'], value: 'diabetes', modifiers: ['missing'] });
        expect(() => filter.filter()).toThrow(BadRequestError);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/filters/specialText.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```js
const { BadRequestError } = require('../../../utils/httpErrors');
const { BaseFilter } = require('./baseFilter');
const { parseTextQuery } = require('../../../utils/textQueryParser');

const REJECTED_MODIFIERS = ['missing', 'contains', 'above', 'below', 'text', 'of-type', 'exact'];

/**
 * Regex-tree fallback for _text/_content -- used whenever the Atlas Search path
 * (FullTextSearchQueryBuilder, hooked into SearchManager) wasn't taken for this request: the
 * resourceType isn't in fullTextSearchAtlasIndexedResources, or the Atlas $search call errored
 * mid-request. AST -> $and/$or regex tree, OR'd across propertyObj.fields (['text.div'] for
 * _text; every string/token/uri field for _content, per SearchParametersManager.getPropertyObject).
 */
class FilterBySpecialText extends BaseFilter {
    filter () {
        const modifiers = this.parsedArg.modifiers || [];
        if (REJECTED_MODIFIERS.some((m) => modifiers.includes(m))) {
            throw new BadRequestError(
                new Error(
                    `Modifiers [${REJECTED_MODIFIERS.join(', ')}] are not supported on _text/_content ` +
                        `(got: ${modifiers.join(', ')})`
                )
            );
        }
        const ast = parseTextQuery(this.parsedArg.queryParameterValue.value);
        return [this._astToFilter(ast)];
    }

    /**
     * @param {{type: string, value?: string, children?: object[]}} node
     * @return {object}
     */
    _astToFilter (node) {
        switch (node.type) {
            case 'term':
            case 'phrase':
                return {
                    $or: this.propertyObj.fields.map((field) => ({
                        [this.fieldMapper.getFieldName(field)]: { $regex: node.value, $options: 'i' }
                    }))
                };
            case 'and':
                return { $and: node.children.map((c) => this._astToFilter(c)) };
            case 'or':
                return { $or: node.children.map((c) => this._astToFilter(c)) };
            default:
                throw new Error(`Unknown text query AST node type: ${node.type}`);
        }
    }
}

module.exports = {
    FilterBySpecialText
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/filters/specialText.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/operations/query/filters/specialText.js src/tests/unit/operations/query/filters/specialText.test.js
git commit -m "Add FilterBySpecialText: AST to Mongo regex tree fallback for _text/_content"
```

---

## Task 7: Atlas Search index definition + admin script

**Files:**
- Create: `src/admin/scripts/fullTextSearchIndexes/definition.json`
- Create: `src/admin/scripts/fullTextSearchIndexHelper.js` (parallel to, not modifying,
  `atlasSearchIndexHelper.js`)
- Create: `src/admin/scripts/createFullTextSearchIndexes.js` (parallel to
  `createAtlasSearchIndexes.js`)
- Test: `src/tests/unit/admin/scripts/fullTextSearchIndexHelper.test.js` (new — mirror whatever
  test coverage `atlasSearchIndexHelper.js` has, if any; if none exists, write unit tests against
  a mocked `collection` object for `createOrUpdateFullTextSearchIndexAsync`)

**Interfaces:**
- Produces: `createAllFullTextSearchIndexesAsync({getCollectionAsync, adminLogger, resourceTypes})`.

- [ ] **Step 1: Write the definition file**

```json
{
    "mappings": {
        "dynamic": true
    }
}
```

- [ ] **Step 2: Write the failing test**

```js
const { describe, test, expect, jest: jestObj } = require('@jest/globals');
const { createOrUpdateFullTextSearchIndexAsync } = require('../../../../admin/scripts/fullTextSearchIndexHelper');

describe('fullTextSearchIndexHelper', () => {
    test('creates the index and waits for READY when none exists yet', async () => {
        const collection = {
            collectionName: 'Condition_4_0_0',
            listSearchIndexes: jestObj.fn(() => ({
                toArray: jestObj.fn()
                    .mockResolvedValueOnce([])
                    .mockResolvedValueOnce([{ status: 'READY' }])
            })),
            createSearchIndex: jestObj.fn().mockResolvedValue(undefined),
            dropSearchIndex: jestObj.fn()
        };
        const adminLogger = { logInfo: jestObj.fn() };

        await createOrUpdateFullTextSearchIndexAsync({ collection, adminLogger });

        expect(collection.dropSearchIndex).not.toHaveBeenCalled();
        expect(collection.createSearchIndex).toHaveBeenCalledWith({
            name: 'fhir-full-text-search',
            definition: { mappings: { dynamic: true } }
        });
    });

    test('drops and recreates when the index already exists', async () => {
        const collection = {
            collectionName: 'Condition_4_0_0',
            listSearchIndexes: jestObj.fn(() => ({
                toArray: jestObj.fn()
                    .mockResolvedValueOnce([{ status: 'READY' }])
                    .mockResolvedValueOnce([{ status: 'READY' }])
            })),
            createSearchIndex: jestObj.fn().mockResolvedValue(undefined),
            dropSearchIndex: jestObj.fn().mockResolvedValue(undefined)
        };
        const adminLogger = { logInfo: jestObj.fn() };

        await createOrUpdateFullTextSearchIndexAsync({ collection, adminLogger });

        expect(collection.dropSearchIndex).toHaveBeenCalledWith('fhir-full-text-search');
    });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/admin/scripts/fullTextSearchIndexHelper.test.js`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 4: Write the implementation**

```js
const fs = require('fs');
const path = require('path');

const FULL_TEXT_SEARCH_INDEX_NAME = 'fhir-full-text-search';
const DEFINITION_PATH = path.join(__dirname, 'fullTextSearchIndexes', 'definition.json');
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

/**
 * One shared dynamic-mapping definition applies to every configured resourceType's collection --
 * unlike hybrid-full-text-search's bespoke per-resource-type field mappings, this index needs no
 * per-resource JSON files, since _text/_content scoping happens via query-time `path`
 * (FullTextSearchQueryBuilder), not index-time field selection.
 * @return {object}
 */
function readDefinition () {
    return JSON.parse(fs.readFileSync(DEFINITION_PATH, 'utf8'));
}

/**
 * @param {import('mongodb').Collection} collection
 * @param {{logInfo: function(string): void}} adminLogger
 * @returns {Promise<void>}
 */
async function waitForFullTextSearchIndexReadyAsync ({ collection, adminLogger }) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const indexes = await collection.listSearchIndexes(FULL_TEXT_SEARCH_INDEX_NAME).toArray();
        const index = indexes[0];
        if (index && index.status === 'READY') {
            return;
        }
        if (index && index.status === 'FAILED') {
            throw new Error(
                `Search index '${FULL_TEXT_SEARCH_INDEX_NAME}' on ${collection.collectionName} failed to build: ` +
                `${JSON.stringify(index.statusDetail || index)}`
            );
        }
        adminLogger.logInfo(
            `Waiting for search index '${FULL_TEXT_SEARCH_INDEX_NAME}' on ${collection.collectionName} ` +
            `(status: ${index ? index.status : 'not found yet'})`
        );
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(
        `Timed out after ${POLL_TIMEOUT_MS}ms waiting for search index '${FULL_TEXT_SEARCH_INDEX_NAME}' ` +
        `on ${collection.collectionName} to become READY`
    );
}

/**
 * @param {import('mongodb').Collection} collection
 * @param {{logInfo: function(string): void}} adminLogger
 * @returns {Promise<void>}
 */
async function createOrUpdateFullTextSearchIndexAsync ({ collection, adminLogger }) {
    const definition = readDefinition();
    const existingIndexes = await collection.listSearchIndexes(FULL_TEXT_SEARCH_INDEX_NAME).toArray();
    if (existingIndexes.length > 0) {
        adminLogger.logInfo(
            `Search index '${FULL_TEXT_SEARCH_INDEX_NAME}' already exists on ${collection.collectionName}; ` +
            'dropping and recreating so it matches the current definition file'
        );
        await collection.dropSearchIndex(FULL_TEXT_SEARCH_INDEX_NAME);
    }
    await collection.createSearchIndex({ name: FULL_TEXT_SEARCH_INDEX_NAME, definition });
    adminLogger.logInfo(`Submitted search index '${FULL_TEXT_SEARCH_INDEX_NAME}' on ${collection.collectionName}`);
    await waitForFullTextSearchIndexReadyAsync({ collection, adminLogger });
    adminLogger.logInfo(`Search index '${FULL_TEXT_SEARCH_INDEX_NAME}' on ${collection.collectionName} is READY`);
}

/**
 * @param {{getCollectionAsync: function(string): Promise<import('mongodb').Collection>, adminLogger: {logInfo: function(string): void}, resourceTypes: string[]}} params
 * @returns {Promise<void>}
 */
async function createAllFullTextSearchIndexesAsync ({ getCollectionAsync, adminLogger, resourceTypes }) {
    for (const resourceType of resourceTypes) {
        const collection = await getCollectionAsync(resourceType);
        await createOrUpdateFullTextSearchIndexAsync({ collection, adminLogger });
    }
}

module.exports = {
    FULL_TEXT_SEARCH_INDEX_NAME,
    createOrUpdateFullTextSearchIndexAsync,
    createAllFullTextSearchIndexesAsync
};
```

```js
// src/admin/scripts/createFullTextSearchIndexes.js
const { createContainer } = require('../../createContainer');
const { AdminLogger } = require('../adminLogger');
const { createAllFullTextSearchIndexesAsync } = require('./fullTextSearchIndexHelper');

const BASE_VERSION = '4_0_0';

/**
 * Creates (or, if already present, drops and recreates) the `fhir-full-text-search` Atlas Search
 * index on every resourceType listed in FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES, from the
 * shared dynamic-mapping definition in ./fullTextSearchIndexes/definition.json, then waits for
 * each to reach READY. Requires a MongoDB deployment that supports Atlas Search (e.g.
 * mongodb/mongodb-atlas-local, per ADR-0003's local docker-compose.yml).
 * @returns {Promise<void>}
 */
async function main () {
    const container = createContainer();
    const adminLogger = new AdminLogger();
    const resourceLocatorFactory = container.resourceLocatorFactory;
    const resourceTypes = container.configManager.fullTextSearchAtlasIndexedResources;

    await createAllFullTextSearchIndexesAsync({
        getCollectionAsync: async (resourceType) => {
            const resourceLocator = resourceLocatorFactory.createResourceLocator({ resourceType, base_version: BASE_VERSION });
            return resourceLocator.getCollectionAsync({});
        },
        adminLogger,
        resourceTypes
    });

    process.exit(0);
}

/**
 * Command: node src/admin/scripts/createFullTextSearchIndexes.js
 * Requires FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES set to the resource types to index, plus the
 * same MONGO_URL/MONGO_USERNAME/MONGO_PASSWORD/MONGO_DB_NAME environment variables
 * createCollections.js needs, pointed at a deployment that supports Atlas Search.
 */
main().catch((reason) => {
    console.error(reason);
    process.exit(1);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/admin/scripts/fullTextSearchIndexHelper.test.js`
Expected: PASS (both tests)

- [ ] **Step 6: Lint and commit**

```bash
yarn run fix_lint
git add src/admin/scripts/fullTextSearchIndexes/definition.json src/admin/scripts/fullTextSearchIndexHelper.js src/admin/scripts/createFullTextSearchIndexes.js src/tests/unit/admin/scripts/fullTextSearchIndexHelper.test.js
git commit -m "Add fhir-full-text-search Atlas Search index definition and admin creation script"
```

---

## Task 8: Integration tests + documentation

**Files:**
- Create: `src/tests/integration/searchParameters/search_by_text/search_by_text.test.js`
- Create: `src/tests/integration/searchParameters/search_by_content/search_by_content.test.js`
- Modify: `readme/cheatsheet.md`

Follow the existing `search_by_composite/search_by_composite.test.js` convention exactly for
fixture loading and request assertions (read that file first).

- [ ] **Step 1: Regex-fallback integration tests (no Atlas required)**

In both new test files, add a case with `FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES` unset (the
default in the test environment): create two `Condition` fixtures differing only in narrative
(`text.div`) content, search `_text=diabetes`, assert only the matching one is returned. Repeat
for `_content` against a non-narrative field (e.g. `code.text`).

- [ ] **Step 2: Atlas-path integration tests (requires `mongodb-atlas-local`)**

Reuse ADR-0003's `jest.atlasSearch.config.js`/`atlasSearchGlobalSetup.js`/
`atlasSearchTestRunner.js` infra (already built for the Patient/Person/Practitioner feature) —
add this suite's resourceType to that setup's index-creation step (call
`createOrUpdateFullTextSearchIndexAsync` from Task 7 alongside whatever it already calls for
`hybrid-full-text-search`), set `FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES=Condition` for the
test run, and assert the same narrowing behavior as Step 1 now goes through the `$search`
pipeline (e.g. by asserting on a `databaseQueryManager.findUsingAggregationAsync` spy, or by
checking Mongo server logs/profiler for the aggregation call, matching whatever verification
technique the existing ADR-0003 Atlas integration tests already use).

- [ ] **Step 3: Atlas-error fallback test**

Point `FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES` at a resourceType whose Atlas index was
deliberately never created, and confirm the request still succeeds (via the regex fallback) with
no user-visible error — mirroring however ADR-0003's own fallback test simulates a missing index.

- [ ] **Step 4: Documentation**

Add a new subsection to `readme/cheatsheet.md`, near the existing composite-parameters section,
documenting `_text`/`_content` syntax (`AND`/`OR`/parens/quoted phrases, per the spec example),
and that behavior is either Atlas-Search-backed (relevance-scored) or regex-based (unscored)
depending on whether the resourceType is listed in `FULL_TEXT_SEARCH_ATLAS_INDEXED_RESOURCES`.

- [ ] **Step 5: Commit**

```bash
git add src/tests/integration/searchParameters/search_by_text src/tests/integration/searchParameters/search_by_content readme/cheatsheet.md
git commit -m "Add integration tests and documentation for _text/_content"
```

---

## Self-Review Notes (for the plan author, not a task to execute)

- **Spec coverage:** Task 1 = grammar/AST. Task 2 = config gate. Task 3 = Atlas backend +
  mutual-exclusion rule. Task 4 = SearchManager/createContainer wiring, including the
  index-name-parameterization and native-sort-gating wrinkles the spec's Architecture section
  calls for but doesn't spell out in code (added here after reading the real current
  `searchManager.js`). Task 5 = regex-fallback reachability (`getPropertyObject`,
  `fhirFilterTypes.special`, `r4.js`). Task 6 = regex backend. Task 7 = index definition + admin
  script. Task 8 = integration tests + docs — covers all of the spec's Testing Plan items.
- **Placeholder scan:** Task 4's test step and Task 8 use structural skeletons with explicit
  "read file X, reuse pattern Y" instructions rather than invented mock scaffolding, because the
  actual current test files' helpers weren't loaded into this planning session — this is a
  deliberate, narrow exception where guessing a fake mock shape would be worse than pointing at
  the real file to copy from. Every other step has real, complete code.
- **Type consistency:** `FullTextSearchQueryBuilder.buildSearchQuery`'s return shape
  (`{must: object[]}|null`) matches `AtlasSearchQueryBuilder.buildSearchQuery`'s existing shape
  exactly, so `SearchManager`'s handling is symmetric between the two builders.
