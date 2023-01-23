/**
 * simple test for the app
 */
const { createTestRequest } = require('./tests/common');

const { describe, expect, test } = require('@jest/globals');
const env = require('var');

// Mocking kafkajs library
jest.mock('kafkajs', () => {
    //Mock the connect, disconnect method of the producer
    return {
        __esmodule: true,
        Kafka: jest.fn().mockImplementation(() => {
            return {
                producer: jest.fn().mockImplementationOnce(() => {
                    return {
                        connect: jest.fn().mockImplementationOnce(() => { return Promise.resolve('connected');}),
                        disconnect: jest.fn().mockImplementationOnce(() => { return Promise.resolve('disconnected');})
                    };
                })
            };
        })
    };
});

describe('#app', () => {
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
        env.ENABLE_EVENTS_KAFKA = enableKafkaEvents;
    });
});
