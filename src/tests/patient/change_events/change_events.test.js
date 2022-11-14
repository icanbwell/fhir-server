// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const person1Resource = require('./fixtures/person/person1.json');
const observation1Resource = require('./fixtures/observation/observation1.json');

// expected
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
} = require('../../common');
const {describe, beforeEach, afterEach, expect, test } = require('@jest/globals');

describe('Patient Change Event Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Patient Change Event Tests', () => {
        test('creating a new patient works', async () => {
            const request = await createTestRequest();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            /**
             * @type {MockKafkaClient}
             */
            const mockKafkaClient = getTestContainer().kafkaClient;
            mockKafkaClient.clear();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync();
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(1);
            const messageValue = JSON.parse(messages[0].value);
            expect(messageValue.resourceType).toBe('AuditEvent');
            expect(messageValue.action).toBe('C');
            expect(messageValue.agent[0].who.reference).toBe('Patient/00100000000');
        });
        test('linking a new patient works', async () => {
            const request = await createTestRequest();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            /**
             * @type {MockKafkaClient}
             */
            const mockKafkaClient = getTestContainer().kafkaClient;
            mockKafkaClient.clear();
            let resp = await request.get('/4_0_0/Patient').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            mockKafkaClient.clear();

            resp = await request
                .put('/4_0_0/Person/0000000001000/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync();
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(2);
            const messageValue1 = JSON.parse(messages[0].value);
            expect(messageValue1.resourceType).toBe('AuditEvent');
            expect(messageValue1.action).toBe('C');
            expect(messageValue1.agent[0].who.reference).toBe('Patient/00100000000');
            const messageValue2 = JSON.parse(messages[0].value);
            expect(messageValue2.resourceType).toBe('AuditEvent');
            expect(messageValue2.action).toBe('U');
            expect(messageValue2.agent[0].who.reference).toBe('Patient/person.???');
        });
    });
    describe('Observation Change Event Tests', () => {
        test('creating a new observation works', async () => {
            const request = await createTestRequest();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            /**
             * @type {MockKafkaClient}
             */
            const mockKafkaClient = getTestContainer().kafkaClient;
            mockKafkaClient.clear();
            let resp = await request
                .get('/4_0_0/Observation')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Observation/0/$merge')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync();
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(3);
            const messageValue = JSON.parse(messages[0].value);
            expect(messageValue.resourceType).toBe('AuditEvent');
            expect(messageValue.action).toBe('U');
            expect(messageValue.agent[0].who.reference).toBe('Patient/2354');
            const messageValue2 = JSON.parse(messages[1].value);
            expect(messageValue2.resourceType).toBe('AuditEvent');
            expect(messageValue2.action).toBe('C');
            expect(messageValue2.agent[0].who.reference).toBe('Patient/person.???');
            const messageValue3 = JSON.parse(messages[2].value);
            expect(messageValue3.resourceType).toBe('AuditEvent');
            expect(messageValue3.action).toBe('C');
            expect(messageValue3.agent[0].who.reference).toBe('Observation/2354-InAgeCohort');
        });
    });
});
