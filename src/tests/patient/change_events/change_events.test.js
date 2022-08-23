// provider file
const patient1Resource = require('./fixtures/patient/patient1.json');
const observation1Resource = require('./fixtures/observation/observation1.json');

// expected
const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, expect} = require('@jest/globals');

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
            let resp = await request
                .get('/4_0_0/Patient')
                .set(getHeaders());

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Patient/1679033641/$merge?validate=true')
                .send(patient1Resource)
                .set(getHeaders());

            console.log('------- response patient1Resource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

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

            expect(resp.body.length).toBe(0);
            console.log('------- response 1 ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response 1 ------------');

            resp = await request
                .post('/4_0_0/Observation/0/$merge')
                .send(observation1Resource)
                .set(getHeaders());

            console.log('------- response observation1Resource ------------');
            console.log(JSON.stringify(resp.body, null, 2));
            console.log('------- end response  ------------');
            expect(resp.body['created']).toBe(true);

            // wait for post request processing to finish
            await postRequestProcessor.waitTillDoneAsync();
            /**
             * @type {KafkaClientMessage[]}
             */
            const messages = mockKafkaClient.getMessages();
            expect(messages.length).toBe(1);
            const messageValue = JSON.parse(messages[0].value);
            expect(messageValue.resourceType).toBe('AuditEvent');
            expect(messageValue.action).toBe('U');
            expect(messageValue.agent[0].who.reference).toBe('Patient/2354');
        });
    });
});
