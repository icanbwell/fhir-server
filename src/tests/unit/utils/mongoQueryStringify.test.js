'use strict';

const { describe, test, expect } = require('@jest/globals');
const { mongoQueryStringify, mongoQueryAndOptionsStringify } = require('../../../utils/mongoQueryStringify');

describe('mongoQueryStringify', () => {
    describe('primitive values', () => {
        test('stringifies string values with quotes', () => {
            expect(mongoQueryStringify('hello')).toBe("'hello'");
        });

        test('stringifies number values without quotes', () => {
            expect(mongoQueryStringify(42)).toBe('42');
        });

        test('stringifies boolean true', () => {
            expect(mongoQueryStringify(true)).toBe('true');
        });

        test('stringifies boolean false', () => {
            expect(mongoQueryStringify(false)).toBe('false');
        });

        test('stringifies null to null string', () => {
            expect(mongoQueryStringify(null)).toBe('null');
        });

        test('returns undefined for undefined input', () => {
            expect(mongoQueryStringify(undefined)).toBeUndefined();
        });

        test('stringifies NaN as null', () => {
            expect(mongoQueryStringify(NaN)).toBe('null');
        });

        test('stringifies Infinity as null', () => {
            expect(mongoQueryStringify(Infinity)).toBe('null');
        });

        test('stringifies negative Infinity as null', () => {
            expect(mongoQueryStringify(-Infinity)).toBe('null');
        });
    });

    describe('functions and symbols', () => {
        test('returns undefined for functions', () => {
            expect(mongoQueryStringify(() => {})).toBeUndefined();
        });

        test('returns undefined for symbols', () => {
            expect(mongoQueryStringify(Symbol('test'))).toBeUndefined();
        });
    });

    describe('dates', () => {
        test('stringifies valid date as ISODate', () => {
            const d = new Date('2024-01-15T10:30:00.000Z');
            expect(mongoQueryStringify(d)).toBe("ISODate('2024-01-15T10:30:00.000Z')");
        });

        test('throws BadRequestError for invalid date', () => {
            const d = new Date('invalid');
            expect(() => mongoQueryStringify(d)).toThrow(/not a valid DateTime value/);
        });
    });

    describe('regex', () => {
        test('stringifies regex source', () => {
            expect(mongoQueryStringify(/^Patient/)).toBe("'^Patient'");
        });

        test('stringifies regex with flags (uses source only)', () => {
            expect(mongoQueryStringify(/test/i)).toBe("'test'");
        });
    });

    describe('arrays', () => {
        test('stringifies simple array', () => {
            expect(mongoQueryStringify([1, 2, 3])).toBe('[1,2,3]');
        });

        test('stringifies array with strings', () => {
            expect(mongoQueryStringify(['a', 'b'])).toBe("['a','b']");
        });

        test('stringifies mixed array', () => {
            expect(mongoQueryStringify([1, 'two', true])).toBe("[1,'two',true]");
        });

        test('stringifies array with null elements', () => {
            expect(mongoQueryStringify([null, 1])).toBe('[null,1]');
        });

        test('converts undefined in array to null', () => {
            expect(mongoQueryStringify([undefined, 1])).toBe('[null,1]');
        });

        test('converts NaN in array to null', () => {
            expect(mongoQueryStringify([NaN, 'x'])).toBe("[null,'x']");
        });
    });

    describe('objects', () => {
        test('stringifies simple object', () => {
            expect(mongoQueryStringify({ name: 'John' })).toBe("{'name':'John'}");
        });

        test('stringifies object with number value', () => {
            expect(mongoQueryStringify({ age: 30 })).toBe("{'age':30}");
        });

        test('stringifies nested object', () => {
            const result = mongoQueryStringify({ a: { b: 1 } });
            expect(result).toBe("{'a':{'b':1}}");
        });

        test('stringifies object with $or operator', () => {
            const q = { $or: [{ status: 'active' }, { status: 'inactive' }] };
            const result = mongoQueryStringify(q);
            expect(result).toContain("'$or'");
            expect(result).toContain("'status':'active'");
        });

        test('omits undefined values from object', () => {
            const result = mongoQueryStringify({ a: 1, b: undefined, c: 3 });
            expect(result).toBe("{'a':1,'c':3}");
        });

        test('omits function values from object', () => {
            const result = mongoQueryStringify({ a: 1, fn: () => {} });
            expect(result).toBe("{'a':1}");
        });

        test('stringifies $in query', () => {
            const q = { _uuid: { $in: ['uuid-1', 'uuid-2'] } };
            const result = mongoQueryStringify(q);
            expect(result).toContain("'_uuid'");
            expect(result).toContain("'$in'");
            expect(result).toContain("'uuid-1'");
        });
    });

    describe('complex queries', () => {
        test('stringifies typical FHIR query', () => {
            const q = {
                'meta.security': { $elemMatch: { system: 'https://www.icanbwell.com/access', code: 'client-a' } },
                resourceType: 'Patient'
            };
            const result = mongoQueryStringify(q);
            expect(result).toContain("'meta.security'");
            expect(result).toContain("'resourceType':'Patient'");
        });
    });
});

describe('mongoQueryAndOptionsStringify', () => {
    test('stringifies single query with collection name', () => {
        const query = { collectionName: 'Patient_4_0_0', query: { resourceType: 'Patient' } };
        const options = { projection: { id: 1 } };
        const result = mongoQueryAndOptionsStringify({ query, options });
        expect(result).toContain('db.Patient_4_0_0.find(');
        expect(result).toContain("'resourceType':'Patient'");
    });

    test('includes sort when provided', () => {
        const query = { collectionName: 'Patient_4_0_0', query: { status: 'active' } };
        const options = { projection: {}, sort: { _lastUpdated: -1 } };
        const result = mongoQueryAndOptionsStringify({ query, options });
        expect(result).toContain('.sort(');
        expect(result).toContain("'_lastUpdated':-1");
    });

    test('includes skip when provided', () => {
        const query = { collectionName: 'Patient_4_0_0', query: {} };
        const options = { projection: {}, skip: 10 };
        const result = mongoQueryAndOptionsStringify({ query, options });
        expect(result).toContain('.skip(10)');
    });

    test('includes limit when provided', () => {
        const query = { collectionName: 'Patient_4_0_0', query: {} };
        const options = { projection: {}, limit: 100 };
        const result = mongoQueryAndOptionsStringify({ query, options });
        expect(result).toContain('.limit(100)');
    });

    test('stringifies array of queries with pipe separator', () => {
        const queries = [
            { collectionName: 'Patient_4_0_0', query: { id: '1' } },
            { collectionName: 'Observation_4_0_0', query: { id: '2' } }
        ];
        const options = [{}, {}];
        const result = mongoQueryAndOptionsStringify({ query: queries, options });
        expect(result).toContain('db.Patient_4_0_0.find(');
        expect(result).toContain(' | db.Observation_4_0_0.find(');
    });

    test('handles empty projection', () => {
        const query = { collectionName: 'Test_4_0_0', query: { x: 1 } };
        const options = {};
        const result = mongoQueryAndOptionsStringify({ query, options });
        expect(result).toContain('db.Test_4_0_0.find(');
    });
});
