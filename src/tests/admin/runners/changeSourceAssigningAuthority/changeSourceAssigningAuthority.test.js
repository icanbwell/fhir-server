// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');
const person3Resource = require('./fixtures/Person/person3.json');

// expected
const expectedPerson1BeforeRun = require('./fixtures/expected/expectedPerson1BeforeRun.json');
const expectedPerson1AfterRun = require('./fixtures/expected/expectedPerson1AfterRun.json');
const expectedPerson2 = require('./fixtures/expected/expectedPerson2.json');
const expectedPerson3BeforeRun = require('./fixtures/expected/expectedPerson3BeforeRun.json');
const expectedPerson3AfterRun = require('./fixtures/expected/expectedPerson3AfterRun.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../../common');
const { AdminLogger } = require('../../../../admin/adminLogger');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { ChangeSourceAssigningAuthorityRunner } = require('../../../../admin/runners/changeSourceAssigningAuthorityRunner');

describe('Person Tests', () => {
    beforeEach(async () => {
        const container = getTestContainer();
        if (container) {
            delete container.services.changeSourceAssigningAuthorityRunner;
        }
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person Tests', () => {
        test('changeSourceAssigningAuthority works for person with history', async () => {
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
                .post('/4_0_0/Person/$merge')
                .send(person2Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2BeforeRun = resp.body;
            delete person2BeforeRun.meta.lastUpdated;
            expect(person2BeforeRun).toEqual(expectedPerson2);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('changeSourceAssigningAuthorityRunner', (c) => new ChangeSourceAssigningAuthorityRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    oldSourceAssigningAuthority: 'client-1',
                    newSourceAssigningAuthority: 'client'
                }
            )
            );

            /**
             * @type {ChangeSourceAssigningAuthorityRunner}
             */
            const changeSourceAssigningAuthorityRunner = container.changeSourceAssigningAuthorityRunner;
            assertTypeEquals(changeSourceAssigningAuthorityRunner, ChangeSourceAssigningAuthorityRunner);
            await changeSourceAssigningAuthorityRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2AfterRun = resp.body;
            delete person2AfterRun.meta.lastUpdated;
            expect(person2AfterRun).toEqual(expectedPerson2);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(1);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson2.id}`)
                .set(getHeaders())
                .expect(200);

            const person2History = resp.body;

            expect(person2History.entry).toBeDefined();
            expect(person2History.entry.length).toEqual(1);

            delete person2History.entry[0].resource.meta.lastUpdated;
            expect(person2History.entry[0].resource).toEqual(expectedPerson2);
        });

        test('changeSourceAssigningAuthority with multiple persons work', async () => {
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
                .post('/4_0_0/Person/$merge')
                .send(person3Resource)
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveMergeResponse({ created: true });

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1BeforeRun = resp.body;
            delete person1BeforeRun.meta.lastUpdated;
            expect(person1BeforeRun).toEqual(expectedPerson1BeforeRun);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson3BeforeRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person3BeforeRun = resp.body;
            delete person3BeforeRun.meta.lastUpdated;
            expect(person3BeforeRun).toEqual(expectedPerson3BeforeRun);

            const container = getTestContainer();

            // run admin runner
            const collections = ['all'];
            const batchSize = 10000;

            container.register('changeSourceAssigningAuthorityRunner', (c) => new ChangeSourceAssigningAuthorityRunner(
                {
                    mongoCollectionManager: c.mongoCollectionManager,
                    collections,
                    batchSize,
                    useAuditDatabase: false,
                    adminLogger: new AdminLogger(),
                    mongoDatabaseManager: c.mongoDatabaseManager,
                    preSaveManager: c.preSaveManager,
                    databaseQueryFactory: c.databaseQueryFactory,
                    resourceLocatorFactory: c.resourceLocatorFactory,
                    resourceMerger: c.resourceMerger,
                    oldSourceAssigningAuthority: 'client-1',
                    newSourceAssigningAuthority: 'client'
                }
            )
            );

            /**
             * @type {ChangeSourceAssigningAuthorityRunner}
             */
            const changeSourceAssigningAuthorityRunner = container.changeSourceAssigningAuthorityRunner;
            assertTypeEquals(changeSourceAssigningAuthorityRunner, ChangeSourceAssigningAuthorityRunner);
            await changeSourceAssigningAuthorityRunner.processAsync();

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1AfterRun = resp.body;
            delete person1AfterRun.meta.lastUpdated;
            expect(person1AfterRun).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/${expectedPerson3AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person3AfterRun = resp.body;
            delete person3AfterRun.meta.lastUpdated;
            expect(person3AfterRun).toEqual(expectedPerson3AfterRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson1AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person1History = resp.body;

            expect(person1History.entry).toBeDefined();
            expect(person1History.entry.length).toEqual(1);

            delete person1History.entry[0].resource.meta.lastUpdated;
            expect(person1History.entry[0].resource).toEqual(expectedPerson1AfterRun);

            resp = await request
                .get(`/4_0_0/Person/_history?id=${expectedPerson3AfterRun.id}`)
                .set(getHeaders())
                .expect(200);

            const person3History = resp.body;

            expect(person3History.entry).toBeDefined();
            expect(person3History.entry.length).toEqual(1);

            delete person3History.entry[0].resource.meta.lastUpdated;
            expect(person3History.entry[0].resource).toEqual(expectedPerson3AfterRun);
        });
    });
});
