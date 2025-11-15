// test file
const topLevelPersonResource = require('./fixtures/Person/topLevelPerson.json');
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const patient1Resource = require('./fixtures/Patient/patient1.json');

const accountResource = require('./fixtures/Account/account.json');
const proxyPatientAccountResource = require('./fixtures/Account/proxy_patient_account.json');

const observation1Resource = require('./fixtures/Observation/observation1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getHeadersJsonPatch
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { MockKafkaClient } = require('../../mocks/mockKafkaClient');

describe('Patient Person Change Event Producer Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('Patient Person Change Event Producer works', async () => {
        const enablePatientDataChangeEvents = process.env.ENABLE_PATIENT_DATA_CHANGE_EVENTS;
        const enablePersonDataChangeEvents = process.env.ENABLE_PERSON_DATA_CHANGE_EVENTS;
        const enableEventsKakfa = process.env.ENABLE_EVENTS_KAFKA;

        process.env.ENABLE_EVENTS_KAFKA = 'true';
        process.env.ENABLE_PATIENT_DATA_CHANGE_EVENTS = 'true';
        process.env.ENABLE_PERSON_DATA_CHANGE_EVENTS = 'true';

        const request = await createTestRequest((c) => {
            c.register(
                'kafkaClient',
                () =>
                    new MockKafkaClient({
                        configManager: c.configManager
                    })
            );
            return c;
        });

        const testContainer = await getTestContainer();
        const postRequestProcessor = testContainer.postRequestProcessor;
        const postSaveProcessor = testContainer.postSaveProcessor;
        /**
         * @type {MockKafkaClient}
         */
        const mockKafkaClient = testContainer.kafkaClient;

        // Test Change Event on Resources Merge
        let resp = await request
            .post('/4_0_0/Person/1/$merge?validate=true')
            .send([topLevelPersonResource, person1Resource, person2Resource, patient1Resource, accountResource])
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse([
            { created: true },
            { created: true },
            { created: true },
            { created: true },
            { created: true }
        ]);

        await postRequestProcessor.waitTillAllRequestsDoneAsync({});
        await postSaveProcessor.flushAsync();

        // ACT
        expect(mockKafkaClient.cloudEventMessages.length).toBe(4);

        let receivedEventMessages = mockKafkaClient.cloudEventMessages.map((m) => {
            const data = JSON.parse(m.value);
            data.changedResourceTypes.sort();
            return data;
        });

        let expectedEventMessages = [
            {
                changedResourceTypes: ['Account', 'Patient'],
                id: '24a5930e-11b4-5525-b482-669174917044',
                resourceType: 'Patient'
            },
            {
                changedResourceTypes: ['Account', 'Patient', 'Person'],
                id: '7b99904f-2f85-51a3-9398-e2eed6854639',
                resourceType: 'Person'
            },
            {
                changedResourceTypes: ['Person'],
                id: '9168d18f-8ad4-5f07-8ace-dd2979455b4e',
                resourceType: 'Person'
            },
            {
                changedResourceTypes: ['Person'],
                id: '0eb80391-0f61-5ce6-b221-a5428f2f38a7',
                resourceType: 'Person'
            }
        ];
        expect(receivedEventMessages).toEqual(expectedEventMessages);

        let receivedHeaders = mockKafkaClient.cloudEventMessages.map((m) => {
            return m.headers;
        });

        receivedHeaders.forEach((headers) => {
            expect(headers).toHaveProperty('ce_specversion', '1.0');
            expect(headers).toHaveProperty('ce_source', 'https://www.icanbwell.com/fhir-server');
            expect(headers).toHaveProperty('ce_datacontenttype', 'application/json;charset=utf-8');
            expect(headers.ce_type).toMatch(/^(Patient|Person)DataChangeEvent$/);
            expect(headers.ce_id).toBeDefined();
            expect(headers.ce_time).toBeDefined();
        });

        // Test Change Event for Proxy Patient Account Merge
        mockKafkaClient.cloudEventMessages = [];
        resp = await request
            .post('/4_0_0/Patient/1/$merge?validate=true')
            .send(proxyPatientAccountResource)
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        await postRequestProcessor.waitTillAllRequestsDoneAsync({});
        await postSaveProcessor.flushAsync();

        // ACT
        expect(mockKafkaClient.cloudEventMessages.length).toBe(1);

        receivedEventMessages = mockKafkaClient.cloudEventMessages.map((m) => {
            const data = JSON.parse(m.value);
            data.changedResourceTypes.sort();
            return data;
        });

        expectedEventMessages = [
            {
                changedResourceTypes: ['Account'],
                id: '0eb80391-0f61-5ce6-b221-a5428f2f38a7',
                resourceType: 'Person'
            }
        ];
        expect(receivedEventMessages).toEqual(expectedEventMessages);

        receivedHeaders = mockKafkaClient.cloudEventMessages.map((m) => {
            return m.headers;
        });

        receivedHeaders.forEach((headers) => {
            expect(headers).toHaveProperty('ce_specversion', '1.0');
            expect(headers).toHaveProperty('ce_source', 'https://www.icanbwell.com/fhir-server');
            expect(headers).toHaveProperty('ce_datacontenttype', 'application/json;charset=utf-8');
            expect(headers).toHaveProperty('ce_type', 'PersonDataChangeEvent');
            expect(headers.ce_id).toBeDefined();
            expect(headers.ce_time).toBeDefined();
        });

        // Test Change Event on Patch Account
        mockKafkaClient.cloudEventMessages = [];
        await request
            .patch('/4_0_0/Account/ce2b3f55-8a3b-5f06-a449-708dd992119e')
            .send([
                {
                    op: 'replace',
                    path: '/description',
                    value: 'New Description'
                }
            ])
            .set(getHeadersJsonPatch())
            .expect(200);

        await postRequestProcessor.waitTillAllRequestsDoneAsync({});
        await postSaveProcessor.flushAsync();

        // ACT
        expect(mockKafkaClient.cloudEventMessages.length).toBe(2);

        receivedEventMessages = mockKafkaClient.cloudEventMessages.map((m) => {
            const data = JSON.parse(m.value);
            data.changedResourceTypes.sort();
            return data;
        });

        expectedEventMessages = [
            {
                changedResourceTypes: ['Account'],
                id: '24a5930e-11b4-5525-b482-669174917044',
                resourceType: 'Patient'
            },
            {
                changedResourceTypes: ['Account'],
                id: '7b99904f-2f85-51a3-9398-e2eed6854639',
                resourceType: 'Person'
            }
        ];
        expect(receivedEventMessages).toEqual(expectedEventMessages);

        receivedHeaders = mockKafkaClient.cloudEventMessages.map((m) => {
            return m.headers;
        });

        receivedHeaders.forEach((headers) => {
            expect(headers).toHaveProperty('ce_specversion', '1.0');
            expect(headers).toHaveProperty('ce_source', 'https://www.icanbwell.com/fhir-server');
            expect(headers).toHaveProperty('ce_datacontenttype', 'application/json;charset=utf-8');
            expect(headers.ce_type).toMatch(/^(Patient|Person)DataChangeEvent$/);
            expect(headers.ce_id).toBeDefined();
            expect(headers.ce_time).toBeDefined();
        });

        resp = await request.post('/4_0_0/Patient/1/$merge?validate=true').send(observation1Resource).set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveMergeResponse({ created: true });

        // Test Change Event on Delete Patient $everything
        mockKafkaClient.cloudEventMessages = [];
        await request
            .delete('/4_0_0/Patient/24a5930e-11b4-5525-b482-669174917044/$everything')
            .set(getHeaders())
            .expect(200);

        await postRequestProcessor.waitTillAllRequestsDoneAsync({});
        await postSaveProcessor.flushAsync();

        // ACT
        expect(mockKafkaClient.cloudEventMessages.length).toBe(2);

        receivedEventMessages = mockKafkaClient.cloudEventMessages.map((m) => {
            const data = JSON.parse(m.value);
            data.changedResourceTypes.sort();
            return data;
        });

        expectedEventMessages = [
            {
                changedResourceTypes: ['Account', 'Observation', 'Patient'],
                id: '24a5930e-11b4-5525-b482-669174917044',
                resourceType: 'Patient'
            },
            {
                changedResourceTypes: ['Person'],
                id: '7b99904f-2f85-51a3-9398-e2eed6854639',
                resourceType: 'Person'
            }
        ];
        expect(receivedEventMessages).toEqual(expectedEventMessages);

        receivedHeaders = mockKafkaClient.cloudEventMessages.map((m) => {
            return m.headers;
        });

        receivedHeaders.forEach((headers) => {
            expect(headers).toHaveProperty('ce_specversion', '1.0');
            expect(headers).toHaveProperty('ce_source', 'https://www.icanbwell.com/fhir-server');
            expect(headers).toHaveProperty('ce_datacontenttype', 'application/json;charset=utf-8');
            expect(headers.ce_type).toMatch(/^(Patient|Person)DataChangeEvent$/);
            expect(headers.ce_id).toBeDefined();
            expect(headers.ce_time).toBeDefined();
        });

        // Test Change Event on Delete Account
        mockKafkaClient.cloudEventMessages = [];
        await request.delete('/4_0_0/Account/8f05fdf5-10f7-5149-9168-f77c0fbaeef2').set(getHeaders()).expect(204);

        await postRequestProcessor.waitTillAllRequestsDoneAsync({});
        await postSaveProcessor.flushAsync();

        // ACT
        expect(mockKafkaClient.cloudEventMessages.length).toBe(1);

        receivedEventMessages = mockKafkaClient.cloudEventMessages.map((m) => {
            const data = JSON.parse(m.value);
            data.changedResourceTypes.sort();
            return data;
        });

        expectedEventMessages = [
            {
                changedResourceTypes: ['Account'],
                id: '0eb80391-0f61-5ce6-b221-a5428f2f38a7',
                resourceType: 'Person'
            }
        ];
        expect(receivedEventMessages).toEqual(expectedEventMessages);

        receivedHeaders = mockKafkaClient.cloudEventMessages.map((m) => {
            return m.headers;
        });

        receivedHeaders.forEach((headers) => {
            expect(headers).toHaveProperty('ce_specversion', '1.0');
            expect(headers).toHaveProperty('ce_source', 'https://www.icanbwell.com/fhir-server');
            expect(headers).toHaveProperty('ce_datacontenttype', 'application/json;charset=utf-8');
            expect(headers.ce_type).toMatch(/^(Patient|Person)DataChangeEvent$/);
            expect(headers.ce_id).toBeDefined();
            expect(headers.ce_time).toBeDefined();
        });

        process.env.ENABLE_PATIENT_DATA_CHANGE_EVENTS = enablePatientDataChangeEvents;
        process.env.ENABLE_PERSON_DATA_CHANGE_EVENTS = enablePersonDataChangeEvents;
        process.env.ENABLE_EVENTS_KAFKA = enableEventsKakfa;
    });
});
