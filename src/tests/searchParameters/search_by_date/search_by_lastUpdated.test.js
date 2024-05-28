// test file
const person1Resource = require('./fixtures/Person/person1.json');
const person2Resource = require('./fixtures/Person/person2.json');

const expectedPerson1Response = require('./fixtures/expected/expectedPerson1Response.json');
const expectedPerson2Response = require('./fixtures/expected/expectedPerson2Response.json');

const {
    commonBeforeEach,
    commonAfterEach,
    createTestRequest,
    getTestContainer,
    getHeaders
} = require('../../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

async function setupDatabaseAsync(mongoDatabaseManager, personResource, collectionName) {
    const fhirDb = await mongoDatabaseManager.getClientDbAsync();

    const collection = fhirDb.collection(collectionName);
    await collection.insertOne(personResource);

    return collection;
}

describe('Person Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search by lastUpdated Tests', () => {
        test('notEquals work for lastUpdated', async () => {
            const request = await createTestRequest();
            const container = getTestContainer();

            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;

            person1Resource.meta.lastUpdated = new Date("2024-01-01");
            await setupDatabaseAsync(mongoDatabaseManager, person1Resource, 'Person_4_0_0');
            person2Resource.meta.lastUpdated = new Date("2024-01-02");
            await setupDatabaseAsync(mongoDatabaseManager, person2Resource, 'Person_4_0_0');

            let resp = await request
                .get('/4_0_0/Person?_lastUpdated=ne2024-01-01&_debug=true&_bundle=1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson1Response);

            resp = await request
                .get('/4_0_0/Person?_lastUpdated=ne2024-01-02&_debug=true&_bundle=1')
                .set(getHeaders())
                .expect(200);

            expect(resp).toHaveResponse(expectedPerson2Response);
        });
    });
});
