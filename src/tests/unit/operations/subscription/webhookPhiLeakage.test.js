/**
 * Tenant isolation of Subscription resources returned by $everything.
 *
 * Subscription, SubscriptionStatus and SubscriptionTopic carry webhook endpoints, auth headers and
 * notification criteria. EverythingRelatedResourcesMapper (Person $everything) only returns the ones
 * whose client_person_id marker equals the requesting Person's _uuid, so a tenant never sees another
 * tenant's subscriptions even when both reference the same source patient.
 *
 * The Kafka change events that downstream subscription processors consume carry identifiers only
 * (resource id, resource type, changed resource types) and never resource content, so they cannot
 * leak PHI to a webhook by themselves.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { EverythingRelatedResourcesMapper } = require('../../../../operations/everything/everythingRelatedResourcesMapper');
const { ChangeEventProducer } = require('../../../../utils/changeEventProducer');
const { PatientPersonDataChangeEventProducer } = require('../../../../utils/patientPersonDataChangeEventProducer');

const SUBSCRIPTION_TYPES = ['Subscription', 'SubscriptionStatus', 'SubscriptionTopic'];

describe('Subscription tenant isolation in Person $everything', () => {
    let related;

    beforeEach(() => {
        related = new EverythingRelatedResourcesMapper().relatedResources('Person', null);
    });

    function customQueryFor(type) {
        const entry = related.find(r => r.type === type);
        expect(entry).toBeDefined();
        expect(entry.customQuery).toBeDefined();
        return entry.customQuery;
    }

    function queryForPerson(type, personUuid) {
        return JSON.parse(customQueryFor(type).query.replace(/{_uuid}/g, personUuid));
    }

    describe('customQuery filters on client_person_id and is parameterized per Person', () => {
        test.each(SUBSCRIPTION_TYPES)('%s customQuery must include client_person_id', (type) => {
            expect(customQueryFor(type).query).toContain('client_person_id');
        });

        test.each(SUBSCRIPTION_TYPES)('%s requiredValues must include _uuid for per-Person substitution', (type) => {
            expect(customQueryFor(type).requiredValues).toEqual(expect.arrayContaining(['_uuid']));
        });
    });

    describe('the substituted query matches only the requesting Person', () => {
        test.each(SUBSCRIPTION_TYPES)('%s elemMatch pairs client_person_id with the Person uuid', (type) => {
            const queryObj = queryForPerson(type, 'person-aaa');

            const elemMatch = Object.values(queryObj)[0].$elemMatch;
            expect(Object.values(elemMatch)).toEqual(expect.arrayContaining(['person-aaa']));
            expect(Object.values(elemMatch).some(v => String(v).includes('client_person_id'))).toBe(true);
        });
    });

    describe('different Persons get different queries', () => {
        test.each(SUBSCRIPTION_TYPES)('%s query differs between Person A and Person B', (type) => {
            const tenantAQuery = customQueryFor(type).query.replace(/{_uuid}/g, 'person-aaa');
            const tenantBQuery = customQueryFor(type).query.replace(/{_uuid}/g, 'person-bbb');

            expect(tenantAQuery).not.toEqual(tenantBQuery);
            expect(tenantAQuery).not.toContain('person-bbb');
            expect(tenantBQuery).not.toContain('person-aaa');
        });
    });

    describe('Kafka change events carry identifiers only, never resource content', () => {
        const PHI_DOC_FIELDS = {
            name: [{ family: 'Smith', given: ['Jane'] }],
            birthDate: '1990-05-15',
            identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' }],
            meta: {
                security: [
                    { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                    { system: 'https://www.icanbwell.com/owner', code: 'tenant-a-slug' }
                ]
            }
        };

        function expectNoPhi(serialized) {
            expect(serialized).not.toContain('Smith');
            expect(serialized).not.toContain('Jane');
            expect(serialized).not.toContain('1990-05-15');
            expect(serialized).not.toContain('123-45-6789');
        }

        test('ChangeEventProducer message references the changed resource by id and carries no resource content', async () => {
            const sentMessages = [];
            const kafkaClient = {
                sendMessagesAsync: jestGlobal.fn().mockImplementation((topic, messages) => {
                    sentMessages.push(...messages);
                    return Promise.resolve();
                })
            };
            const producer = new ChangeEventProducer({
                kafkaClient,
                resourceManager: {},
                fhirResourceChangeTopic: 'test-topic',
                configManager: { kafkaEnabledResources: ['Patient'], postRequestBatchSize: 100 }
            });

            await producer.afterSaveAsync({
                requestId: 'req-123',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { id: 'patient-123', ...PHI_DOC_FIELDS }
            });
            process.env.ENABLE_EVENTS_KAFKA = '1';
            try {
                await producer.flushAsync();
            } finally {
                delete process.env.ENABLE_EVENTS_KAFKA;
            }

            expect(sentMessages).toHaveLength(1);
            expect(sentMessages[0].key).toBe('patient-123');
            const messageValue = JSON.parse(sentMessages[0].value);
            expect(messageValue.agent[0].who.reference).toBe('Patient/patient-123');
            expectNoPhi(sentMessages[0].value);
        });

        test('ChangeEventProducer keys the buffered message by resource id', async () => {
            const producer = new ChangeEventProducer({
                kafkaClient: {},
                resourceManager: {},
                fhirResourceChangeTopic: 'test-topic',
                configManager: { kafkaEnabledResources: ['Observation'], postRequestBatchSize: 100 }
            });

            await producer.onResourceChangeAsync({
                requestId: 'req-456',
                id: 'obs-789',
                resourceType: 'Observation',
                timestamp: '2024-01-01',
                sourceType: 'some-source',
                eventType: 'C'
            });

            const entry = producer.getFhirResourceMessageMap().get('obs-789');
            expect(entry).toBeDefined();
            expect(entry.agent[0].who.reference).toBe('Observation/obs-789');
            expect(entry.action).toBe('C');
        });

        test('PatientPersonDataChangeEventProducer CloudEvent data is exactly id, resourceType and changedResourceTypes', () => {
            const producer = new PatientPersonDataChangeEventProducer({
                kafkaClient: {},
                configManager: {
                    kafkaEnableEvents: true,
                    enablePatientDataChangeEvents: true,
                    enablePersonDataChangeEvents: true,
                    patientDataChangeEventTopic: 'patient-topic',
                    personDataChangeEventTopic: 'person-topic',
                    postRequestBatchSize: 100
                },
                patientFilterManager: { getPatientPropertyForResource: jestGlobal.fn().mockReturnValue(null) },
                databaseQueryFactory: { createQuery: jestGlobal.fn() }
            });

            const cloudEventMessage = producer._createCloudEvent({
                resourceId: 'patient-123',
                resourceType: 'Patient',
                changedResourceTypes: ['Observation', 'Condition']
            });

            expect(JSON.parse(cloudEventMessage.value)).toEqual({
                id: 'patient-123',
                resourceType: 'Patient',
                changedResourceTypes: ['Observation', 'Condition']
            });
        });

        test('PatientPersonDataChangeEventProducer sends the patient uuid and no resource content', async () => {
            const sentMessages = [];
            const producer = new PatientPersonDataChangeEventProducer({
                kafkaClient: {
                    sendCloudEventMessageAsync: jestGlobal.fn().mockImplementation(({ messages }) => {
                        sentMessages.push(...messages);
                        return Promise.resolve();
                    })
                },
                configManager: {
                    kafkaEnableEvents: true,
                    enablePatientDataChangeEvents: true,
                    enablePersonDataChangeEvents: false,
                    patientDataChangeEventTopic: 'patient-changes',
                    personDataChangeEventTopic: 'person-changes',
                    postRequestBatchSize: 100
                },
                patientFilterManager: { getPatientPropertyForResource: jestGlobal.fn().mockReturnValue('subject.reference') },
                databaseQueryFactory: { createQuery: jestGlobal.fn() }
            });

            await producer.afterSaveAsync({
                requestId: 'req-abc',
                eventType: 'C',
                resourceType: 'Patient',
                doc: { _uuid: 'patient-uuid-111', id: 'patient-111', ...PHI_DOC_FIELDS }
            });
            await producer.flushAsync();

            expect(sentMessages).toHaveLength(1);
            expect(JSON.parse(sentMessages[0].value)).toEqual({
                id: 'patient-uuid-111',
                resourceType: 'Patient',
                changedResourceTypes: ['Patient']
            });
            expectNoPhi(sentMessages[0].value);
        });
    });
});
