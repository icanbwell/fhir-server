const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

// Mock the problematic transitive dependency before requiring AdminPersonPatientLinkManager
jestGlobal.mock('../../../operations/fhirOperationsManager', () => {
    class FhirOperationsManager {
        getRequestInfo () { return { requestId: 'req-1' }; }
    }
    return { FhirOperationsManager };
});

jestGlobal.mock('../../../operations/remove/removeHelper', () => {
    class RemoveHelper {
        async deleteManyAsync () { return 0; }
    }
    return { RemoveHelper };
});

const { AdminPersonPatientLinkManager } = require('../../../admin/adminPersonPatientLinkManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { DatabaseUpdateFactory } = require('../../../dataLayer/databaseUpdateFactory');
const { FhirOperationsManager } = require('../../../operations/fhirOperationsManager');
const { PostSaveProcessor } = require('../../../dataLayer/postSaveProcessor');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { RemoveHelper } = require('../../../operations/remove/removeHelper');
const { PatientPersonManualLinkingEventProducer } = require('../../../utils/patientPersonManualLinkingEventProducer');

function createMockInstance (ClassType) {
    const instance = Object.create(ClassType.prototype);
    return instance;
}

describe('AdminPersonPatientLinkManager', () => {
    let manager;
    let mockDatabaseQueryFactory;
    let mockDatabaseUpdateFactory;
    let mockFhirOperationsManager;
    let mockPostSaveProcessor;
    let mockPatientFilterManager;
    let mockRemoveHelper;
    let mockPatientPersonManualLinkingEventProducer;

    beforeEach(() => {
        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockDatabaseUpdateFactory = createMockInstance(DatabaseUpdateFactory);
        mockFhirOperationsManager = createMockInstance(FhirOperationsManager);
        mockPostSaveProcessor = createMockInstance(PostSaveProcessor);
        mockPatientFilterManager = createMockInstance(PatientFilterManager);
        mockRemoveHelper = createMockInstance(RemoveHelper);
        mockPatientPersonManualLinkingEventProducer = createMockInstance(PatientPersonManualLinkingEventProducer);

        mockFhirOperationsManager.getRequestInfo = jestGlobal.fn().mockReturnValue({ requestId: 'req-1' });
        mockPostSaveProcessor.afterSaveAsync = jestGlobal.fn().mockResolvedValue(undefined);
        mockPatientPersonManualLinkingEventProducer.produceEventAsync = jestGlobal.fn().mockResolvedValue(undefined);

        manager = new AdminPersonPatientLinkManager({
            databaseQueryFactory: mockDatabaseQueryFactory,
            databaseUpdateFactory: mockDatabaseUpdateFactory,
            fhirOperationsManager: mockFhirOperationsManager,
            postSaveProcessor: mockPostSaveProcessor,
            patientFilterManager: mockPatientFilterManager,
            removeHelper: mockRemoveHelper,
            patientPersonManualLinkingEventProducer: mockPatientPersonManualLinkingEventProducer
        });
    });

    describe('createPersonToPersonLinkAsync', () => {
        test('returns message when person not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue({});

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Person found');
        });

        test('returns message when link already exists', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue({});

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Link already exists');
        });

        test('adds link when person exists and link does not exist', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-3' } }]
            };
            const mockUpdateManager = {
                replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: existingPerson, patches: [] }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(2);
        });

        test('creates link array when person has no existing links', async () => {
            const existingPerson = {
                id: 'person-1',
                link: null
            };
            const mockUpdateManager = {
                replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: existingPerson, patches: [] }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(1);
        });

        test('strips Person/ prefix from ids', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue({});

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'Person/person-1',
                externalPersonId: 'Person/person-2'
            });

            expect(result.bwellPersonId).toBe('person-1');
            expect(result.externalPersonId).toBe('person-2');
        });
    });

    describe('removePersonToPersonLinkAsync', () => {
        test('returns message when person not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Person found');
        });

        test('returns message when no link exists', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-3' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Link exists');
        });

        test('removes link when it exists by reference', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [
                    { target: { reference: 'Person/person-2', _uuid: 'Person/uuid-2' } },
                    { target: { reference: 'Person/person-3', _uuid: 'Person/uuid-3' } }
                ]
            };
            const mockUpdateManager = {
                replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: existingPerson, patches: [] }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Removed link');
            expect(existingPerson.link.length).toBe(1);
        });

        test('returns no link message when person has no link array', async () => {
            const existingPerson = { id: 'person-1', link: null };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Link exists');
        });
    });

    describe('createPersonToPatientLinkAsync', () => {
        test('creates new person when person not found and patient exists', async () => {
            const patient = {
                id: 'patient-1',
                _uuid: 'patient-uuid-1',
                meta: {
                    source: 'http://example.com',
                    security: [{ system: 'https://www.icanbwell.com/owner', code: 'client' }]
                }
            };
            const mockPersonQueryManager = {
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            };
            const mockPatientQueryManager = {
                findOneAsync: jestGlobal.fn().mockResolvedValue(patient)
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(mockPersonQueryManager)
                .mockReturnValueOnce(mockPatientQueryManager);

            const mockUpdateManager = {
                insertOneAsync: jestGlobal.fn().mockResolvedValue({ id: 'new-person' }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'new-person-id',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Created Person');
            expect(mockUpdateManager.insertOneAsync).toHaveBeenCalled();
        });

        test('returns message when person not found and patient not found', async () => {
            const mockPersonQueryManager = {
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            };
            const mockPatientQueryManager = {
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            };
            // First call for Person, second for Patient
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(mockPersonQueryManager)
                .mockReturnValueOnce(mockPatientQueryManager);

            const mockUpdateManager = {
                insertOneAsync: jestGlobal.fn().mockResolvedValue({}),
                replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: {}, patches: [] }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Patient found');
        });

        test('adds link to existing person', async () => {
            const existingPerson = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [{ target: { reference: 'Patient/patient-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            const mockUpdateManager = {
                replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: existingPerson, patches: [] }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(2);
        });

        test('returns message when link already exists', async () => {
            const existingPerson = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [{ target: { reference: 'Patient/patient-1' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue({});

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Link already exists');
        });
    });

    describe('removePersonToPatientLinkAsync', () => {
        test('returns message when person not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Person found');
        });

        test('returns message when link does not exist', async () => {
            const person = {
                id: 'person-1',
                link: [{ target: { reference: 'Patient/other', _uuid: 'Patient/other-uuid' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Link exists');
        });

        test('removes link successfully', async () => {
            const person = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [
                    { target: { reference: 'Patient/patient-1', _uuid: 'Patient/pat-uuid-1' } },
                    { target: { reference: 'Patient/patient-2', _uuid: 'Patient/pat-uuid-2' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });
            const mockUpdateManager = {
                replaceOneAsync: jestGlobal.fn().mockResolvedValue({ savedResource: person }),
                postSaveAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            mockDatabaseUpdateFactory.createDatabaseUpdateManager = jestGlobal.fn().mockReturnValue(mockUpdateManager);

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Removed link');
            expect(person.link.length).toBe(1);
        });
    });

    describe('updatePatientReference', () => {
        test('returns falsy when reference is null', () => {
            const result = manager.updatePatientReference({
                reference: null,
                currentResource: { resourceType: 'Observation' }
            });
            expect(result).toBeFalsy();
        });

        test('returns true when reference is updated successfully', () => {
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');

            const currentResource = {
                resourceType: 'Observation',
                subject: { reference: 'Patient/old-patient' }
            };

            const result = manager.updatePatientReference({
                reference: 'Patient/new-patient',
                currentResource
            });

            expect(result).toBe(true);
            expect(currentResource.subject.reference).toBe('Patient/new-patient');
        });

        test('returns falsy when reference is already the same', () => {
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');

            const currentResource = {
                resourceType: 'Observation',
                subject: { reference: 'Patient/same-patient' }
            };

            const result = manager.updatePatientReference({
                reference: 'Patient/same-patient',
                currentResource
            });

            expect(result).toBeFalsy();
        });

        test('returns falsy when patient property not found', () => {
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue(null);

            const currentResource = { resourceType: 'Account' };

            const result = manager.updatePatientReference({
                reference: 'Patient/patient-1',
                currentResource
            });

            expect(result).toBeFalsy();
        });
    });

    describe('showPersonToPersonLinkAsync', () => {
        test('strips Person/ prefix', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            });

            const result = await manager.showPersonToPersonLinkAsync({ bwellPersonId: 'Person/person-1' });
            expect(result.id).toBe('person-1');
            expect(result.source).toBe('[Resource missing]');
        });
    });

    describe('deletePersonAsync', () => {
        test('returns 0 deleted count when person not found', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                nextObject: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(null),
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            const result = await manager.deletePersonAsync({
                req: {},
                requestId: 'req-1',
                personId: 'person-1'
            });

            expect(result.deletedCount).toBe(0);
        });

        test('deletes person and returns count', async () => {
            const personToDelete = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: []
            };
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                nextObject: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                findOneAsync: jestGlobal.fn().mockResolvedValue(personToDelete),
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });
            mockRemoveHelper.deleteManyAsync = jestGlobal.fn().mockResolvedValue(1);

            const result = await manager.deletePersonAsync({
                req: {},
                requestId: 'req-1',
                personId: 'person-1'
            });

            expect(result.deletedCount).toBe(1);
            expect(mockRemoveHelper.deleteManyAsync).toHaveBeenCalled();
        });
    });
});
