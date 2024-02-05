// provider file
const observation1Resource = require('./fixtures/observation/observation1.json');
const observation2Resource = require('./fixtures/observation/observation2.json');
const encounterResource = require('./fixtures/encounter/encounter.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedEncounterResources = require('./fixtures/expected/expected_encounter.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
} = require('../../common');
const {describe, beforeEach, afterEach, test } = require('@jest/globals');

describe('ObservationReturnIdTests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation Search By token Tests', () => {
        test('search by single token works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right observation back
            resp = await request
                .get(
                    '/4_0_0/Observation/?code=http://www.icanbwell.com/cql/library|BMI001&_setIndexHint=1&_bundle=1'
                )
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by just token code and make sure we get the right observation back
            resp = await request
                .get('/4_0_0/Observation/?code=BMI001&_setIndexHint=1&_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);

            // search by just token system and make sure we get the right observation back
            resp = await request
                .get(
                    '/4_0_0/Observation/?code=http://www.icanbwell.com/cql/libraryVersion|&_bundle=1'
                )
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
    });
});

describe('Encounter tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Encounter Search By token Tests', () => {
        test('search by token field as object works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Encounter/1/$merge')
                .send(encounterResource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right observation back
            resp = await request
                .get(
                    '/4_0_0/Encounter?class=http://terminology.hl7.org/CodeSystem/v3-ActCode|AMB&_bundle=1&_debug=1'
                )
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedEncounterResources);
        });
    });
});
