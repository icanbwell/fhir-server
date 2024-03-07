// test file
const person1Resource = require('./fixtures/person/person1.json');

const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');

const {
    FixMultipleOwnerTagsRunner
} = require('../../../../admin/runners/fixMultipleOwnerTagsRunner');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person fixPersonLinks Tests', () => {
        test('fixPersonLinks works for main person 1', async () => {
            // eslint-disable-next-line no-unused-vars
            const request = await createTestRequest();

            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/Person/$merge')
                .send(person1Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${person1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            const container = getTestContainer();
            const batchSize = 10000;
            const collections = ['all'];

            container.register(
                'fixMultipleOwnerTagsRunner',
                (c) =>
                    new FixMultipleOwnerTagsRunner({
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        collections
                    })
            );

            /**
             * @type {FixMultipleOwnerTagsRunner}
             */
            const fixMultipleOwnerTagsRunner = container.fixMultipleOwnerTagsRunner;
            assertTypeEquals(fixMultipleOwnerTagsRunner, FixMultipleOwnerTagsRunner);
            await fixMultipleOwnerTagsRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${person1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson1AfterRun);
        });
    });
});
