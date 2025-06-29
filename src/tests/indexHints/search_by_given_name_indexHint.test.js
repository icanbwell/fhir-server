// provider file
const personResource = require('./fixtures/person.json');

// expected
const expectedPersonResult = require('./fixtures/expectedPersonResult.json');

const { commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer } = require('../common');
const { describe, beforeEach, afterEach, test, expect } = require('@jest/globals');

// const { customIndexes } = require('./mockCustomIndexes');
const { ConfigManager } = require('../../utils/configManager');
const { CreateCollectionsRunner } = require('../../admin/runners/createCollectionsRunner');
const { AdminLogger } = require('../../admin/adminLogger');

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
        test.only('search by given name and _setIndexHint should work', async () => {
            const request = await createTestRequest((container) => {
                container.register('configManager', () => new MockConfigManager());
                container.register(
                    'createCollectionsRunner',
                    (c) =>
                        new CreateCollectionsRunner({
                            indexManager: c.indexManager,
                            adminLogger: new AdminLogger(),
                            mongoDatabaseManager: c.mongoDatabaseManager
                        })
                );
                return container;
            });

            const container = getTestContainer();
            // create collections and indexes
            const createCollectionsRunner = container.createCollectionsRunner;
            await createCollectionsRunner.processAsync();

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
        });
    });
});
