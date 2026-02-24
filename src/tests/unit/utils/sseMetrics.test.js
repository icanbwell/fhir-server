/**
 * Unit tests for SSEMetrics
 */
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../common');

// Mock OpenTelemetry API
jest.mock('@opentelemetry/api', () => ({
    metrics: {
        getMeter: jest.fn().mockReturnValue({
            createCounter: jest.fn().mockReturnValue({
                add: jest.fn()
            }),
            createUpDownCounter: jest.fn().mockReturnValue({
                add: jest.fn()
            }),
            createHistogram: jest.fn().mockReturnValue({
                record: jest.fn()
            })
        })
    }
}));

const { SSEMetrics, getSSEMetrics } = require('../../../utils/sseMetrics');

describe('SSEMetrics Tests', () => {
    let sseMetrics;

    beforeEach(async () => {
        await commonBeforeEach();
        // Create a fresh instance for each test
        sseMetrics = new SSEMetrics();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('initialization', () => {
        test('should not be initialized by default', () => {
            expect(sseMetrics.isInitialized()).toBe(false);
        });

        test('should initialize successfully', () => {
            sseMetrics.initialize();
            expect(sseMetrics.isInitialized()).toBe(true);
        });

        test('should not initialize twice', () => {
            sseMetrics.initialize();
            sseMetrics.initialize(); // Should be a no-op
            expect(sseMetrics.isInitialized()).toBe(true);
        });
    });

    describe('recordConnection', () => {
        test('should not throw when not initialized', () => {
            expect(() => {
                sseMetrics.recordConnection({ subscriptionId: 'sub-1' });
            }).not.toThrow();
        });

        test('should record connection when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordConnection({ subscriptionId: 'sub-1', clientId: 'client-1' });
            }).not.toThrow();
        });
    });

    describe('recordDisconnection', () => {
        test('should not throw when not initialized', () => {
            expect(() => {
                sseMetrics.recordDisconnection({ subscriptionId: 'sub-1' });
            }).not.toThrow();
        });

        test('should record disconnection when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordDisconnection({ subscriptionId: 'sub-1' });
            }).not.toThrow();
        });
    });

    describe('recordEventDispatched', () => {
        test('should record event when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordEventDispatched({
                    subscriptionId: 'sub-1',
                    eventType: 'notification',
                    resourceType: 'Patient'
                });
            }).not.toThrow();
        });
    });

    describe('recordEventLatency', () => {
        test('should record latency when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordEventLatency(150, { subscriptionId: 'sub-1' });
            }).not.toThrow();
        });
    });

    describe('recordReplayEvents', () => {
        test('should record replay count when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordReplayEvents(100, { subscriptionId: 'sub-1' });
            }).not.toThrow();
        });
    });

    describe('recordReplayDuration', () => {
        test('should record replay duration when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordReplayDuration(250, { subscriptionId: 'sub-1' });
            }).not.toThrow();
        });
    });

    describe('recordError', () => {
        test('should record error when initialized', () => {
            sseMetrics.initialize();
            expect(() => {
                sseMetrics.recordError({
                    errorType: 'connection_timeout',
                    subscriptionId: 'sub-1'
                });
            }).not.toThrow();
        });
    });

    describe('getSSEMetrics singleton', () => {
        test('should return same instance', () => {
            const instance1 = getSSEMetrics();
            const instance2 = getSSEMetrics();
            expect(instance1).toBe(instance2);
        });
    });
});
