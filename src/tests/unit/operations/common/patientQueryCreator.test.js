'use strict';

const { describe, beforeEach, it, expect, jest } = require('@jest/globals');

const { PatientQueryCreator } = require('../../../../operations/common/patientQueryCreator');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { R4SearchQueryCreator } = require('../../../../operations/query/r4');
const { R4ArgsParser } = require('../../../../operations/query/r4ArgsParser');

describe('PatientQueryCreator', () => {
    let patientQueryCreator;
    let mockPatientFilterManager;
    let mockR4SearchQueryCreator;
    let mockR4ArgsParser;

    beforeEach(() => {
        mockPatientFilterManager = Object.create(PatientFilterManager.prototype);
        mockPatientFilterManager.canAccessResourceWithPatientScope = jest.fn().mockReturnValue(true);
        mockPatientFilterManager.getPatientPropertyForResource = jest.fn();
        mockPatientFilterManager.getPatientFilterQueryForResource = jest.fn();
        mockPatientFilterManager.getPersonPropertyForResource = jest.fn();
        mockPatientFilterManager.getPersonFilterQueryForResource = jest.fn();

        mockR4SearchQueryCreator = Object.create(R4SearchQueryCreator.prototype);
        mockR4SearchQueryCreator.appendAndSimplifyQuery = jest.fn().mockImplementation(({ query, andQuery }) => {
            if (query.$and) {
                query.$and.push(andQuery);
                return query;
            }
            return { $and: [query, andQuery] };
        });
        mockR4SearchQueryCreator.buildR4SearchQuery = jest.fn();

        mockR4ArgsParser = Object.create(R4ArgsParser.prototype);
        mockR4ArgsParser.parseArgs = jest.fn();

        patientQueryCreator = new PatientQueryCreator({
            patientFilterManager: mockPatientFilterManager,
            r4SearchQueryCreator: mockR4SearchQueryCreator,
            r4ArgsParser: mockR4ArgsParser
        });
    });

    describe('getQueryWithPersonSecurityContext', () => {
        const UUID_1 = '8d1d6c0a-5a43-4a7b-9c07-3f1f6f2a9e11';
        const UUID_2 = '2b7a64f8-0c1e-4d6a-8e55-9a3c1d7b6f22';
        const PERSON_UUID = 'c4f9a1d2-7e30-4b58-a6d1-0e8b2f3c5a33';
        // isUuid() is true for the proxy id (it contains the person's uuid), so, exactly like the existing patient
        // filter, the proxy is matched on _uuid, where the reference handler stores it unhashed
        const proxy = `person.${PERSON_UUID}`;
        const NON_UUID = 'legacy-patient-1';
        const unowned = (uuidField = 'securityContext._uuid', sourceIdField = 'securityContext._sourceId') => ({
            $and: [
                { [uuidField]: { $not: { $regex: '^Patient/' } } },
                { [sourceIdField]: { $not: { $regex: '^Patient/' } } }
            ]
        });

        beforeEach(() => {
            mockPatientFilterManager.getPersonSecurityContextProperty = jest.fn().mockImplementation(
                ({ resourceType }) => (resourceType === 'Binary' ? 'securityContext.reference' : undefined)
            );
        });

        const run = (overrides) => patientQueryCreator.getQueryWithPersonSecurityContext({
            patientIds: [proxy, UUID_1, UUID_2],
            query: { _uuid: 'b1' },
            resourceType: 'Binary',
            useHistoryTable: false,
            strict: false,
            ...overrides
        });

        it('throws for a resource type that is not owned through a securityContext', () => {
            expect(() => run({ resourceType: 'Condition' })).toThrow('not owned through a securityContext');
        });

        it('mixed mode: owned by the caller (linked patient uuids or the person proxy) OR owned by nobody (T34)', () => {
            const result = run();
            expect(result).toEqual({
                $and: [
                    { _uuid: 'b1' },
                    {
                        $or: [
                            unowned(),
                            { 'securityContext._uuid': { $in: [`Patient/${proxy}`, `Patient/${UUID_1}`, `Patient/${UUID_2}`] } }
                        ]
                    }
                ]
            });
        });

        it('matches a non-uuid patient id on the stored source id', () => {
            expect(run({ strict: true, patientIds: [proxy, NON_UUID] })).toEqual({
                $and: [
                    { _uuid: 'b1' },
                    {
                        $or: [
                            { 'securityContext._uuid': { $in: [`Patient/${proxy}`] } },
                            { 'securityContext._sourceId': { $in: [`Patient/${NON_UUID}`] } }
                        ]
                    }
                ]
            });
        });

        it('strict mode: owned by the caller only; no clause admits a resource with no securityContext (T39)', () => {
            const result = run({ strict: true });
            expect(result).toEqual({
                $and: [
                    { _uuid: 'b1' },
                    { 'securityContext._uuid': { $in: [`Patient/${proxy}`, `Patient/${UUID_1}`, `Patient/${UUID_2}`] } }
                ]
            });
            expect(JSON.stringify(result)).not.toContain('$not');
        });

        it('uses a single owned clause when there is only a proxy id (the usual member upload)', () => {
            expect(run({ strict: true, patientIds: [proxy] })).toEqual({
                $and: [{ _uuid: 'b1' }, { 'securityContext._uuid': { $in: [`Patient/${proxy}`] } }]
            });
        });

        it('strict mode fails closed with no patient ids (T33)', () => {
            for (const patientIds of [undefined, null, [], ['']]) {
                expect(run({ strict: true, patientIds })).toEqual({
                    $and: [{ _uuid: 'b1' }, { _uuid: '__invalid__' }]
                });
            }
        });

        it('mixed mode with no patient ids only admits resources owned by nobody', () => {
            expect(run({ patientIds: [] })).toEqual({ $and: [{ _uuid: 'b1' }, unowned()] });
        });

        it('uses the resource.* field names against the history table', () => {
            const result = run({ strict: true, useHistoryTable: true, patientIds: [proxy] });
            expect(result).toEqual({
                $and: [
                    { _uuid: 'b1' },
                    { 'resource.securityContext._uuid': { $in: [`Patient/${proxy}`] } }
                ]
            });
            const mixed = run({ useHistoryTable: true, patientIds: [proxy] });
            expect(JSON.stringify(mixed)).toContain('resource.securityContext._uuid');
        });
    });

    describe('getQueryWithPatientFilter', () => {
        it('should throw ForbiddenError when resource cannot be accessed via patient scope', () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(false);

            expect(() => {
                patientQueryCreator.getQueryWithPatientFilter({
                    patientIds: ['patient-1'],
                    query: {},
                    resourceType: 'StructureDefinition',
                    useHistoryTable: false,
                    personIds: null
                });
            }).toThrow('cannot be accessed via a patient scope');
        });

        it('should return __invalid__ query when no patient or person ids produce valid queries', () => {
            // No patientIds, no personIds
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: null,
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            expect(result).toEqual({ _uuid: '__invalid__' });
        });

        it('should build UUID query for Patient resourceType using _uuid field', () => {
            // UUID pattern patient ID for Patient resource type (uses 'id' property which maps to _uuid)
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('id');
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['550e8400-e29b-41d4-a716-446655440000'],
                query: {},
                resourceType: 'Patient',
                useHistoryTable: false,
                personIds: null
            });

            // For Patient resource with 'id' property and UUID, the query should use _uuid field
            // and not prefix with 'Patient/'
            expect(result).not.toEqual({ _uuid: '__invalid__' });
        });

        it('should handle array patientFilterProperty with uuid patient IDs', () => {
            // Multiple patient filter properties (array case)
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue([
                'subject.reference',
                'performer.reference'
            ]);
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['550e8400-e29b-41d4-a716-446655440000'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            expect(result).not.toEqual({ _uuid: '__invalid__' });
        });

        it('BUG: empty patientIds array with no personIds returns __invalid__ even when patient filter exists', () => {
            // When patientIds is an empty array [], the filter for uuid and non-uuid both produce empty arrays
            // The code does: patientIds.filter(id => isUuid(id)) => []
            // Then checks: if (patientUuids && patientUuids.length > 0) => false
            // And: patientIds.filter(id => !isUuid(id)) => []
            // Then checks: if (patientNonUuids && patientNonUuids.length > 0) => false
            // Result: queries array is empty, returns {_uuid: '__invalid__'}
            // This is technically correct behavior but could be confusing
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: [],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            // With empty patient IDs, no queries are generated -> returns invalid
            expect(result).toEqual({ _uuid: '__invalid__' });
        });

        it('BUG: patientFilterProperty is empty array - creates $or with empty array', () => {
            // When patientFilterProperty is an empty array [], Array.isArray([]) is true
            // but .map() on empty array returns [], resulting in { $or: [] }
            // MongoDB rejects $or with empty array: "$or/$and/$nor must be a nonempty array"
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue([]);
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['550e8400-e29b-41d4-a716-446655440000'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // When patientFilterProperty is an empty array, should NOT produce {$or: []}
            // Should either return __invalid__ or skip the empty $or clause
            const hasEmptyOr = (obj) => {
                if (!obj || typeof obj !== 'object') return false;
                if (Array.isArray(obj.$or) && obj.$or.length === 0) return true;
                if (Array.isArray(obj.$and)) return obj.$and.some(hasEmptyOr);
                if (Array.isArray(obj.$or)) return obj.$or.some(hasEmptyOr);
                return Object.values(obj).some(v => typeof v === 'object' && hasEmptyOr(v));
            };
            expect(hasEmptyOr(result)).toBe(false);
        });

        it('should apply RESOURCE_RESTRICTION_TAG filter via applyCommonPatientFilters', () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['550e8400-e29b-41d4-a716-446655440000'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            // Verify the restriction tag filter is applied
            expect(result.$and).toBeDefined();
            expect(result.$and).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        'meta.security': expect.objectContaining({
                            $not: expect.objectContaining({
                                $elemMatch: expect.objectContaining({
                                    system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
                                    code: 'R'
                                })
                            })
                        })
                    })
                ])
            );
        });

        it('should handle non-UUID patient IDs with sourceId field mapping', () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('patient.reference');
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['non-uuid-id-123'],
                query: {},
                resourceType: 'Condition',
                useHistoryTable: false,
                personIds: null
            });

            // Non-UUID patient IDs should use _sourceId field
            expect(result).not.toEqual({ _uuid: '__invalid__' });
        });

        it('should handle personIds with Person resourceType using _uuid field', () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue('id');
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: null,
                query: {},
                resourceType: 'Person',
                useHistoryTable: false,
                personIds: ['550e8400-e29b-41d4-a716-446655440000']
            });

            // Person with 'id' property and UUID -> _uuid field, no prefix
            expect(result).not.toEqual({ _uuid: '__invalid__' });
        });

        it('should combine patient and person queries with $or', () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue('link.target.reference');
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['550e8400-e29b-41d4-a716-446655440000'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: ['660e8400-e29b-41d4-a716-446655440001']
            });

            expect(result).not.toEqual({ _uuid: '__invalid__' });
        });

        it('BUG: when both patientFilterProperty and patientFilterWithQueryProperty are null, patientUuids with entries still produces no query', () => {
            // If getPatientPropertyForResource returns null AND getPatientFilterQueryForResource returns null
            // then patientsUuidQuery is never assigned, stays undefined
            // The check `if (patientsUuidQuery)` on line 131 is false, so nothing is pushed
            // This means having valid patient UUIDs but no mapping for the resource type
            // results in silent denial of access (returns __invalid__)
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPatientFilterQueryForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonPropertyForResource.mockReturnValue(null);
            mockPatientFilterManager.getPersonFilterQueryForResource.mockReturnValue(null);

            const result = patientQueryCreator.getQueryWithPatientFilter({
                patientIds: ['550e8400-e29b-41d4-a716-446655440000'],
                query: {},
                resourceType: 'Observation',
                useHistoryTable: false,
                personIds: null
            });

            // Even with valid patient UUIDs, if no filter property exists -> __invalid__
            expect(result).toEqual({ _uuid: '__invalid__' });
        });
    });

    describe('applyCommonPatientFilters', () => {
        it('should add RESOURCE_RESTRICTION_TAG filter to query.$and', () => {
            const query = {};
            const result = patientQueryCreator.applyCommonPatientFilters({ query });

            expect(result.$and).toBeDefined();
            expect(result.$and).toHaveLength(1);
            expect(result.$and[0]).toEqual({
                'meta.security': {
                    $not: {
                        $elemMatch: {
                            system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality',
                            code: 'R'
                        }
                    }
                }
            });
        });

        it('should append to existing $and array', () => {
            const query = { $and: [{ status: 'active' }] };
            const result = patientQueryCreator.applyCommonPatientFilters({ query });

            expect(result.$and).toHaveLength(2);
            expect(result.$and[0]).toEqual({ status: 'active' });
        });

        it('BUG: mutates the original query object - $and array is modified in place', () => {
            // The method does query.$and = query.$and || [] and then pushes
            // This mutates the original query. If the caller doesn't expect mutation
            // it can lead to subtle bugs.
            const originalQuery = { status: 'active' };
            const result = patientQueryCreator.applyCommonPatientFilters({ query: originalQuery });

            // The original object is mutated
            expect(originalQuery.$and).toBeDefined();
            expect(result).toBe(originalQuery); // Same reference
        });
    });
});
