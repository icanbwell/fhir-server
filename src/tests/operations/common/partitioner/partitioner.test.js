const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {commonBeforeEach, commonAfterEach} = require('../../../common');
const {Partitioner} = require('../../../../operations/common/partitioner');
const globals = require('../../../../globals');
const {CLIENT_DB} = require('../../../../constants');
const {ConfigManager} = require('../../../../utils/configManager');

class MockConfigManager extends ConfigManager{
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return ['Account'];
    }
}

describe('Partitioner Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('Partitioner Tests', () => {
        test('Get existing collections works', async () => {
            const partitioner = new Partitioner({configManager: new MockConfigManager()});
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = globals.get(CLIENT_DB);
            /**
             * @type {string}
             */
            const mongoCollectionName = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName).insertOne({foo: 1});
            await partitioner.loadPartitionsFromDatabaseAsync();
            expect(partitioner.partitionsCache.size).toBe(1);
            const partitions = partitioner.partitionsCache.get('Account');
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe(mongoCollectionName);
        });
    });
});
