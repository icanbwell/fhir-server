const { describe, test, expect, beforeEach, jest, afterEach } = require('@jest/globals');

// Mock modules before imports
jest.mock('express-http-context', () => ({ get: jest.fn(), set: jest.fn() }));

jest.mock('cloudevents', () => ({
    CloudEvent: jest.fn().mockImplementation((payload) => ({ ...payload, _isCloudEvent: true })),
    Kafka: {
        binary: jest.fn().mockImplementation((event) => ({
            body: JSON.stringify(event.data),
            headers: { ce_type: event.type, ce_source: event.source, undefinedHeader: undefined }
        }))
    }
}));

jest.mock('../../../operations/common/logging', () => ({
    logError: jest.fn()
}));

const { PatientPersonDataChangeEventProducer } = require('../../../utils/patientPersonDataChangeEventProducer');
const { KafkaClient } = require('../../../utils/kafkaClient');
const { ConfigManager } = require('../../../utils/configManager');
const { PatientFilterManager } = require('../../../fhir/patientFilterManager');
const { DatabaseQueryFactory } = require('../../../dataLayer/databaseQueryFactory');
const { BasePostSaveHandler } = require('../../../utils/basePostSaveHandler');
const { logError } = require('../../../operations/common/logging');

describe('PatientPersonDataChangeEventProducer', () => {
    let producer;
    let mockKafkaClient;
    let mockConfigManager;
    let mockPatientFilterManager;
    let mockDatabaseQueryFactory;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock instances that pass assertTypeEquals
        mockKafkaClient = Object.create(KafkaClient.prototype);
        mockKafkaClient.sendCloudEventMessageAsync = jest.fn().mockResolvedValue(undefined);

        mockConfigManager = Object.create(ConfigManager.prototype);
        Object.defineProperty(mockConfigManager, 'kafkaEnableEvents', { get: () => true, configurable: true });
        Object.defineProperty(mockConfigManager, 'enablePatientDataChangeEvents', { get: () => true, configurable: true });
        Object.defineProperty(mockConfigManager, 'enablePersonDataChangeEvents', { get: () => true, configurable: true });
        Object.defineProperty(mockConfigManager, 'patientDataChangeEventTopic', { get: () => 'test.patient.topic', configurable: true });
        Object.defineProperty(mockConfigManager, 'personDataChangeEventTopic', { get: () => 'test.person.topic', configurable: true });
        Object.defineProperty(mockConfigManager, 'postRequestBatchSize', { get: () => 50, configurable: true });

        mockPatientFilterManager = Object.create(PatientFilterManager.prototype);
        mockPatientFilterManager.getPatientPropertyForResource = jest.fn();

        mockDatabaseQueryFactory = Object.create(DatabaseQueryFactory.prototype);
        mockDatabaseQueryFactory.createQuery = jest.fn();

        producer = new PatientPersonDataChangeEventProducer({
            kafkaClient: mockKafkaClient,
            configManager: mockConfigManager,
            patientFilterManager: mockPatientFilterManager,
            databaseQueryFactory: mockDatabaseQueryFactory
        });
    });

    describe('constructor', () => {
        test('should initialize with correct properties from configManager', () => {
            expect(producer.dataChangeEventsEnabled).toBe(true);
            expect(producer.enablePatientDataChangeEvents).toBe(true);
            expect(producer.enablePersonDataChangeEvents).toBe(true);
            expect(producer.patientDataChangeEventTopic).toBe('test.patient.topic');
            expect(producer.personDataChangeEventTopic).toBe('test.person.topic');
            expect(producer.maxBufferSize).toBe(50);
        });

        test('should be disabled when kafkaEnableEvents is false', () => {
            const disabledConfigManager = Object.create(ConfigManager.prototype);
            Object.defineProperty(disabledConfigManager, 'kafkaEnableEvents', { get: () => false, configurable: true });
            Object.defineProperty(disabledConfigManager, 'enablePatientDataChangeEvents', { get: () => true, configurable: true });
            Object.defineProperty(disabledConfigManager, 'enablePersonDataChangeEvents', { get: () => true, configurable: true });
            Object.defineProperty(disabledConfigManager, 'patientDataChangeEventTopic', { get: () => 'test.patient.topic', configurable: true });
            Object.defineProperty(disabledConfigManager, 'personDataChangeEventTopic', { get: () => 'test.person.topic', configurable: true });
            Object.defineProperty(disabledConfigManager, 'postRequestBatchSize', { get: () => 50, configurable: true });

            const disabledProducer = new PatientPersonDataChangeEventProducer({
                kafkaClient: mockKafkaClient,
                configManager: disabledConfigManager,
                patientFilterManager: mockPatientFilterManager,
                databaseQueryFactory: mockDatabaseQueryFactory
            });
            expect(disabledProducer.dataChangeEventsEnabled).toBe(false);
        });
    });

    describe('addResourceToChangeEventMap', () => {
        test('should return early when id is null/undefined', () => {
            producer.addResourceToChangeEventMap({ id: null, resourceType: 'Patient', changedResourceType: 'Observation' });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should return early when id is empty string', () => {
            producer.addResourceToChangeEventMap({ id: '', resourceType: 'Patient', changedResourceType: 'Observation' });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should return early when changedResourceType is null', () => {
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: null });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should return early when changedResourceType is undefined', () => {
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: undefined });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should add to patientDataChangeMap for Patient resourceType', () => {
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: 'Observation' });
            expect(producer.patientDataChangeMap.get('patient-1')).toEqual(['Observation']);
        });

        test('should add to personDataChangeMap for Person resourceType', () => {
            producer.addResourceToChangeEventMap({ id: 'person-1', resourceType: 'Person', changedResourceType: 'Patient' });
            expect(producer.personDataChangeMap.get('person-1')).toEqual(['Patient']);
        });

        test('should not add duplicate changedResourceType', () => {
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: 'Observation' });
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: 'Observation' });
            expect(producer.patientDataChangeMap.get('patient-1')).toEqual(['Observation']);
        });

        test('should accumulate different changedResourceTypes for same id', () => {
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: 'Observation' });
            producer.addResourceToChangeEventMap({ id: 'patient-1', resourceType: 'Patient', changedResourceType: 'Condition' });
            expect(producer.patientDataChangeMap.get('patient-1')).toEqual(['Observation', 'Condition']);
        });

        test('should skip Person resourceType when enablePersonDataChangeEvents is false', () => {
            producer.enablePersonDataChangeEvents = false;
            producer.addResourceToChangeEventMap({ id: 'person-1', resourceType: 'Person', changedResourceType: 'Patient' });
            expect(producer.personDataChangeMap.size).toBe(0);
        });
    });

    describe('_extractPatientReferenceId', () => {
        test('should return null for null reference', () => {
            const result = producer._extractPatientReferenceId(null, 'Observation', 'doc-1', 'req-1', 'C');
            expect(result).toBeNull();
        });

        test('should return null for non-string reference', () => {
            const result = producer._extractPatientReferenceId(123, 'Observation', 'doc-1', 'req-1', 'C');
            expect(result).toBeNull();
        });

        test('should return null for reference without Patient/ prefix', () => {
            const result = producer._extractPatientReferenceId('Organization/org-1', 'Observation', 'doc-1', 'req-1', 'C');
            expect(result).toBeNull();
        });

        test('should extract patient id from valid Patient reference', () => {
            const result = producer._extractPatientReferenceId('Patient/patient-123', 'Observation', 'doc-1', 'req-1', 'C');
            expect(result).toBe('patient-123');
        });

        test('should return null and log error when Patient/ has no id after split', () => {
            // BUG DETECTION: 'Patient/'.split('/')[1] returns '' which is falsy
            const result = producer._extractPatientReferenceId('Patient/', 'Observation', 'doc-1', 'req-1', 'C');
            expect(result).toBeNull();
            expect(logError).toHaveBeenCalled();
        });
    });

    describe('_parsePatientReferenceId', () => {
        test('should identify person proxy reference', () => {
            const result = producer._parsePatientReferenceId('person.some-person-id');
            expect(result).toEqual({ id: 'some-person-id', referencedResourceType: 'Person' });
        });

        test('should identify regular patient reference', () => {
            const result = producer._parsePatientReferenceId('patient-123');
            expect(result).toEqual({ id: 'patient-123', referencedResourceType: 'Patient' });
        });

        test('should handle empty string after person prefix removal', () => {
            // BUG: If referencedResourceId is exactly 'person.' then replace gives ''
            // which is falsy - the caller checks `if (id)` so it would skip
            const result = producer._parsePatientReferenceId('person.');
            expect(result).toEqual({ id: '', referencedResourceType: 'Person' });
        });
    });

    describe('_cleanHeaders', () => {
        test('should remove undefined headers', () => {
            const result = producer._cleanHeaders({
                'ce_type': 'PatientDataChangeEvent',
                'ce_source': 'https://www.icanbwell.com/fhir-server',
                'undefinedHeader': undefined
            });
            expect(result).toEqual({
                'ce_type': 'PatientDataChangeEvent',
                'ce_source': 'https://www.icanbwell.com/fhir-server'
            });
        });

        test('should keep null and empty string headers', () => {
            const result = producer._cleanHeaders({
                'nullHeader': null,
                'emptyHeader': ''
            });
            expect(result).toEqual({
                'nullHeader': null,
                'emptyHeader': ''
            });
        });

        test('should handle empty headers object', () => {
            const result = producer._cleanHeaders({});
            expect(result).toEqual({});
        });
    });

    describe('_createCloudEvent', () => {
        test('should create a cloud event message with correct structure', () => {
            const result = producer._createCloudEvent({
                resourceId: 'patient-1',
                resourceType: 'Patient',
                changedResourceTypes: ['Observation', 'Condition']
            });
            expect(result).toHaveProperty('key', 'patient-1');
            expect(result).toHaveProperty('value');
            expect(result).toHaveProperty('headers');
            // Undefined headers should be filtered out
            expect(result.headers.undefinedHeader).toBeUndefined();
        });

        test('should handle undefined resourceType.toUpperCase() for CLOUD_EVENT_TYPES lookup', () => {
            // BUG: CLOUD_EVENT_TYPES only has 'PATIENT' and 'PERSON' keys.
            // If resourceType is something else like 'Observation', toUpperCase() gives 'OBSERVATION'
            // which doesn't exist in CLOUD_EVENT_TYPES, resulting in type: undefined
            const result = producer._createCloudEvent({
                resourceId: 'obs-1',
                resourceType: 'Observation',
                changedResourceTypes: ['Observation']
            });
            // This is not a bug per se since _createCloudEvent is only called with Patient/Person
            // but it's a defensive programming concern
            expect(result.key).toBe('obs-1');
        });
    });

    describe('afterSaveAsync', () => {
        test('should return early when dataChangeEventsEnabled is false', async () => {
            producer.dataChangeEventsEnabled = false;
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: 'patient-1' }
            });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should return early for AuditEvent resourceType', async () => {
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'AuditEvent',
                doc: { _uuid: 'audit-1' }
            });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should add Patient resource to patientDataChangeMap', async () => {
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: 'patient-1' }
            });
            expect(producer.patientDataChangeMap.get('patient-1')).toEqual(['Patient']);
        });

        test('should add Person resource to personDataChangeMap', async () => {
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Person',
                doc: { _uuid: 'person-1' }
            });
            expect(producer.personDataChangeMap.get('person-1')).toEqual(['Person']);
        });

        test('should handle resource with patient reference', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Observation',
                doc: { _uuid: 'obs-1', subject: { _uuid: 'Patient/patient-1' } }
            });
            expect(producer.patientDataChangeMap.get('patient-1')).toEqual(['Observation']);
        });

        test('should handle resource with person proxy reference', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Observation',
                doc: { _uuid: 'obs-1', subject: { _uuid: 'Patient/person.person-1' } }
            });
            expect(producer.personDataChangeMap.get('person-1')).toEqual(['Observation']);
        });

        test('should return early for resource without patient property', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue(null);

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Organization',
                doc: { _uuid: 'org-1' }
            });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should handle array of patient references', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('participant.actor.reference');

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Appointment',
                doc: {
                    _uuid: 'appt-1',
                    participant: [
                        { actor: { _uuid: 'Patient/patient-1' } },
                        { actor: { _uuid: 'Patient/patient-2' } }
                    ]
                }
            });
            expect(producer.patientDataChangeMap.get('patient-1')).toEqual(['Appointment']);
            expect(producer.patientDataChangeMap.get('patient-2')).toEqual(['Appointment']);
        });

        test('should skip references that are not Patient references', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Observation',
                doc: { _uuid: 'obs-1', subject: { _uuid: 'Organization/org-1' } }
            });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should flush when buffer exceeds maxBufferSize', async () => {
            producer.maxBufferSize = 2;
            const flushSpy = jest.spyOn(producer, 'flushAsync').mockResolvedValue(undefined);

            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: 'patient-1' }
            });
            await producer.afterSaveAsync({
                requestId: 'req-2',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: 'patient-2' }
            });

            expect(flushSpy).toHaveBeenCalled();
        });

        test('should throw RethrownError when error occurs', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockImplementation(() => {
                throw new Error('Some internal error');
            });

            await expect(producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Observation',
                doc: { _uuid: 'obs-1' }
            })).rejects.toThrow('Error in PatientPersonDataChangeEventProducer.afterSaveAsync()');
        });

        test('should handle doc with null _uuid for Patient', async () => {
            // BUG: doc._uuid could be null/undefined - addResourceToChangeEventMap checks for !id
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: null }
            });
            // Should not add to map since id is null
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should handle doc with undefined _uuid for Patient', async () => {
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: undefined }
            });
            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should handle resource reference that is undefined from NestedPropertyReader', async () => {
            mockPatientFilterManager.getPatientPropertyForResource.mockReturnValue('subject.reference');

            // When the nested property doesn't exist, NestedPropertyReader returns undefined
            await producer.afterSaveAsync({
                requestId: 'req-1',
                eventType: 'C',
                resourceType: 'Observation',
                doc: { _uuid: 'obs-1' } // no 'subject' property
            });
            // Should not crash, undefined becomes [undefined] which _extractPatientReferenceId handles
            expect(producer.patientDataChangeMap.size).toBe(0);
        });
    });

    describe('flushAsync', () => {
        test('should return early when both maps are empty', async () => {
            await producer.flushAsync();
            expect(mockKafkaClient.sendCloudEventMessageAsync).not.toHaveBeenCalled();
        });

        test('should send patient data change events', async () => {
            producer.patientDataChangeMap.set('patient-1', ['Observation', 'Condition']);

            await producer.flushAsync();

            expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalledWith(
                expect.objectContaining({
                    topic: 'test.patient.topic',
                    messages: expect.arrayContaining([
                        expect.objectContaining({ key: 'patient-1' })
                    ])
                })
            );
        });

        test('should clear maps after flush', async () => {
            producer.patientDataChangeMap.set('patient-1', ['Observation']);

            await producer.flushAsync();

            expect(producer.patientDataChangeMap.size).toBe(0);
        });

        test('should populate person data change map from patient data before sending person events', async () => {
            producer.patientDataChangeMap.set('patient-1', ['Observation']);

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: [{ target: { _uuid: 'Patient/patient-1' } }]
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            await producer.flushAsync();

            // Should have sent both patient and person events
            expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalledTimes(2);
        });

        test('should log error and not throw when kafka send fails', async () => {
            producer.patientDataChangeMap.set('patient-1', ['Observation']);
            mockKafkaClient.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka error'));

            // Should not throw - error is caught and logged
            await producer.flushAsync();
            expect(logError).toHaveBeenCalled();
        });

        test('should clear maps even when error occurs - DATA LOSS BUG', async () => {
            producer.patientDataChangeMap.set('patient-1', ['Observation']);
            mockKafkaClient.sendCloudEventMessageAsync.mockRejectedValue(new Error('Kafka error'));

            await producer.flushAsync();

            // BUG DETECTION: Maps are cleared BEFORE processing (line 355), so data is lost on error.
            // The patientDataChangeMap was cleared before the Kafka send failed at line 362.
            // The catch block (line 384) only logs but doesn't restore the data.
            // This means if Kafka is temporarily unavailable, ALL patient/person change events
            // accumulated in the buffer are permanently lost with no retry mechanism.
            expect(producer.patientDataChangeMap.size).toBe(0);
            // The event for 'patient-1' was never successfully sent but is now gone
            expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalled();
        });

        test('DATA LOSS: person events lost when patient events succeed but person population fails', async () => {
            // Scenario: Patient events are sent successfully, but DB query for person lookup fails
            producer.patientDataChangeMap.set('patient-1', ['Observation']);
            producer.personDataChangeMap.set('person-1', ['Patient']);

            // Patient send succeeds
            mockKafkaClient.sendCloudEventMessageAsync
                .mockResolvedValueOnce(undefined) // patient events succeed
                .mockResolvedValueOnce(undefined); // person events succeed

            // But the DB query to populate person data map throws
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockRejectedValue(new Error('DB connection lost'))
            });

            await producer.flushAsync();

            // Both maps are already cleared - person events are lost
            expect(producer.patientDataChangeMap.size).toBe(0);
            expect(producer.personDataChangeMap.size).toBe(0);
            expect(logError).toHaveBeenCalled();
        });
    });

    describe('_populatePersonDataChangeMapAsync', () => {
        test('should return early when patientDataMapBuffer is empty', async () => {
            const patientBuffer = new Map();
            const personBuffer = new Map();

            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);
            expect(mockDatabaseQueryFactory.createQuery).not.toHaveBeenCalled();
        });

        test('should find persons linked to patients and populate personDataMapBuffer', async () => {
            const patientBuffer = new Map([['patient-1', ['Observation']]]);
            const personBuffer = new Map();

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: [{ target: { _uuid: 'Patient/patient-1' } }]
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);

            expect(personBuffer.get('person-1')).toEqual(['Observation']);
        });

        test('should handle person with multiple patient links', async () => {
            const patientBuffer = new Map([
                ['patient-1', ['Observation']],
                ['patient-2', ['Condition']]
            ]);
            const personBuffer = new Map();

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: [
                            { target: { _uuid: 'Patient/patient-1' } },
                            { target: { _uuid: 'Patient/patient-2' } }
                        ]
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);

            expect(personBuffer.get('person-1')).toEqual(expect.arrayContaining(['Observation', 'Condition']));
        });

        test('should handle person with null link array', async () => {
            const patientBuffer = new Map([['patient-1', ['Observation']]]);
            const personBuffer = new Map();

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: null
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            // Should not crash - `for (const link of personResource.link || [])` handles null
            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);
            expect(personBuffer.get('person-1')).toEqual([]);
        });

        test('should handle link target without _uuid', async () => {
            const patientBuffer = new Map([['patient-1', ['Observation']]]);
            const personBuffer = new Map();

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: [{ target: {} }] // no _uuid
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);
            // Should not crash, the condition targetRef._uuid checks for undefined
            expect(personBuffer.get('person-1')).toEqual([]);
        });

        test('should handle link target that is null', async () => {
            const patientBuffer = new Map([['patient-1', ['Observation']]]);
            const personBuffer = new Map();

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: [{ target: null }]
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            // The code checks `targetRef && typeof targetRef === 'object'` which handles null
            // BUT null IS typeof 'object' in JavaScript!
            // So the condition `targetRef && typeof targetRef === 'object' && targetRef._uuid`
            // evaluates: null && ... => false. So it's actually safe due to short-circuit.
            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);
            expect(personBuffer.get('person-1')).toEqual([]);
        });

        test('should handle link with non-Patient _uuid prefix', async () => {
            const patientBuffer = new Map([['patient-1', ['Observation']]]);
            const personBuffer = new Map();

            const mockCursor = {
                toArrayAsync: jest.fn().mockResolvedValue([
                    {
                        _uuid: 'person-1',
                        link: [{ target: { _uuid: 'RelatedPerson/related-1' } }]
                    }
                ])
            };
            mockDatabaseQueryFactory.createQuery.mockReturnValue({
                findAsync: jest.fn().mockResolvedValue(mockCursor)
            });

            await producer._populatePersonDataChangeMapAsync(patientBuffer, personBuffer);
            // The code checks `targetRef._uuid.startsWith('Patient/')` - so non-Patient links are skipped
            expect(personBuffer.get('person-1')).toEqual([]);
        });
    });

    describe('_processDataChangeEvents', () => {
        test('should not send messages when dataChangeMap is empty', async () => {
            await producer._processDataChangeEvents({
                topic: 'test.topic',
                dataChangeMap: new Map(),
                resourceType: 'Patient'
            });
            expect(mockKafkaClient.sendCloudEventMessageAsync).not.toHaveBeenCalled();
        });

        test('should send messages for each entry in dataChangeMap', async () => {
            const dataChangeMap = new Map([
                ['patient-1', ['Observation']],
                ['patient-2', ['Condition', 'Observation']]
            ]);

            await producer._processDataChangeEvents({
                topic: 'test.patient.topic',
                dataChangeMap,
                resourceType: 'Patient'
            });

            expect(mockKafkaClient.sendCloudEventMessageAsync).toHaveBeenCalledWith({
                topic: 'test.patient.topic',
                messages: expect.arrayContaining([
                    expect.objectContaining({ key: 'patient-1' }),
                    expect.objectContaining({ key: 'patient-2' })
                ])
            });
        });
    });
});
