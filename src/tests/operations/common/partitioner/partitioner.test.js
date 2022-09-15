const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {commonBeforeEach, commonAfterEach} = require('../../../common');
const {Partitioner} = require('../../../../operations/common/partitioner');
const globals = require('../../../../globals');
const {CLIENT_DB, AUDIT_EVENT_CLIENT_DB} = require('../../../../constants');
const {ConfigManager} = require('../../../../utils/configManager');
const moment = require('moment-timezone');

class MockConfigManager extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return ['Account', 'AuditEvent'];
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
        test('loadPartitionsFromDatabaseAsync works', async () => {
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
            expect(partitioner.partitionsCache.size).toBe(2);
            const partitions = partitioner.partitionsCache.get('Account');
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe(mongoCollectionName);
        });
        test('loadPartitionsFromDatabaseAsync works for collections for multiple resources', async () => {
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
            const mongoCollectionName1 = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            const year = fieldDate.getUTCFullYear();
            const month = fieldDate.getUTCMonth() + 1; // 0 indexed
            const monthFormatted = String(month).padStart(2, '0');
            /**
             * @type {string}
             */
            const mongoCollectionName2 = `AuditEvent_4_0_0_${year}_${monthFormatted}`;
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = globals.get(AUDIT_EVENT_CLIENT_DB);
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});
            await partitioner.loadPartitionsFromDatabaseAsync();
            expect(partitioner.partitionsCache.size).toBe(2);
            const partitions = partitioner.partitionsCache.get('AuditEvent');
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe(mongoCollectionName2);
        });
        test('loadPartitionsFromDatabaseAsync works for multiple collections for same resource', async () => {
            const partitioner = new Partitioner({configManager: new MockConfigManager()});
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = globals.get(AUDIT_EVENT_CLIENT_DB);
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'AuditEvent_4_0_0';
            await auditEventDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            const year = fieldDate.getUTCFullYear();
            const month = fieldDate.getUTCMonth() + 1; // 0 indexed
            const monthFormatted = String(month).padStart(2, '0');
            /**
             * @type {string}
             */
            const mongoCollectionName2 = `AuditEvent_4_0_0_${year}_${monthFormatted}`;
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});
            await partitioner.loadPartitionsFromDatabaseAsync();
            expect(partitioner.partitionsCache.size).toBe(2);
            const partitions = partitioner.partitionsCache.get('AuditEvent');
            expect(partitions.length).toBe(2);
            const partitionsSorted = partitions.sort();
            expect(partitionsSorted[0]).toBe(mongoCollectionName1);
            expect(partitionsSorted[1]).toBe(mongoCollectionName2);
        });
        test('getPartitionNameAsync works for partitioned collection with no records', async () => {
            const partitioner = new Partitioner({configManager: new MockConfigManager()});
            expect(partitioner.partitionsCache.size).toBe(0);
            // noinspection JSValidateTypes
            /**
             * @type {Resource}
             */
            const resource = {resourceType: 'Account'};
            const partition = await partitioner.getPartitionNameAsync({
                resource: resource,
                base_version: '4_0_0'
            });
            expect(partition).toBe('Account_4_0_0');
        });
        test('getPartitionNameAsync works for partitioned collection with records', async () => {
            const partitioner = new Partitioner({configManager: new MockConfigManager()});
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = globals.get(AUDIT_EVENT_CLIENT_DB);
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'AuditEvent_4_0_0';
            await auditEventDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            const year = fieldDate.getUTCFullYear();
            const month = fieldDate.getUTCMonth() + 1; // 0 indexed
            const monthFormatted = String(month).padStart(2, '0');
            /**
             * @type {string}
             */
            const mongoCollectionName2 = `AuditEvent_4_0_0_${year}_${monthFormatted}`;
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});

            // noinspection JSValidateTypes
            /**
             * @type {Resource}
             */
            const resource = {resourceType: 'AuditEvent', recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'))};
            const partition = await partitioner.getPartitionNameAsync({
                resource: resource,
                base_version: '4_0_0'
            });
            expect(partition).toBe(mongoCollectionName2);
        });
    });
});
