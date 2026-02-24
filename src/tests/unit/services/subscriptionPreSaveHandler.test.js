const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../common');
const { SubscriptionPreSaveHandler } = require('../../../preSaveHandlers/handlers/subscriptionPreSaveHandler');
const { SubscriptionTopicManager } = require('../../../services/subscriptionTopicManager');
const { ConfigManager } = require('../../../utils/configManager');

/**
 * Mock Database Query Factory
 */
class MockDatabaseQueryFactory {
    createQuery() {
        return {
            findOneAsync: async () => null,
            findAsync: async () => ({
                toArrayAsync: async () => []
            })
        };
    }
}

/**
 * Mock Config Manager with SSE enabled
 */
class MockSSEConfigManager extends ConfigManager {
    get enableSSESubscriptions() {
        return true;
    }
}

/**
 * Mock Config Manager with SSE disabled
 */
class MockNoSSEConfigManager extends ConfigManager {
    get enableSSESubscriptions() {
        return false;
    }
}

describe('SubscriptionPreSaveHandler Tests', () => {
    let handler;
    let topicManager;

    beforeEach(async () => {
        await commonBeforeEach();

        topicManager = new SubscriptionTopicManager({
            databaseQueryFactory: new MockDatabaseQueryFactory(),
            configManager: new MockSSEConfigManager()
        });

        handler = new SubscriptionPreSaveHandler({
            configManager: new MockSSEConfigManager(),
            subscriptionTopicManager: topicManager
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('preSaveAsync - non-Subscription resources', () => {
        test('should pass through non-Subscription resources', async () => {
            const patient = {
                resourceType: 'Patient',
                id: 'patient-123',
                name: [{ family: 'Test' }]
            };

            const result = await handler.preSaveAsync({ resource: patient });

            expect(result.resourceType).toBe('Patient');
            expect(result.id).toBe('patient-123');
        });
    });

    describe('preSaveAsync - SSE disabled', () => {
        test('should pass through when SSE is disabled', async () => {
            const disabledHandler = new SubscriptionPreSaveHandler({
                configManager: new MockNoSSEConfigManager(),
                subscriptionTopicManager: topicManager
            });

            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes'
            };

            const result = await disabledHandler.preSaveAsync({ resource: subscription });

            expect(result.status).toBe('requested'); // Not changed to active
        });
    });

    describe('preSaveAsync - channel type validation', () => {
        test('should reject non-message channel types', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'rest-hook'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes'
            };

            await expect(handler.preSaveAsync({ resource: subscription }))
                .rejects.toThrow('SSE Subscriptions require channel.type');
        });

        test('should accept message channel type', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: new Date(Date.now() + 86400000).toISOString() // Tomorrow
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.status).toBe('active');
        });
    });

    describe('preSaveAsync - topic validation', () => {
        test('should reject unknown topic URL', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://unknown.com/topic'
            };

            await expect(handler.preSaveAsync({ resource: subscription }))
                .rejects.toThrow('SubscriptionTopic not found');
        });

        test('should accept valid topic URL', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/observation-results',
                end: new Date(Date.now() + 86400000).toISOString()
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result).toBeDefined();
            expect(result.topic).toBe('https://bwell.zone/fhir/SubscriptionTopic/observation-results');
        });
    });

    describe('preSaveAsync - end time validation', () => {
        test('should reject past end time', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: '2020-01-01T00:00:00Z' // Past date
            };

            await expect(handler.preSaveAsync({ resource: subscription }))
                .rejects.toThrow('Subscription end time must be in the future');
        });

        test('should accept future end time', async () => {
            const futureDate = new Date(Date.now() + 86400000).toISOString();
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: futureDate
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.end).toBe(futureDate);
        });
    });

    describe('preSaveAsync - auto-activation', () => {
        test('should set status to active for requested SSE subscriptions', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: new Date(Date.now() + 86400000).toISOString()
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.status).toBe('active');
        });

        test('should not change active status', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'active',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: new Date(Date.now() + 86400000).toISOString()
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.status).toBe('active');
        });

        test('should not change off status', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'off',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: new Date(Date.now() + 86400000).toISOString()
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.status).toBe('off');
        });
    });

    describe('preSaveAsync - meta tag', () => {
        test('should add SSE meta tag', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: new Date(Date.now() + 86400000).toISOString()
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.meta).toBeDefined();
            expect(result.meta.tag).toBeDefined();
            const sseTag = result.meta.tag.find(
                t => t.system === 'https://bwell.zone/fhir/CodeSystem/subscription-channel-type'
            );
            expect(sseTag).toBeDefined();
            expect(sseTag.code).toBe('sse');
        });

        test('should preserve existing meta', async () => {
            const subscription = {
                resourceType: 'Subscription',
                id: 'sub-123',
                status: 'requested',
                meta: {
                    versionId: '1',
                    lastUpdated: '2024-01-01T00:00:00Z'
                },
                channel: {
                    type: 'message'
                },
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes',
                end: new Date(Date.now() + 86400000).toISOString()
            };

            const result = await handler.preSaveAsync({ resource: subscription });

            expect(result.meta.versionId).toBe('1');
            expect(result.meta.tag).toBeDefined();
        });
    });
});
