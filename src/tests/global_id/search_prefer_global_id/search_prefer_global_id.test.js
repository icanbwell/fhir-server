// test file
const observation1Resource = require('./fixtures/Observation/observation1.json');
const observation2Resource = require('./fixtures/Observation/observation2.json');
const observation3Resource = require('./fixtures/Observation/observation3.json');

// expected
const expectedObservationResources = require('./fixtures/expected/expected_observation.json');
const expectedObservationByReferenceResources = require('./fixtures/expected/expected_observation_by_reference.json');
const expectedObservationBothResources = require('./fixtures/expected/expected_observation_both.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { IdentifierSystem } = require('../../../utils/identifierSystem');
const { SecurityTagSystem } = require('../../../utils/securityTagSystem');
const { generateUUIDv5, isUuid } = require('../../../utils/uid.util');

describe('Observation Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Observation search_prefer_global_id Tests', () => {
        test('search_prefer_global_id works with single resource', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            const headers = getHeaders();
            headers.Prefer = 'global_id=true';
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationResources);
        });
        test('search_prefer_global_id works with multiple resources', async () => {
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
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation2Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation3Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            const headers = getHeaders();
            headers.Prefer = 'global_id=true';
            resp = await request
                .get('/4_0_0/Observation/?_bundle=1&_debug=1')
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationBothResources);

            // check that the uuid is correct
            for (const /** @type {BundleEntry} */ entry of resp.body.entry) {
                /**
                 * @type {Observation}
                 */
                const resource = entry.resource;
                /**
                 * @type {Reference}
                 */
                const subject = resource.subject;
                const id = subject.extension.find(e => e.url === IdentifierSystem.sourceId).valueString.split('/')[1];
                const sourceAssigningAuthority = subject.extension.find(
                    e => e.url === SecurityTagSystem.sourceAssigningAuthority).valueString;
                const reference = subject.reference;
                const referenceId = reference.split('/').slice(-1)[0];
                if (!isUuid(referenceId)){
                    const expectedReferenceId = generateUUIDv5(`${id}|${sourceAssigningAuthority}`);
                    expect(referenceId).toStrictEqual(expectedReferenceId);
                }
            }
        });
        test('search_prefer_global_id works with reference', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Observation/1/$merge?validate=true')
                .send(observation1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Observation back
            const headers = getHeaders();
            headers.Prefer = 'global_id=true';

            const patientId = generateUUIDv5('2354|A');
            resp = await request
                .get(`/4_0_0/Observation/?_bundle=1&patient=${patientId}&_debug=1`)
                .set(headers);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedObservationByReferenceResources);
        });
    });
});
