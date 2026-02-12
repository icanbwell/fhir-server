// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');

// expected
const expectedObservationResource = require('./fixtures/expected/expected_observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getTestContainer
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Observation historyByVersionId Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    test('historyByVersionId works', async () => {
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
         * mongo connection
         * @type {import('mongodb').Db}
         */
        const fhirDb = await mongoDatabaseManager.getClientDbAsync();
        const collectionName = 'Observation_4_0_0_History';
        /**
         * mongo collection
         * @type {import('mongodb').Collection}
         */
        const observationHistoryCollection = fhirDb.collection(collectionName);
        await observationHistoryCollection.insertOne(observation1Resource);

        // ACT & ASSERT
        const resp = await request
            .get('/4_0_0/Observation/007ae95f-1ce4-43af-a881-7eeff3fd264e/_history/1')
            .set(getHeaders());
        // noinspection JSUnresolvedFunction
        expect(resp).toHaveResponse(expectedObservationResource);
    });

    test('History by version id dont work for patient scope', async () => {
        const request = await createTestRequest();

        // get history with patient scope fails for clinical resource
        let resp = await request
            .get('/4_0_0/Observation/1/_history/1?_debug=1')
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
            .get('/4_0_0/Practitioner/1/_history/1?_debug=1')
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
