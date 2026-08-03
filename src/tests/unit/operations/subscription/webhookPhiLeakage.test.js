/**
 * Webhook PHI Leakage Tests for FHIR Subscription Notification System
 *
 * These tests assert CORRECT (secure) behavior and are expected to FAIL
 * against the current vulnerable code until the bugs are fixed.
 *
 * Attack Surface:
 * 1. Subscription notifications triggered by resource changes can send full
 *    resource payloads (including PHI) to webhook endpoints without verifying
 *    the subscription owner's tenant matches the resource's tenant.
 * 2. Kafka change events are published to a shared topic without tenant
 *    isolation, meaning any consumer of the topic can see changes across
 *    all tenants.
 * 3. The $everything custom query for Subscription/SubscriptionStatus/SubscriptionTopic
 *    returns resources across tenants when patients share the same source_patient_id
 *    and service_slug, exposing webhook URLs, auth headers, and subscription criteria.
 */
const { describe, test, expect, beforeEach, jest: jestGlobal } = require('@jest/globals');

jestGlobal.mock('../../../../utils/assertType', () => ({
    assertIsValid: () => {},
    assertTypeEquals: () => {}
}));

const { EverythingRelatedResourcesMapper } = require('../../../../operations/everything/everythingRelatedResourcesMapper');
const { ChangeEventProducer } = require('../../../../utils/changeEventProducer');
const { PatientPersonDataChangeEventProducer } = require('../../../../utils/patientPersonDataChangeEventProducer');

