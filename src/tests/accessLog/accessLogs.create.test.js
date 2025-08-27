// test file
const observationResource = require('./fixtures/observation.json');
// expected
const accessLogs1 = require('./fixtures/access-logs1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer,
    getJsonHeadersWithAdminToken
} = require('../common');
const { describe, beforeEach, afterEach, test, expect, jest } = require('@jest/globals');
const { AccessLogger } = require('../../utils/accessLogger');
const { MockKafkaClient } = require('../mocks/mockKafkaClient');

describe('AccessLogs Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AccessLogs create Tests', () => {
        test('Access Log is created', async () => {
            const kafkaEnableAccessLogsEvent = process.env.ENABLE_ACCESS_LOGS_KAFKA_EVENTS;
            process.env.ENABLE_ACCESS_LOGS_KAFKA_EVENTS = 'true';

            /**
             * @type {MockKafkaClient}
             */
            let mockKafkaClient;
            const request = await createTestRequest((container) => {
                container.register('accessLogger', (c) => new AccessLogger({
                    scopesManager: c.scopesManager,
                    fhirOperationsManager: c.fhirOperationsManager,
                    configManager: c.configManager,
                    databaseBulkInserter: c.databaseBulkInserter,
                    accessLogsEventProducer: c.accessLogsEventProducer
                }));
                container.register(
                    'kafkaClient',
                    () =>
                        new MockKafkaClient({
                            configManager: container.configManager
                        })
                );
                mockKafkaClient = container.kafkaClient;
                return container;
            });

            const container = await getTestContainer();
            /**
             * @type {AccessLogger}
             */
            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );

            expect(logAccessLogAsync).toHaveBeenCalledTimes(0);

            await request
                .post('/4_0_0/Observation/$merge')
                .send(observationResource)
                .set({...getHeaders(), 'Origin-Service': 'test-server', 'x-request-id': 'test-request-id'})
                .expect(200);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(1);

            await accessLogger.flushAsync();

            const resp = await request.get('/admin/searchLogResults?id=test-request-id').set(getJsonHeadersWithAdminToken());

            accessLogs1._id = expect.any(String);
            accessLogs1.timestamp = expect.any(String);
            accessLogs1.request.start = expect.any(String);
            accessLogs1.details.host = expect.any(String);
            accessLogs1.request.end = expect.any(String);
            accessLogs1.request.systemGeneratedRequestId = expect.any(String);
            accessLogs1.request.duration = expect.any(Number);
            expect(resp.body[0]).toEqual(accessLogs1);

            expect(mockKafkaClient.messages.length).toBe(1);
            expect(JSON.parse(mockKafkaClient.messages[0].value)).toEqual({
                specversion: '1.0',
                id: expect.any(String),
                type: 'access-logs',
                datacontenttype: 'application/json',
                data: {
                    timestamp: expect.any(String),
                    outcomeDesc: 'Success',
                    agent: {
                        altId: 'imran',
                        networkAddress: '::ffff:127.0.0.1',
                        scopes: 'user/*.read user/*.write access/*.*'
                    },
                    details: {
                        version: 'undefined',
                        host: expect.any(String),
                        contentType: 'application/fhir+json',
                        accept: 'application/fhir+json',
                        originService: 'test-server',
                        operationResult:
                            '[{"created":true,"id":"1","uuid":"61abdd48-df46-5e98-ac6c-fde3cace4d07","resourceType":"Observation","updated":false,"sourceAssigningAuthority":"bwell"}]',
                        body: '{"resourceType":"Observation","id":"1","meta":{"source":"https://www.icanbwell.com","security":[{"system":"https://www.icanbwell.com/owner","code":"bwell"}]},"status":"final","text":{"status":"generated","div":"<div xmlns=\\"http://www.w3.org/1999/xhtml\\"><p>Carbon dioxide in blood</p></div>"},"code":{"coding":[{"system":"URN:OID:2.16.840.1.113883.6.96","code":"11557-6","display":"Carbon dioxide in blood"}]},"subject":{"reference":"Patient/1","display":"P. van de Heuvel"},"encounter":{"reference":"Encounter/1"},"effectiveDateTime":"2013-04-02T10:30:10+01:00","issued":"2013-04-03T15:30:10+01:00","performer":[{"reference":"Practitioner/f005","display":"A. Langeveld"}],"valueQuantity":{"value":6.2,"unit":"kPa","system":"http://unitsofmeasure.org","code":"kPa"},"interpretation":[{"coding":[{"system":"urn:oid:2.16.840.1.113883.6.96","code":"H","display":"High"}]}],"referenceRange":[{"low":{"value":4.8,"unit":"kPa","system":"http://unitsofmeasure.org","code":"kPa"},"high":{"value":6,"unit":"kPa","system":"http://unitsofmeasure.org","code":"kPa"}}]}'
                    },
                    request: {
                        id: 'test-request-id',
                        systemGeneratedRequestId: expect.any(String),
                        url: '/4_0_0/Observation/$merge',
                        start: expect.any(String),
                        end: expect.any(String),
                        resourceType: 'Observation',
                        operation: 'WRITE',
                        duration: expect.any(Number),
                        method: 'POST'
                    }
                }
            });

            process.env.ENABLE_ACCESS_LOGS_KAFKA_EVENTS = kafkaEnableAccessLogsEvent;
        });

        test('AccessLog is called every time as expected', async () => {
            const request = await createTestRequest();

            const container = await getTestContainer();

            const accessLogger = container.accessLogger;

            const logAccessLogAsync = jest.spyOn(
                accessLogger,
                'logAccessLogAsync'
            );
            delete observationResource.status;
            expect(logAccessLogAsync).toHaveBeenCalledTimes(1);
            await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set(getHeaders())
                .expect(400);

            observationResource.status = 'final';
            await request
                .post('/4_0_0/Observation/')
                .send(observationResource)
                .set(getHeaders())
                .expect(201);

            expect(logAccessLogAsync).toHaveBeenCalledTimes(4);
        });
    });
});
