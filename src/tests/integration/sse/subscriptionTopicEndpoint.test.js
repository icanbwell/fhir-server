/**
 * Integration tests for SSE Subscription endpoint handlers
 */

// Enable SSE subscriptions for these tests
process.env.ENABLE_SSE_SUBSCRIPTIONS = 'true';

const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach, createTestRequest, getTestContainer } = require('../../common');

// Mock SSE services
jest.mock('../../../services/sseConnectionManager', () => {
    return {
        getSSEConnectionManager: () => ({
            registerConnection: jest.fn().mockReturnValue({
                connectionId: 'test-connection-id',
                subscriptionId: 'sub-123',
                clientId: 'client-456'
            }),
            removeConnection: jest.fn(),
            getConnectionsForSubscription: jest.fn().mockReturnValue([]),
            hasActiveConnections: jest.fn().mockReturnValue(false),
            getStats: jest.fn().mockReturnValue({
                totalConnections: 0,
                activeSubscriptions: 0,
                subscriptionCounts: {}
            }),
            closeAllForSubscription: jest.fn()
        }),
        SSEConnectionManager: jest.fn()
    };
});

describe('SSE Subscription Endpoint Integration Tests', () => {
    let request;

    beforeEach(async () => {
        await commonBeforeEach();
        // Use createTestRequest to properly set up the container and app
        request = await createTestRequest();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GET /4_0_0/SubscriptionTopic', () => {
        test('should return list of subscription topics', async () => {
            const response = await request
                .get('/4_0_0/SubscriptionTopic')
                .set('Accept', 'application/fhir+json');

            expect(response.status).toBe(200);
            expect(response.body.resourceType).toBe('Bundle');
            expect(response.body.type).toBe('searchset');
            expect(response.body.total).toBeGreaterThan(0);
        });

        test('should filter topics by URL', async () => {
            const response = await request
                .get('/4_0_0/SubscriptionTopic')
                .query({ url: 'https://bwell.zone/fhir/SubscriptionTopic/patient-changes' })
                .set('Accept', 'application/fhir+json');

            expect(response.status).toBe(200);
            expect(response.body.total).toBe(1);
            expect(response.body.entry[0].resource.id).toBe('patient-changes');
        });
    });

    describe('GET /4_0_0/SubscriptionTopic/:id', () => {
        test('should return specific subscription topic', async () => {
            const response = await request
                .get('/4_0_0/SubscriptionTopic/patient-changes')
                .set('Accept', 'application/fhir+json');

            expect(response.status).toBe(200);
            expect(response.body.resourceType).toBe('SubscriptionTopic');
            expect(response.body.id).toBe('patient-changes');
        });

        test('should return 404 for unknown topic', async () => {
            const response = await request
                .get('/4_0_0/SubscriptionTopic/unknown-topic')
                .set('Accept', 'application/fhir+json');

            expect(response.status).toBe(404);
            expect(response.body.resourceType).toBe('OperationOutcome');
        });
    });
});
