// provider file
const personResource = require('./fixtures/person.json');

// expected
const expectedPersonResult = require('./fixtures/expectedPersonResult.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

const { ConfigManager } = require('../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get enableReturnBundle () {
        return true;
    }
}

describe('PersonWithIndexHint Test', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Person search using _setIndexHint', () => {
        test('search by given name and _setIndexHint should work', async () => {
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                return container;
            });

            const container = getTestContainer();

            // Create only the Person_4_0_0 collection + the name.family_1 index
            // we need to exercise _setIndexHint. Calling CreateCollectionsRunner
            // would create 140+ collections × 3 db's × all configured indexes,
            // which routinely brushes the 60s testTimeout under CI load.
            const db = await container.mongoDatabaseManager.getClientDbAsync();
            await db.createCollection('Person_4_0_0');
            await db.collection('Person_4_0_0').createIndex(
                { 'name.family': 1, 'name.given': 1 },
                { name: 'name.family_1' }
            );

            let resp = await request.get('/4_0_0/Person').set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResourceCount(0);

            // now add a record
            resp = await request
                .post('/4_0_0/Person/1/$merge?validate=true')
                .send(personResource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({ created: true });

            // now check that we get the right record back
            resp = await request
                .get(
                    '/4_0_0/Person?given=Daniel&_debug=true&_format=json&_setIndexHint=name.family_1'
                )
                .set(getHeaders());

            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedPersonResult);
        }, 120000);
    });
});
