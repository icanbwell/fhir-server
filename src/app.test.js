/**
 * simple test for the app
 */
const { createTestRequest } = require('./tests/common');

const { describe, beforeAll, afterAll, test, jest, expect } = require('@jest/globals');
const { KafkaClient } = require('./utils/kafkaClient');

// Mocking connect and disconnect methods of producer class
const mockProducerMethods = {
    connect: jest.fn().mockImplementation(() => {
        return Promise.resolve('connected');
    }),
    disconnect: jest.fn().mockImplementation(() => {
        return Promise.resolve('disconnected');
    })
};

// Mocking the producer method of Kafka class
const mockProducer = {
    producer: jest.fn(() => mockProducerMethods)
};

const mockKafka = jest.fn(() => mockProducer);

// Mocking kafkajs library
jest.mock('kafkajs', () => {
    // Mock the Kafka class
    return {
        __esmodule: true,
        Kafka: mockKafka
    };
});

class MockKafkaClient extends KafkaClient {
    /**
     * init
     * @typedef {Object} InitProps
     * @property {string} clientId
     * @property {string[]} brokers
     * @property {boolean} ssl
     * @property {import('kafkajs').SASLOptions} sasl
     *
     * @param {InitProps}
     */

    init ({ clientId, brokers, ssl, sasl }) {
        // do nothing
        this.client = new (require('kafkajs').Kafka)();

        this.producer = this.client.producer();
    }

    /**
     * Sends a message to Kafka
     * @param {string} topic
     * @param {KafkaClientMessage[]} messages
     * @return {Promise<void>}
     */

    async sendMessagesAsync (topic, messages) {
    }
}

describe('#app', () => {
    beforeAll(() => {
        jest.useFakeTimers();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    test('it should startup and return health check status ok', async () => {
        const request = await createTestRequest((c) => {
            c.register('kafkaClient', () => new MockKafkaClient({ configManager: c.configManager }));
            return c;
        });
        const response = await request.get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ status: 'OK' });
    });

    test('it should startup check kafka health and return health check status ok', async () => {
        const enableKafkaEvents = process.env.ENABLE_EVENTS_KAFKA;
        const enablekafkahealthcheck = process.env.ENABLE_KAFKA_HEALTHCHECK;
        // Setting ENABLE_EVENTS_KAFKA to '1' which implies kafka is being used.
        process.env.ENABLE_EVENTS_KAFKA = '1';
        process.env.ENABLE_KAFKA_HEALTHCHECK = '1';

        let request = await createTestRequest((c) => {
            c.register('kafkaClient', () => new MockKafkaClient({ configManager: c.configManager }));
            return c;
        });
        let response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject({ status: 'OK' });
        // Kafka class has been called
        expect(mockKafka).toHaveBeenCalledTimes(1);
        // A connection request is being made
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(1);

        // Kafka Health Connection should not be checked within an interval of 30 seconds
        // Clearing all the mocks
        jest.clearAllMocks();
        request = await createTestRequest();
        response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject({ status: 'OK' });
        // Since the request has been made with 30 seconds of the previous request. Kafka class won't be called
        expect(mockKafka).toHaveBeenCalledTimes(0);
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(0);

        // Kafka Health Connection should be checked but all the values should be stored in variables.
        // So kafka shouldn't be called, and restoring all the mocks
        jest.restoreAllMocks();
        jest.advanceTimersByTime(40000);
        request = await createTestRequest((c) => {
            c.register('kafkaClient', () => new MockKafkaClient({ configManager: c.configManager }));
            return c;
        });
        response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject({ status: 'OK' });
        // Since the KafkaClient is being stored in a variable. Kafka class won't be called.
        expect(mockKafka).toHaveBeenCalledTimes(0);
        // Ensuring the connect() is being called.
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(0);

        process.env.ENABLE_EVENTS_KAFKA = enableKafkaEvents;
        process.env.ENABLE_KAFKA_HEALTHCHECK = enablekafkahealthcheck;
    });
});
