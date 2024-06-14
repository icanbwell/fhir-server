// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservationByIdResources = require('./fixtures/expected/expected_observation_by_id.json');
const expectedObservationAllResources = require('./fixtures/expected/expected_observation_all.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation hidden_resources Tests', () => {
        test('hidden resources are not returned in query', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/3/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_total=accurate')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
            // Number of resources returned in this case is 2 as 1 of them has hidden tag
            expect(resp.body.entry.length).toEqual(2);
            expect(resp.body.total).toEqual(2);
        });
        test('hidden resources are returned in query by id', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            resp = await request
                .get('/4_0_0/Observation/2')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByIdResources);

            resp = await request
                .get('/4_0_0/Observation?id=2')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByIdResources);
        });
        test('hidden resources are returned when _includeHidden is passed as true value', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/3/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // Requested with value of _includeHidden as true
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_total=accurate&_includeHidden=true')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationAllResources);
            // Number of resources returned in this case is 3 even when 1 of them has hidden tag
            expect(resp.body.entry.length).toEqual(3);
            expect(resp.body.total).toEqual(3);

            // Requested with value of _includeHidden as 1
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_total=accurate&_includeHidden=1')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationAllResources);
            expect(resp.body.entry.length).toEqual(3);
            expect(resp.body.total).toEqual(3);

            // Requested with value of _includeHidden as a non-true value
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_total=accurate&_includeHidden=0')
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
            expect(resp.body.entry.length).toEqual(2);
            expect(resp.body.total).toEqual(2);
        });
    });
});
