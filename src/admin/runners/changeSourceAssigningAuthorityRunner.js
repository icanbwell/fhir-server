const { RethrownError } = require('../../utils/rethrownError');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { FixReferenceIdRunner } = require('./fixReferenceIdRunner');
const { assertIsValid } = require('../../utils/assertType');
const { ReferenceParser } = require('../../utils/referenceParser');

/**
 * @classdesc Changes sourceAssigningAuthority of the resource
 */
class ChangeSourceAssigningAuthorityRunner extends FixReferenceIdRunner {
    /**
     * @param {Object} args
     * @param {string} oldSourceAssigningAuthority
     * @param {string} newSourceAssigningAuthority
     */
    constructor({ oldSourceAssigningAuthority, newSourceAssigningAuthority, ...args }) {
        super(args);

        /**
         * @type {string}
         */
        this.oldSourceAssigningAuthority = oldSourceAssigningAuthority;
        assertIsValid(typeof oldSourceAssigningAuthority === 'string', 'oldSourceAssigningAuthority must be a string');

        /**
         * @type {boolean}
         */
        this.newSourceAssigningAuthority = newSourceAssigningAuthority;
        assertIsValid(typeof oldSourceAssigningAuthority === 'string', 'newSourceAssigningAuthority is not a string');
    }

    /**
     * Updates the resource with new sourceAssigningAuthority
     * @param {Resource} resource
     * @returns {Promise<Resource>}
     */
    async updateRecordAsync(resource) {
        if (resource.meta?.security) {
            resource.meta.security = resource.meta.security.map(security => {
                if (security.code && security.code === this.oldSourceAssigningAuthority) {
                    security.code = this.newSourceAssigningAuthority;
                }
                return security;
            });
        }

        // iterate over all the references of the resource and update sourceAssigningAuthority
        // of the references which are same as oldSourceAssigningAuthority
        await resource.updateReferencesAsync(
            {
                fnUpdateReferenceAsync: async (reference) => {
                    if (reference?.reference) {
                        const {id, sourceAssigningAuthority, resourceType} = ReferenceParser.parseReference(reference.reference);
                        if (sourceAssigningAuthority) {
                            reference.reference = ReferenceParser.createReference({
                                id, sourceAssigningAuthority, resourceType
                            });
                        } else if (reference._sourceAssigningAuthority === this.oldSourceAssigningAuthority) {
                            reference._sourceAssigningAuthority = this.newSourceAssigningAuthority;
                        }
                    }
                }
            }
        );

        // run preSave to update all the fields according to new values
        await this.preSaveManager.preSaveAsync(resource);

        return resource;
    }

    /**
     * Adds meta.security index to the collection
     * @param {string} collectionName
     * @param {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}} mongoConfig
     * @returns {Promise<void>}
     */
    async addIndexesToCollection({ collectionName, mongoConfig }) {
        const { collection, session, client } = await this.createSingeConnectionAsync({ mongoConfig, collectionName });

        const indexName = 'fixChangeSourceAssigningAuthorityRunner_meta.security_1';

        try {
            if (!await collection.indexExists(indexName)) {
                this.adminLogger.logInfo(`Creating index ${indexName} for collection ${collectionName}`);

                await collection.createIndex(
                    {
                        'resource.meta.security.system': 1,
                        'resource.meta.security.code': 1,
                        '_id': 1
                    },
                    {
                        name: indexName
                    }
                );
            }
        } catch (e) {
            // if index already exists with different name then continue
            if (e.code === 85) {
                this.adminLogger.logInfo(`${indexName} already exists in collection ${collectionName} with different name`);
            } else {
                throw new RethrownError(
                    {
                        message: `Error creating indexes for collection ${collectionName}, ${e.message}`,
                        error: e,
                        source: 'ChangeSourceAssigningAuthorityRunner.addIndexesToCollection'
                    }
                );
            }
        } finally {
            await session.endSession();
            await client.close();
        }
    }

    /**
     * Runs a loop to process all the documents
     * @returns {Promise<void>}
     */
    async processAsync() {
        // noinspection JSValidateTypes
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                /**
                 * @type {string[]}
                 */
                this.collections = ['Person_4_0_0', 'Person_4_0_0_History'];

                if (this.startFromCollection) {
                    this.collections = this.collections.filter(c => c >= this.startFromCollection);
                }
            }

            await this.init();

            /**
             * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
             */
            const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();

            try {
                for (const collectionName of this.collections) {
                    this.adminLogger.logInfo(`Starting reference update for ${collectionName}`);
                    /**
                     * @type {boolean}
                     */
                    const isHistoryCollection = collectionName.includes('_History');
                    /**
                     * @type {import('mongodb').Filter<import('mongodb').Document>}
                     */
                    const query = this.getQueryForResource(isHistoryCollection);

                    if (isHistoryCollection) {
                        await this.addIndexesToCollection({collectionName, mongoConfig});
                    }

                    const startFromIdContainer = this.createStartFromIdContainer();

                    try {
                        this.adminLogger.logInfo(`query: ${mongoQueryStringify(query)}`);

                        await this.runForQueryBatchesAsync({
                            config: mongoConfig,
                            sourceCollectionName: collectionName,
                            destinationCollectionName: collectionName,
                            query,
                            startFromIdContainer,
                            fnCreateBulkOperationAsync: async (doc) =>
                                await this.processRecordAsync(doc, this.updateRecordAsync),
                            ordered: false,
                            batchSize: this.batchSize,
                            skipExistingIds: false,
                            limit: this.limit,
                            useTransaction: this.useTransaction,
                            skip: this.skip
                        });

                    } catch (e) {
                        this.adminLogger.logError(`Got error ${e}.  At ${startFromIdContainer.startFromId}`);
                        throw new RethrownError(
                            {
                                message: `Error processing ids of collection ${collectionName} ${e.message}`,
                                error: e,
                                args: {
                                    query
                                },
                                source: 'ChangeSourceAssigningAuthorityRunner.processAsync'
                            }
                        );
                    }
                }
            } catch (err) {
                this.adminLogger.logError(err.message, { stack: err.stack });
            }

            if (this.logUnresolvedReferencesToFile) {
                this.writeStream.write('}\n');
            }
            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo('Shutting down');
            await this.shutdown();
            this.adminLogger.logInfo('Shutdown finished');
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e.message}`, { stack: e.stack });
        }
    }

    /**
     * Get query for the resources whose id might change
     * @param {boolean} isHistoryCollection
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQueryForResource(isHistoryCollection) {
        // create a query from the parameters
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        let query = this.getQueryFromParameters({ queryPrefix: isHistoryCollection ? 'resource.' : '' });

        /**
         * @type {string}
         */
        const queryPrefix = isHistoryCollection ? 'resource.' : '';

        // query to get resources that needs to be changes
        /**
         * @type {import('mongodb').Filter<import('mongodb').Document>}
         */
        const filterQuery = {
            [`${queryPrefix}meta.security`]: {
                $elemMatch: {
                    'system': SecurityTagSystem.owner,
                    'code': 'rise'
                }
            }
        };

        // merge query and filterQuery
        if (Object.keys(query).length) {
            query = {
                $and: [query, filterQuery]
            };
        } else {
            query = filterQuery;
        }

        return query;
    }
}

module.exports = {
    ChangeSourceAssigningAuthorityRunner
};
