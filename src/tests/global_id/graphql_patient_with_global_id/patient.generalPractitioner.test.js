const expectedUpdateGraphQlResponse = require('./fixtures/expected_update_graphql_response.json');
const expectedPractitionerMissingUserScopesResponse = require('./fixtures/expected_practitioner_missing_user_scopes_response.json');
const expectedPractitionerMissingAccessScopesResponse = require('./fixtures/expected_practitioner_missing_access_scopes_response.json');

const patientBundleResource = require('./fixtures/patients.json');
const practitionerBundleResource = require('./fixtures/practitioners.json');

const fs = require('fs');
const path = require('path');

const updatePractitionerQuery = fs.readFileSync(
    path.resolve(__dirname, './fixtures/updatePractitioner.graphql'),
    'utf8'
);

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    getGraphQLHeaders,
    getUnAuthenticatedGraphQLHeaders,
    createTestRequest,
    getTestContainer, mockHttpContext
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const env = require('var');
const moment = require('moment-timezone');
const { AuditLogger } = require('../../../utils/auditLogger');

describe('GraphQL Patient Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('GraphQL Update General Practitioner', () => {
        test('GraphQL Update General Practitioner for Patient', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            // Using unmocked audit logger to test creation of audit logs in db
            container.register(
                'auditLogger',
                (c) =>
                    new AuditLogger({
                        postRequestProcessor: c.postRequestProcessor,
                        databaseBulkInserter: c.databaseBulkInserter,
                        configManager: c.configManager,
                        preSaveManager: c.preSaveManager
                    })
            );

            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            /**
             * @type {import('../../../utils/auditLogger').AuditLogger}
             */
            const auditLogger = container.auditLogger;
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            // noinspection JSValidateTypes
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            const base_version = '4_0_0';
            const collection_name = env.INTERNAL_AUDIT_TABLE || 'AuditEvent';
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            const year = fieldDate.getUTCFullYear();
            const month = fieldDate.getUTCMonth() + 1; // 0 indexed
            const monthFormatted = String(month).padStart(2, '0');
            /**
             * @type {string}
             */
            const mongoCollectionName = `${collection_name}_${base_version}_${year}_${monthFormatted}`;
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const internalAuditEventCollection = auditEventDb.collection(mongoCollectionName);
            // no audit logs should be created since there were no resources returned
            expect(await internalAuditEventCollection.countDocuments()).toStrictEqual(0);

            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            resp = await request.get('/4_0_0/Practitioner/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            expect(await internalAuditEventCollection.countDocuments()).toStrictEqual(4);
            // clear out audit table
            await internalAuditEventCollection.deleteMany({});

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(
                    getGraphQLHeaders(
                        'user/Patient.read user/Patient.write user/Practitioner.read access/client.*'
                    )
                )
                .expect(200);

            const body = resp.body;
            if (body.errors) {
                console.log(body.errors);
                expect(body.errors).toBeUndefined();
            }
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedUpdateGraphQlResponse);

            // check that the audit entry is made
            await postRequestProcessor.waitTillDoneAsync({ requestId });
            await auditLogger.flushAsync();
            expect(await internalAuditEventCollection.countDocuments()).toStrictEqual(4);
        });
        test('GraphQL Update General Practitioner for Patient (unauthenticated)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            resp = await request.get('/4_0_0/Practitioner/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getUnAuthenticatedGraphQLHeaders())
                .expect(401);
        });
        test('GraphQL Update General Practitioner for Patient (missing user scopes)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            resp = await request.get('/4_0_0/Practitioner/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(getGraphQLHeaders('user/Patient.read user/Practitioner.read access/client.*'))
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerMissingUserScopesResponse);
        });
        test('GraphQL Update General Practitioner for Patient (missing access scopes)', async () => {
            const request = await createTestRequest();
            const graphqlQueryText = updatePractitionerQuery.replace(/\\n/g, '');

            let resp = await request.get('/4_0_0/Patient').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request.get('/4_0_0/Practitioner').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(0);

            resp = await request
                .post('/4_0_0/Patient/1/$merge')
                .send(patientBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request
                .post('/4_0_0/Practitioner/1/$merge')
                .send(practitionerBundleResource)
                .set(getHeaders())
                .expect(200);

            resp = await request.get('/4_0_0/Patient/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            resp = await request.get('/4_0_0/Practitioner/').set(getHeaders()).expect(200);
            expect(resp.body.length).toBe(2);

            resp = await request
                .post('/$graphql')
                .send({
                    operationName: null,
                    variables: {},
                    query: graphqlQueryText
                })
                .set(
                    getGraphQLHeaders(
                        'user/Patient.read user/Patient.write user/Practitioner.read access/fake.*'
                    )
                )
                .expect(200);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPractitionerMissingAccessScopesResponse);
        });
    });
});
