// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest,
    getHeadersWithCustomPayload
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const person_payload = {
    scope: 'patient/Observation.read patient/Observation.write user/*.* access/*.*',
    username: 'patient-123@example.com',
    clientFhirPersonId: 'person1',
    clientFhirPatientId: 'clientFhirPatient',
    bwellFhirPersonId: 'person1',
    bwellFhirPatientId: 'bwellFhirPatient',
    token_use: 'access'
};
const headers = getHeadersWithCustomPayload(person_payload);

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation restricted_resources Tests', () => {
        test('restricted resources are not returned in query by patient scope', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add person to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            resp = await request
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
            // search using patient scope and make sure we get the right Observation back
            resp = await request.get('/4_0_0/Observation/?_bundle=1&_total=accurate').set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
            // Number of resources returned in this case is 2 as 1 of them has restricted tag
            expect(resp.body.entry.length).toEqual(2);
            expect(resp.body.total).toEqual(2);
        });

        test('restricted resources are not returned in search by id with patient scope', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add person to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            resp = await request
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

            // ACT & ASSERT
            // search using patient scope and make sure we get the right Observation back
            await request.get('/4_0_0/Observation/1').set(headers).expect(200);

            await request.get('/4_0_0/Observation/2').set(headers).expect(404);
        });

        test('restricted resources are not updated with patient scope', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add person to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            let addResp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(addResp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // make sure restricted resources are not updated using patient scope
            resp = await request
                .put('/4_0_0/Observation/' + addResp._body.uuid)
                .send(observation1Resource)
                .set(headers)
                .expect(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse({
                issue: [
                    {
                        code: 'forbidden',
                        details: {
                            text: 'user person1 with scopes [patient/Observation.read patient/Observation.write user/*.* access/*.*] has no write access to resource Observation with id 2'
                        },
                        diagnostics:
                            'user person1 with scopes [patient/Observation.read patient/Observation.write user/*.* access/*.*] has no write access to resource Observation with id 2',
                        severity: 'error'
                    }
                ],
                resourceType: 'OperationOutcome'
            });
        });

        test('restricted resources are not patched with patient scope', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add person to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // make sure restricted resources are not patched using patient scope
            resp = await request
                .patch('/4_0_0/Observation/2')
                .send([
                    {
                        op: 'replace',
                        path: '/status',
                        value: 'cancelled'
                    }
                ])
                .set({ ...headers, 'Content-Type': 'application/json-patch+json' })
                .expect(404);
        });

        test('restricted resources are not deleted with patient scope', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add person to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Observation/2/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // make sure restricted resources are not deleted using patient scope
            resp = await request.delete('/4_0_0/Observation/2').set(headers).expect(204);
            // checking that the document is not deleted
            await request.get('/4_0_0/Observation/2').set(getHeaders()).expect(200);
        });
    });
});
