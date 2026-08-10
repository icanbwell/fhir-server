const { describe, test, expect, beforeEach, jest } = require('@jest/globals');

// Mock logging to avoid Winston initialization
jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn(),
    logInfo: jest.fn(),
    logWarn: jest.fn(),
    logDebug: jest.fn()
}));

jest.mock('../../../operations/common/systemEventLogging', () => ({
    logTraceSystemEventAsync: jest.fn()
}));

const { BwellPersonFinder } = require('../../../utils/bwellPersonFinder');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');

/**
 * Creates a mock DatabaseQueryFactory that passes assertTypeEquals
 */
function createMockDatabaseQueryFactory() {
    const factory = Object.create(DatabaseQueryFactory.prototype);
    factory.createQuery = jest.fn();
    return factory;
}

/**
 * Creates a mock cursor that simulates async iteration
 */
function createMockCursor(documents) {
    let index = 0;
    return {
        hasNext: jest.fn(async () => index < documents.length),
        next: jest.fn(async () => documents[index++] || null),
        nextObject: jest.fn(async () => documents[index++] || null)
    };
}

/**
 * Creates a mock DatabaseQueryManager
 */
function createMockDatabaseQueryManager() {
    return {
        findAsync: jest.fn()
    };
}

describe('BwellPersonFinder', () => {
    let bwellPersonFinder;
    let mockDatabaseQueryFactory;
    let mockDatabaseQueryManager;

    beforeEach(() => {
        jest.clearAllMocks();
        mockDatabaseQueryFactory = createMockDatabaseQueryFactory();
        mockDatabaseQueryManager = createMockDatabaseQueryManager();
        mockDatabaseQueryFactory.createQuery.mockReturnValue(mockDatabaseQueryManager);
        bwellPersonFinder = new BwellPersonFinder({ databaseQueryFactory: mockDatabaseQueryFactory });
    });

    describe('constructor', () => {
        test('should throw if databaseQueryFactory is null', () => {
            expect(() => new BwellPersonFinder({ databaseQueryFactory: null }))
                .toThrow();
        });

        test('should throw if databaseQueryFactory is wrong type', () => {
            expect(() => new BwellPersonFinder({ databaseQueryFactory: {} }))
                .toThrow();
        });
    });

    describe('isBwellPerson', () => {
        test('should return true for a valid bwell person', () => {
            const person = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };
            expect(bwellPersonFinder.isBwellPerson(person)).toBeTruthy();
        });

        test('should return falsy if person has no access tag', () => {
            const person = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };
            expect(bwellPersonFinder.isBwellPerson(person)).toBeFalsy();
        });

        test('should return falsy if person has no owner tag', () => {
            const person = {
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' }
                    ]
                }
            };
            expect(bwellPersonFinder.isBwellPerson(person)).toBeFalsy();
        });

        test('should throw TypeError when person has no meta property', () => {
            const person = {};
            // BUG: person.meta is undefined, accessing person.meta.security throws TypeError
            expect(() => bwellPersonFinder.isBwellPerson(person)).toThrow(TypeError);
        });

        test('should throw TypeError when person is null', () => {
            // BUG: null.meta throws TypeError
            expect(() => bwellPersonFinder.isBwellPerson(null)).toThrow(TypeError);
        });

        test('should throw TypeError when person.meta is null', () => {
            const person = { meta: null };
            // BUG: null.security throws TypeError
            expect(() => bwellPersonFinder.isBwellPerson(person)).toThrow(TypeError);
        });

        test('should return falsy if security is empty array', () => {
            const person = {
                meta: {
                    security: []
                }
            };
            expect(bwellPersonFinder.isBwellPerson(person)).toBeFalsy();
        });

        test('should return falsy if security is undefined', () => {
            const person = {
                meta: {}
            };
            // person.meta.security is undefined, which is falsy so first && short-circuits
            expect(bwellPersonFinder.isBwellPerson(person)).toBeFalsy();
        });
    });

    describe('searchForBwellPersonAsync', () => {
        test('should return null if currentSubject was already visited', async () => {
            const visitedSubjects = new Set(['Patient/123']);
            const result = await bwellPersonFinder.searchForBwellPersonAsync({
                currentSubject: 'Patient/123',
                databaseQueryManager: mockDatabaseQueryManager,
                visitedSubjects
            });
            expect(result).toBeNull();
        });

        test('should return person id when bwell person is found directly', async () => {
            const bwellPerson = {
                _uuid: 'bwell-person-uuid',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };
            const mockCursor = createMockCursor([bwellPerson]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await bwellPersonFinder.searchForBwellPersonAsync({
                currentSubject: 'Patient/test-patient-id',
                databaseQueryManager: mockDatabaseQueryManager,
                visitedSubjects: new Set()
            });

            expect(result).toBe('bwell-person-uuid');
        });

        test('should return null when no linked persons found', async () => {
            const mockCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await bwellPersonFinder.searchForBwellPersonAsync({
                currentSubject: 'Patient/test-patient-id',
                databaseQueryManager: mockDatabaseQueryManager,
                visitedSubjects: new Set()
            });

            expect(result).toBeNull();
        });

        test('should recursively search when non-bwell person is found', async () => {
            const nonBwellPerson = {
                _uuid: 'non-bwell-person-uuid',
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other' }
                    ]
                }
            };
            const bwellPerson = {
                _uuid: 'bwell-person-uuid',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };

            // First call finds non-bwell person
            const firstCursor = createMockCursor([nonBwellPerson]);
            // Second (recursive) call finds bwell person
            const secondCursor = createMockCursor([bwellPerson]);

            mockDatabaseQueryManager.findAsync
                .mockResolvedValueOnce(firstCursor)
                .mockResolvedValueOnce(secondCursor);

            const result = await bwellPersonFinder.searchForBwellPersonAsync({
                currentSubject: 'Patient/test-patient-id',
                databaseQueryManager: mockDatabaseQueryManager,
                visitedSubjects: new Set()
            });

            expect(result).toBe('bwell-person-uuid');
        });

        test('should avoid infinite loops with circular references', async () => {
            // Person A links to Person B, Person B links back to Person A
            const personA = {
                _uuid: 'person-a-uuid',
                meta: {
                    security: [{ system: SecurityTagSystem.owner, code: 'other' }]
                }
            };

            // First call for Patient/123 finds personA
            const firstCursor = createMockCursor([personA]);
            // Second call for Person/person-a-uuid returns empty (circular => already visited)
            const secondCursor = createMockCursor([]);

            mockDatabaseQueryManager.findAsync
                .mockResolvedValueOnce(firstCursor)
                .mockResolvedValueOnce(secondCursor);

            const result = await bwellPersonFinder.searchForBwellPersonAsync({
                currentSubject: 'Patient/123',
                databaseQueryManager: mockDatabaseQueryManager,
                visitedSubjects: new Set()
            });

            expect(result).toBeNull();
        });
    });

    describe('getBwellPersonIdAsync', () => {
        test('should create query for Person resourceType', async () => {
            const mockCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(mockCursor);

            await bwellPersonFinder.getBwellPersonIdAsync({ patientId: 'test-123' });

            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Person',
                base_version: '4_0_0'
            });
        });
    });

    describe('getPersonIdsInLinkPathToBwellPersonAsync', () => {
        test('should return every Person visited (client Person then master Person) in visit order for a 2-hop path', async () => {
            const clientPersonId = 'client-person-uuid';
            const masterPersonId = 'master-person-uuid';

            const clientPerson = {
                _uuid: clientPersonId,
                meta: {
                    security: [
                        { system: SecurityTagSystem.owner, code: 'other' }
                    ]
                }
            };
            const masterPerson = {
                _uuid: masterPersonId,
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };

            // First call (from the patient) finds the immediate client Person
            const firstCursor = createMockCursor([clientPerson]);
            // Second (recursive) call (from the client Person) finds the master Person
            const secondCursor = createMockCursor([masterPerson]);

            mockDatabaseQueryManager.findAsync
                .mockResolvedValueOnce(firstCursor)
                .mockResolvedValueOnce(secondCursor);

            const result = await bwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync({
                patientId: 'test-patient-id'
            });

            expect(result).toEqual([clientPersonId, masterPersonId]);
            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Person',
                base_version: '4_0_0'
            });
        });

        test('should return [] when no Person links to the patient at all', async () => {
            const mockCursor = createMockCursor([]);
            mockDatabaseQueryManager.findAsync.mockResolvedValue(mockCursor);

            const result = await bwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync({
                patientId: 'test-patient-id'
            });

            expect(result).toEqual([]);
        });

        test('should visit every branch of a branching link graph, not stop after the first branch reaches a master Person', async () => {
            // A Patient shared across two tenants (review.md §E's normal case) is linked-to by
            // two distinct client Persons, each routing through its own distinct intermediate
            // Person to a (shared) bwell master Person:
            //   Patient -> C1 -> D1 -> M
            //           -> C2 -> D2 -> M
            // Before the fix, the while loop in searchForBwellPersonAsync stopped as soon as the
            // C1 branch resolved to M, so D2/C2's branch was never visited or pushed onto path.
            const nonMasterMeta = { security: [{ system: SecurityTagSystem.owner, code: 'other' }] };
            const c1 = { _uuid: 'client-person-1', meta: nonMasterMeta };
            const c2 = { _uuid: 'client-person-2', meta: nonMasterMeta };
            const d1 = { _uuid: 'intermediate-person-1', meta: nonMasterMeta };
            const d2 = { _uuid: 'intermediate-person-2', meta: nonMasterMeta };
            const masterPerson = {
                _uuid: 'master-person-uuid',
                meta: {
                    security: [
                        { system: SecurityTagSystem.access, code: 'bwell' },
                        { system: SecurityTagSystem.owner, code: 'bwell' }
                    ]
                }
            };

            mockDatabaseQueryManager.findAsync
                .mockResolvedValueOnce(createMockCursor([c1, c2])) // from the Patient
                .mockResolvedValueOnce(createMockCursor([d1])) // from C1
                .mockResolvedValueOnce(createMockCursor([masterPerson])) // from D1
                .mockResolvedValueOnce(createMockCursor([d2])) // from C2
                .mockResolvedValueOnce(createMockCursor([masterPerson])); // from D2

            const result = await bwellPersonFinder.getPersonIdsInLinkPathToBwellPersonAsync({
                patientId: 'test-patient-id'
            });

            // Every Person on every branch must be present -- not just the first branch found.
            expect(result).toEqual(
                expect.arrayContaining(['client-person-1', 'intermediate-person-1', 'client-person-2', 'intermediate-person-2', 'master-person-uuid'])
            );
            expect(result.filter((id) => id === 'client-person-1')).toHaveLength(1);
            expect(result.filter((id) => id === 'client-person-2')).toHaveLength(1);
            expect(result.filter((id) => id === 'intermediate-person-1')).toHaveLength(1);
            expect(result.filter((id) => id === 'intermediate-person-2')).toHaveLength(1);
        });
    });

    describe('getImmediatePersonIdHelperAsync', () => {
        test('should return object with expected properties when references is empty', async () => {
            const result = await bwellPersonFinder.getImmediatePersonIdHelperAsync({
                references: [],
                databaseQueryManager: mockDatabaseQueryManager,
                asObject: false,
                securityTags: []
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should return an object with the expected shape, not a Map
            expect(result).not.toBeInstanceOf(Map);
            const { patientReferenceToPersonUuid, personToLinkedPatientsMap } = result;
            expect(patientReferenceToPersonUuid).toBeDefined();
            expect(personToLinkedPatientsMap).toBeDefined();
        });

        test('should return object with expected properties when references is null', async () => {
            const result = await bwellPersonFinder.getImmediatePersonIdHelperAsync({
                references: null,
                databaseQueryManager: mockDatabaseQueryManager,
                asObject: false,
                securityTags: []
            });

            // EXPECTED: correct behavior (will fail until bug is fixed)
            // Should return { patientReferenceToPersonUuid, personToLinkedPatientsMap }, not a Map
            expect(result).not.toBeInstanceOf(Map);
            const { patientReferenceToPersonUuid, personToLinkedPatientsMap } = result;
            expect(patientReferenceToPersonUuid).toBeDefined();
            expect(personToLinkedPatientsMap).toBeDefined();
        });
    });

    describe('getAllLinkedReferencesFromPerson', () => {
        test('should return empty array when person is null', () => {
            const result = bwellPersonFinder.getAllLinkedReferencesFromPerson(null);
            expect(result).toEqual([]);
        });

        test('should return empty array when person.link is undefined', () => {
            const result = bwellPersonFinder.getAllLinkedReferencesFromPerson({});
            expect(result).toEqual([]);
        });

        test('should return empty array when person.link is not an array', () => {
            const result = bwellPersonFinder.getAllLinkedReferencesFromPerson({ link: 'not-array' });
            expect(result).toEqual([]);
        });

        test('should return linked UUIDs from person links', () => {
            const person = {
                link: [
                    { target: { _uuid: 'Patient/uuid-1' } },
                    { target: { _uuid: 'Patient/uuid-2' } },
                    { target: null },
                    { target: { reference: 'Patient/123' } } // no _uuid
                ]
            };
            const result = bwellPersonFinder.getAllLinkedReferencesFromPerson(person);
            expect(result).toEqual(['Patient/uuid-1', 'Patient/uuid-2']);
        });

        test('should handle links with no target', () => {
            const person = {
                link: [
                    { target: undefined },
                    {}
                ]
            };
            const result = bwellPersonFinder.getAllLinkedReferencesFromPerson(person);
            expect(result).toEqual([]);
        });
    });
});
