const { describe, test, expect } = require('@jest/globals');
const { HttpPreconditions } = require('../../../../operations/writePipeline/httpPreconditions');

describe('HttpPreconditions', () => {
    test.each([
        {
            name: 'no headers',
            headers: {},
            expected: { ifMatch: undefined, ifMatchVersionIds: [], ifNoneMatch: undefined, writePrecondition: null }
        },
        {
            name: 'a weak If-Match',
            headers: { 'if-match': 'W/"1"' },
            expected: {
                ifMatch: 'W/"1"',
                ifMatchVersionIds: ['1'],
                ifNoneMatch: undefined,
                writePrecondition: { ifMatchVersionIds: ['1'] }
            }
        },
        {
            name: 'a comma-separated If-Match',
            headers: { 'if-match': '"1", "2"' },
            expected: {
                ifMatch: '"1", "2"',
                ifMatchVersionIds: ['1', '2'],
                ifNoneMatch: undefined,
                writePrecondition: { ifMatchVersionIds: ['1', '2'] }
            }
        },
        {
            name: 'a wildcard If-Match',
            headers: { 'if-match': '*' },
            expected: {
                ifMatch: '*',
                ifMatchVersionIds: ['*'],
                ifNoneMatch: undefined,
                writePrecondition: { ifMatchVersionIds: ['*'] }
            }
        },
        {
            name: 'If-None-Match: *',
            headers: { 'if-none-match': '*' },
            expected: { ifMatch: undefined, ifMatchVersionIds: [], ifNoneMatch: '*', writePrecondition: null }
        },
        {
            name: 'headers undefined',
            headers: undefined,
            expected: { ifMatch: undefined, ifMatchVersionIds: [], ifNoneMatch: undefined, writePrecondition: null }
        }
    ])('reads $name', ({ headers, expected }) => {
        const preconditions = HttpPreconditions.fromRequestInfo({ headers });

        expect(preconditions.ifMatch).toBe(expected.ifMatch);
        expect(preconditions.ifMatchVersionIds).toEqual(expected.ifMatchVersionIds);
        expect(preconditions.ifNoneMatch).toBe(expected.ifNoneMatch);
        expect(preconditions.writePrecondition).toEqual(expected.writePrecondition);
    });

    test('is frozen, including the version ids and the write precondition', () => {
        const preconditions = HttpPreconditions.fromRequestInfo({ headers: { 'if-match': '"1"' } });

        expect(Object.isFrozen(preconditions)).toBe(true);
        expect(Object.isFrozen(preconditions.ifMatchVersionIds)).toBe(true);
        expect(Object.isFrozen(preconditions.writePrecondition)).toBe(true);
    });
});
