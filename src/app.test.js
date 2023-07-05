/**
 * simple test for the app
 */
const { createTestRequest } = require('./tests/common');

const { Kafka } = require('kafkajs');
const { describe, expect, test} = require('@jest/globals');
const env = require('var');
const statusOK = {
  'status': {
    'kafkaStatus': 'OK',
    'logStatus': 'OK',
    'mongoDBStatus': 'OK'
  }
};

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

    test('it should startup and return health check status ok', async () => {
        const request = await createTestRequest();
        const response = await request.get('/health');
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject(statusOK);
    });

    test('it should startup check kafka health and return health check status ok', async () => {
        const enableKafkaEvents = env.ENABLE_EVENTS_KAFKA;
        const enablekafkahealthcheck = env.ENABLE_KAFKA_HEALTHCHECK;
        // Setting ENABLE_EVENTS_KAFKA to '1' which implies kafka is being used.
        env.ENABLE_EVENTS_KAFKA = '1';
        env.ENABLE_KAFKA_HEALTHCHECK = '1';

        let request = await createTestRequest();
        let response = await request.get('/health');
        expect(response.status).toBe(200);
        // If Kafka is healthy status returned is ok
        expect(response.body).toMatchObject(statusOK);
        // Kafka class has been called
        expect(Kafka).toHaveBeenCalledTimes(1);
        // A connection request is being made
        expect(mockProducerMethods.connect).toHaveBeenCalledTimes(1);
        env.ENABLE_EVENTS_KAFKA = enableKafkaEvents;
        env.ENABLE_KAFKA_HEALTHCHECK = enablekafkahealthcheck;
    });
});
