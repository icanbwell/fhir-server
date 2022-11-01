// test file
const person1Resource = require('./fixtures/Person/person1.json');

// expected
const expectedPersonResources = require('./fixtures/expected/expected_Person.json');
const expectedMissingAccessScope = require('./fixtures/expected/expectedMissingAccessScope.json');
const expectedWrongAccessScope = require('./fixtures/expected/expectedWrongAccessScope.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeaders,
    createTestRequest, getTestContainer,
} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person mergeWith_id Tests', () => {
        test('mergeWith_id works with access/*.* (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('mergeWith_id works with access/*.* (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: false});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
        test('mergeWith_id fails with missing permissions (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE

            // ACT & ASSERT
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMissingAccessScope, r => {
                delete r['diagnostics'];
            });
        });
        test('mergeWith_id fails with missing permissions (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            let resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            // ACT & ASSERT
            // add the resources to FHIR server
            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedMissingAccessScope, r => {
                delete r['diagnostics'];
            });

        });
        test('mergeWith_id fails with wrong access scope (create)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // ACT & ASSERT
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongAccessScope, r => {
                delete r['diagnostics'];
            });
        });
        test('mergeWith_id fails with wrong access scope (update)', async () => {
            const request = await createTestRequest();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            const container = getTestContainer();
            /**
             * @type {PostRequestProcessor}
             */
            const postRequestProcessor = container.postRequestProcessor;
            await postRequestProcessor.waitTillDoneAsync();

            resp = await request
                .post('/4_0_0/Person/1/$merge')
                .send(person1Resource)
                .set(getHeaders('user/*.read user/*.write access/foo.*'));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveStatusCode(403);
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedWrongAccessScope, r => {
                delete r['diagnostics'];
            });

            // ACT & ASSERT
            // search by token system and code and make sure we get the right Person back
            resp = await request
                .get('/4_0_0/Person/?_bundle=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResources);
        });
    });
});
