// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const person1withlinkResource = require('./fixtures/person/person1_withlink.json');
const person1nolinkResource = require('./fixtures/person/person1_nolink.json');
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');

// expected
const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer, getRequestId,
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
                .post('/4_0_0/Patient/2354/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(1);
            const messageValue = JSON.parse(messages[0].value);
            expect(messageValue.resourceType).toBe('AuditEvent');
            expect(messageValue.action).toBe('C');
            expect(messageValue.agent[0].who.reference).toBe('Patient/2354');
        });
        test('creating a new person with a patient link updates proxy patient', async () => {
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
                .post('/4_0_0/Patient/2354/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Person/81236/$merge?validate=true')
                .send(person1withlinkResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(2);
            const messageValue1 = JSON.parse(messages[0].value);
            expect(messageValue1.resourceType).toBe('AuditEvent');
            expect(messageValue1.action).toBe('C');
            expect(messageValue1.agent[0].who.reference).toBe('Patient/2354');
            const messageValue2 = JSON.parse(messages[1].value);
            expect(messageValue2.resourceType).toBe('AuditEvent');
            expect(messageValue2.action).toBe('C');
            expect(messageValue2.agent[0].who.reference).toBe('Patient/person.81236');
        });
        test('adding a patient link to an existing person updates proxy patient', async () => {
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
                .post('/4_0_0/Person/81236/$merge?validate=true')
                .send(person1nolinkResource)
                .set(getHeaders());

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            mockKafkaClient.clear();

            resp = await request
                .post('/4_0_0/Patient/2354/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .put('/4_0_0/Person/81236')
                .send(person1withlinkResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(200);

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(2);
            const messageValue1 = JSON.parse(messages[0].value);
            expect(messageValue1.resourceType).toBe('AuditEvent');
            expect(messageValue1.action).toBe('C');
            expect(messageValue1.agent[0].who.reference).toBe('Patient/2354');
            const messageValue2 = JSON.parse(messages[1].value);
            expect(messageValue2.resourceType).toBe('AuditEvent');
            expect(messageValue2.action).toBe('U');
            expect(messageValue2.agent[0].who.reference).toBe('Patient/person.81236');
        });
    });
    describe('Observation Change Event Tests', () => {
        test('creating a new observation updates patient and proxy patient', async () => {
            const request = await createTestRequest();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            /**
             * @type {MockKafkaClient}
             */
            const mockKafkaClient = getTestContainer().kafkaClient;

            let resp = await request
                .post('/4_0_0/Person/81236/$merge')
                .send(person1withlinkResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            mockKafkaClient.clear();

            resp = await request
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
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
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
            expect(messageValue2.action).toBe('U');
            expect(messageValue2.agent[0].who.reference).toBe('Patient/person.81236');
            const messageValue3 = JSON.parse(messages[2].value);
            expect(messageValue3.resourceType).toBe('AuditEvent');
            expect(messageValue3.action).toBe('C');
            expect(messageValue3.agent[0].who.reference).toBe('Observation/2354-InAgeCohort');
        });
        test('creating a new observation updates patient if no associated proxy patient', async () => {
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
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(2);
            const messageValue = JSON.parse(messages[0].value);
            expect(messageValue.resourceType).toBe('AuditEvent');
            expect(messageValue.action).toBe('U');
            expect(messageValue.agent[0].who.reference).toBe('Patient/2354');
            const messageValue2 = JSON.parse(messages[1].value);
            expect(messageValue2.resourceType).toBe('AuditEvent');
            expect(messageValue2.action).toBe('C');
            expect(messageValue2.agent[0].who.reference).toBe('Observation/2354-InAgeCohort');
        });
        test('creating a new observation includes sourceType, if any', async () => {
            const request = await createTestRequest();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = getTestContainer().postRequestProcessor;
            /**
             * @type {MockKafkaClient}
             */
            const mockKafkaClient = getTestContainer().kafkaClient;

            let resp = await request
                .post('/4_0_0/Person/81236/$merge')
                .send(person1withlinkResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            mockKafkaClient.clear();

            resp = await request
                .get('/4_0_0/Observation')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            resp = await request
                .post('/4_0_0/Observation/0/$merge')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync({requestId: getRequestId(resp)});
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(3);
            for (let message of messages) {
                const messageValue = JSON.parse(message.value);
                expect(messageValue.source.type[0].code).toBe('cql-engine');
            }
        });
    });
});
