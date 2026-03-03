const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../common');
const { SubscriptionTopicManager, SUBSCRIPTION_TOPIC_FIXTURES } = require('../../../services/subscriptionTopicManager');
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

describe('SubscriptionTopicManager Tests', () => {
    let topicManager;

    beforeEach(async () => {
        await commonBeforeEach();
        topicManager = new SubscriptionTopicManager({
            databaseQueryFactory: new MockDatabaseQueryFactory(),
            configManager: new ConfigManager()
        });
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('SUBSCRIPTION_TOPIC_FIXTURES', () => {
        test('should have 4 fixture topics', () => {
            expect(SUBSCRIPTION_TOPIC_FIXTURES.length).toBe(4);
        });

        test('should have patient-changes topic', () => {
            const patientTopic = SUBSCRIPTION_TOPIC_FIXTURES.find(t => t.id === 'patient-changes');
            expect(patientTopic).toBeDefined();
            expect(patientTopic.url).toBe('https://bwell.zone/fhir/SubscriptionTopic/patient-changes');
            expect(patientTopic.resourceTrigger[0].resource).toBe('Patient');
        });

        test('should have observation-results topic', () => {
            const observationTopic = SUBSCRIPTION_TOPIC_FIXTURES.find(t => t.id === 'observation-results');
            expect(observationTopic).toBeDefined();
            expect(observationTopic.url).toBe('https://bwell.zone/fhir/SubscriptionTopic/observation-results');
            expect(observationTopic.resourceTrigger[0].resource).toBe('Observation');
        });

        test('should have encounter-events topic', () => {
            const encounterTopic = SUBSCRIPTION_TOPIC_FIXTURES.find(t => t.id === 'encounter-events');
            expect(encounterTopic).toBeDefined();
            expect(encounterTopic.resourceTrigger[0].resource).toBe('Encounter');
        });

        test('should have all-resources topic', () => {
            const allTopic = SUBSCRIPTION_TOPIC_FIXTURES.find(t => t.id === 'all-resources');
            expect(allTopic).toBeDefined();
            expect(allTopic.resourceTrigger[0].resource).toBe('Resource');
        });

        test('all topics should have correct resourceType', () => {
            SUBSCRIPTION_TOPIC_FIXTURES.forEach(topic => {
                expect(topic.resourceType).toBe('SubscriptionTopic');
            });
        });

        test('all topics should have active status', () => {
            SUBSCRIPTION_TOPIC_FIXTURES.forEach(topic => {
                expect(topic.status).toBe('active');
            });
        });
    });

    describe('getAllTopics', () => {
        test('should return all fixture topics', () => {
            const topics = topicManager.getAllTopics();
            expect(topics.length).toBe(4);
        });
    });

    describe('getTopicById', () => {
        test('should return topic by id', () => {
            const topic = topicManager.getTopicById('patient-changes');
            expect(topic).toBeDefined();
            expect(topic.id).toBe('patient-changes');
        });

        test('should return undefined for unknown id', () => {
            const topic = topicManager.getTopicById('unknown-topic');
            expect(topic).toBeNull();
        });
    });

    describe('getTopicByUrl', () => {
        test('should return topic by URL', () => {
            const topic = topicManager.getTopicByUrl('https://bwell.zone/fhir/SubscriptionTopic/patient-changes');
            expect(topic).toBeDefined();
            expect(topic.id).toBe('patient-changes');
        });

        test('should return undefined for unknown URL', () => {
            const topic = topicManager.getTopicByUrl('https://unknown.com/topic');
            expect(topic).toBeNull();
        });
    });

    describe('searchTopics', () => {
        test('should return all topics without params', () => {
            const topics = topicManager.searchTopics({});
            expect(topics.length).toBe(4);
        });

        test('should filter by URL', () => {
            const topics = topicManager.searchTopics({
                url: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes'
            });
            expect(topics.length).toBe(1);
            expect(topics[0].id).toBe('patient-changes');
        });

        test('should filter by resource type', () => {
            // Note: searchTopics uses 'resource' param, not 'resource-type'
            const topics = topicManager.searchTopics({
                resource: 'Patient'
            });
            // patient-changes and all-resources (which matches any resource)
            expect(topics.length).toBe(2);
        });

        test('should filter by status', () => {
            const topics = topicManager.searchTopics({
                status: 'active'
            });
            expect(topics.length).toBe(4);
        });

        test('should filter by status inactive (no results)', () => {
            const topics = topicManager.searchTopics({
                status: 'draft'
            });
            expect(topics.length).toBe(0);
        });
    });

    describe('validateSubscriptionTopic', () => {
        test('should validate a known topic URL', () => {
            // validateSubscriptionTopic expects a subscription object with topic/criteria property
            const result = topicManager.validateSubscriptionTopic({
                topic: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes'
            });
            expect(result.valid).toBe(true);
            expect(result.topic).toBeDefined();
        });

        test('should reject unknown topic URL', () => {
            // validateSubscriptionTopic expects a subscription object with topic/criteria property
            const result = topicManager.validateSubscriptionTopic({
                topic: 'https://unknown.com/topic'
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unknown SubscriptionTopic');
        });

        test('should reject empty topic URL', () => {
            // validateSubscriptionTopic expects a subscription object
            const result = topicManager.validateSubscriptionTopic({});
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Subscription must specify a topic URL or criteria');
        });
    });

    describe('createSearchBundle', () => {
        test('should create a valid searchset bundle', () => {
            const topics = topicManager.getAllTopics();
            const bundle = topicManager.createSearchBundle(topics, 'http://test.com/SubscriptionTopic');

            expect(bundle.resourceType).toBe('Bundle');
            expect(bundle.type).toBe('searchset');
            expect(bundle.total).toBe(4);
            expect(bundle.entry.length).toBe(4);
        });

        test('should have proper entry structure', () => {
            const topics = [topicManager.getTopicById('patient-changes')];
            const bundle = topicManager.createSearchBundle(topics, 'http://test.com/SubscriptionTopic');

            expect(bundle.entry[0].fullUrl).toContain('patient-changes');
            expect(bundle.entry[0].resource.resourceType).toBe('SubscriptionTopic');
            expect(bundle.entry[0].search.mode).toBe('match');
        });

        test('should handle empty array', () => {
            const bundle = topicManager.createSearchBundle([], 'http://test.com/SubscriptionTopic');

            expect(bundle.total).toBe(0);
            expect(bundle.entry.length).toBe(0);
        });
    });
});
