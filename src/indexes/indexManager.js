/**
 * This file implements code to index the mongo database and to list the current indexes
 */

const async = require('async');
const { logInfo } = require('../operations/common/logging');
const { logSystemEventAsync, logSystemErrorAsync } = require('../operations/common/systemEventLogging');
const { assertTypeEquals, assertIsValid } = require('../utils/assertType');
const { IndexProvider } = require('./indexProvider');
const { MongoDatabaseManager } = require('../utils/mongoDatabaseManager');
const deepEqual = require('fast-deep-equal');
const { ACCESS_LOGS_COLLECTION_NAME } = require('../constants');

/**
 * @typedef IndexConfig
 * @type {object}
 * @property {Object} keys
 * @property {{name: string, [unique]: boolean|undefined}} options
 * @property {string[]|undefined} [exclude]
 */

/**
 * @classdesc Creates and deletes indexes
 */
class IndexManager {
    /**
     * constructor
     * @param {IndexProvider} indexProvider
     * @param {MongoDatabaseManager} mongoDatabaseManager
     */
    constructor ({
                    indexProvider,
                    mongoDatabaseManager
                }) {
        /**
         * @type {IndexProvider}
         */
        this.indexProvider = indexProvider;
        assertTypeEquals(indexProvider, IndexProvider);

        /**
         * @type {MongoDatabaseManager}
         */
        this.mongoDatabaseManager = mongoDatabaseManager;
        assertTypeEquals(mongoDatabaseManager, MongoDatabaseManager);
    }

    /**
     * creates a multi key index if it does not exist
     * https://www.mongodb.com/docs/manual/reference/method/db.collection.createIndex/
     * https://www.mongodb.com/docs/drivers/node/current/fundamentals/indexes/
     * @param {import('mongodb').Db} db
     * @param {IndexConfig} indexConfig
     * @param {string} collectionName
     * @return {Promise<boolean>}
     */
    async createIndexIfNotExistsAsync ({ db, indexConfig, collectionName }) {
        assertIsValid(collectionName);
        /**
         * @type {import('mongodb').IndexSpecification}
         */
        const indexSpec = indexConfig.keys;
        /**
         * @type {string[]}
         */
        const properties_to_index = Object.keys(indexSpec);
        /**
         * @type {string}
         */
        const indexName = indexConfig.options.name;
        /**
         * @type {string}
         */
        const columnsText = properties_to_index.join(',');
        // limitations: https://www.mongodb.com/docs/manual/reference/limits/
        try {
            if (!(await db.collection(collectionName).indexExists(indexName))) {
                const message = 'Creating index ' + indexName + ' with columnsText: [' + columnsText + ']' +
                    ' in ' + collectionName;
                await logSystemEventAsync(
                    {
                        event: 'createIndex',
                        message,
                        args: {
                            index: indexName,
                            columns: columnsText,
                            collection: collectionName,
                            indexColumnConfig: indexConfig
                        }
                    }
                );
                await db.collection(collectionName).createIndex(indexSpec, indexConfig.options);
                return true;
            }
        } catch (e) {
            const message1 = 'Error creating index: ' + indexName + ' for collection ' + collectionName +
                ': ' + JSON.stringify(e);
            await logSystemErrorAsync(
                {
                    event: 'createIndex',
message: message1,
args: {
                        index: indexName,
                        columns: columnsText,
                        collection: collectionName
                    },
                    error: e
                }
            );
        }
        return false;
    }

    /**
     * creates indexes on a collection
     * @param {string} collectionName
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes: IndexConfig[], indexesCreated: number, collectionName: string}>}
     */
    async indexCollectionAsync ({ collectionName, db }) {
        /**
         * @type {{collectionName: string, indexes: IndexConfig[]}}
         */
        const createIndexResult = await this.getIndexesToCreateForCollectionAsync({ collectionName });

        // check if index exists
        let indexesCreated = 0;
        for (const /** @type {IndexConfig} */ indexConfig of createIndexResult.indexes) {
            const createdIndex = await this.createIndexIfNotExistsAsync(
                {
                    db,
                    indexConfig,
                    collectionName
                }
            );
            if (createdIndex) {
                indexesCreated += 1;
            }
        }

        const currentIndexResult = await this.getIndexesInCollectionAsync({ collectionName, db });
        return {
            collectionName: currentIndexResult.collectionName,
            indexesCreated,
            indexes: currentIndexResult.indexes
        };
    }

