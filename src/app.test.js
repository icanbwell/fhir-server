/**
 * simple test for the app
 */
const { createTestRequest } = require('./tests/common');

const { Kafka } = require('kafkajs');
const { describe, expect, test } = require('@jest/globals');
const env = require('var');

// Mocking connect and disconnect methods of prooducer class
const mockProducerMethods = {
    connect: jest.fn().mockImplementation(() => {
        return Promise.resolve('connected');
    }),
    disconnect: jest.fn().mockImplementation(() => {
        return Promise.resolve('disconnected');
    }),
};

// Mocking the producer method of Kafka class
const mockProducer = {
    producer: jest.fn(() => mockProducerMethods),
};

// Mocking kafkajs library
jest.mock('kafkajs', () => {
    //Mock the Kafka class
    return {
        __esmodule: true,
        Kafka: jest.fn(() => mockProducer),
    };
});

describe('#app', () => {
    beforeAll(() => {
        jest.useFakeTimers();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    test('it should startup and return health check status ok', async () => {
        const request = await createTestRequest();
        const response = await request.get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ status: 'ok' });
    });

    test('it should startup check kafka health and return health check status ok', async () => {
        const enableKafkaEvents = env.ENABLE_EVENTS_KAFKA;
        // Setting ENABLE_EVENTS_KAFKA to '1' which implies kafka is being used.
        env.ENABLE_EVENTS_KAFKA = '1';

        let request = await createTestRequest();
        let response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject({ status: 'ok' });
        // Kafka class has been called
        expect(Kafka).toHaveBeenCalledTimes(1);
        // A connection request is being made
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(1);

        // Kafka Health Connection should not be checked within an interval of 30 seconds
        // Clearing all the mocks
        jest.clearAllMocks();
        request = await createTestRequest();
        response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject({ status: 'ok' });
        // Since the request has been made with 30 seconds of the previous request. Kafka class won't be called
        expect(Kafka).toHaveBeenCalledTimes(0);
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(0);

        // Kafka Health Connection should be checked but all the values should be stored in variables.
        // So kafka shouldn't be called, and restoring all the mocks
        jest.restoreAllMocks();
        jest.advanceTimersByTime(40000);
        request = await createTestRequest();
        response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject({ status: 'ok' });
        // Since the KafkaClient is being stored in a variable. Kafka class won't be called.
        expect(Kafka).toHaveBeenCalledTimes(0);
        // Ensuring the connect() is being called.
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(1);

        env.ENABLE_EVENTS_KAFKA = enableKafkaEvents;
    });
});
