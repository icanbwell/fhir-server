const { describe, test, expect } = require('@jest/globals');
const { FilterByComposite } = require('../../../../../operations/query/filters/composite');
const { FilterParameters } = require('../../../../../operations/query/filters/filterParameters');
const { FieldMapper } = require('../../../../../operations/query/filters/fieldMapper');
const {
    SearchParameterDefinition
} = require('../../../../../searchParameters/searchParameterTypes');
const { ParsedArgsItem } = require('../../../../../operations/query/parsedArgsItem');
const { QueryParameterValue } = require('../../../../../operations/query/queryParameterValue');

// NOTE: ServerError's constructor (src/middleware/fhir/utils/server.error.js) calls
// `Object.setPrototypeOf(this, ServerError.prototype)` unconditionally, which resets the
// prototype chain on every subclass instance (including BadRequestError) back to
// ServerError.prototype. This means `err instanceof BadRequestError` is always false for a
// *pre-existing, unrelated* reason -- see the "BUG" comments in
// src/tests/unit/utils/httpErrors.test.js, which already documents this and asserts on
// `err.statusCode` instead of using `toThrow(BadRequestError)`. We follow that same
// established convention here rather than changing ServerError (out of scope for this task).
function expectBadRequestError(fn) {
    let thrown;
    try {
        fn();
    } catch (e) {
        thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.statusCode).toBe(400);
}

function makeComposite(scopes) {
    return new SearchParameterDefinition({ type: 'composite', scopes });
}

function makeFilter(propertyObj, { value, modifiers = [], useHistoryTable = false } = {}) {
    const parsedArg = new ParsedArgsItem({
        queryParameter: 'test-composite',
        queryParameterValue: new QueryParameterValue({ value }),
        propertyObj,
        modifiers
    });
    return new FilterByComposite(
        new FilterParameters({
            propertyObj,
            parsedArg,
            fieldMapper: new FieldMapper({ useHistoryTable }),
            fnUseAccessIndex: () => false,
            resourceType: 'Observation'
        })
    );
}

