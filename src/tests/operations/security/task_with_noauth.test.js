// test file
const task1Resource = require('./fixtures/task1.json');

const {
    commonBeforeEach,
    commonAfterEach,
    getHeadersWithCustomPayload,
    createTestRequest
} = require('../../common');
const {describe, beforeAll, afterAll, test, expect} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    get authEnabled() {
        return false;
    }
}

describe('taskTests', () => {
    beforeAll(async () => {
        await commonBeforeEach();
    });

    afterAll(async () => {
        await commonAfterEach();
    });

    describe('task noauth Tests', () => {
        const app_client_payload = {
            username: 'Some App'
        };

        test('App clients can create Tasks', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            const resp = await request
                .post('/4_0_0/Task/231/$merge?validate=true')
                .send(task1Resource)
                .set(getHeadersWithCustomPayload(app_client_payload));
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});
        });
    });
});
