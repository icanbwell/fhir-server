# Search Value Escaping (`\$`, `\,`, `\|`, `\\`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every place this codebase splits a search value on `,`, `|`, or `$` respect
backslash-escaping (`\,`, `\|`, `\$`, `\\`) per the FHIR search spec
(https://hl7.org/fhir/R4B/search.html#escaping), instead of naively splitting on every literal
occurrence of the character.

**Architecture:** One new pure-function utility (`splitUnescaped` / `unescapeSearchValue`)
replaces every existing naive `.split(',')` / `.split('|')` / `.split('$')` call site across
`queryParameterValue.js`, `parsedArgsItem.js`, `querybuilder.util.js`, and
`filters/composite.js`. Splitting never unescapes (so a later stage's escape marker survives);
only the true leaf value (about to become a literal Mongo match/regex value) calls the unescape
function, exactly once.

**Tech Stack:** Node.js / CommonJS, Jest, MongoDB filter documents (no schema/index changes).

**Spec:** `docs/superpowers/specs/2026-09-06-search-value-escaping-design.md`

## Global Constraints

- No unescaping happens until a string has finished all delimiter-splitting it will ever go
  through — composite's `$`-split must NOT unescape `\|`/`\,`, since the token/quantity filters it
  hands each component to still need those escape markers intact.
- A lone trailing backslash, or a backslash followed by a character that isn't `$`/`,`/`|`/`\`, is
  passed through literally — never throw for this.
- Every new/modified function must have a docstring-level comment only where the *why* isn't
  obvious from the code (per this repo's comment convention) — no restating what the code does.
- Follow existing test file conventions exactly (see each task) — extend the existing test file
  for a module, don't create a parallel one.

---

## Task 1: `searchValueEscaping.js` utility

**Files:**
- Create: `src/utils/searchValueEscaping.js`
- Test: `src/tests/unit/utils/searchValueEscaping.test.js` (new)

**Interfaces:**
- Produces: `splitUnescaped(value: string, delimiter: string): string[]` and
  `unescapeSearchValue(value: string): string`, both exported from
  `src/utils/searchValueEscaping.js`. Every later task imports one or both of these.

- [ ] **Step 1: Write the failing tests**

```js
const { describe, test, expect } = require('@jest/globals');
const { splitUnescaped, unescapeSearchValue } = require('../../../utils/searchValueEscaping');

describe('searchValueEscaping', () => {
    describe('splitUnescaped', () => {
        test('splits on an unescaped delimiter', () => {
            expect(splitUnescaped('a,b', ',')).toEqual(['a', 'b']);
        });

        test('does not split on an escaped delimiter', () => {
            expect(splitUnescaped('a\\,b', ',')).toEqual(['a\\,b']);
        });

        test('splits on a real delimiter after an escaped one', () => {
            expect(splitUnescaped('a\\,b,c', ',')).toEqual(['a\\,b', 'c']);
        });

        test('treats an even run of backslashes before the delimiter as not escaping it', () => {
            expect(splitUnescaped('a\\\\,b', ',')).toEqual(['a\\\\', 'b']);
        });

        test('treats an odd run of backslashes before the delimiter as escaping it', () => {
            expect(splitUnescaped('a\\\\\\,b', ',')).toEqual(['a\\\\\\,b']);
        });

        test('only splits on the given delimiter, leaving other separator characters alone', () => {
            expect(splitUnescaped('a|b,c', ',')).toEqual(['a|b', 'c']);
        });

        test('returns the original single-element array when there is no delimiter', () => {
            expect(splitUnescaped('abc', ',')).toEqual(['abc']);
        });

        test('returns [value] unchanged for non-string input', () => {
            expect(splitUnescaped(undefined, ',')).toEqual([undefined]);
        });

        test('handles an empty string', () => {
            expect(splitUnescaped('', ',')).toEqual(['']);
        });
    });

    describe('unescapeSearchValue', () => {
        test('unescapes an escaped comma', () => {
            expect(unescapeSearchValue('a\\,b')).toBe('a,b');
        });

        test('unescapes an escaped pipe', () => {
            expect(unescapeSearchValue('a\\|b')).toBe('a|b');
        });

        test('unescapes an escaped dollar sign', () => {
            expect(unescapeSearchValue('a\\$b')).toBe('a$b');
        });

        test('unescapes an escaped backslash', () => {
            expect(unescapeSearchValue('a\\\\b')).toBe('a\\b');
        });

        test('collapses two consecutive escaped backslashes to two literal backslashes', () => {
            expect(unescapeSearchValue('a\\\\\\\\b')).toBe('a\\\\b');
        });

        test('passes a trailing lone backslash through literally', () => {
            expect(unescapeSearchValue('abc\\')).toBe('abc\\');
        });

        test('passes a backslash followed by a non-escapable character through literally', () => {
            expect(unescapeSearchValue('a\\nb')).toBe('a\\nb');
        });

        test('returns non-string input unchanged', () => {
            expect(unescapeSearchValue(undefined)).toBe(undefined);
        });

        test('handles an empty string', () => {
            expect(unescapeSearchValue('')).toBe('');
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/searchValueEscaping.test.js`
Expected: FAIL — `Cannot find module '../../../utils/searchValueEscaping'`

- [ ] **Step 3: Write the implementation**

```js
/**
 * Escape-aware splitting/unescaping for FHIR search values, per
 * https://hl7.org/fhir/R4B/search.html#escaping — ',', '|', '$', and '\' are separator/escape
 * characters; a literal occurrence of the first three must be backslash-escaped by the caller,
 * and a literal '\' must be escaped as '\\'.
 *
 * A search value can pass through more than one delimiter-splitting stage before reaching a
 * leaf use (e.g. a composite component: split on '$', then handed to a token filter that splits
 * on '|'). splitUnescaped() never unescapes -- doing so early would destroy an escape marker a
 * later stage still needs. Only unescapeSearchValue() actually converts escape sequences to
 * literal characters, and it must be called exactly once, at the true leaf (the point where a
 * string is about to become a literal Mongo match/regex value, with no further delimiter
 * splitting ahead of it).
 */

const ESCAPABLE_CHARS = new Set(['$', ',', '|', '\\']);

/**
 * Splits `value` on every occurrence of `delimiter` that is not escaped -- a delimiter is
 * escaped if it's preceded by an odd number of consecutive backslashes. Backslash sequences are
 * left untouched in the returned parts (no unescaping here).
 * @param {string} value
 * @param {string} delimiter a single character
 * @return {string[]}
 */
function splitUnescaped (value, delimiter) {
    if (typeof value !== 'string') {
        return [value];
    }
    const parts = [];
    let current = '';
    let backslashRun = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\') {
            backslashRun++;
            current += ch;
            continue;
        }
        if (ch === delimiter && backslashRun % 2 === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
        backslashRun = 0;
    }
    parts.push(current);
    return parts;
}

/**
 * Converts '\$', '\,', '\|', '\\' to their literal characters. A lone trailing backslash, or a
 * backslash followed by a character that isn't one of the four escapable characters, is passed
 * through literally rather than treated as an error -- rejecting it risks breaking a free-text
 * value that happens to contain a backslash for unrelated reasons.
 * @param {string} value
 * @return {string}
 */
function unescapeSearchValue (value) {
    if (typeof value !== 'string') {
        return value;
    }
    let result = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\' && i + 1 < value.length && ESCAPABLE_CHARS.has(value[i + 1])) {
            result += value[i + 1];
            i++;
        } else {
            result += ch;
        }
    }
    return result;
}

module.exports = {
    splitUnescaped,
    unescapeSearchValue
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/searchValueEscaping.test.js`
Expected: PASS (all 19 tests)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/utils/searchValueEscaping.js src/tests/unit/utils/searchValueEscaping.test.js
git commit -m "Add escape-aware split/unescape utility for FHIR search values"
```

---

## Task 2: `QueryParameterValue` — escape-aware comma handling

**Files:**
- Modify: `src/operations/query/queryParameterValue.js:30` and `:52`
- Test: `src/tests/unit/operations/query/queryParameterValue.test.js` (extend)

**Interfaces:**
- Consumes: `splitUnescaped(value, ',')` from Task 1.
- Produces: no interface change — `QueryParameterValue.values`/`.operator` now correctly treat an
  escaped comma as non-splitting. Later tasks that call into `QueryParameterValue` are unaffected.

- [ ] **Step 1: Write the failing tests**

Add to `src/tests/unit/operations/query/queryParameterValue.test.js`, inside the existing
`describe('constructor', ...)` block:

```js
        test('does not set operator to $or when the only comma is escaped', () => {
            const qpv = new QueryParameterValue({ value: 'Smith\\, John' });
            expect(qpv.operator).toBe('$and');
        });

        test('still sets operator to $or when an unescaped comma follows an escaped one', () => {
            const qpv = new QueryParameterValue({ value: 'Smith\\, John,Patient/2' });
            expect(qpv.operator).toBe('$or');
        });
```

Add a new top-level `describe('values (escaping)', ...)` block:

```js
    describe('values (escaping)', () => {
        test('keeps an escaped comma inside a single value', () => {
            const qpv = new QueryParameterValue({ value: 'Smith\\, John' });
            expect(qpv.values).toEqual(['Smith\\, John']);
        });

        test('splits on an unescaped comma after an escaped one', () => {
            const qpv = new QueryParameterValue({ value: 'Smith\\, John,Patient/2' });
            expect(qpv.values).toEqual(['Smith\\, John', 'Patient/2']);
        });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/queryParameterValue.test.js`
Expected: FAIL — the two new constructor tests and the two new `values` tests report `$or` /
extra-split results instead of the expected escape-aware ones.

- [ ] **Step 3: Write the implementation**

In `src/operations/query/queryParameterValue.js`, add the import at the top:

```js
const { splitUnescaped } = require('../../utils/searchValueEscaping');
```

Replace the constructor's operator-detection (currently line 30):

```js
        if (typeof value === 'string' && value.includes(',')) {
            this.operator = '$or';
        }
```

with:

```js
        if (typeof value === 'string' && splitUnescaped(value, ',').length > 1) {
            this.operator = '$or';
        }
```

Replace `parseQueryParameterValueIntoArrayIfNeeded`'s split (currently line 52):

```js
            const parts = queryParameterValue.split(',');
```

with:

```js
            const parts = splitUnescaped(queryParameterValue, ',');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/queryParameterValue.test.js`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/operations/query/queryParameterValue.js src/tests/unit/operations/query/queryParameterValue.test.js
git commit -m "Make QueryParameterValue's comma-OR-split escape-aware"
```

---

## Task 3: `ParsedArgsItem.applyModifierToQueryParameterValue` — escape-aware comma split

**Files:**
- Modify: `src/operations/query/parsedArgsItem.js:88`
- Test: `src/tests/unit/operations/query/parsedArgsItem.test.js` (extend)

**Interfaces:**
- Consumes: `splitUnescaped(value, ',')` from Task 1.

This function only runs when `this.propertyObj.target` includes one of the current `modifiers`
(i.e. a reference-type search parameter with a `ResourceType:` modifier, e.g.
`subject:Patient=Smith\, John`) — find the existing test(s) exercising
`applyModifierToQueryParameterValue` to match the exact `propertyObj`/`modifiers` shape already
used there before adding the new case.

- [ ] **Step 1: Write the failing test**

First, locate how the existing suite constructs a `ParsedArgsItem` that exercises
`applyModifierToQueryParameterValue` (search the test file for `target:` in a `propertyObj`).
Add a new test alongside it:

```js
    test('does not split an escaped comma when applying a target modifier', () => {
        const item = new ParsedArgsItem({
            queryParameter: 'subject',
            queryParameterValue: new QueryParameterValue({ value: 'Smith\\, John' }),
            propertyObj: new SearchParameterDefinition({
                target: ['Patient'],
                type: 'reference',
                fields: ['subject'],
                field: 'subject'
            }),
            modifiers: ['Patient']
        });
        expect(item.queryParameterValue.value).toEqual(['Patient/Smith\\, John']);
    });
```

(Adjust the `SearchParameterDefinition` constructor args to match whatever shape the existing
`target`-modifier test in this file already uses — reuse that exact pattern rather than
inventing a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/parsedArgsItem.test.js -t "does not split an escaped comma"`
Expected: FAIL — value is split into `['Patient/Smith\\', 'Patient/ John']` (two elements) instead
of one.

- [ ] **Step 3: Write the implementation**

In `src/operations/query/parsedArgsItem.js`, add the import at the top:

```js
const { splitUnescaped } = require('../../utils/searchValueEscaping');
```

Replace the split inside `applyModifierToQueryParameterValue` (currently):

```js
                const queryParameterValues = this.queryParameterValue.value.split(',');
```

with:

```js
                const queryParameterValues = splitUnescaped(this.queryParameterValue.value, ',');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/parsedArgsItem.test.js`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/operations/query/parsedArgsItem.js src/tests/unit/operations/query/parsedArgsItem.test.js
git commit -m "Make ParsedArgsItem's target-modifier comma-split escape-aware"
```

---

## Task 4: `querybuilder.util.js` — `tokenQueryBuilder` and `tokenQueryContainsBuilder`

**Files:**
- Modify: `src/utils/querybuilder.util.js` (`tokenQueryBuilder` ~line 147,
  `tokenQueryContainsBuilder` ~line 225)
- Test: `src/tests/unit/utils/querybuilder.util.test.js` (extend)

**Interfaces:**
- Consumes: `splitUnescaped`, `unescapeSearchValue` from Task 1.
- Produces: no signature change to either function.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('tokenQueryBuilder', ...)` block:

```js
        test('unescapes an escaped pipe within the system portion', () => {
            const result = tokenQueryBuilder({
                target: 'http://x\\|y|actual-code',
                type: 'code',
                field: 'code.coding',
                resourceType: 'Observation'
            });
            expect(result).toEqual({
                'code.coding.system': 'http://x|y',
                'code.coding.code': 'actual-code'
            });
        });

        test('unescapes an escaped comma within the value portion (single value, not split)', () => {
            const result = tokenQueryBuilder({
                target: 'sys|a\\,b',
                type: 'code',
                field: 'code.coding',
                resourceType: 'Observation'
            });
            expect(result).toEqual({
                'code.coding.system': 'sys',
                'code.coding.code': 'a,b'
            });
        });
```

Add to the existing `describe('tokenQueryContainsBuilder', ...)` block:

```js
        test('unescapes an escaped pipe within the system portion', () => {
            const result = tokenQueryContainsBuilder({
                target: 'http://x\\|y|actual',
                type: 'code',
                field: 'code.coding'
            });
            expect(result['code.coding.system'].$regex).toBe('http\\:\\/\\/x\\|y');
        });

        test('does not split an escaped comma within the value portion', () => {
            const result = tokenQueryContainsBuilder({
                target: 'a\\,b',
                type: 'code',
                field: 'code.coding'
            });
            expect(result['code.coding.code'].$regex).toBe('a\\,b');
        });
```

(The exact expected `$regex` strings above must match whatever `escapeRegExp` produces for those
inputs on this branch — run the test once, read the actual failure output, and correct the
literal expected strings to match if they differ; the *behavior* under test — one unescaped
value, not two — is what matters, not the exact regex-escaping output.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/querybuilder.util.test.js -t "unescapes an escaped"`
Expected: FAIL — `system`/`code` end up split into extra pieces or still contain the backslash.

- [ ] **Step 3: Write the implementation**

Add the import near the top of `src/utils/querybuilder.util.js`:

```js
const { splitUnescaped, unescapeSearchValue } = require('./searchValueEscaping');
```

In `tokenQueryBuilder`, replace:

```js
    if (typeof target === 'string' && target.includes('|')) {
        [system, value] = target.split('|');
    } else {
        value = target;
    }
```

with:

```js
    if (typeof target === 'string' && target.includes('|')) {
        [system, value] = splitUnescaped(target, '|').map(unescapeSearchValue);
    } else {
        value = typeof target === 'string' ? unescapeSearchValue(target) : target;
    }
```

Leave the rest of `tokenQueryBuilder` unchanged (including its own `value.includes(',')` /
`value.split(',')` for the `$in` case) — `value` is now already unescaped, so a literal comma
that survived (because it was never escaped) still correctly means "multiple values" per FHIR's
own token-list convention, and an escaped comma (`\,`) is already gone by this point, so it can
no longer trigger that split at all. No further change needed there.

Apply the identical pattern to `tokenQueryContainsBuilder` — replace:

```js
    if (typeof target === 'string' && target.includes('|')) {
        [system, value] = target.split('|');
    } else {
        value = target;
    }
```

with:

```js
    if (typeof target === 'string' && target.includes('|')) {
        [system, value] = splitUnescaped(target, '|').map(unescapeSearchValue);
    } else {
        value = typeof target === 'string' ? unescapeSearchValue(target) : target;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/querybuilder.util.test.js`
Expected: PASS (full file, no regressions in the other ~15 describe blocks)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/utils/querybuilder.util.js src/tests/unit/utils/querybuilder.util.test.js
git commit -m "Make tokenQueryBuilder/tokenQueryContainsBuilder's pipe-split escape-aware"
```

---

## Task 5: `querybuilder.util.js` — `tokenIdentifierOfTypeQueryBuilder`, `extensionQueryBuilder`, `quantityQueryBuilder`

**Files:**
- Modify: `src/utils/querybuilder.util.js` (`tokenIdentifierOfTypeQueryBuilder` ~line 292,
  `extensionQueryBuilder` ~line 1271, `quantityQueryBuilder` ~line 455)
- Test: `src/tests/unit/utils/querybuilder.util.test.js` (extend)

**Interfaces:**
- Consumes: `splitUnescaped`, `unescapeSearchValue` from Task 1 (already imported in this file by
  Task 4).

- [ ] **Step 1: Write the failing tests**

Add to `describe('tokenIdentifierOfTypeQueryBuilder', ...)`:

```js
        test('unescapes an escaped pipe within one of the three parts', () => {
            const result = tokenIdentifierOfTypeQueryBuilder({
                target: 'http://x\\|y|SB|123456',
                field: 'identifier'
            });
            expect(result.$and[0].identifier.$elemMatch['type.coding.system']).toBe('http://x|y');
            expect(result.$and[0].identifier.$elemMatch['type.coding.code']).toBe('SB');
            expect(result.$and[1]['identifier.value']).toBe('123456');
        });
```

Add to `describe('extensionQueryBuilder', ...)`:

```js
        test('unescapes an escaped pipe within the url portion', () => {
            const result = extensionQueryBuilder({
                target: 'http://x\\|y|value',
                type: 'valueString',
                field: 'extension',
                resourceType: 'Patient'
            });
            const elemMatch = result.extension.$elemMatch || result.extension;
            expect(JSON.stringify(result)).toContain('http://x|y');
            expect(JSON.stringify(result)).not.toContain('http://x\\\\|y');
        });
```

Add to `describe('quantityQueryBuilder', ...)`:

```js
        test('unescapes an escaped pipe within the system portion', () => {
            const result = quantityQueryBuilder({
                target: '5.4|http://unitsofmeasure\\|org|mg',
                field: 'valueQuantity'
            });
            expect(result['valueQuantity.system']).toBe('http://unitsofmeasure|org');
            expect(result['valueQuantity.code']).toBe('mg');
        });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/querybuilder.util.test.js -t "unescapes an escaped pipe"`
Expected: FAIL for all three new tests — each currently mis-splits on the escaped pipe.

- [ ] **Step 3: Write the implementation**

In `tokenIdentifierOfTypeQueryBuilder`, replace:

```js
    let targetArray = target.split('|').filter((t) => t !== '');
```

with:

```js
    let targetArray = splitUnescaped(target, '|').map(unescapeSearchValue).filter((t) => t !== '');
```

In `extensionQueryBuilder`, replace:

```js
    if (typeof target === 'string' && target.includes('|')) {
        [url, value] = target.split('|');
    } else {
        value = target;
    }
```

with:

```js
    if (typeof target === 'string' && target.includes('|')) {
        [url, value] = splitUnescaped(target, '|').map(unescapeSearchValue);
    } else {
        value = typeof target === 'string' ? unescapeSearchValue(target) : target;
    }
```

In `quantityQueryBuilder`, replace:

```js
    // split by the two pipes
    let [num, system, code] = target.split('|');
```

with:

```js
    // split by the two pipes
    let [num, system, code] = splitUnescaped(target, '|');
    if (system) {
        system = unescapeSearchValue(system);
    }
    if (code) {
        code = unescapeSearchValue(code);
    }
```

(`num` is deliberately left un-unescaped — it's parsed as a number a few lines below via
`Number(strNum)`/`isNaN(num)`, so it never legitimately contains an escape sequence, and running
it through `unescapeSearchValue` would be a no-op for any valid numeric-with-prefix value anyway.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/utils/querybuilder.util.test.js`
Expected: PASS (full file)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/utils/querybuilder.util.js src/tests/unit/utils/querybuilder.util.test.js
git commit -m "Make remaining querybuilder.util pipe-splits escape-aware"
```

---

## Task 6: `FilterByComposite.filterOneValue` — escape-aware `$`-split

**Files:**
- Modify: `src/operations/query/filters/composite.js`
- Test: `src/tests/unit/operations/query/filters/composite.test.js` (extend)

**Interfaces:**
- Consumes: `splitUnescaped` from Task 1. Deliberately does **not** call `unescapeSearchValue` —
  each resulting component string is handed to `FilterByToken`/`FilterByQuantity`/etc. (via
  `filterOneComponent`), which apply their own splitting/unescaping from Tasks 4-5.

- [ ] **Step 1: Write the failing test**

First read `src/tests/unit/operations/query/filters/composite.test.js` to find how it mocks
`FilterByToken`/`FilterByString`/etc. and constructs a `propertyObj.scopes` fixture for a
2-component, root-scope-only composite (mirrors the existing "root-only AND" test in that file).
Add a new test using the same fixture shape:

```js
    test('does not split an escaped $ within a component value', () => {
        // Using the same 2-component root-scope fixture as the "root-only AND" test above, but
        // with a component value containing an escaped '$'.
        const filter = createCompositeFilter({
            /* same propertyObj.scopes fixture as the existing root-only test */
        });
        filter.parsedArg.queryParameterValue = new QueryParameterValue({
            value: 'a\\$b$1234-5',
            operator: '$and'
        });

        const result = filter.filter();

        // The mocked first-component filter class must have been called with the single,
        // unsplit value 'a\$b' (still escaped -- FilterByComposite must not unescape it itself),
        // not two separate values from an incorrect 3-way split.
        expect(mockFilterByStringInstanceFilter).toHaveBeenCalledTimes(1);
    });
```

(Adapt variable/mock names — `createCompositeFilter`, `mockFilterByStringInstanceFilter` — to
whatever the existing test file's helpers/mocks are actually named; reuse them exactly rather
than inventing new ones.)

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/filters/composite.test.js -t "does not split an escaped"`
Expected: FAIL — `filterOneValue` currently splits `'a\\$b$1234-5'` into three parts
(`['a\\', 'b', '1234-5']`), so the mismatched-part-count check throws a `BadRequestError` instead
of reaching the component filters at all.

- [ ] **Step 3: Write the implementation**

Add the import near the top of `src/operations/query/filters/composite.js`:

```js
const { splitUnescaped } = require('../../../utils/searchValueEscaping');
```

Replace, in `filterOneValue`:

```js
        const parts = value.split('$');
```

with:

```js
        const parts = splitUnescaped(value, '$');
```

No other change in this file — `filterOneComponent` already passes each part straight to the
relevant `FilterClass`, which (as of Tasks 4-5) now unescapes `|`/`,` itself at its own leaf.

- [ ] **Step 4: Run test to verify it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/unit/operations/query/filters/composite.test.js`
Expected: PASS (full file, no regressions in the existing root/array/OR-of-scopes/genomics tests)

- [ ] **Step 5: Lint and commit**

```bash
yarn run fix_lint
git add src/operations/query/filters/composite.js src/tests/unit/operations/query/filters/composite.test.js
git commit -m "Make FilterByComposite's \$-split escape-aware"
```

---

## Task 7: End-to-end integration test

**Files:**
- Modify: `src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js`
  (extend with one new test case — read the existing file first to match its fixture-loading and
  assertion conventions exactly, e.g. how it loads `Observation` fixtures and issues the search
  request)

**Interfaces:**
- Consumes: nothing new — this is a black-box HTTP/DB-backed test confirming Tasks 1-6 work
  together.

- [ ] **Step 1: Write the failing test**

Add one new test to the existing suite: two `Observation` fixtures differing only in that one has
a `code.coding.system` containing a literal pipe character (e.g. `http://example.org/sys|extra`)
and the other doesn't. Search with
`code-value-quantity=http://example.org/sys\|extra|8480-6$ge140` (the `\|` escaped so it's part
of the system, not the system/code separator) and assert only the matching Observation is
returned. Follow the exact request-building/assertion helpers the existing tests in this file
already use (e.g. however they call the search endpoint and read `response.body.entry`).

- [ ] **Step 2: Run test to verify it fails**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js -t "escaped"`
Expected: FAIL before Tasks 1-6 land; since this task runs *after* them, expected: this new test
should already PASS once written (it's a confirmation test, not a TDD-red step for new
production code) — if it fails, one of Tasks 1-6 has a bug; stop and fix that task before
proceeding.

- [ ] **Step 3: Run the full test to confirm it passes**

Run: `nvm use && node node_modules/.bin/jest src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js`
Expected: PASS (full file)

- [ ] **Step 4: Commit**

```bash
git add src/tests/integration/searchParameters/search_by_composite/search_by_composite.test.js
git commit -m "Add end-to-end test for escaped pipe within a composite token component"
```

---

## Task 8: Documentation

**Files:**
- Modify: `readme/cheatsheet.md` (add a short escaping section near the existing
  [1.9 Composite Search Parameters](#19-composite-search-parameters) section, which already
  documents the `$`-joined composite syntax this escaping applies to)

- [ ] **Step 1: Write the doc addition**

Immediately after the existing "1.9 Composite Search Parameters" section's modifier-restrictions
bullet list (the one ending "...return a 400 rather than silently producing an incorrect
filter."), add:

```markdown
- If a component's own value needs to contain a literal `,`, `|`, or `$`, escape it with a
  backslash (`\,`, `\|`, `\$`) per the FHIR spec's
  [escaping rules](https://www.hl7.org/fhir/R4B/search.html#escaping) — e.g.
  `code-value-quantity=http://example.org/sys\|extra|8480-6$ge140` searches for a token whose
  system is literally `http://example.org/sys|extra`. This applies to every search parameter
  type that uses `,`/`|` as a separator (token `system|code`, quantity `num|system|code`,
  comma-separated OR values), not just composite parameters.
```

- [ ] **Step 2: Commit**

```bash
git add readme/cheatsheet.md
git commit -m "Document search value escaping in cheatsheet"
```

---

## Self-Review Notes (for the plan author, not a task to execute)

- **Spec coverage:** Task 1 covers the spec's "Key ordering insight" + utility design. Tasks 2-3
  cover the `,` touch points. Tasks 4-5 cover all five `|` touch points identified in the spec
  (note: the spec's Background section calls one of these a "canonical/reference builder" at
  `querybuilder.util.js:1286` — that line is actually inside `extensionQueryBuilder`, used by
  `FilterByToken` for `field === 'extension'`, not a separate canonical/reference function;
  `FilterByCanonical` does no pipe-splitting at all. Task 5 uses the corrected function name).
  Task 6 covers the `$` touch point. Task 7 covers the spec's Testing Plan's integration-test
  item. Task 8 covers the spec's cheatsheet documentation item.
- **Type consistency:** `splitUnescaped`/`unescapeSearchValue` signatures are identical across
  every task that imports them.
