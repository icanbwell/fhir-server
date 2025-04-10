// test file
const person1Resource = require('./fixtures/Person/person1.json');
const personMergeResource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_person.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer, mockHttpContext } = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

describe('Person Tests', () => {
    let requestId;
    beforeEach(async () => {
        await commonBeforeEach();
        requestId = mockHttpContext();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person merge_with_multiple_updates_to_same_resource Tests', () => {
        test('merge_with_multiple_updates_to_same_resource works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personMergeResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ updated: false }, { updated: false }, { updated: false });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/f924936d-e31e-45fe-a379-e13a9107f51a')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });

        test('merge_with_multiple_updates_to_same_resource to same field works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person3Resource)
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ updated: false });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/f924936d-e31e-45fe-a379-e13a9107f51a')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });

        test('merge_with_multiple_updates_to_same_resource to same field with bundle works', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.executeAsync({ requestId });
            await postRequestProcessor.waitTillDoneAsync({ requestId });

            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send({
                    resourceType: 'Bundle',
                    entry: person3Resource.map(resource => ({ resource }))
                })
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ updated: false });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/f924936d-e31e-45fe-a379-e13a9107f51a')
                .set(getHeaders())
                .expect(200);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
    });
});
