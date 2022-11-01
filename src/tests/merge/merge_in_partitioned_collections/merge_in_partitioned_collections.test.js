// test file
const auditevent1Resource = require('./fixtures/AuditEvent/auditevent1.json');

// expected
const expectedAuditEventResources = require('./fixtures/expected/expected_AuditEvent.json');
const expectedAuditEventFirstTwoResources = require('./fixtures/expected/expected_AuditEvent_first _two.json');

const {commonBeforeEach, commonAfterEach, getHeaders, createTestRequest, getTestContainer} = require('../../common');
const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {ConfigManager} = require('../../../utils/configManager');

class MockConfigManager extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return ['AuditEvent'];
    }
}

describe('AuditEvent Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('AuditEvent merge_in_partitioned_collections Tests', () => {
        test('merge_in_partitioned_collections works', async () => {
            const request = await createTestRequest((c) => {
                c.register('configManager', () => new MockConfigManager());
                return c;
            });
            /**
             * @type {SimpleContainer}
             */
            const container = getTestContainer();
            // ARRANGE
            // add the resources to FHIR server
            let resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: true});

            // send again to test merging with existing resources
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: false});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventResources);

            // now send just the first two and make sure the third collection was not queried
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = container.mongoDatabaseManager;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditDb.dropCollection('AuditEvent_4_0_0_2021_05');

            auditevent1Resource.entry = auditevent1Resource.entry.slice(0, 3);
            resp = await request
                .post('/4_0_0/AuditEvent/1/$merge?validate=true')
                .send(auditevent1Resource)
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveMergeResponse({created: false, updated: false});

            // ACT & ASSERT
            // search by token system and code and make sure we get the right AuditEvent back
            resp = await request
                .get('/4_0_0/AuditEvent/?_bundle=1&_debug=1')
                .set(getHeaders());
            // noinspection JSUnresolvedFunction
            expect(resp).toHaveResponse(expectedAuditEventFirstTwoResources);
        });
    });
});