describe('Webhook PHI Leakage via Subscription Notifications', () => {
    let mapper;

    beforeEach(() => {
        mapper = new EverythingRelatedResourcesMapper();
    });

    describe('Subscription custom query must enforce tenant isolation to prevent webhook URL exposure', () => {
        /**
         * VULNERABILITY: When the Subscription custom query only filters by
         * source_patient_id + service_slug, an attacker in Tenant B can see
         * Tenant A's Subscription resources via $everything. This exposes:
         * - channel.endpoint (webhook URL, possibly containing API keys)
         * - channel.header (custom HTTP headers with auth tokens)
         * - criteria (what data the other tenant monitors)
         * - contact information of the subscribing party
         */

        test('Subscription customQuery must include client_person_id filter to isolate webhook endpoints', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            expect(subscription).toBeDefined();
            expect(subscription.customQuery).toBeDefined();

            // The query MUST include client_person_id to prevent cross-tenant leakage
            // of webhook endpoint URLs and authorization headers
            const queryStr = subscription.customQuery.query;
            expect(queryStr).toContain('client_person_id');
        });

        test('Subscription requiredValues must include _clientPersonId for tenant-scoped query substitution', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            // Without _clientPersonId in requiredValues, the query template cannot
            // be parameterized per-tenant, making cross-tenant isolation impossible
            expect(subscription.customQuery.requiredValues).toEqual(
                expect.arrayContaining(['_clientPersonId'])
            );
        });

        test('SubscriptionStatus customQuery must include client_person_id to prevent notification event leakage', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            expect(subscriptionStatus).toBeDefined();
            expect(subscriptionStatus.customQuery).toBeDefined();

            // SubscriptionStatus contains notification event details including:
            // - notificationEvent[].focus: references to resources that triggered notifications
            // - error messages that may contain PHI
            const queryStr = subscriptionStatus.customQuery.query;
            expect(queryStr).toContain('client_person_id');
        });

        test('SubscriptionStatus requiredValues must include _clientPersonId', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            expect(subscriptionStatus.customQuery.requiredValues).toEqual(
                expect.arrayContaining(['_clientPersonId'])
            );
        });

        test('SubscriptionTopic customQuery must include client_person_id to prevent criteria leakage', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionTopic = result.find(r => r.type === 'SubscriptionTopic');

            expect(subscriptionTopic).toBeDefined();
            expect(subscriptionTopic.customQuery).toBeDefined();

            // SubscriptionTopic reveals what resource types and criteria are being
            // monitored by another tenant - sensitive operational information
            const queryStr = subscriptionTopic.customQuery.query;
            expect(queryStr).toContain('client_person_id');
        });

        test('SubscriptionTopic requiredValues must include _clientPersonId', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionTopic = result.find(r => r.type === 'SubscriptionTopic');

            expect(subscriptionTopic.customQuery.requiredValues).toEqual(
                expect.arrayContaining(['_clientPersonId'])
            );
        });
    });

    describe('Subscription custom query $and filter must have three-part tenant isolation', () => {
        /**
         * A properly isolated query for Subscription resources requires THREE conditions:
         * 1. source_patient_id = <patient_id> (identifies the patient)
         * 2. service_slug = <service_slug> (identifies the health system)
         * 3. client_person_id = <person_id> (identifies the TENANT)
         *
         * Without condition 3, any tenant sharing the same patient at the same
         * health system sees all other tenants' subscriptions.
         */

        test('Subscription $and filter must have at least 3 conditions for tenant isolation', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            const queryStr = subscription.customQuery.query
                .replace(/{_sourceId}/g, 'test-patient')
                .replace(/{_sourceAssigningAuthority}/g, 'test-slug')
                .replace(/{_clientPersonId}/g, 'test-person');

            const queryObj = JSON.parse(queryStr);

            // Must have source_patient_id + service_slug + client_person_id
            expect(queryObj.$and.length).toBeGreaterThanOrEqual(3);
        });

        test('SubscriptionStatus $and filter must have at least 3 conditions for tenant isolation', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            const queryStr = subscriptionStatus.customQuery.query
                .replace(/{_sourceId}/g, 'test-patient')
                .replace(/{_sourceAssigningAuthority}/g, 'test-slug')
                .replace(/{_clientPersonId}/g, 'test-person');

            const queryObj = JSON.parse(queryStr);

            expect(queryObj.$and.length).toBeGreaterThanOrEqual(3);
        });

        test('SubscriptionTopic $and filter must have at least 3 conditions for tenant isolation', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionTopic = result.find(r => r.type === 'SubscriptionTopic');

            const queryStr = subscriptionTopic.customQuery.query
                .replace(/{_sourceId}/g, 'test-patient')
                .replace(/{_sourceAssigningAuthority}/g, 'test-slug')
                .replace(/{_clientPersonId}/g, 'test-person');

            const queryObj = JSON.parse(queryStr);

            expect(queryObj.$and.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('Kafka change event producer must include tenant isolation metadata', () => {
        /**
         * The ChangeEventProducer publishes resource change events to a single
         * shared Kafka topic. Without tenant metadata in the message, any
         * consumer of this topic (including subscription notification processors)
         * cannot distinguish which tenant owns the changed resource.
         *
         * This enables a scenario where:
         * 1. Tenant A's resource is created/updated
         * 2. Change event goes to shared Kafka topic without tenant tag
         * 3. Subscription notification processor picks up the event
         * 4. Processor matches against ALL subscriptions (not just Tenant A's)
         * 5. Tenant B's webhook receives notification about Tenant A's resource
         */

        test('ChangeEventProducer message must include sourceAssigningAuthority for tenant isolation', () => {
            const mockKafkaClient = {
                sendMessagesAsync: jestGlobal.fn().mockResolvedValue(undefined),
                sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            const mockResourceManager = {};
            const mockConfigManager = {
                kafkaEnabledResources: ['Patient'],
                postRequestBatchSize: 100
            };

            const producer = new ChangeEventProducer({
                kafkaClient: mockKafkaClient,
                resourceManager: mockResourceManager,
                fhirResourceChangeTopic: 'test-topic',
                configManager: mockConfigManager
            });

            const message = producer._createMessage({
                requestId: 'req-123',
                id: 'patient-123',
                timestamp: '2024-01-01',
                eventType: 'C',
                resourceType: 'Patient',
                eventName: 'Patient Create',
                sourceType: 'test'
            });

            // The message MUST contain tenant isolation information
            // (sourceAssigningAuthority / owner / security tag) so that downstream
            // subscription processors can filter by tenant
            const messageStr = JSON.stringify(message);
            const hasTenantInfo =
                messageStr.includes('sourceAssigningAuthority') ||
                messageStr.includes('_access') ||
                messageStr.includes('owner') ||
                messageStr.includes('security');

            expect(hasTenantInfo).toBe(true);
        });

        test('ChangeEventProducer flushAsync must include tenant context in Kafka message headers', async () => {
            const sentMessages = [];
            const mockKafkaClient = {
                sendMessagesAsync: jestGlobal.fn().mockImplementation((topic, messages) => {
                    sentMessages.push(...messages);
                    return Promise.resolve();
                }),
                sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            const mockResourceManager = {};
            const mockConfigManager = {
                kafkaEnabledResources: ['Patient'],
                postRequestBatchSize: 100
            };

            const producer = new ChangeEventProducer({
                kafkaClient: mockKafkaClient,
                resourceManager: mockResourceManager,
                fhirResourceChangeTopic: 'test-topic',
                configManager: mockConfigManager
            });

            // Simulate a resource change
            await producer.afterSaveAsync({
                requestId: 'req-123',
                eventType: 'C',
                resourceType: 'Patient',
                doc: {
                    id: 'patient-123',
                    _sourceAssigningAuthority: 'tenant-a-slug',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/access', code: 'tenant-a' },
                            { system: 'https://www.icanbwell.com/owner', code: 'tenant-a-slug' }
                        ]
                    }
                }
            });

            // Force flush
            process.env.ENABLE_EVENTS_KAFKA = '1';
            await producer.flushAsync();
            delete process.env.ENABLE_EVENTS_KAFKA;

            expect(sentMessages.length).toBeGreaterThan(0);

            // Each Kafka message value MUST carry tenant info so downstream
            // subscription processors can enforce tenant isolation
            const messageValue = JSON.parse(sentMessages[0].value);
            const messageStr = JSON.stringify(messageValue);
            const hasTenantContext =
                messageStr.includes('tenant-a-slug') ||
                messageStr.includes('tenant-a') ||
                messageStr.includes('owner') ||
                messageStr.includes('_access');

            expect(hasTenantContext).toBe(true);
        });
    });

    describe('PatientPersonDataChangeEventProducer must include tenant context in events', () => {
        /**
         * The PatientPersonDataChangeEventProducer fires CloudEvents when patient
         * or person data changes. If these events do not carry tenant context,
         * a downstream subscription notification service cannot determine which
         * tenant's subscriptions should be triggered, potentially delivering
         * notifications with PHI to unauthorized webhook endpoints.
         */

        test('CloudEvent data payload must include tenant identifier (sourceAssigningAuthority or owner)', () => {
            const mockKafkaClient = {
                sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            const mockConfigManager = {
                kafkaEnableEvents: true,
                enablePatientDataChangeEvents: true,
                enablePersonDataChangeEvents: true,
                patientDataChangeEventTopic: 'patient-topic',
                personDataChangeEventTopic: 'person-topic',
                postRequestBatchSize: 100
            };
            const mockPatientFilterManager = {
                getPatientPropertyForResource: jestGlobal.fn().mockReturnValue(null)
            };
            const mockDatabaseQueryFactory = {
                createQuery: jestGlobal.fn()
            };

            const producer = new PatientPersonDataChangeEventProducer({
                kafkaClient: mockKafkaClient,
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager,
                databaseQueryFactory: mockDatabaseQueryFactory
            });

            const cloudEventMessage = producer._createCloudEvent({
                resourceId: 'patient-123',
                resourceType: 'Patient',
                changedResourceTypes: ['Observation', 'Condition']
            });

            // The event data MUST include tenant context so that subscription
            // notification processors downstream can enforce tenant boundaries
            const eventData = JSON.parse(cloudEventMessage.value);
            const hasTenantContext =
                eventData.sourceAssigningAuthority !== undefined ||
                eventData.owner !== undefined ||
                eventData.tenantId !== undefined ||
                eventData.accessTags !== undefined;

            expect(hasTenantContext).toBe(true);
        });
    });

    describe('Subscription notification payload must not include full resource without tenant verification', () => {
        /**
         * When a FHIR Subscription with channel.type = 'rest-hook' and
         * channel.payload = 'application/fhir+json' is triggered, the full
         * resource is sent to the webhook endpoint. If the subscription was
         * matched without tenant verification, PHI from one tenant's resources
         * is sent to another tenant's webhook.
         *
         * These tests verify that the query structure used to match subscriptions
         * to changed resources includes tenant-scoping.
         */

        test('Subscription query structure must prevent cross-tenant notification delivery', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            // Parse the query and verify it contains an $elemMatch for client_person_id
            const queryStr = subscription.customQuery.query;

            // The query should have an $elemMatch condition that checks client_person_id
            // This is what prevents Tenant B's subscription from being matched when
            // Tenant A's resource changes
            const hasPersonIdElemMatch = queryStr.includes('client_person_id');
            expect(hasPersonIdElemMatch).toBe(true);
        });

        test('Subscription query for SubscriptionStatus must prevent notification event focus leakage', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            // SubscriptionStatus.notificationEvent[].focus contains references to
            // resources that triggered the notification. Without tenant isolation,
            // one tenant can discover what resources exist for another tenant's patients.
            const queryStr = subscriptionStatus.customQuery.query;
            expect(queryStr).toContain('client_person_id');
        });
    });

    describe('Shared Kafka topic without per-tenant partitioning enables notification cross-contamination', () => {
        /**
         * The ChangeEventProducer publishes all resource changes to a single
         * topic (fhirResourceChangeTopic) regardless of tenant. If a downstream
         * subscription notification processor consumes from this topic and
         * matches subscriptions without checking the message's tenant context
         * against the subscription's tenant, PHI leaks via webhook notifications.
         *
         * Correct behavior: Either use per-tenant topics, or include tenant
         * metadata in messages AND verify at subscription match time.
         */

        test('Kafka message key must encode tenant owner for partition-based isolation', () => {
            const mockKafkaClient = {
                sendMessagesAsync: jestGlobal.fn().mockResolvedValue(undefined),
                sendCloudEventMessageAsync: jestGlobal.fn().mockResolvedValue(undefined)
            };
            const mockResourceManager = {};
            const mockConfigManager = {
                kafkaEnabledResources: ['Observation'],
                postRequestBatchSize: 100
            };

            const producer = new ChangeEventProducer({
                kafkaClient: mockKafkaClient,
                resourceManager: mockResourceManager,
                fhirResourceChangeTopic: 'test-topic',
                configManager: mockConfigManager
            });

            // Simulate a resource belonging to a specific tenant
            producer.onResourceChangeAsync({
                requestId: 'req-456',
                id: 'obs-789',
                resourceType: 'Observation',
                timestamp: '2024-01-01',
                sourceType: 'some-source',
                eventType: 'C'
            });

            const messageMap = producer.getFhirResourceMessageMap();
            const entry = messageMap.get('obs-789');

            expect(entry).toBeDefined();

            // The message MUST include the resource's owner security tag
            // (https://www.icanbwell.com/owner) or _access field to enable
            // downstream subscription notification processors to verify tenant match.
            // sourceType alone is NOT a security control - it's an arbitrary
            // metadata field that does not represent tenant ownership.
            const entryStr = JSON.stringify(entry);
            const hasOwnerSecurityTag =
                entryStr.includes('https://www.icanbwell.com/owner') ||
                entryStr.includes('https://www.icanbwell.com/access') ||
                entryStr.includes('_access') ||
                entryStr.includes('sourceAssigningAuthority');

            expect(hasOwnerSecurityTag).toBe(true);
        });

        test('PatientPersonDataChangeEventProducer must include owner tag in event for subscription tenant matching', async () => {
            const sentMessages = [];
            const mockKafkaClient = {
                sendCloudEventMessageAsync: jestGlobal.fn().mockImplementation(({ topic, messages }) => {
                    sentMessages.push(...messages);
                    return Promise.resolve();
                })
            };
            const mockConfigManager = {
                kafkaEnableEvents: true,
                enablePatientDataChangeEvents: true,
                enablePersonDataChangeEvents: false,
                patientDataChangeEventTopic: 'patient-changes',
                personDataChangeEventTopic: 'person-changes',
                postRequestBatchSize: 100
            };
            const mockPatientFilterManager = {
                getPatientPropertyForResource: jestGlobal.fn().mockReturnValue('subject.reference')
            };
            const mockDatabaseQueryFactory = {
                createQuery: jestGlobal.fn()
            };

            const producer = new PatientPersonDataChangeEventProducer({
                kafkaClient: mockKafkaClient,
                configManager: mockConfigManager,
                patientFilterManager: mockPatientFilterManager,
                databaseQueryFactory: mockDatabaseQueryFactory
            });

            // Simulate: Observation changes for a patient in tenant-a
            await producer.afterSaveAsync({
                requestId: 'req-abc',
                eventType: 'C',
                resourceType: 'Patient',
                doc: {
                    _uuid: 'patient-uuid-111',
                    id: 'patient-111',
                    meta: {
                        security: [
                            { system: 'https://www.icanbwell.com/owner', code: 'tenant-a-org' }
                        ]
                    }
                }
            });

            // Flush to send
            await producer.flushAsync();

            expect(sentMessages.length).toBeGreaterThan(0);

            // The CloudEvent message data must include tenant/owner information
            // so that downstream subscription processors can verify tenant match
            const messageData = JSON.parse(sentMessages[0].value);
            const parsedData = typeof messageData === 'string' ? JSON.parse(messageData) : messageData;

            const hasTenantOwner =
                parsedData.owner !== undefined ||
                parsedData.tenantId !== undefined ||
                parsedData.sourceAssigningAuthority !== undefined;

            expect(hasTenantOwner).toBe(true);
        });
    });

    describe('Cross-tenant subscription matching scenario: shared patient at same health system', () => {
        /**
         * REAL-WORLD ATTACK SCENARIO:
         *
         * Setup:
         * - Health System "epic-hospital" has patient "john-doe" (source_patient_id)
         * - Tenant A (person-aaa) registered a Subscription for john-doe with:
         *   channel.endpoint = "https://tenant-a.example.com/webhook"
         *   channel.header = ["Authorization: Bearer secret-token-a"]
         * - Tenant B (person-bbb) also registered a Subscription for john-doe with:
         *   channel.endpoint = "https://tenant-b.example.com/webhook"
         *
         * Attack:
         * - Tenant B calls GET /Patient/john-doe/$everything
         * - The custom query matches: source_patient_id=john-doe AND service_slug=epic-hospital
         * - This returns BOTH subscriptions (no client_person_id filter!)
         * - Tenant B now sees Tenant A's webhook URL and auth token
         *
         * PHI Exposure:
         * - Webhook URLs may encode organization structure
         * - Authorization headers contain secrets
         * - Subscription criteria reveals what conditions the other tenant monitors
         */

        test('Subscription query with only 2 conditions is insufficient for tenant isolation', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            const queryStr = subscription.customQuery.query
                .replace(/{_sourceId}/g, 'john-doe')
                .replace(/{_sourceAssigningAuthority}/g, 'epic-hospital');

            const queryObj = JSON.parse(queryStr);

            // CURRENT BUG: Only 2 conditions in the $and array
            // With only source_patient_id + service_slug, both tenants' subscriptions match
            // CORRECT: Must have 3+ conditions including client_person_id
            expect(queryObj.$and.length).not.toBe(2);
        });

        test('Subscription query must discriminate between tenants sharing same source patient', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscription = result.find(r => r.type === 'Subscription');

            // Simulate query for Tenant A (person-aaa)
            const tenantAQuery = subscription.customQuery.query
                .replace(/{_sourceId}/g, 'john-doe')
                .replace(/{_sourceAssigningAuthority}/g, 'epic-hospital')
                .replace(/{_clientPersonId}/g, 'person-aaa');

            // Simulate query for Tenant B (person-bbb)
            const tenantBQuery = subscription.customQuery.query
                .replace(/{_sourceId}/g, 'john-doe')
                .replace(/{_sourceAssigningAuthority}/g, 'epic-hospital')
                .replace(/{_clientPersonId}/g, 'person-bbb');

            // The queries MUST be different because they target different tenants
            // If _clientPersonId placeholder doesn't exist in the query template,
            // both queries will be identical (the replace is a no-op)
            expect(tenantAQuery).not.toEqual(tenantBQuery);
        });

        test('SubscriptionStatus query must discriminate between tenants for notification history isolation', () => {
            const result = mapper.relatedResources('Patient', null);
            const subscriptionStatus = result.find(r => r.type === 'SubscriptionStatus');

            const tenantAQuery = subscriptionStatus.customQuery.query
                .replace(/{_sourceId}/g, 'john-doe')
                .replace(/{_sourceAssigningAuthority}/g, 'epic-hospital')
                .replace(/{_clientPersonId}/g, 'person-aaa');

            const tenantBQuery = subscriptionStatus.customQuery.query
                .replace(/{_sourceId}/g, 'john-doe')
                .replace(/{_sourceAssigningAuthority}/g, 'epic-hospital')
                .replace(/{_clientPersonId}/g, 'person-bbb');

            expect(tenantAQuery).not.toEqual(tenantBQuery);
        });
    });
});
