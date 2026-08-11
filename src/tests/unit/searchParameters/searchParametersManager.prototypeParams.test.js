'use strict';

/**
 * SEC-1580 - a query parameter whose name collides with an Object.prototype member resolves to the
 * inherited prototype value instead of `undefined`.
 *
 * `SearchParametersManager.getPropertyObject()` looked its argument up with bare bracket access on
 * a plain object. `?constructor=x` therefore returned `Object.prototype.constructor` - a truthy
 * value - so `r4ArgsParser` skipped its `if (!propertyObj)` unknown-parameter branch and then
 * dereferenced `propertyObj.fields.length`, throwing a TypeError. The request surfaced as HTTP 500.
 *
 * Reachable unauthenticated-shaped on a plain `GET /4_0_0/Patient?constructor=x`: Express 5's
 * default `simple` query parser uses Node `querystring`, which keeps `constructor` as an own key,
 * and `get_all_args.js` Object.assign's it onto a normal object. A POST `_search` Parameters body
 * with `{"name":"constructor"}` reaches the same place.
 *
 * Oracle: bwell-business-logic-master.md
 *   §22 Error Response Codes
 */

const { describe, test, expect, beforeEach } = require('@jest/globals');
const { SearchParametersManager } = require('../../../searchParameters/searchParametersManager');

describe('SearchParametersManager.getPropertyObject - prototype-named query parameters', () => {
    let searchParametersManager;

    beforeEach(() => {
        searchParametersManager = new SearchParametersManager();
    });

    // Every own-property-shaped name that a plain object inherits from Object.prototype.
    const prototypeMemberNames = [
        'constructor',
        'toString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString'
    ];

    test.each(prototypeMemberNames)(
        'returns undefined for a query parameter named "%s" on a resource type',
        (queryParameter) => {
            const propertyObj = searchParametersManager.getPropertyObject({
                resourceType: 'Patient',
                queryParameter
            });

            // §22: an unrecognized search parameter is an "Invalid/missing parameter" condition -
            // it must be reported as 400, which requires the parser's unknown-parameter branch to
            // be reached. That branch is gated on this returning a falsy value. Returning the
            // inherited Object.prototype member instead sends the parser down the known-parameter
            // path, where it dereferences `.fields` and throws -> 500 "Unhandled server error".
            expect(propertyObj).toBeUndefined();
        }
    );

    test.each(prototypeMemberNames)(
        'returns undefined for a query parameter named "%s" on an unknown resource type',
        (queryParameter) => {
            // Exercises the second lookup, against combinedSearchParameters.Resource, by making the
            // per-resource-type lookup miss first.
            const propertyObj = searchParametersManager.getPropertyObject({
                resourceType: 'NotARealResourceType',
                queryParameter
            });

            // §22
            expect(propertyObj).toBeUndefined();
        }
    );

    test('whatever is returned for a prototype-named parameter is never dereferenced into a TypeError', () => {
        // This is the actual crash shape in r4ArgsParser: `propertyObj.fields.length > 0`.
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'Patient',
            queryParameter: 'constructor'
        });

        // §22: the parser only reaches this expression when propertyObj is truthy, so either
        // propertyObj is falsy (unknown-parameter branch, 400) or it is a real search parameter
        // definition carrying `fields`. An inherited prototype member is neither.
        expect(() => (propertyObj ? propertyObj.fields.length : 0)).not.toThrow();
    });

    // Guard against the fix over-tightening the lookup into always returning undefined.
    test.each([
        ['birthdate', 'birthDate'],
        ['family', 'name.family'],
        ['gender', 'gender']
    ])('still resolves the genuine Patient search parameter "%s"', (queryParameter, expectedField) => {
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'Patient',
            queryParameter
        });

        expect(propertyObj).toBeDefined();
        expect(propertyObj.fields).toEqual([expectedField]);
    });

    test('still resolves a search parameter inherited from Resource', () => {
        const propertyObj = searchParametersManager.getPropertyObject({
            resourceType: 'Patient',
            queryParameter: '_lastUpdated'
        });

        expect(propertyObj).toBeDefined();
    });
});
