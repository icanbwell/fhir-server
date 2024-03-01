// test file
const person1Resource = require('./fixtures/person/person1.json');

const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');

const {
    FixDuplicateOwnerTagsRunner
} = require('../../../../admin/runners/fixDuplicateOwnerTagsRunner');

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
                'fixDuplicateOwnerTagsRunner',
                (c) =>
                    new FixDuplicateOwnerTagsRunner({
                        adminLogger: new AdminLogger(),
                        mongoDatabaseManager: c.mongoDatabaseManager,
                        mongoCollectionManager: c.mongoCollectionManager,
                        batchSize,
                        collections
                    })
            );

            /**
             * @type {FixDuplicateOwnerTagsRunner}
             */
            const fixDuplicateOwnerTagsRunner = container.fixDuplicateOwnerTagsRunner;
            assertTypeEquals(fixDuplicateOwnerTagsRunner, FixDuplicateOwnerTagsRunner);
            await fixDuplicateOwnerTagsRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${person1Resource.id}`)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson1AfterRun);
        });
    });
});