    /**
     * Gets indexes to create for the collection requested
     * @param {string} collectionName
     * @returns {Promise<{collectionName: string, indexes: IndexConfig[]}>}
     */
    async getIndexesToCreateForCollectionAsync ({ collectionName }) {
        const baseCollectionName = collectionName.endsWith('_4_0_0') || collectionName === ACCESS_LOGS_COLLECTION_NAME
            ? collectionName : collectionName.substring(0, collectionName.indexOf('_4_0_0') + 6);

        // if this is a history collection then we only create an index on id
        /**
         * @type {boolean}
         */
        const isHistoryTable = collectionName.includes('_History');
        /**
         * @type {IndexConfig[]}
         */
        const indexesToCreate = [];

        // first add indexes that are set on all collections (except ones marked exlude)
        const indexes = this.indexProvider.getIndexes();
        for (const [indexCollectionName,
            /** @type {IndexConfig[]} */ indexConfigs]
            of Object.entries(indexes)) {
            if (isHistoryTable) {
                if (indexCollectionName === '*_History') {
                    for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                        if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                            indexesToCreate.push(indexConfig);
                        }
                    }
                }
            } else {
                if (indexCollectionName === '*') {
                    for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                        if (
                            (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) &&
                            (!indexConfig.include || indexConfig.include.includes(baseCollectionName))
                        ) {
                            indexesToCreate.push(indexConfig);
                        }
                    }
                }
                if (baseCollectionName === indexCollectionName) {
                    for (const /** @type {IndexConfig} */ indexConfig of indexConfigs) {
                        if (!indexConfig.exclude || !indexConfig.exclude.includes(baseCollectionName)) {
                            indexesToCreate.push(indexConfig);
                        }
                    }
                }
            }
        }

        return {
            collectionName: collectionName,
            indexes: indexesToCreate
        };
    }

    /**
     * Indexes all the collections
     * @param {string|undefined} [collectionRegex]
     * @return {Promise<{indexes: IndexConfig[], indexesCreated: number, collectionName: string}[]>}
     */
    async indexAllCollectionsAsync ({ collectionRegex } = {}) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(
            await this.mongoDatabaseManager.getClientConfigAsync()
        );
        /**
         * @type {import('mongodb').Db}
         */
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        try {
            return await this.indexAllCollectionsInDatabaseAsync({
                db, collectionRegex
            });
        } finally {
            await this.mongoDatabaseManager.disconnectClientAsync(client);
        }
    }

    /**
     * indexes all collections in this database
     * @param {import('mongodb').Db} db
     * @param {string|undefined} [collectionRegex]
     * @returns {Promise<{indexes: IndexConfig[], indexesCreated: number, collectionName: string}[]>}
     */
    async indexAllCollectionsInDatabaseAsync ({ db, collectionRegex }) {
        /**
         * @type {string[]}
         */
        let collectionNames = [];
        /**
         * @type {import('mongodb').CommandCursor}
         */
        const commandCursor = db.listCollections();
        await commandCursor.forEach(collection => {
            if (this.isNotSystemCollection(collection.name)) {
                collectionNames.push(collection.name);
            }
        });

        if (collectionRegex) {
            collectionNames = collectionNames.filter(c => c.match(collectionRegex) !== null);
        }
        return async.map(
            collectionNames,
            async collectionName => await this.indexCollectionAsync({
                collectionName, db
            })
        );
    }

    /**
     * indexes all collections in this database
     * @param {import('mongodb').Db} db
     * @param {string} collectionName
     * @param {boolean|undefined} filterToProblems
     * @returns {Promise<{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}>}
     */
    async compareCurrentIndexesWithConfigurationInCollectionAsync (
        {
            db,
            collectionName,
            filterToProblems
        }) {
        /**
         * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}}
         */
        const compareIndexesResult = {
            collectionName: collectionName,
            indexes: []
        };

        // now get the current indexes on these collections
        /**
         * @type {{indexes: IndexConfig[], collectionName: string}}
         */
        const currentIndexesForCollection = await this.getIndexesInCollectionAsync({
            collectionName,
            db
        });
        // find missing indexes
        /**
         * @type {{collectionName: string, indexes: IndexConfig[]}}
         */
        const indexesToCreate = await this.getIndexesToCreateForCollectionAsync({ collectionName });
        // find indexes to create that are not present currently
        for (const /** @type {IndexConfig} */ indexConfig of indexesToCreate.indexes) {
            /**
             * @type {IndexConfig[]}
             */
            const indexesMatchingByName = currentIndexesForCollection.indexes.filter(
                i => i.options.name === indexConfig.options.name
            );
            if (indexesMatchingByName.length === 0) {
                compareIndexesResult.indexes.push(
                    {
                        indexConfig: indexConfig,
                        missing: true
                    }
                );
            } else {
                // check if the index configuration has changed
                /**
                 * @type {{keys: Object, options: {name: string, unique?: (boolean|undefined)}, exclude?: (string[]|undefined)}}
                 */
                const indexMatchingByName = indexesMatchingByName[0];
                // compare the keys
                if (
                    !(deepEqual(indexConfig.keys, indexMatchingByName.keys)) ||
                    (
                        (indexConfig.options.unique || indexMatchingByName.options.unique) &&
                        indexConfig.options.unique !== indexMatchingByName.options.unique
                    )
                ) {
                    compareIndexesResult.indexes.push(
                        {
                            indexConfig: indexConfig,
                            changed: true
                        }
                    );
                }
            }
        }
        // find indexes to remove that are present currently but not in configuration
        for (const /** @type {IndexConfig} */ indexConfig of currentIndexesForCollection.indexes) {
            /**
             * @type {IndexConfig[]}
             */
            const indexesMatchingByName = indexesToCreate.indexes.filter(
                i => i.options.name === indexConfig.options.name
            );
            if (indexesMatchingByName.length > 0 || indexConfig.options.name === '_id_') {
                if (!filterToProblems) {
                    compareIndexesResult.indexes.push(
                        {
                            indexConfig: indexConfig
                        }
                    );
                }
            } else {
                compareIndexesResult.indexes.push(
                    {
                        indexConfig: indexConfig,
                        extra: true
                    }
                );
            }
        }

        return compareIndexesResult;
    }

    /**
     * Gets the current indexes on the specified collection
     * @param {string} collectionName
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes: IndexConfig[], collectionName: string}>}
     */
    async getIndexesInCollectionAsync ({ collectionName, db }) {
        // check if index exists
        const indexes = await db.collection(collectionName).indexes();
        return {
            collectionName,
            indexes: indexes.map(i => {
                return {
                    keys: i.key,
                    options: {
                        name: i.name,
                        unique: i.unique
                    }
                };
            })
        };
    }

    /**
     * Deletes the current indexes on the specified collection
     * @param {string} collection_name
     * @param {import('mongodb').Db} db
     * @return {Promise<{indexes:IndexConfig[], name}>}
     */
    async deleteIndexesInCollectionAsync ({ collection_name, db }) {
        await db.collection(collection_name).dropIndexes();
    }

    /**
     * Deletes the provided index on the specified collection
     * @param {string} collectionName
     * @param {import('mongodb').Db} db
     * @param {string} indexName
     * @return {Promise<{indexes:IndexConfig[], name}>}
     */
    async deleteIndexInCollectionAsync ({ collectionName, db, indexName }) {
        const message = `Dropping index ${indexName} from ${collectionName} `;
        await logSystemEventAsync(
            {
                event: 'dropIndex',
                message,
                args: {
                    index: indexName,
                    collection: collectionName,
                    indexName: indexName
                }
            }
        );
        try {
            await db.collection(collectionName).dropIndex(indexName);
        } catch (e) {
            const message1 = 'Error dropping index: ' + indexName + ' for collection ' + collectionName +
                ': ' + JSON.stringify(e);
            await logSystemErrorAsync(
                {
                    event: 'createIndex',
message: message1,
args: {
                        index: indexName,
                        collection: collectionName
                    },
                    error: e
                }
            );
        }
    }

    /**
     * Gets indexes on all the collections
     * @return {Promise<{collectionName: string, indexes: IndexConfig[]}[]>}
     */
    async getIndexesInAllCollectionsAsync () {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(
            await this.mongoDatabaseManager.getClientConfigAsync()
        );
        try {
            /**
             * @type {import('mongodb').Db}
             */
            const db = await this.mongoDatabaseManager.getClientDbAsync();
            const collection_names = [];

            for await (const collection of db.listCollections()) {
                if (this.isNotSystemCollection(collection.name)) {
                    collection_names.push(collection.name);
                }
            }
            // now add indices on id column for every collection
            /**
             * @type {{indexes: IndexConfig[], collectionName: string}[]}
             */
            const collectionIndexes = await async.map(
                collection_names,
                async collectionName => await this.getIndexesInCollectionAsync({ collectionName, db })
            );
            return collectionIndexes
                .sort(
                    (a, b) =>
                        a.collectionName.localeCompare(b.collectionName));
        } finally {
            await this.mongoDatabaseManager.disconnectClientAsync(client);
        }
    }

    /**
     * Gets missingindexes on all the collections
     * @param {boolean} audit
     * @param {boolean} accessLogs
     * @param {boolean|undefined} filterToProblems
     * @return {Promise<{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}[]>}
     */
    async compareCurrentIndexesWithConfigurationInAllCollectionsAsync (
        {
            audit,
            accessLogs,
            filterToProblems
        }
    ) {
        /**
         * @type {import('mongodb').Db}
         */
        const db = audit
            ? await this.mongoDatabaseManager.getAuditDbAsync()
            : accessLogs ? await this.mongoDatabaseManager.getAccessLogsDbAsync()
            : await this.mongoDatabaseManager.getClientDbAsync();

        const collection_names = [];

        for await (const collection of db.listCollections({ type: { $ne: 'view' } })) {
            if (this.isNotSystemCollection(collection.name)) {
                collection_names.push(collection.name);
            }
        }
        // now add indices on id column for every collection
        /**
         * @type {{indexes: {indexConfig: IndexConfig, [missing]:boolean, [extra]: boolean, [changed]: boolean}[], collectionName: string}[]}
         */
        const collectionIndexes = await async.map(
            collection_names,
            async collectionName => await this.compareCurrentIndexesWithConfigurationInCollectionAsync(
                {
                    collectionName,
                    db,
                    filterToProblems
                })
        );
        return collectionIndexes
            .filter(c => !filterToProblems || c.indexes.length > 0)
            .sort(
                (a, b) =>
                    a.collectionName.localeCompare(b.collectionName));
    }

    /**
     * Delete indexes on all the collections
     * @param {string|undefined} [collectionRegex]
     * @return {Promise<*>}
     */
    async deleteIndexesInAllCollectionsAsync ({ collectionRegex }) {
        /**
         * @type {import('mongodb').MongoClient}
         */
        const client = await this.mongoDatabaseManager.createClientAsync(
            await this.mongoDatabaseManager.getClientConfigAsync());
        /**
         * @type {import('mongodb').Db}
         */
        const db = await this.mongoDatabaseManager.getClientDbAsync();
        try {
            await this.deleteIndexesInAllCollectionsInDatabaseAsync({ db, collectionRegex });
        } finally {
            await this.mongoDatabaseManager.disconnectClientAsync(client);
        }
    }

    /**
     * deletes all indexes in database where collection name starts with collectionNameStartsWith
     * @param {import('mongodb').Db} db
     * @param {string|undefined} [collectionRegex]
     * @returns {Promise<void>}
     */
    async deleteIndexesInAllCollectionsInDatabaseAsync ({ db, collectionRegex }) {
        /**
         * @type {string[]}
         */
        let collectionNames = [];

        for await (const collection of db.listCollections()) {
            if (this.isNotSystemCollection(collection.name)) {
                collectionNames.push(collection.name);
            }
        }

        if (collectionRegex) {
            collectionNames = collectionNames.filter(c => c.match(collectionRegex) !== null);
        }

        for await (const collectionName of collectionNames) {
            logInfo('Deleting all indexes in collection', { collectionName });
            await this.deleteIndexesInCollectionAsync({ collection_name: collectionName, db });
        }

        logInfo('Finished deleteIndexesInAllCollections', {});
    }

    /**
     * creates indexes specified in the indexProblem
     * @param {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}} indexProblem
     * @param {import('mongodb').Db} db
     * @returns {Promise<IndexConfig[]>}
     */
    async createCollectionIndexAsync ({ indexProblem, db }) {
        /**
         * @type {IndexConfig[]}
         */
        const indexConfigsCreated = [];

        for (const /** @type {{indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}} */
        index of indexProblem.indexes) {
            // if index is missing or index is changed we must create
            if (index.missing) {
                await this.createIndexIfNotExistsAsync({
                    db,
                    collectionName: indexProblem.collectionName,
                    indexConfig: index.indexConfig
                });

                indexConfigsCreated.push(index.indexConfig);
            }
        }

        return indexConfigsCreated;
    }

    /**
     * drops indexes specified in the indexProblem
     * @param {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}} indexProblem
     * @param {import('mongodb').Db} db
     * @returns {Promise<IndexConfig[]>}
     */
    async dropCollectionIndexAsync ({ indexProblem, db }) {
        /**
         * @type {IndexConfig[]}
         */
        const indexConfigsDropped = [];

        for (const /** @type {{indexConfig: IndexConfig, missing?: boolean, extra?: boolean}} */
        index of indexProblem.indexes) {
            // if the index is extra or changed we must drop it
            if (index.extra) {
                await this.deleteIndexInCollectionAsync({
                    collectionName: indexProblem.collectionName,
                    indexName: index.indexConfig.options.name,
                    db
                });

                indexConfigsDropped.push(index.indexConfig);
            }
        }

        return indexConfigsDropped;
    }

    /**
     * checks for indexes that are to be renamed and renames them
     * @param {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}} indexProblem
     * @param {import('mongodb').Db} db
     * @returns {Promise<{indexConfigsCreated: IndexConfig[], indexConfigsDropped: IndexConfig[]}>}
     */
    async renameIndexes ({ indexProblem, db }) {
        /**
         * @type {{string: string}}
         */
        const configsPresent = {};

        /**
         * @type {IndexConfig[]}
         */
        const indexConfigsCreated = [];

        /**
         * @type {IndexConfig[]}
         */
        const indexConfigsDropped = [];

        for (const index of indexProblem.indexes) {
            const key = JSON.stringify({ keys: index.indexConfig.keys, exclude: index.indexConfig.exclude });
            if (configsPresent[String(key)]) {
                // if this is missing index then we need to drop index present in configsPresent else current
                const indexNameToDrop = index.missing ? configsPresent[String(key)] : index.indexConfig.options.name;

                // if this is missing index then we need to create the index else
                // we change the index name with name present in configsPresent
                const indexConfigToCreate = index.missing ? index.indexConfig : {
                    ...JSON.parse(key),
                    options: {
                        name: configsPresent[String(key)]
                    }
                };

                // drop the old index first
                await this.deleteIndexInCollectionAsync({
                    collectionName: indexProblem.collectionName,
                    indexName: indexNameToDrop,
                    db
                });

                indexConfigsDropped.push({
                    keys: index.indexConfig.keys,
                    options: {
                        name: indexNameToDrop
                    }
                });

                // create the index with new name
                await this.createIndexIfNotExistsAsync({
                    collectionName: indexProblem.collectionName,
                    indexConfig: indexConfigToCreate,
                    db
                });

                indexConfigsCreated.push(indexConfigToCreate);
            } else {
                configsPresent[String(key)] = index.indexConfig.options.name;
            }
        }
        return { indexConfigsCreated, indexConfigsDropped };
    }

    /**
     * adds any indexes missing from config and removes any indexes not in config
     * @param {boolean} [audit]
     * @param {boolean} [accessLogs]
     * @param {string[]} collections
     * @returns {Promise<{created: {indexes: IndexConfig[], collectionName: string}[],dropped: {indexes: IndexConfig[], collectionName: string}[]}>}
     */
    async synchronizeIndexesWithConfigAsync ({ audit = false, accessLogs = false, collections = ['all'] }) {
        /**
         * @type {{indexes: IndexConfig[], collectionName: string}[]}
         */
        const collectionIndexesCreated = [];
        /**
         * @type {{indexes: IndexConfig[], collectionName: string}[]}
         */
        const collectionIndexesDropped = [];

        /**
         * @type {import('mongodb').Db}
         */
        const db = audit
            ? await this.mongoDatabaseManager.getAuditDbAsync()
            : accessLogs ? await this.mongoDatabaseManager.getAccessLogsDbAsync()
            : await this.mongoDatabaseManager.getClientDbAsync();

        /**
         * @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}[]}
         */
        const indexProblems = await this.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
            audit,
            accessLogs,
            filterToProblems: true
        });

        for (
            const /** @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}} */
            indexProblem of indexProblems
        ) {
            assertIsValid(indexProblem.collectionName);

            if ((collections.length > 0 && collections[0] === 'all') ||
                collections.includes(indexProblem.collectionName)) {
                // synchronize the name of the indexes first to avoid creating indexes with same config
                let { indexConfigsCreated, indexConfigsDropped } = await this.renameIndexes({ indexProblem, db });

                // missing indexes needs to be created
                const createdIndexes = await this.addMissingIndexesAsync({ audit, accessLogs, collections: [indexProblem.collectionName] });
                if (createdIndexes.created.length > 0) {
                    indexConfigsCreated = [
                        ...indexConfigsCreated, ...(createdIndexes.created[0].indexes)
                    ];
                }

                // extra indexes needs to be dropped
                const droppedIndexes = await this.dropExtraIndexesAsync({ audit, accessLogs, collections: [indexProblem.collectionName] });
                if (droppedIndexes.dropped.length > 0) {
                    indexConfigsDropped = [
                        ...indexConfigsDropped, ...(droppedIndexes.dropped[0].indexes)
                    ];
                }

                // changed indexes needs to be dropped and created with new configurations
                for (const index of indexProblem.indexes) {
                    if (index.changed) {
                        await this.deleteIndexInCollectionAsync({
                            collectionName: indexProblem.collectionName,
                            indexName: index.indexConfig.options.name,
                            db
                        });

                        indexConfigsDropped.push(index.indexConfig);

                        await this.createIndexIfNotExistsAsync({
                            collectionName: indexProblem.collectionName,
                            indexConfig: index.indexConfig,
                            db
                        });

                        indexConfigsCreated.push(index.indexConfig);
                    }
                }

                if (indexConfigsCreated.length) {
                    collectionIndexesCreated.push({
                        collectionName: indexProblem.collectionName,
                        indexes: indexConfigsCreated
                    });
                }

                if (indexConfigsDropped.length) {
                    collectionIndexesDropped.push({
                        collectionName: indexProblem.collectionName,
                        indexes: indexConfigsDropped
                    });
                }
            }
        }

        return {
            created: collectionIndexesCreated,
            dropped: collectionIndexesDropped
        };
    }

    /**
     * Adds any index missing from the config
     * @param {boolean} [audit]
     * @param {boolean} [accessLogs]
     * @param {string[]} collections
     * @returns {Promise<{created: {indexes: IndexConfig[], collectionName: string}[]}>}
     */
    async addMissingIndexesAsync ({ audit = false, accessLogs = false, collections = ['all'] }) {
        /**
         * @type {{indexes: IndexConfig[], collectionName: string}[]}
         */
        const collectionIndexesCreated = [];

        /**
         * @type {import('mongodb').Db}
         */
        const db = audit
            ? await this.mongoDatabaseManager.getAuditDbAsync()
            : accessLogs ? await this.mongoDatabaseManager.getAccessLogsDbAsync()
            : await this.mongoDatabaseManager.getClientDbAsync();

        /**
         * @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}[]}
         */
        const indexProblems = await this.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
            audit,
            accessLogs,
            filterToProblems: true
        });

        for (
            const /** @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}} */
            indexProblem of indexProblems
        ) {
            assertIsValid(indexProblem.collectionName);

            if ((collections.length > 0 && collections[0] === 'all') ||
                collections.includes(indexProblem.collectionName)) {
                const indexConfigsCreated = await this.createCollectionIndexAsync({ indexProblem, db });

                if (indexConfigsCreated.length) {
                    collectionIndexesCreated.push({
                        collectionName: indexProblem.collectionName,
                        indexes: indexConfigsCreated
                    });
                }
            }
        }

        return {
            created: collectionIndexesCreated
        };
    }

    /**
     * drops any indexes not in config
     * @param {boolean} [audit]
     * @param {boolean} [accessLogs]
     * @param {string[]} collections
     * @returns {Promise<{dropped: {indexes: IndexConfig[], collectionName: string}[]}>}
     */
    async dropExtraIndexesAsync ({ audit = false, accessLogs = false, collections = ['all'] }) {
        /**
         * @type {{indexes: IndexConfig[], collectionName: string}[]}
         */
        const collectionIndexesDropped = [];

        /**
         * @type {import('mongodb').Db}
         */
        const db = audit
            ? await this.mongoDatabaseManager.getAuditDbAsync()
            : accessLogs ? await this.mongoDatabaseManager.getAccessLogsDbAsync()
            : await this.mongoDatabaseManager.getClientDbAsync();

        /**
         * @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}[]}
         */
        const indexProblems = await this.compareCurrentIndexesWithConfigurationInAllCollectionsAsync({
            audit,
            accessLogs,
            filterToProblems: true
        });

        for (
            const /** @type {{indexes: {indexConfig: IndexConfig, missing?: boolean, extra?: boolean, [changed]: boolean}[], collectionName: string}} */
            indexProblem of indexProblems
        ) {
            assertIsValid(indexProblem.collectionName);

            if ((collections.length > 0 && collections[0] === 'all') ||
                collections.includes(indexProblem.collectionName)) {
                const indexConfigsDropped = await this.dropCollectionIndexAsync({ indexProblem, db });

                if (indexConfigsDropped.length) {
                    collectionIndexesDropped.push({
                        collectionName: indexProblem.collectionName,
                        indexes: indexConfigsDropped
                    });
                }
            }
        }

        return {
            dropped: collectionIndexesDropped
        };
    }

    /**
     * Check if a collection is system collection or not
     * @param {String} collectionName
     * @returns {boolean}
     */
    isNotSystemCollection (collectionName) {
        const systemCollectionNames = ['system.', 'fs.files', 'fs.chunks'];
        return !systemCollectionNames.some(systemCollectionName => collectionName.indexOf(systemCollectionName) !== -1);
    }
}

module.exports = {
    IndexManager
};