describe('FilterByComposite', () => {
    test('root-only AND: both components at the top level, no $elemMatch', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept'
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        const result = makeFilter(composite, { value: '8480-6$ge140' }).filter();
        expect(result).toHaveLength(1);
        const [
            {
                $and: [andSegments]
            }
        ] = result;
        expect(JSON.stringify(andSegments)).not.toMatch(/\$elemMatch/);
    });

    test('array-only: components wrapped in a single $elemMatch on the shared array field', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'component',
            fieldType: 'CodeableConcept'
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'component'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        const result = makeFilter(composite, { value: '8480-6$ge140' }).filter();
        const [
            {
                $and: [andSegments]
            }
        ] = result;
        expect(andSegments.component.$elemMatch).toBeDefined();
        expect(andSegments.component.$elemMatch.$and).toHaveLength(2);
    });

    test('OR-of-scopes: root scope OR array scope', () => {
        const rootCode = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept'
        });
        const rootValue = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const arrayCode = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'component',
            fieldType: 'CodeableConcept'
        });
        const arrayValue = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'component'
        });
        const composite = makeComposite([
            { components: [rootCode, rootValue] },
            { components: [arrayCode, arrayValue] }
        ]);
        const result = makeFilter(composite, { value: '8480-6$ge140' }).filter();
        const [
            {
                $and: [{ $or: scopeConditions }]
            }
        ] = result;
        expect(scopeConditions).toHaveLength(2);
    });

    test('%resource. override / genomics 3-component shape: root component + 2 array components', () => {
        const chromosome = new SearchParameterDefinition({
            type: 'token',
            field: 'referenceSeq.chromosome',
            fieldType: 'string'
        });
        const start = new SearchParameterDefinition({
            type: 'number',
            field: 'start',
            arrayField: 'variant'
        });
        const end = new SearchParameterDefinition({
            type: 'number',
            field: 'end',
            arrayField: 'variant'
        });
        const composite = makeComposite([{ components: [chromosome, start, end] }]);
        const result = makeFilter(composite, { value: '1$123$345' }).filter();
        // This scope mixes a root-scoped component (chromosome) with two array-scoped
        // components (start/end, both under 'variant'), so filterOneScope's `conditions` has
        // 2 entries (the root segment + the one $elemMatch) and gets wrapped in its own $and --
        // one level deeper than the root-only/array-only cases above where `conditions` has
        // exactly 1 entry and is returned unwrapped.
        const [
            {
                $and: [{ $and: scopeConditions }]
            }
        ] = result;
        const variantCondition = scopeConditions.find((c) => c.variant);
        expect(variantCondition.variant.$elemMatch.$and).toHaveLength(2);
    });

    test('mismatched $-part count throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expectBadRequestError(() => makeFilter(composite, { value: 'only-one-part' }).filter());
    });

    test('trailing empty $-part (e.g. code-value-quantity=8480-6$) throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept'
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expectBadRequestError(() => makeFilter(composite, { value: '8480-6$' }).filter());
    });

    test('all-empty $-parts (e.g. code-value-quantity=$) throws BadRequestError instead of matching everything', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept'
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expectBadRequestError(() => makeFilter(composite, { value: '$' }).filter());
    });

    test('whitespace-only $-part throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            fieldType: 'CodeableConcept'
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expectBadRequestError(() => makeFilter(composite, { value: '8480-6$   ' }).filter());
    });

    test('rejected modifier (contains) throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expectBadRequestError(() =>
            makeFilter(composite, { value: 'a$b', modifiers: ['contains'] }).filter()
        );
    });

    test('rejected modifier (exact) throws BadRequestError', () => {
        const component1 = new SearchParameterDefinition({ type: 'token', field: 'code' });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        expectBadRequestError(() =>
            makeFilter(composite, { value: 'a$b', modifiers: ['exact'] }).filter()
        );
    });

    test('array-scoped token component on a Coding-shaped field (e.g. useContext.code) uses the ' +
        'type-agnostic fallback -- not the CodeableConcept branch, which can never match', () => {
        // Regression guard for the r4ArgsParser fieldType-resolution bug (fixed by resolving via
        // `${arrayField}.${firstField}`, not the bare relative field): useContext.code is a Coding
        // per the FHIR UsageContext datatype, but that nested path isn't present in the generated
        // field-types data (UsageContext isn't a backbone element), so the correctly-resolved
        // fieldType for it is `undefined` -- which routes FilterByToken to its type-agnostic
        // fallback ($or of exact-match / token-match on the bare field / token-match on
        // `field.coding`). Before the fix, resolving fieldType off the bare relative field name
        // (e.g. 'ActivityDefinition.code') incorrectly returned 'CodeableConcept', forcing the
        // filter onto `code.coding` alone -- a shape that never matches a real Coding value.
        const contextCode = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'useContext'
            // fieldType intentionally omitted -- matches the real resolved value (undefined) for
            // this path, per FhirTypesManager.getTypeForField({resourceType, field: 'useContext.code'})
        });
        const contextValue = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'useContext'
        });
        const composite = makeComposite([{ components: [contextCode, contextValue] }]);
        const result = makeFilter(composite, { value: 'system|program$ge140' }).filter();
        const [
            {
                $and: [andSegments]
            }
        ] = result;
        const [codeSegment] = andSegments.useContext.$elemMatch.$and;
        const codeSegmentJson = JSON.stringify(codeSegment);
        // Type-agnostic fallback: tries the bare field directly (matches a Coding stored at
        // useContext.code) as one of several $or branches.
        expect(codeSegmentJson).toMatch(/"code\.system"/);
        expect(codeSegmentJson).toMatch(/"code\.code"/);

        // Now prove the CodeableConcept branch this guards against really would produce a
        // different, narrower shape that omits the bare-field match entirely.
        const wrongContextCode = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'useContext',
            fieldType: 'CodeableConcept'
        });
        const wrongComposite = makeComposite([{ components: [wrongContextCode, contextValue] }]);
        const wrongResult = makeFilter(wrongComposite, { value: 'system|program$ge140' }).filter();
        const [
            {
                $and: [wrongAndSegments]
            }
        ] = wrongResult;
        const [wrongCodeSegment] = wrongAndSegments.useContext.$elemMatch.$and;
        expect(JSON.stringify(wrongCodeSegment)).not.toMatch(/"code\.system"/);
    });

    test('useHistoryTable prefixes the array field once, not the fields inside $elemMatch', () => {
        const component1 = new SearchParameterDefinition({
            type: 'token',
            field: 'code',
            arrayField: 'component',
            fieldType: 'CodeableConcept'
        });
        const component2 = new SearchParameterDefinition({
            type: 'quantity',
            field: 'valueQuantity',
            arrayField: 'component'
        });
        const composite = makeComposite([{ components: [component1, component2] }]);
        const result = makeFilter(composite, {
            value: '8480-6$ge140',
            useHistoryTable: true
        }).filter();
        const [
            {
                $and: [andSegments]
            }
        ] = result;
        expect(andSegments['resource.component']).toBeDefined();
        expect(andSegments.component).toBeUndefined();
        expect(JSON.stringify(andSegments['resource.component'])).not.toMatch(/resource\.code/);
    });
});
