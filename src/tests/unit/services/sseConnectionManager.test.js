const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { commonBeforeEach, commonAfterEach } = require('../../common');
const { SSEConnectionManager, getSSEConnectionManager } = require('../../../services/sseConnectionManager');
const { EventEmitter } = require('events');

/**
 * Mock SSE Response Writer
 */
class MockSSEResponseWriter extends EventEmitter {
    constructor() {
        super();
        this._isOpen = true;
        this.writtenData = [];
    }

    write(data) {
        this.writtenData.push(data);
    }

    isOpen() {
        return this._isOpen;
    }

    sendError(error) {
        this.writtenData.push({ type: 'error', error });
    }

    end() {
        this._isOpen = false;
    }
}

/**
 * Mock HTTP Request
 */
class MockRequest extends EventEmitter {
    constructor() {
        super();
    }
}

describe('SSEConnectionManager Tests', () => {
    let connectionManager;

    beforeEach(async () => {
        await commonBeforeEach();
        // Get a fresh instance for each test
        connectionManager = getSSEConnectionManager();
        // Clear any existing connections
        connectionManager._connectionsBySubscription.clear();
        connectionManager._connectionsById.clear();
        connectionManager._totalConnections = 0;
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('registerConnection', () => {
        test('should register a new connection', () => {
            const writer = new MockSSEResponseWriter();
            const request = new MockRequest();

            const connection = connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-456',
                writer,
                lastEventId: null,
                request
            });

            expect(connection).toBeDefined();
            expect(connection.connectionId).toBeDefined();
            expect(connection.subscriptionId).toBe('sub-123');
            expect(connection.clientId).toBe('client-456');
            expect(connectionManager._totalConnections).toBe(1);
        });

        test('should support multiple connections for same subscription', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            const connections = connectionManager.getConnectionsForSubscription('sub-123');
            expect(connections.length).toBe(2);
            expect(connectionManager._totalConnections).toBe(2);
        });
    });

    describe('removeConnection', () => {
        test('should remove a connection by ID', () => {
            const writer = new MockSSEResponseWriter();
            const request = new MockRequest();

            const connection = connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-456',
                writer,
                request
            });

            expect(connectionManager._totalConnections).toBe(1);

            connectionManager.removeConnection(connection.connectionId);

            expect(connectionManager._totalConnections).toBe(0);
            expect(connectionManager.getConnection(connection.connectionId)).toBeUndefined();
        });
    });

    describe('getConnectionsForSubscription', () => {
        test('should return empty array for unknown subscription', () => {
            const connections = connectionManager.getConnectionsForSubscription('unknown-sub');
            expect(connections).toEqual([]);
        });

        test('should return all connections for a subscription', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            const connections = connectionManager.getConnectionsForSubscription('sub-123');
            expect(connections.length).toBe(2);
        });
    });

    describe('hasActiveConnections', () => {
        test('should return false for subscription with no connections', () => {
            expect(connectionManager.hasActiveConnections('sub-999')).toBe(false);
        });

        test('should return true for subscription with connections', () => {
            const writer = new MockSSEResponseWriter();
            const request = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-1',
                writer,
                request
            });

            expect(connectionManager.hasActiveConnections('sub-123')).toBe(true);
        });
    });

    describe('broadcastToSubscription', () => {
        test('should broadcast to all connections for a subscription', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            const notification = { id: 'event-1', data: { test: 'payload' } };
            const notifiedCount = connectionManager.broadcastToSubscription({
                subscriptionId: 'sub-123',
                notification
            });

            expect(notifiedCount).toBe(2);
            expect(writer1.writtenData.length).toBe(1);
            expect(writer2.writtenData.length).toBe(1);
        });

        test('should skip closed connections', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            writer2._isOpen = false; // Mark as closed
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            const notification = { id: 'event-1', data: { test: 'payload' } };
            const notifiedCount = connectionManager.broadcastToSubscription({
                subscriptionId: 'sub-123',
                notification
            });

            expect(notifiedCount).toBe(1);
            expect(writer1.writtenData.length).toBe(1);
        });
    });

    describe('closeAllForSubscription', () => {
        test('should close all connections for a subscription', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-123',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            connectionManager.closeAllForSubscription('sub-123', 'Test close reason');

            expect(writer1._isOpen).toBe(false);
            expect(writer2._isOpen).toBe(false);
        });
    });

    describe('getStats', () => {
        test('should return accurate statistics', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-1',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-2',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            const stats = connectionManager.getStats();

            expect(stats.totalConnections).toBe(2);
            expect(stats.activeSubscriptions).toBe(2);
            expect(stats.subscriptionCounts['sub-1']).toBe(1);
            expect(stats.subscriptionCounts['sub-2']).toBe(1);
        });
    });

    describe('getActiveSubscriptionIds', () => {
        test('should return all subscription IDs with active connections', () => {
            const writer1 = new MockSSEResponseWriter();
            const writer2 = new MockSSEResponseWriter();
            const request1 = new MockRequest();
            const request2 = new MockRequest();

            connectionManager.registerConnection({
                subscriptionId: 'sub-a',
                clientId: 'client-1',
                writer: writer1,
                request: request1
            });

            connectionManager.registerConnection({
                subscriptionId: 'sub-b',
                clientId: 'client-2',
                writer: writer2,
                request: request2
            });

            const subscriptionIds = connectionManager.getActiveSubscriptionIds();

            expect(subscriptionIds).toContain('sub-a');
            expect(subscriptionIds).toContain('sub-b');
            expect(subscriptionIds.length).toBe(2);
        });
    });
});
