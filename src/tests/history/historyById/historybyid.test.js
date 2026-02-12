// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservationResourceWithCountAndNextUrlQuery = require('./fixtures/expected/expected_observation_count_and_next.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const deepcopy = require('deepcopy');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation historyById Tests', () => {
        test('historyById works', async () => {
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
            const observation1 = deepcopy(observation1Resource)
            observation1.resource.meta.lastUpdated = new Date("2023-02-16T01:12:00.000Z");
            observation1.resource.meta.versionId = "1";
            await observationHistoryCollection.insertOne(observation1);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            const resp = await request
                .get('/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1')
                .set(getHeaders());

            expect(resp.body.link).toEqual([
                {
                    relation: 'self',
                    url: 'http://localhost:3000/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1'
                },
                {
                    relation: 'next',
                    url: 'http://localhost:3000/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1&_lastUpdated=lt2023-02-16T01%3A12%3A00.000Z'
                }
            ]);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });

        test('historyById works with count and next url', async () => {
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
            const observation1 = deepcopy(observation1Resource);
            observation1.resource.meta.lastUpdated = new Date("2023-02-16T01:12:00.000Z");
            observation1.resource.meta.versionId = "1";
            await observationHistoryCollection.insertOne(observation1);
            const observation2 = deepcopy(observation1Resource);
            observation2.resource.meta.lastUpdated = new Date("2023-02-17T01:12:00.000Z");
            observation2.resource.meta.versionId = "2";
            await observationHistoryCollection.insertOne(observation2);
            const observation3 = deepcopy(observation1Resource);
            observation3.resource.meta.lastUpdated = new Date("2023-02-18T01:12:00.000Z");
            observation3.resource.meta.versionId = "3";
            await observationHistoryCollection.insertOne(observation3);

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            const resp = await request
                .get('/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1&_count=1&_lastUpdated=lt2023-02-18T01:12:00.000Z')
                .set(getHeaders());

            expect(resp.body.link).toEqual([
                {
                    relation: 'self',
                    url: 'http://localhost:3000/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1&_count=1&_lastUpdated=lt2023-02-18T01:12:00.000Z'
                },
                {
                    relation: 'next',
                    url: 'http://localhost:3000/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history?_debug=1&_count=1&_lastUpdated=lt2023-02-17T01%3A12%3A00.000Z'
                }
            ]);

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResourceWithCountAndNextUrlQuery);
        });

        test('History by id dont work for patient scope', async () => {
            const request = await createTestRequest();

            // get history with patient scope fails for clinical resource
            let resp = await request
                .get('/4_0_0/Observation/1/_history?_debug=1')
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
                .get('/4_0_0/Practitioner/1/_history?_debug=1')
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
