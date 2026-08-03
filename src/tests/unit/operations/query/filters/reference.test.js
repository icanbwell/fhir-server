'use strict';

const { describe, test, expect, jest: jestObj } = require('@jest/globals');

jestObj.mock('../../../../../utils/assertType', () => ({
    assertIsValid: jestObj.fn((val, msg) => { if (!val) throw new Error(msg); })
}));

const { FilterByReference } = require('../../../../../operations/query/filters/reference');

describe('FilterByReference', () => {
    const makeFieldMapper = () => ({
        getFieldName: jestObj.fn((field) => field)
    });

    const makeFilterParams = (overrides = {}) => ({
        propertyObj: {
            fields: ['subject'],
            target: ['Patient']
        },
        parsedArg: {
            queryParameterValue: {
                values: ['Patient/123'],
                operator: '$or'
            }
        },
        fieldMapper: makeFieldMapper(),
        fnUseAccessIndex: jestObj.fn(() => false),
        resourceType: 'Observation',
        ...overrides
    });

    describe('getReferences', () => {
        test('creates reference with resourceType when present in reference', () => {
            const filter = new FilterByReference(makeFilterParams());
            const refs = filter.getReferences({
                targets: ['Patient'],
                reference: 'Patient/123'
            });
            expect(refs).toEqual(['Patient/123']);
        });

        test('creates reference for each target when no resourceType in reference', () => {
            const filter = new FilterByReference(makeFilterParams());
            const refs = filter.getReferences({
                targets: ['Patient', 'Practitioner'],
                reference: '123'
            });
            expect(refs).toEqual(['Patient/123', 'Practitioner/123']);
        });

        test('creates single reference when reference has resourceType even with multiple targets', () => {
            const filter = new FilterByReference(makeFilterParams());
            const refs = filter.getReferences({
                targets: ['Patient', 'Practitioner'],
                reference: 'Patient/456'
            });
            expect(refs).toEqual(['Patient/456']);
        });

        test('strips sourceAssigningAuthority from the created reference', () => {
            const filter = new FilterByReference(makeFilterParams());
            const refs = filter.getReferences({
                targets: ['Patient'],
                reference: 'Patient/123|clientA'
            });
            // sourceAssigningAuthority is not included in the reference per the code comment
            expect(refs).toEqual(['Patient/123']);
        });
    });

    describe('filter', () => {
        test('returns empty array when values is empty', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: [],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toEqual([]);
        });

        test('returns empty array when values is undefined', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: undefined,
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toEqual([]);
        });

        test('returns empty array when values is null', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: null,
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toEqual([]);
        });

        test('creates _sourceId filter for id reference without sourceAssigningAuthority', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            // Structure is: [{$or: [{$or: [{subject._sourceId: {$in: [...]}}]}]}]
            expect(result[0].$or).toBeDefined();
            const outerOr = result[0].$or;
            expect(outerOr).toHaveLength(1);
            const innerOr = outerOr[0].$or;
            expect(innerOr).toBeDefined();
            const sourceIdFilter = innerOr.find(f => f['subject._sourceId']);
            expect(sourceIdFilter).toBeDefined();
            expect(sourceIdFilter['subject._sourceId'].$in).toContain('Patient/123');
        });

        test('creates _uuid filter for uuid reference', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/urn:uuid:12345678-1234-1234-1234-123456789012'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            expect(outerOr).toHaveLength(1);
            const innerOr = outerOr[0].$or;
            const uuidFilter = innerOr.find(f => f['subject._uuid']);
            expect(uuidFilter).toBeDefined();
            expect(uuidFilter['subject._uuid'].$in).toContain('Patient/urn:uuid:12345678-1234-1234-1234-123456789012');
        });

        test('creates filter for sourceAssigningAuthority references', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123|clientA'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            expect(outerOr).toHaveLength(1);
            const innerOr = outerOr[0].$or;
            const andFilter = innerOr.find(f => f.$and);
            expect(andFilter).toBeDefined();
            expect(andFilter.$and[0]['subject._sourceAssigningAuthority']).toBe('clientA');
            expect(andFilter.$and[1]['subject._sourceId'].$in).toContain('Patient/123');
        });

        test('handles multiple fields', () => {
            const params = makeFilterParams({
                propertyObj: {
                    fields: ['subject', 'performer'],
                    target: ['Patient']
                },
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            expect(outerOr).toHaveLength(1);
            const innerOr = outerOr[0].$or;
            expect(innerOr).toHaveLength(2);
            const subjectFilter = innerOr.find(f => f['subject._sourceId']);
            const performerFilter = innerOr.find(f => f['performer._sourceId']);
            expect(subjectFilter).toBeDefined();
            expect(performerFilter).toBeDefined();
        });

        test('handles mix of uuid and id references', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: [
                            'Patient/urn:uuid:12345678-1234-1234-1234-123456789012',
                            'Patient/456'
                        ],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            // Should have both uuid and id filters in $or
            const outerOr = result[0].$or;
            expect(outerOr).toHaveLength(2); // one for uuid filters, one for id filters
            // First $or group is uuid
            const uuidGroup = outerOr.find(g => g.$or && g.$or.some(f => f['subject._uuid']));
            expect(uuidGroup).toBeDefined();
            // Second $or group is id
            const idGroup = outerOr.find(g => g.$or && g.$or.some(f => f['subject._sourceId']));
            expect(idGroup).toBeDefined();
        });

        test('handles multiple values for the same field', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123', 'Patient/456'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            const innerOr = outerOr[0].$or;
            const sourceIdFilter = innerOr.find(f => f['subject._sourceId']);
            expect(sourceIdFilter['subject._sourceId'].$in).toContain('Patient/123');
            expect(sourceIdFilter['subject._sourceId'].$in).toContain('Patient/456');
        });

        test('groups references by sourceAssigningAuthority', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123|clientA', 'Patient/456|clientA'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            const innerOr = outerOr[0].$or;
            const andFilter = innerOr.find(f => f.$and);
            expect(andFilter.$and[0]['subject._sourceAssigningAuthority']).toBe('clientA');
            expect(andFilter.$and[1]['subject._sourceId'].$in).toContain('Patient/123');
            expect(andFilter.$and[1]['subject._sourceId'].$in).toContain('Patient/456');
        });

        test('handles reference without resourceType by using all targets', () => {
            const params = makeFilterParams({
                propertyObj: {
                    fields: ['subject'],
                    target: ['Patient', 'Group']
                },
                parsedArg: {
                    queryParameterValue: {
                        values: ['123'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            const innerOr = outerOr[0].$or;
            const sourceIdFilter = innerOr.find(f => f['subject._sourceId']);
            // Should have both Patient/123 and Group/123
            expect(sourceIdFilter['subject._sourceId'].$in).toContain('Patient/123');
            expect(sourceIdFilter['subject._sourceId'].$in).toContain('Group/123');
        });

        test('separates different sourceAssigningAuthorities into separate $and groups', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123|clientA', 'Patient/456|clientB'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            const innerOr = outerOr[0].$or;
            const andFilters = innerOr.filter(f => f.$and);
            expect(andFilters).toHaveLength(2);
            const clientAFilter = andFilters.find(f => f.$and[0]['subject._sourceAssigningAuthority'] === 'clientA');
            const clientBFilter = andFilters.find(f => f.$and[0]['subject._sourceAssigningAuthority'] === 'clientB');
            expect(clientAFilter).toBeDefined();
            expect(clientBFilter).toBeDefined();
        });

        test('handles mix of references with and without sourceAssigningAuthority', () => {
            const params = makeFilterParams({
                parsedArg: {
                    queryParameterValue: {
                        values: ['Patient/123|clientA', 'Patient/456'],
                        operator: '$or'
                    }
                }
            });
            const filter = new FilterByReference(params);
            const result = filter.filter();
            expect(result).toHaveLength(1);
            const outerOr = result[0].$or;
            const innerOr = outerOr[0].$or;
            // Should have $and for SA ref and plain _sourceId for non-SA ref
            const andFilter = innerOr.find(f => f.$and);
            const plainFilter = innerOr.find(f => f['subject._sourceId']);
            expect(andFilter).toBeDefined();
            expect(plainFilter).toBeDefined();
            expect(andFilter.$and[0]['subject._sourceAssigningAuthority']).toBe('clientA');
            expect(plainFilter['subject._sourceId'].$in).toContain('Patient/456');
        });
    });
});
