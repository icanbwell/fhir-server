/**
 * Unit tests for SubscriptionExpirationProcessor
 */
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../common');

// Mock cron
jest.mock('cron', () => ({
    CronJob: {
        from: jest.fn().mockReturnValue({
            running: true,
            stop: jest.fn()
        })
    },
    validateCronExpression: jest.fn().mockReturnValue({ valid: true })
}));

// Mock SSE Connection Manager
jest.mock('../../../services/sseConnectionManager', () => ({
    getSSEConnectionManager: jest.fn().mockReturnValue({
        hasActiveConnections: jest.fn().mockReturnValue(true),
        closeAllForSubscription: jest.fn()
    })
}));

const { SubscriptionExpirationProcessor } = require('../../../utils/subscriptionExpirationProcessor');

describe('SubscriptionExpirationProcessor Tests', () => {
    let processor;
    let mockDatabaseQueryFactory;
    let mockConfigManager;
    let mockQueryManager;

    beforeEach(async () => {
        await commonBeforeEach();

        mockQueryManager = {
            findAsync: jest.fn().mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([])
            }),
            updateOneAsync: jest.fn().mockResolvedValue({ modifiedCount: 1 })
        };

        mockDatabaseQueryFactory = {
            createQuery: jest.fn().mockReturnValue(mockQueryManager)
        };

        mockConfigManager = {
            enableSSESubscriptions: true,
            subscriptionExpirationCronTime: '* * * * *'
        };

        processor = new SubscriptionExpirationProcessor({
            databaseQueryFactory: mockDatabaseQueryFactory,
            configManager: mockConfigManager
        });
    });

    afterEach(async () => {
        await commonAfterEach();
        if (processor.isRunning()) {
            processor.stop();
        }
    });

    describe('initiateTasks', () => {
        test('should skip initialization when SSE disabled', async () => {
            mockConfigManager.enableSSESubscriptions = false;

            await processor.initiateTasks();

            expect(processor.isRunning()).toBe(false);
        });

        test('should start cron job when SSE enabled', async () => {
            await processor.initiateTasks();

            // After initialization, isRunning should check the cron job
            expect(processor._cronJob).not.toBeNull();
        });
    });

    describe('processExpiredSubscriptionsAsync', () => {
        test('should return early when no expired subscriptions', async () => {
            mockQueryManager.findAsync.mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([])
            });

            const result = await processor.processExpiredSubscriptionsAsync();

            expect(result.processed).toBe(0);
            expect(result.errors).toBe(0);
        });

        test('should process expired subscriptions', async () => {
            const expiredSubscription = {
                id: 'sub-expired',
                _id: 'sub-expired',
                status: 'active',
                end: '2020-01-01T00:00:00Z',
                meta: {}
            };

            mockQueryManager.findAsync.mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([expiredSubscription])
            });

            const result = await processor.processExpiredSubscriptionsAsync();

            expect(result.processed).toBe(1);
            expect(result.errors).toBe(0);
            expect(mockQueryManager.updateOneAsync).toHaveBeenCalled();
        });

        test('should handle errors gracefully', async () => {
            const expiredSubscription = {
                id: 'sub-expired',
                _id: 'sub-expired',
                status: 'active',
                end: '2020-01-01T00:00:00Z',
                meta: {}
            };

            mockQueryManager.findAsync.mockResolvedValue({
                toArrayAsync: jest.fn().mockResolvedValue([expiredSubscription])
            });

            mockQueryManager.updateOneAsync.mockRejectedValue(new Error('DB error'));

            const result = await processor.processExpiredSubscriptionsAsync();

            expect(result.processed).toBe(0);
            expect(result.errors).toBe(1);
        });
    });

    describe('stop', () => {
        test('should stop cron job', async () => {
            await processor.initiateTasks();

            processor.stop();

            expect(processor._cronJob).toBeNull();
        });
    });
});
