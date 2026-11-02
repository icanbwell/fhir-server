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

jestGlobal.mock('../../../utils/assertType', () => {
    const { jest: j } = require('@jest/globals');
    return {
        assertTypeEquals: j.fn(),
        assertIsValid: j.fn()
    };
});

jestGlobal.mock('../../../operations/common/logging', () => {
    const { jest: j } = require('@jest/globals');
    return {
        logInfo: j.fn(),
        logDebug: j.fn(),
        logError: j.fn(),
        logWarn: j.fn()
    };
});

const { AdminPersonPatientLinkManager } = require('../../../admin/adminPersonPatientLinkManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { AdminResourceWriter } = require('../../../admin/adminResourceWriter');
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
    let mockAdminResourceWriter;
    let mockFhirOperationsManager;
    let mockPostSaveProcessor;
    let mockPatientFilterManager;
    let mockRemoveHelper;
    let mockPatientPersonManualLinkingEventProducer;

    beforeEach(() => {
        mockDatabaseQueryFactory = createMockInstance(DatabaseQueryFactory);
        mockAdminResourceWriter = createMockInstance(AdminResourceWriter);
        mockAdminResourceWriter.writeAsync = jestGlobal.fn().mockResolvedValue(undefined);
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
            adminResourceWriter: mockAdminResourceWriter,
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
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Person found');
            expect(result.bwellPersonId).toBe('person-1');
            expect(result.externalPersonId).toBe('person-2');
        });

        test('returns message when link already exists', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

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
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(2);
            expect(existingPerson.link[1].target.reference).toBe('Person/person-2');
        });

        test('creates link array when person has no existing links', async () => {
            const existingPerson = {
                id: 'person-1',
                link: null
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(1);
            expect(existingPerson.link[0].target.reference).toBe('Person/person-2');
        });

        test('strips Person/ prefix from ids', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'Person/person-1',
                externalPersonId: 'Person/person-2'
            });

            expect(result.bwellPersonId).toBe('person-1');
            expect(result.externalPersonId).toBe('person-2');
        });

        test('writes the Person with the added link through the admin resource writer using smart merge', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-3' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledTimes(1);
            const writeArgs = mockAdminResourceWriter.writeAsync.mock.calls[0][0];
            expect(writeArgs).toMatchObject({
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Person',
                resource: existingPerson
            });
            expect(writeArgs.smartMerge).not.toBe(false);
            expect(existingPerson.link.map(l => l.target.reference)).toEqual(['Person/person-3', 'Person/person-2']);
            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
        });

        test('does not write when the link already exists', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            await manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(mockAdminResourceWriter.writeAsync).not.toHaveBeenCalled();
        });

        test('propagates a failure from the admin resource writer', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-3' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });
            mockAdminResourceWriter.writeAsync.mockRejectedValue(new Error('write failed'));

            await expect(manager.createPersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            })).rejects.toThrow('write failed');
        });
    });

    describe('removePersonToPersonLinkAsync', () => {
        test('returns message when person not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Person found');
        });

        test('returns message when no link exists (link array present but no match)', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-3', _uuid: 'Person/uuid-3' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('No Link exists');
        });

        test('returns no link message when person has no link array', async () => {
            const existingPerson = { id: 'person-1', link: null };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
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
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Removed link');
            expect(existingPerson.link.length).toBe(1);
            expect(existingPerson.link[0].target.reference).toBe('Person/person-3');
        });

        test('removes link when matched by _uuid', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [
                    { target: { reference: 'Person/other-ref', _uuid: 'Person/person-2' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(result.message).toContain('Removed link');
            expect(existingPerson.link.length).toBe(0);
        });

        test('strips Person/ prefix from ids', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'Person/person-1',
                externalPersonId: 'Person/person-2'
            });

            expect(result.bwellPersonId).toBe('person-1');
            expect(result.externalPersonId).toBe('person-2');
        });

        test('writes the Person without the link through the admin resource writer using replace semantics', async () => {
            const existingPerson = {
                id: 'person-1',
                link: [{ target: { reference: 'Person/person-2', _uuid: 'Person/uuid-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            await manager.removePersonToPersonLinkAsync({
                req: {},
                bwellPersonId: 'person-1',
                externalPersonId: 'person-2'
            });

            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledTimes(1);
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledWith({
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Person',
                resource: existingPerson,
                smartMerge: false
            });
            expect(existingPerson.link).toEqual([]);
            expect(mockPostSaveProcessor.afterSaveAsync).not.toHaveBeenCalled();
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
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            };
            const mockPatientQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(patient)
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(mockPersonQueryManager)
                .mockReturnValueOnce(mockPatientQueryManager);


            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'new-person-id',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Created Person');
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledTimes(1);
            const writeArgs = mockAdminResourceWriter.writeAsync.mock.calls[0][0];
            expect(writeArgs.resourceType).toBe('Person');
            expect(writeArgs.smartMerge).not.toBe(false);
            const createdPerson = writeArgs.resource;
            expect(createdPerson.resourceType).toBe('Person');
            expect(createdPerson._uuid).toBe(createdPerson.id);
            expect(createdPerson.meta.source).toBe('http://example.com');
            expect(createdPerson.meta.security).toEqual(patient.meta.security);
            expect(createdPerson.link).toEqual([{ target: { reference: 'Patient/patient-1' } }]);
            expect(mockPatientPersonManualLinkingEventProducer.produceEventAsync).toHaveBeenCalledWith({
                personId: createdPerson._uuid,
                patientId: 'patient-uuid-1',
                isLinking: true
            });
        });

        test('returns message when person not found and patient not found', async () => {
            const mockPersonQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            };
            const mockPatientQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(mockPersonQueryManager)
                .mockReturnValueOnce(mockPatientQueryManager);


            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Patient found');
            expect(mockAdminResourceWriter.writeAsync).not.toHaveBeenCalled();
        });

        test('adds link to existing person with existing links', async () => {
            const existingPerson = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [{ target: { reference: 'Patient/patient-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(2);
            expect(existingPerson.link[1].target.reference).toBe('Patient/patient-1');
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person', resource: existingPerson })
            );
        });

        test('adds link to existing person with no existing links', async () => {
            const existingPerson = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: null
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Added link');
            expect(existingPerson.link.length).toBe(1);
            expect(existingPerson.link[0].target.reference).toBe('Patient/patient-1');
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledWith(
                expect.objectContaining({ resourceType: 'Person', resource: existingPerson })
            );
        });

        test('returns message when link already exists', async () => {
            const existingPerson = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [{ target: { reference: 'Patient/patient-1' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Link already exists');
            expect(mockAdminResourceWriter.writeAsync).not.toHaveBeenCalled();
        });

        test('strips Person/ and Patient/ prefixes from ids', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce({ fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null) })
                .mockReturnValueOnce({ fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null) });

            const result = await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'Person/person-1',
                patientId: 'Patient/patient-1'
            });

            expect(result.patientId).toBe('patient-1');
            expect(result.externalPersonId).toBe('person-1');
        });

        test('produces manual linking event when adding to existing person', async () => {
            const existingPerson = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [{ target: { reference: 'Patient/patient-2' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(existingPerson)
            });

            await manager.createPersonToPatientLinkAsync({
                req: {},
                externalPersonId: 'person-1',
                patientId: 'patient-1'
            });

            expect(mockPatientPersonManualLinkingEventProducer.produceEventAsync).toHaveBeenCalledWith({
                personId: 'person-uuid-1',
                patientId: 'patient-1',
                isLinking: true
            });
        });
    });

    describe('removePersonToPatientLinkAsync', () => {
        test('returns message when person not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Person found');
        });

        test('returns message when person has no link array', async () => {
            const person = { id: 'person-1', link: null };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Link exists');
        });

        test('returns message when link does not exist', async () => {
            const person = {
                id: 'person-1',
                link: [{ target: { reference: 'Patient/other', _uuid: 'Patient/other-uuid' } }]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('No Link exists');
        });

        test('removes link by reference successfully', async () => {
            const person = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [
                    { target: { reference: 'Patient/patient-1', _uuid: 'Patient/pat-uuid-1' } },
                    { target: { reference: 'Patient/patient-2', _uuid: 'Patient/pat-uuid-2' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Removed link');
            expect(person.link.length).toBe(1);
            expect(person.link[0].target.reference).toBe('Patient/patient-2');
        });

        test('removes link by _uuid successfully', async () => {
            const person = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [
                    { target: { reference: 'Patient/other-ref', _uuid: 'Patient/patient-1' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('Removed link');
            expect(person.link.length).toBe(0);
        });

        test('strips prefixes from ids', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'Person/person-1',
                patientId: 'Patient/patient-1'
            });

            expect(result.personId).toBe('person-1');
            expect(result.patientId).toBe('patient-1');
        });

        test('produces unlinking event after successful removal', async () => {
            const person = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [
                    { target: { reference: 'Patient/patient-1', _uuid: 'Patient/pat-uuid-1' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(mockPatientPersonManualLinkingEventProducer.produceEventAsync).toHaveBeenCalledWith({
                personId: 'person-uuid-1',
                patientId: 'patient-1',
                isLinking: false
            });
        });

        test('writes the Person without the link through the admin resource writer using replace semantics', async () => {
            const person = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [
                    { target: { reference: 'Patient/patient-1', _uuid: 'Patient/pat-uuid-1' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });

            await manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            });

            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledTimes(1);
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledWith({
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Person',
                resource: person,
                smartMerge: false
            });
            expect(person.link).toEqual([]);
        });

        test('does not produce the unlinking event when the write fails', async () => {
            const person = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: [
                    { target: { reference: 'Patient/patient-1', _uuid: 'Patient/pat-uuid-1' } }
                ]
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person)
            });
            mockAdminResourceWriter.writeAsync.mockRejectedValue(new Error('write failed'));

            await expect(manager.removePersonToPatientLinkAsync({
                req: {},
                personId: 'person-1',
                patientId: 'patient-1'
            })).rejects.toThrow('write failed');
            expect(mockPatientPersonManualLinkingEventProducer.produceEventAsync).not.toHaveBeenCalled();
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

        test('returns falsy when reference is undefined', () => {
            const result = manager.updatePatientReference({
                reference: undefined,
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

        test('returns falsy when patient property not found for resource type', () => {
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue(null);

            const currentResource = { resourceType: 'Account' };

            const result = manager.updatePatientReference({
                reference: 'Patient/patient-1',
                currentResource
            });

            expect(result).toBeFalsy();
        });

        test('returns falsy when intermediate field is missing', () => {
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');

            const currentResource = {
                resourceType: 'Observation'
                // subject field is missing
            };

            const result = manager.updatePatientReference({
                reference: 'Patient/patient-1',
                currentResource
            });

            expect(result).toBeFalsy();
        });

        test('handles deeply nested patient fields', () => {
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('for.reference');

            const currentResource = {
                resourceType: 'Claim',
                for: { reference: 'Patient/old-patient' }
            };

            const result = manager.updatePatientReference({
                reference: 'Patient/new-patient',
                currentResource
            });

            expect(result).toBe(true);
            expect(currentResource.for.reference).toBe('Patient/new-patient');
        });
    });

    describe('updatePatientLinkAsync', () => {
        test('returns message when resourceType not supported', async () => {
            const result = await manager.updatePatientLinkAsync({
                req: {},
                resourceId: 'res-1',
                resourceType: 'UnsupportedType',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('not supported');
        });

        test('returns message when resource not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null)
            });

            const result = await manager.updatePatientLinkAsync({
                req: {},
                resourceId: 'obs-1',
                resourceType: 'Observation',
                patientId: 'patient-1'
            });

            expect(result.message).toContain('does not exist');
        });

        test('updates patient reference successfully', async () => {
            const relatedResource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'obs-uuid-1',
                subject: { reference: 'Patient/old-patient' },
                meta: { versionId: '1' }
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(relatedResource)
            });
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');

            const result = await manager.updatePatientLinkAsync({
                req: {},
                resourceId: 'obs-1',
                resourceType: 'Observation',
                patientId: 'patient-new'
            });

            expect(result.message).toContain('Patient reference updated');
            expect(relatedResource.subject.reference).toBe('Patient/patient-new');
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledTimes(1);
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledWith({
                requestInfo: { requestId: 'req-1' },
                base_version: '4_0_0',
                resourceType: 'Observation',
                resource: relatedResource,
                smartMerge: false
            });
        });

        test('returns failure message when reference could not be updated', async () => {
            const relatedResource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'obs-uuid-1',
                subject: { reference: 'Patient/same-patient' },
                meta: { versionId: '1' }
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(relatedResource)
            });
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');

            const result = await manager.updatePatientLinkAsync({
                req: {},
                resourceId: 'obs-1',
                resourceType: 'Observation',
                patientId: 'same-patient'
            });

            expect(result.message).toContain("Couldn't update");
            expect(mockAdminResourceWriter.writeAsync).not.toHaveBeenCalled();
        });

        test('leaves meta.versionId for the write pipeline to bump', async () => {
            const relatedResource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'obs-uuid-1',
                subject: { reference: 'Patient/old-patient' },
                meta: { versionId: '5' }
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(relatedResource)
            });
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');

            await manager.updatePatientLinkAsync({
                req: {},
                resourceId: 'obs-1',
                resourceType: 'Observation',
                patientId: 'patient-new'
            });

            expect(relatedResource.meta.versionId).toBe('5');
        });

        test('propagates a failure from the admin resource writer', async () => {
            const relatedResource = {
                resourceType: 'Observation',
                id: 'obs-1',
                _uuid: 'obs-uuid-1',
                subject: { reference: 'Patient/old-patient' },
                meta: { versionId: '1' }
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(relatedResource)
            });
            mockPatientFilterManager.getPatientPropertyForResource = jestGlobal.fn()
                .mockReturnValue('subject.reference');
            mockAdminResourceWriter.writeAsync.mockRejectedValue(new Error('write failed'));

            await expect(manager.updatePatientLinkAsync({
                req: {},
                resourceId: 'obs-1',
                resourceType: 'Observation',
                patientId: 'patient-new'
            })).rejects.toThrow('write failed');
        });
    });

    describe('showPersonToPersonLinkAsync', () => {
        test('strips Person/ prefix', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            });

            const result = await manager.showPersonToPersonLinkAsync({ bwellPersonId: 'Person/person-1' });
            expect(result.id).toBe('person-1');
            expect(result.source).toBe('[Resource missing]');
        });
    });

    describe('findPersonAndChildrenAsync', () => {
        test('returns resource missing when person not found', async () => {
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            });

            const result = await manager.findPersonAndChildrenAsync({ personId: 'missing', level: 1 });
            expect(result.id).toBe('missing');
            expect(result.source).toBe('[Resource missing]');
        });

        test('returns person with patient children', async () => {
            const person = {
                id: 'person-1',
                resourceType: 'Person',
                meta: {
                    source: 'http://source.com',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-1' },
                        { system: 'https://www.icanbwell.com/access', code: 'access-1' }
                    ]
                },
                link: [
                    { target: { reference: 'Patient/patient-1', type: 'Patient' } }
                ]
            };
            const patient = {
                id: 'patient-1',
                resourceType: 'Patient',
                meta: {
                    source: 'http://patient-source.com',
                    security: [
                        { system: 'https://www.icanbwell.com/owner', code: 'owner-2' }
                    ]
                }
            };

            const personQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            };
            const patientQueryManager = {
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([patient]) })
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(personQueryManager) // Person query for fastFindOneAsync
                .mockReturnValueOnce(patientQueryManager); // Patient query for children

            const result = await manager.findPersonAndChildrenAsync({ personId: 'person-1', level: 1 });

            expect(result.id).toBe('person-1');
            expect(result.source).toBe('http://source.com');
            expect(result.owner).toEqual(['owner-1']);
            expect(result.access).toEqual(['access-1']);
            expect(result.children).toHaveLength(1);
            expect(result.children[0].id).toBe('patient-1');
        });

        test('marks missing patients in children', async () => {
            const person = {
                id: 'person-1',
                resourceType: 'Person',
                meta: { source: 'src' },
                link: [
                    { target: { reference: 'Patient/patient-1' } },
                    { target: { reference: 'Patient/patient-missing' } }
                ]
            };
            const patient = {
                id: 'patient-1',
                resourceType: 'Patient',
                meta: { source: 'src' }
            };

            const personQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            };
            const patientQueryManager = {
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([patient]) })
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(personQueryManager)
                .mockReturnValueOnce(patientQueryManager);

            const result = await manager.findPersonAndChildrenAsync({ personId: 'person-1', level: 1 });

            expect(result.children).toHaveLength(2);
            const missingChild = result.children.find(c => c.id === 'patient-missing');
            expect(missingChild.source).toBe('[Resource missing]');
        });

        test('includes parent persons at level 1', async () => {
            const person = {
                id: 'person-1',
                resourceType: 'Person',
                meta: { source: 'src' },
                link: []
            };
            const parentPerson = {
                id: 'parent-1',
                resourceType: 'Person',
                meta: { source: 'parent-src', security: [] }
            };

            const personQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([parentPerson]) })
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(personQueryManager);

            const result = await manager.findPersonAndChildrenAsync({ personId: 'person-1', level: 1 });

            expect(result.parents).toHaveLength(1);
            expect(result.parents[0].id).toBe('parent-1');
        });

        test('does not include parents at level > 1', async () => {
            const person = {
                id: 'person-1',
                resourceType: 'Person',
                meta: { source: 'src' },
                link: []
            };

            const personQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(personQueryManager);

            const result = await manager.findPersonAndChildrenAsync({ personId: 'person-1', level: 2 });

            expect(result.parents).toBeUndefined();
        });

        test('returns result without children when person has no links', async () => {
            const person = {
                id: 'person-1',
                resourceType: 'Person',
                meta: { source: 'src', security: [] },
                link: null
            };

            const personQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(personQueryManager);

            const result = await manager.findPersonAndChildrenAsync({ personId: 'person-1', level: 1 });

            expect(result.children).toBeUndefined();
        });

        test('handles empty meta.security gracefully', async () => {
            const person = {
                id: 'person-1',
                resourceType: 'Person',
                meta: { source: 'src' },
                link: []
            };

            const personQueryManager = {
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(person),
                findAsync: jestGlobal.fn().mockResolvedValue({ toArrayAsync: jestGlobal.fn().mockResolvedValue([]) })
            };

            mockDatabaseQueryFactory.createQuery = jestGlobal.fn()
                .mockReturnValueOnce(personQueryManager);

            const result = await manager.findPersonAndChildrenAsync({ personId: 'person-1', level: 1 });

            expect(result.owner).toEqual([]);
            expect(result.access).toEqual([]);
        });
    });

    describe('deletePersonAsync', () => {
        test('returns 0 deleted count when person not found', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                next: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null),
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
                next: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(personToDelete),
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

        test('removes links from parent persons before deletion', async () => {
            const personToDelete = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: []
            };
            const parentPerson = {
                id: 'parent-1',
                link: [{ target: { reference: 'Person/person-1', _uuid: 'Person/person-1' } }]
            };

            const mockCursor = {
                hasNext: jestGlobal.fn()
                    .mockResolvedValueOnce(true)
                    .mockResolvedValueOnce(false),
                next: jestGlobal.fn()
                    .mockResolvedValueOnce(parentPerson)
            };


            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn()
                    .mockResolvedValueOnce(parentPerson)
                    .mockResolvedValueOnce(personToDelete),
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });
            mockRemoveHelper.deleteManyAsync = jestGlobal.fn().mockResolvedValue(1);

            const result = await manager.deletePersonAsync({
                req: {},
                requestId: 'req-1',
                personId: 'person-1'
            });

            expect(result.deletedCount).toBe(1);
            expect(result.linksRemoved).toBeDefined();
            expect(result.linksRemoved.length).toBe(1);
            expect(result.linksRemoved[0].message).toContain('Removed link from Person/parent-1');
            expect(mockAdminResourceWriter.writeAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    resourceType: 'Person',
                    smartMerge: false,
                    resource: expect.objectContaining({ id: 'parent-1', link: [] })
                })
            );
        });

        test('strips Person/ prefix from personId', async () => {
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                next: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(null),
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });

            const result = await manager.deletePersonAsync({
                req: {},
                requestId: 'req-1',
                personId: 'Person/person-1'
            });

            expect(result.deletedCount).toBe(0);
        });

        test('calls postSaveProcessor.afterSaveAsync after deletion', async () => {
            const personToDelete = {
                id: 'person-1',
                _uuid: 'person-uuid-1',
                link: []
            };
            const mockCursor = {
                hasNext: jestGlobal.fn().mockResolvedValue(false),
                next: jestGlobal.fn()
            };
            mockDatabaseQueryFactory.createQuery = jestGlobal.fn().mockReturnValue({
                fastFindOneAsync: jestGlobal.fn().mockResolvedValue(personToDelete),
                findAsync: jestGlobal.fn().mockResolvedValue(mockCursor)
            });
            mockRemoveHelper.deleteManyAsync = jestGlobal.fn().mockResolvedValue(1);

            await manager.deletePersonAsync({
                req: {},
                requestId: 'req-1',
                personId: 'person-1'
            });

            expect(mockPostSaveProcessor.afterSaveAsync).toHaveBeenCalledWith(expect.objectContaining({
                requestId: 'req-1',
                eventType: 'U',
                resourceType: 'Person',
                doc: personToDelete
            }));
        });
    });
});
