const { describe, test, expect, beforeEach, afterEach, jest } = require('@jest/globals');
const httpContext = require('express-http-context');
const { PatientScopeManager } = require('../../../../operations/security/patientScopeManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { PersonToPatientIdsExpander } = require('../../../../utils/personToPatientIdsExpander');
const { ScopesManager } = require('../../../../operations/security/scopesManager');
const { PatientFilterManager } = require('../../../../fhir/patientFilterManager');
const { HTTP_CONTEXT_KEYS, PERSON_PROXY_PREFIX } = require('../../../../constants');

// Create mock instances that pass assertTypeEquals
function createMockInstance(ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('PatientScopeManager', () => {
    let patientScopeManager;
    let mockDatabaseQueryFactory;
    let mockPersonToPatientIdsExpander;
    let mockScopesManager;
    let mockPatientFilterManager;
    let httpContextGetSpy;
    let httpContextSetSpy;

    beforeEach(() => {
        // Use spyOn for httpContext methods
        httpContextGetSpy = jest.spyOn(httpContext, 'get').mockReturnValue(undefined);
        httpContextSetSpy = jest.spyOn(httpContext, 'set').mockImplementation(() => {});

        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseQueryFactory.createQuery = jest.fn().mockReturnValue({});

        mockPersonToPatientIdsExpander = createMockInstance(PersonToPatientIdsExpander);
        mockPersonToPatientIdsExpander.getPatientIdsFromPersonAsync = jest.fn().mockResolvedValue(['patient-1', 'patient-2']);

        mockScopesManager = createMockInstance(ScopesManager);
        mockScopesManager.isAccessAllowedByPatientScopes = jest.fn().mockReturnValue(true);

        mockPatientFilterManager = createMockInstance(PatientFilterManager);
        mockPatientFilterManager.canAccessResourceWithPatientScope = jest.fn().mockReturnValue(true);
        mockPatientFilterManager.getPatientPropertyForResource = jest.fn().mockReturnValue('subject.reference');
        mockPatientFilterManager.getPatientPropertyForPersonScopedResource = jest.fn().mockReturnValue(null);
        mockPatientFilterManager.getPersonPropertyForResource = jest.fn().mockReturnValue(null);

        patientScopeManager = new PatientScopeManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            personToPatientIdsExpander: mockPersonToPatientIdsExpander,
            scopesManager: mockScopesManager,
            patientFilterManager: mockPatientFilterManager
        });
    });

    // ========== CACHE ANALYSIS for getLinkedPatientsAsync ==========
    // CACHE ANALYSIS:
    // 1. Cache mechanism: httpContext.get/set with key `linkedPatientIdsFor-${personIdFromJwtToken}`
    // 2. Cache KEY dimensions: personIdFromJwtToken
    // 3. Method PARAMETERS: base_version, isUser, personIdFromJwtToken, addPersonOwnerToContext
    // 4. Params NOT in cache key: base_version, addPersonOwnerToContext
    // 5. Cached VALUE: array of linked patient IDs
    // 6. Downstream consumer: canWriteResourceAsync checks patient IDs against resource
    // 7. REQUIRED TEST: same personIdFromJwtToken, different base_version/addPersonOwnerToContext
    // 8. MOCK SETUP: personToPatientIdsExpander returns different values per call
    // 9. ASSERTION: result2 still contains call1 values (cached)

    describe('getLinkedPatientsAsync', () => {
        test('returns empty array when isUser is false', async () => {
            const result = await patientScopeManager.getLinkedPatientsAsync({
                base_version: '4_0_0',
                isUser: false,
                personIdFromJwtToken: 'person-1'
            });
            expect(result).toEqual([]);
        });

        test('returns empty array when personIdFromJwtToken is falsy', async () => {
            const result = await patientScopeManager.getLinkedPatientsAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: null
            });
            expect(result).toEqual([]);
        });

        test('fetches and caches patient IDs for first call', async () => {
            const result = await patientScopeManager.getLinkedPatientsAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-1'
            });
            expect(result).toEqual(['patient-1', 'patient-2']);
            expect(httpContextSetSpy).toHaveBeenCalledWith(
                `${HTTP_CONTEXT_KEYS.LINKED_PATIENTS_FOR_PERSON_PREFIX}person-1`,
                ['patient-1', 'patient-2']
            );
        });

        test('second call with same personId but different base_version returns cached value', async () => {
            // First call
            await patientScopeManager.getLinkedPatientsAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-shared'
            });

            // Change the mock return value for second call
            mockPersonToPatientIdsExpander.getPatientIdsFromPersonAsync.mockResolvedValue(['patient-new']);

            // Simulate the cache being present in httpContext
            httpContextGetSpy.mockImplementation((key) => {
                if (key === `${HTTP_CONTEXT_KEYS.LINKED_PATIENTS_FOR_PERSON_PREFIX}person-shared`) {
                    return ['patient-1', 'patient-2'];
                }
                return undefined;
            });

            // Second call with DIFFERENT base_version
            const result2 = await patientScopeManager.getLinkedPatientsAsync({
                base_version: '5_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-shared'
            });

            // CACHE BUG SURFACE: base_version is NOT in cache key, so call2 returns call1 cached value
            expect(result2).toEqual(['patient-1', 'patient-2']);
        });

        test('second call with same personId but different addPersonOwnerToContext returns cached value', async () => {
            await patientScopeManager.getLinkedPatientsAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-shared',
                addPersonOwnerToContext: false
            });

            mockPersonToPatientIdsExpander.getPatientIdsFromPersonAsync.mockResolvedValue(['patient-different']);

            httpContextGetSpy.mockImplementation((key) => {
                if (key === `${HTTP_CONTEXT_KEYS.LINKED_PATIENTS_FOR_PERSON_PREFIX}person-shared`) {
                    return ['patient-1', 'patient-2'];
                }
                return undefined;
            });

            const result2 = await patientScopeManager.getLinkedPatientsAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-shared',
                addPersonOwnerToContext: true
            });

            // CACHE BUG SURFACE: addPersonOwnerToContext is NOT in cache key
            expect(result2).toEqual(['patient-1', 'patient-2']);
        });
    });

    // ========== getPatientIdsByPersonIdAsync ==========
    describe('getPatientIdsByPersonIdAsync', () => {
        test('calls personToPatientIdsExpander with correct params', async () => {
            await patientScopeManager.getPatientIdsByPersonIdAsync({
                base_version: '4_0_0',
                personIdFromJwtToken: 'person-1'
            });
            expect(mockDatabaseQueryFactory.createQuery).toHaveBeenCalledWith({
                resourceType: 'Person',
                base_version: '4_0_0'
            });
            expect(mockPersonToPatientIdsExpander.getPatientIdsFromPersonAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    personIds: ['person-1'],
                    level: 1
                })
            );
        });

        test('throws when base_version is falsy', async () => {
            await expect(
                patientScopeManager.getPatientIdsByPersonIdAsync({
                    base_version: null,
                    personIdFromJwtToken: 'person-1'
                })
            ).rejects.toThrow();
        });

        test('throws when personIdFromJwtToken is falsy', async () => {
            await expect(
                patientScopeManager.getPatientIdsByPersonIdAsync({
                    base_version: '4_0_0',
                    personIdFromJwtToken: null
                })
            ).rejects.toThrow();
        });
    });

    // ========== getPatientIdsFromScopeAsync ==========
    describe('getPatientIdsFromScopeAsync', () => {
        test('returns proxy prefix + linked patients when personIdFromJwtToken present', async () => {
            httpContextGetSpy.mockReturnValue(undefined);
            const result = await patientScopeManager.getPatientIdsFromScopeAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-1'
            });
            expect(result).toContain(`${PERSON_PROXY_PREFIX}person-1`);
            expect(result).toContain('patient-1');
            expect(result).toContain('patient-2');
        });

        test('returns empty array when personIdFromJwtToken is null', async () => {
            const result = await patientScopeManager.getPatientIdsFromScopeAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: null
            });
            expect(result).toEqual([]);
        });
    });

    // ========== getValueOfPropertyFromResource ==========
    describe('getValueOfPropertyFromResource', () => {
        test('returns undefined when property is null', () => {
            const resource = { _uuid: 'uuid-1', resourceType: 'Patient' };
            const result = patientScopeManager.getValueOfPropertyFromResource({
                resource,
                property: null
            });
            expect(result).toBeUndefined();
        });

        test('returns [_uuid] when property is "id"', () => {
            const resource = { _uuid: 'uuid-123', resourceType: 'Patient' };
            const result = patientScopeManager.getValueOfPropertyFromResource({
                resource,
                property: 'id'
            });
            expect(result).toEqual(['uuid-123']);
        });
    });

    // ========== canWriteResourceWithAllowedPatientIdsAsync ==========
    describe('canWriteResourceWithAllowedPatientIdsAsync', () => {
        test('throws ForbiddenError when resource type cannot be written with patient scope', async () => {
            mockPatientFilterManager.canAccessResourceWithPatientScope.mockReturnValue(false);
            const resource = { _uuid: 'uuid-1', resourceType: 'Device' };
            await expect(
                patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                    patientIds: ['patient-1'],
                    resource
                })
            ).rejects.toThrow(/cannot be written via a patient scope/);
        });

        test('returns true when patient reference in resource matches patientIds', async () => {
            const resource = {
                _uuid: 'uuid-1',
                resourceType: 'Observation',
                subject: { reference: 'Patient/patient-1', _uuid: 'patient-1' }
            };
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('id');
            const result = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: ['uuid-1'],
                resource
            });
            expect(result).toBe(true);
        });

        test('returns false when no patient reference matches', async () => {
            const resource = {
                _uuid: 'uuid-1',
                resourceType: 'Observation',
                subject: { reference: 'Patient/patient-999', _uuid: 'patient-999' }
            };
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('id');
            const result = await patientScopeManager.canWriteResourceWithAllowedPatientIdsAsync({
                patientIds: ['other-uuid'],
                resource
            });
            expect(result).toBe(false);
        });
    });

    // ========== canWriteResourceAsync ==========
    describe('canWriteResourceAsync', () => {
        test('throws when scope is missing', async () => {
            const resource = { _uuid: 'uuid-1', resourceType: 'Patient' };
            await expect(
                patientScopeManager.canWriteResourceAsync({
                    base_version: '4_0_0',
                    isUser: true,
                    personIdFromJwtToken: 'person-1',
                    resource,
                    scope: null
                })
            ).rejects.toThrow();
        });

        test('returns true when scope does not restrict access via patient scopes', async () => {
            mockScopesManager.isAccessAllowedByPatientScopes.mockReturnValue(false);
            const resource = { _uuid: 'uuid-1', resourceType: 'Observation' };
            const result = await patientScopeManager.canWriteResourceAsync({
                base_version: '4_0_0',
                isUser: true,
                personIdFromJwtToken: 'person-1',
                resource,
                scope: 'user/*.write'
            });
            expect(result).toBe(true);
        });
    });
});
