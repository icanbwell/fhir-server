const {describe, beforeEach, afterEach, test} = require('@jest/globals');
const {commonBeforeEach, commonAfterEach} = require('../../../common');
const {PartitioningManager} = require('../../../../partitioners/partitioningManager');
const {ConfigManager} = require('../../../../utils/configManager');
const moment = require('moment-timezone');
const {YearMonthPartitioner} = require('../../../../partitioners/yearMonthPartitioner');
const {TestMongoDatabaseManager} = require('../../../testMongoDatabaseManager');
const {logInfo} = require('../../../../operations/common/logging');

class MockConfigManager extends ConfigManager {
    /**
     * @returns {string[]}
     */
    get partitionResources() {
        return ['Account', 'AuditEvent'];
    }
}

describe('PartitioningManager Tests', () => {
    beforeEach(async () => {
        await commonBeforeEach();
    });

    afterEach(async () => {
        await commonAfterEach();
    });

    describe('loadPartitionsFromDatabaseAsync Tests', () => {
        test('loadPartitionsFromDatabaseAsync works', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();
            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);

            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName).insertOne({foo: 1});
            partitioner.clearCache();
            await partitioner.loadPartitionsFromDatabaseAsync();
            expect(partitioner.partitionsCache.size).toBe(2);
            const partitions = partitioner.partitionsCache.get('Account');
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe(mongoCollectionName);
            await mongoDatabaseManager.dropDatabasesAsync();
        });
        test('loadPartitionsFromDatabaseAsync works for collections for multiple resources', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);

            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditEventDb.collection(mongoCollectionName2).insertOne({
                    bar: 1
                }
            );
            partitioner.clearCache();
            await partitioner.loadPartitionsFromDatabaseAsync();
            expect(partitioner.partitionsCache.size).toBe(2);
            const partitions = partitioner.partitionsCache.get('AuditEvent');
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe(mongoCollectionName2);
        });
        test('loadPartitionsFromDatabaseAsync works for multiple collections for same resource', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'AuditEvent_4_0_0';
            await auditEventDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                resourceWithBaseVersion: 'AuditEvent_4_0_0',
                fieldValue: fieldDate.toString()
            });
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});
            partitioner.clearCache();
            await partitioner.loadPartitionsFromDatabaseAsync();
            expect(partitioner.partitionsCache.size).toBe(2);
            const partitions = partitioner.partitionsCache.get('AuditEvent');
            expect(partitions.length).toBe(2);
            const partitionsSorted = partitions.sort();
            expect(partitionsSorted[0]).toBe(mongoCollectionName1);
            expect(partitionsSorted[1]).toBe(mongoCollectionName2);
        });
    });
    describe('getPartitionNameByResourceAsync Tests', () => {
        test('getPartitionNameByResourceAsync works for partitioned collection with no records', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            // noinspection JSValidateTypes
            /**
             * @type {Resource}
             */
            const resource = {resourceType: 'Account'};
            const partition = await partitioner.getPartitionNameByResourceAsync({
                resource: resource,
                base_version: '4_0_0'
            });
            expect(partition).toBe('Account_4_0_0');
        });
        test('getPartitionNameByResourceAsync works for partitioned collection with records', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'AuditEvent_4_0_0';
            await auditEventDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'));
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});

            // noinspection JSValidateTypes
            /**
             * @type {Resource}
             */
            const resource = {
                resourceType: 'AuditEvent',
                recorded: new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ssZ'))
            };
            const partition = await partitioner.getPartitionNameByResourceAsync({
                resource: resource,
                base_version: '4_0_0'
            });
            expect(partition).toBe(mongoCollectionName2);
        });
    });
    describe('getPartitionNamesByQueryAsync Tests', () => {
        test('getPartitionNamesByQueryAsync works for partitioned collection with no query', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'Account',
                base_version: '4_0_0',
                query: {}
            });
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe('Account_4_0_0');
        });
        test('getPartitionNamesByQueryAsync works for AuditEvent without data & no query', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                query: {}
            });
            if (partitions.length > 0) {
                logInfo('', {partitions});
                throw new Error(JSON.stringify(partitions));
            }
            expect(partitions.length).toBe(0);
        });
        test('getPartitionNamesByQueryAsync works for AuditEvent with data & no query', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            // now add the Audit Event
            const fieldDate = new Date(2022, 7 - 1, 10);
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                query: {}
            });
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe('AuditEvent_4_0_0_2022_07');
        });
        test('getPartitionNamesByQueryAsync works for AuditEvent with query for both gt & lt', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(2022, 7 - 1, 10);
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});

            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                $and: [
                    {'recorded': {$gt: new Date(2022, 7 - 1, 10)}}, // javascript months are 0-based
                    {'recorded': {$lt: new Date(2022, 7 - 1, 11)}}
                ]
            };
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                query
            });
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe('AuditEvent_4_0_0_2022_07');
        });
        test('getPartitionNamesByQueryAsync works for AuditEvent with query for just gt', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(2022, 7 - 1, 10);
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});

            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                $and: [
                    {'recorded': {$gt: new Date(2022, 7 - 1, 9)}}, // javascript months are 0-based
                ]
            };
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                query
            });
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe('AuditEvent_4_0_0_2022_07');
        });
        test('getPartitionNamesByQueryAsync works for AuditEvent with query for just lt', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(2022, 7 - 1, 10);
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});

            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                $and: [
                    {'recorded': {$lt: new Date(2022, 7 - 1, 11)}}, // javascript months are 0-based
                ]
            };
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                query
            });
            expect(partitions.length).toBe(1);
            expect(partitions[0]).toBe('AuditEvent_4_0_0_2022_07');
        });
        test('getPartitionNamesByQueryAsync works for AuditEvent with query for both gt & lt outside range', async () => {
            /**
             * @type {MongoDatabaseManager}
             */
            const mongoDatabaseManager = new TestMongoDatabaseManager();
            await mongoDatabaseManager.dropDatabasesAsync();

            const partitioner = new PartitioningManager({
                configManager: new MockConfigManager(),
                mongoDatabaseManager: mongoDatabaseManager
            });
            partitioner.clearCache();
            expect(partitioner.partitionsCache.size).toBe(0);
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const fhirDb = await mongoDatabaseManager.getClientDbAsync();
            /**
             * @type {string}
             */
            const mongoCollectionName1 = 'Account_4_0_0';
            await fhirDb.collection(mongoCollectionName1).insertOne({foo: 1});
            // now add the Audit Event
            const fieldDate = new Date(2022, 7 - 1, 10);
            /**
             * @type {string}
             */
            const mongoCollectionName2 = YearMonthPartitioner.getPartitionNameFromYearMonth({
                fieldValue: fieldDate.toString(),
                resourceWithBaseVersion: 'AuditEvent_4_0_0'
            });
            /**
             * mongo connection
             * @type {import('mongodb').Db}
             */
            const auditEventDb = await mongoDatabaseManager.getAuditDbAsync();
            await auditEventDb.collection(mongoCollectionName2).insertOne({bar: 1});

            /**
             * @type {import('mongodb').Filter<import('mongodb').Document>}
             */
            const query = {
                $and: [
                    {'recorded': {$gt: new Date(2023, 7 - 1, 10)}}, // javascript months are 0-based
                    {'recorded': {$lt: new Date(2023, 7 - 1, 11)}}
                ]
            };
            // noinspection JSValidateTypes
            const partitions = await partitioner.getPartitionNamesByQueryAsync({
                resourceType: 'AuditEvent',
                base_version: '4_0_0',
                query
            });
            expect(partitions.length).toBe(0);
        });
    });
});
