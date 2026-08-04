const { describe, test, expect, beforeEach, jest: jestObj } = require('@jest/globals');

// Mock the referenceParser
jestObj.mock('../../../../../utils/referenceParser', () => ({
    ReferenceParser: {
        isUuidReference: jestObj.fn(),
        createReference: jestObj.fn(),
        getSourceAssigningAuthority: jestObj.fn(),
        createReferenceWithoutSourceAssigningAuthority: jestObj.fn()
    }
}));

// Mock list.util groupByLambda
jestObj.mock('../../../../../utils/list.util', () => ({
    groupByLambda: jestObj.fn()
}));

const { SearchFilterFromReference } = require('../../../../../operations/query/filters/searchFilterFromReference');
const { ReferenceParser } = require('../../../../../utils/referenceParser');
const { groupByLambda } = require('../../../../../utils/list.util');

describe('SearchFilterFromReference', () => {
    beforeEach(() => {
        jestObj.clearAllMocks();

        // Default mock implementations
        ReferenceParser.isUuidReference.mockImplementation((id) => {
            // Simple UUID pattern check
            return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        });

        ReferenceParser.createReference.mockImplementation(({ id, resourceType, sourceAssigningAuthority }) => {
            let ref = '';
            if (resourceType) {
                ref = `${resourceType}/`;
            }
            ref += id;
            if (sourceAssigningAuthority) {
                ref += `|${sourceAssigningAuthority}`;
            }
            return ref;
        });

        ReferenceParser.getSourceAssigningAuthority.mockImplementation((ref) => {
            const parts = ref.split('|');
            return parts.length > 1 ? parts[parts.length - 1] : undefined;
        });

        ReferenceParser.createReferenceWithoutSourceAssigningAuthority.mockImplementation((ref) => {
            const pipeIndex = ref.indexOf('|');
            if (pipeIndex > -1) {
                return ref.substring(0, pipeIndex);
            }
            return ref;
        });

        // Default: groupByLambda returns empty object (no sourceAssigningAuthority groups)
        groupByLambda.mockImplementation((sourceArray, fnKey) => {
            const result = {};
            for (const item of sourceArray) {
                const key = fnKey(item);
                if (!result[key]) {
                    result[key] = [];
                }
                result[key].push(item);
            }
            return result;
        });
    });

    describe('buildFilter with UUID references', () => {
        test('UUID references go into _uuid.$in array', () => {
            const references = [
                { id: 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6', resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            // First filter should be the _uuid filter
            const uuidFilter = filters.find(f => f._uuid);
            expect(uuidFilter).toBeDefined();
            expect(uuidFilter._uuid.$in).toContain('bb7862e6-b7ac-470e-bde3-e85cee9d1ce6');
        });

        test('UUID references without property use bare id', () => {
            const uuid = 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6';
            const references = [
                { id: uuid, resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);
            const uuidFilter = filters.find(f => f._uuid);

            expect(uuidFilter._uuid.$in).toContain(uuid);
            // createReference should NOT be called for UUID without property prefix
            expect(ReferenceParser.createReference).not.toHaveBeenCalledWith(
                expect.objectContaining({ id: uuid, resourceType: 'Patient' })
            );
        });

        test('UUID references with property use ResourceType/id prefix', () => {
            const uuid = 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6';
            const references = [
                { id: uuid, resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, 'subject');

            // When property is provided, createReference is called with resourceType
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({ id: uuid, resourceType: 'Patient' });
            const uuidFilter = filters.find(f => f['subject._uuid']);
            expect(uuidFilter).toBeDefined();
            expect(uuidFilter['subject._uuid'].$in).toContain(`Patient/${uuid}`);
        });
    });

    describe('buildFilter with non-UUID references (no sourceAssigningAuthority)', () => {
        test('non-UUID references go into _sourceId.$in', () => {
            const references = [
                { id: 'patientId1', resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            const sourceIdFilter = filters.find(f => f._sourceId);
            expect(sourceIdFilter).toBeDefined();
            expect(sourceIdFilter._sourceId.$in).toContain('patientId1');
        });

        test('non-UUID references with property get ResourceType/id prefix', () => {
            const references = [
                { id: 'patientId1', resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, 'subject');

            expect(ReferenceParser.createReference).toHaveBeenCalledWith({ id: 'patientId1', resourceType: 'Patient' });
            const sourceIdFilter = filters.find(f => f['subject._sourceId']);
            expect(sourceIdFilter).toBeDefined();
            expect(sourceIdFilter['subject._sourceId'].$in).toContain('Patient/patientId1');
        });
    });

    describe('buildFilter with sourceAssigningAuthority', () => {
        test('references with sourceAssigningAuthority group into $and filters', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            // Should have a $and filter with _sourceAssigningAuthority and _sourceId
            const andFilter = filters.find(f => f.$and);
            expect(andFilter).toBeDefined();
            expect(andFilter.$and[0]._sourceAssigningAuthority).toBe('client-1');
            expect(andFilter.$and[1]._sourceId.$in).toBeDefined();
        });

        test('groups references by sourceAssigningAuthority correctly', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' },
                { id: 'id2', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' },
                { id: 'id3', resourceType: 'Patient', sourceAssigningAuthority: 'client-2' }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            // Should produce 2 $and filters (one per sourceAssigningAuthority group)
            const andFilters = filters.filter(f => f.$and);
            expect(andFilters.length).toBe(2);

            const client1Filter = andFilters.find(f => f.$and[0]._sourceAssigningAuthority === 'client-1');
            expect(client1Filter).toBeDefined();
            // Should have 2 IDs in client-1 group
            expect(client1Filter.$and[1]._sourceId.$in.length).toBe(2);

            const client2Filter = andFilters.find(f => f.$and[0]._sourceAssigningAuthority === 'client-2');
            expect(client2Filter).toBeDefined();
            expect(client2Filter.$and[1]._sourceId.$in.length).toBe(1);
        });

        test('property prefix applied to sourceAssigningAuthority references', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, 'performer');

            const andFilter = filters.find(f => f.$and);
            expect(andFilter).toBeDefined();
            expect(andFilter.$and[0]['performer._sourceAssigningAuthority']).toBe('client-1');
            expect(andFilter.$and[1]['performer._sourceId']).toBeDefined();
        });

        test('createReference called with sourceAssigningAuthority for non-UUID with authority', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' }
            ];

            SearchFilterFromReference.buildFilter(references, null);

            // Without property: createReference called with id and sourceAssigningAuthority (no resourceType)
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                id: 'id1',
                sourceAssigningAuthority: 'client-1'
            });
        });

        test('createReference called with resourceType when property is provided', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' }
            ];

            SearchFilterFromReference.buildFilter(references, 'subject');

            // With property: createReference called with id, resourceType, and sourceAssigningAuthority
            expect(ReferenceParser.createReference).toHaveBeenCalledWith({
                id: 'id1',
                resourceType: 'Patient',
                sourceAssigningAuthority: 'client-1'
            });
        });
    });

    describe('buildFilter with empty references', () => {
        test('empty references array produces filters with empty $in arrays', () => {
            const references = [];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            const uuidFilter = filters.find(f => f._uuid);
            expect(uuidFilter._uuid.$in).toEqual([]);

            const sourceIdFilter = filters.find(f => f._sourceId);
            expect(sourceIdFilter._sourceId.$in).toEqual([]);
        });

        test('no $and filters produced for empty references', () => {
            const references = [];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            const andFilters = filters.filter(f => f.$and);
            expect(andFilters.length).toBe(0);
        });
    });

    describe('buildFilter with mixed reference types', () => {
        test('separates UUID and non-UUID references correctly', () => {
            const uuid = 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6';
            const references = [
                { id: uuid, resourceType: 'Patient', sourceAssigningAuthority: undefined },
                { id: 'patientId1', resourceType: 'Patient', sourceAssigningAuthority: undefined },
                { id: 'patientId2', resourceType: 'Patient', sourceAssigningAuthority: 'client-1' }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            const uuidFilter = filters.find(f => f._uuid);
            expect(uuidFilter._uuid.$in).toContain(uuid);
            expect(uuidFilter._uuid.$in.length).toBe(1);

            const sourceIdFilter = filters.find(f => f._sourceId);
            expect(sourceIdFilter._sourceId.$in).toContain('patientId1');
            expect(sourceIdFilter._sourceId.$in.length).toBe(1);

            const andFilter = filters.find(f => f.$and);
            expect(andFilter).toBeDefined();
            expect(andFilter.$and[0]._sourceAssigningAuthority).toBe('client-1');
        });

        test('multiple UUIDs all go into same _uuid.$in array', () => {
            const uuid1 = 'bb7862e6-b7ac-470e-bde3-e85cee9d1ce6';
            const uuid2 = 'cc8973f7-c8bd-581f-cef4-f96dee2d2df7';
            const references = [
                { id: uuid1, resourceType: 'Patient', sourceAssigningAuthority: undefined },
                { id: uuid2, resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            const uuidFilter = filters.find(f => f._uuid);
            expect(uuidFilter._uuid.$in).toContain(uuid1);
            expect(uuidFilter._uuid.$in).toContain(uuid2);
            expect(uuidFilter._uuid.$in.length).toBe(2);
        });
    });

    describe('buildFilter property prefix behavior', () => {
        test('no property means no prefix on filter keys', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, null);

            expect(filters.some(f => f._uuid !== undefined)).toBe(true);
            expect(filters.some(f => f._sourceId !== undefined)).toBe(true);
        });

        test('property adds prefix to all filter keys', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            const filters = SearchFilterFromReference.buildFilter(references, 'subject');

            expect(filters.some(f => f['subject._uuid'] !== undefined)).toBe(true);
            expect(filters.some(f => f['subject._sourceId'] !== undefined)).toBe(true);
        });

        test('empty string property does not add prefix', () => {
            const references = [
                { id: 'id1', resourceType: 'Patient', sourceAssigningAuthority: undefined }
            ];

            // Empty string is falsy, so no prefix
            const filters = SearchFilterFromReference.buildFilter(references, '');

            expect(filters.some(f => f._uuid !== undefined)).toBe(true);
            expect(filters.some(f => f._sourceId !== undefined)).toBe(true);
        });
    });
});
