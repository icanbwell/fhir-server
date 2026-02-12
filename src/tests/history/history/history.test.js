// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservationResourceCount1 = require('./fixtures/expected/expected_observation_count1.json');
const expectedObservationResourceWithNextUrl = require('./fixtures/expected/expected_observation_next.json');
const expectedObservationResourceSameLastUpdated = require('./fixtures/expected/expected_observation_same_lastUpdated.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation history Tests', () => {
        test('History works even when used without id', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Observation_4_0_0_History';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const observationHistoryCollection = fhirDb.collection(collectionName);
            observation1Resource.resource.meta.lastUpdated = new Date(observation1Resource.resource.meta.lastUpdated);
            observation2Resource.resource.meta.lastUpdated = new Date(observation2Resource.resource.meta.lastUpdated);
            await observationHistoryCollection.insertOne(observation1Resource);
            await observationHistoryCollection.insertOne(observation2Resource.resource);

            // Both observation's history is returned even second one has hidden tag
            const resp = await request
                .get('/4_0_0/Observation/_history?_debug=1')
                .set(getHeaders());

            expect(resp.body.link).toEqual([
                {
                    relation: 'self',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1'
                },
                {
                    relation: 'next',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_lastUpdated=lt2023-03-16T01%3A12%3A00.000Z'
                }
            ]);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });

        test('History works even when used without id with count and next url', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Observation_4_0_0_History';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const observationHistoryCollection = fhirDb.collection(collectionName);
            observation1Resource.resource.meta.lastUpdated = new Date(observation1Resource.resource.meta.lastUpdated);
            observation2Resource.resource.meta.lastUpdated = new Date(observation2Resource.resource.meta.lastUpdated);
            await observationHistoryCollection.insertOne(observation1Resource);
            await observationHistoryCollection.insertOne(observation2Resource);

            let resp = await request
                .get('/4_0_0/Observation/_history?_debug=1&_count=1')
                .set(getHeaders());

            expect(resp.body.link).toEqual([
                {
                    relation: 'self',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_count=1'
                },
                {
                    relation: 'next',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_count=1&_lastUpdated=lt2023-03-16T01%3A12%3A00.000Z'
                }
            ]);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResourceCount1);

            resp = await request
                .get('/4_0_0/Observation/_history?_debug=1&_count=1&_lastUpdated=lt2023-03-16T01%3A12%3A00.000Z')
                .set(getHeaders());

            expect(resp.body.link).toEqual([
                {
                    relation: 'self',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_count=1&_lastUpdated=lt2023-03-16T01%3A12%3A00.000Z'
                },
                {
                    relation: 'next',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_count=1&_lastUpdated=lt2023-02-16T01%3A12%3A00.000Z'
                }
            ]);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResourceWithNextUrl);
        });

        test('History returns all resource with same lastUpdated for pagination', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo auditEventDb connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            const collectionName = 'Observation_4_0_0_History';
            /**
             * mongo collection
             * @type {import('mongodb').Collection}
             */
            const observationHistoryCollection = fhirDb.collection(collectionName);

            // set lastUpdated to the same value for both resources
            observation1Resource.resource.meta.lastUpdated = new Date(observation1Resource.resource.meta.lastUpdated);
            observation2Resource.resource.meta.lastUpdated = new Date(observation1Resource.resource.meta.lastUpdated);
            await observationHistoryCollection.insertOne(observation1Resource);
            await observationHistoryCollection.insertOne(observation2Resource);

            let resp = await request
                .get('/4_0_0/Observation/_history?_debug=1&_count=1')
                .set(getHeaders());

            expect(resp.body.link).toEqual([
                {
                    relation: 'self',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_count=1'
                },
                {
                    relation: 'next',
                    url: 'http://localhost:3000/4_0_0/Observation/_history?_debug=1&_count=1&_lastUpdated=lt2023-02-16T01%3A12%3A00.000Z'
                }
            ]);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResourceSameLastUpdated);
        });

        test('History without id dont work for patient scope', async () => {
            const request = await createTestRequest();

            // get history with patient scope fails for clinical resource
            let resp = await request
                .get('/4_0_0/Observation/_history?_debug=1')
                .set(getHeaders('patient/*.* access/*.* user/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'forbidden',
                        details: {
                            text: "user clientFhirPerson with scopes [patient/*.* access/*.* user/*.*] failed access check to Observation's history: Access to history resources not allowed if patient scope is present"
                        },
                        diagnostics:
                            "user clientFhirPerson with scopes [patient/*.* access/*.* user/*.*] failed access check to Observation's history: Access to history resources not allowed if patient scope is present"
                    }
                ]
            });

            // get history with patient scope fails for non-clinical resource
            resp = await request
                .get('/4_0_0/Practitioner/_history?_debug=1')
                .set(getHeaders('patient/*.* access/*.* user/*.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse({
                resourceType: 'OperationOutcome',
                issue: [
                    {
                        severity: 'error',
                        code: 'forbidden',
                        details: {
                            text: "user clientFhirPerson with scopes [patient/*.* access/*.* user/*.*] failed access check to Practitioner's history: Access to history resources not allowed if patient scope is present"
                        },
                        diagnostics:
                            "user clientFhirPerson with scopes [patient/*.* access/*.* user/*.*] failed access check to Practitioner's history: Access to history resources not allowed if patient scope is present"
                    }
                ]
            });
        });
    });
});
