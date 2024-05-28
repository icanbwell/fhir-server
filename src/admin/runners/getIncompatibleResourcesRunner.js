const fs = require('fs');
const { DatabaseQueryFactory } = require('../../dataLayer/databaseQueryFactory');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { RethrownError } = require('../../utils/rethrownError');
const { isUuid } = require('../../utils/uid.util');
const { validateResource } = require('../../utils/validator.util');

class GetIncompatibleResourcesRunner extends BaseBulkOperationRunner {
    /**
     * constructor
     * @typedef {Object} ConstructorParams
     * @property {DatabaseQueryFactory} databaseQueryFactory
     * @property {string[]} collections
     * @property {string|undefined} startFromCollection
     * @property {number|undefined} limit
     * @property {string|undefined} skip
     * @property {string|undefined} startFromId
     * @property {string|undefined} afterLastUpdatedDate
     * @property {string|undefined} beforeLastUpdatedDate
     * @property {Object} args
     *
     * @param {ConstructorParams}
     */
    constructor({
        databaseQueryFactory,
        collections,
        startFromCollection,
        limit,
        skip,
        startFromId,
        afterLastUpdatedDate,
        beforeLastUpdatedDate,
        ...args
    }) {
        super(args);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        /**
         * @type {string[]}
         */
        this.collections = collections;

        /**
         * @type {string|undefined}
         */
        this.startFromCollection = startFromCollection;

        /**
         * @type {number|undefined}
         */
        this.limit = limit;

        /**
         * @type {string|undefined}
         */
        this.skip = skip;

        /**
         * @type {string|undefined}
         */
        this.startFromId = startFromId;

        /**
         * @type {string|undefined}
         */
        this.afterLastUpdatedDate = afterLastUpdatedDate;

        /**
         * @type {string|undefined}
         */
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;
    }

    /**
     * Main process
     */
    async processAsync() {
        try {
            if (this.collections.length > 0 && this.collections[0] === 'all') {
                this.collections = await this.getAllCollectionNamesAsync({
                    useAuditDatabase: false,
                    includeHistoryCollections: false
                });
                this.collections = this.collections.sort();
                if (this.startFromCollection) {
                    this.collections = this.collections.filter(
                        (c) => c >= this.startFromCollection
                    );
                }
            }

            // create directory to store validation errors for all resources
            try {
                fs.mkdirSync('validationErrors');
            } catch (err) {
                // if folder exists then continue
                if (err.code === 'EEXIST') {
                    this.adminLogger.logInfo('Directory already exists');
                } else {
                    throw err;
                }
            }

            for (const collectionName of this.collections) {
                this.adminLogger.logInfo(`Processing ${collectionName} collection`);
                await this.validateCollectionAsync(collectionName);
                this.adminLogger.logInfo(`Finished processing ${collectionName} collection`);
            }
        } catch (err) {
            this.adminLogger.logError(`ERROR: ${err.message}`, { stack: err.stack });
        }
    }

    /**
     * Validates collection documents one by one
     * @param {string} collectionName
     */
    async validateCollectionAsync(collectionName) {
        try {
            const resourceType = collectionName.replace('_4_0_0', '');

            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType,
                base_version: '4_0_0'
            });

            const query = this.getQueryFromParams();

            const cursor = await databaseQueryManager.findAsync({
                query,
                options: {
                    skip: this.skip,
                    limit: this.limit
                }
            });

            this.writeStream = fs.createWriteStream(`./validationErrors/${resourceType}-errors.csv`, { flags: 'w' });
            this.writeStream.write('ResourceType| ResourceId| ValidationOperationOutcome|\n');

            while (await cursor.hasNext()) {
                const resource = await cursor.next();

                this.adminLogger.logInfo(`Processing ${resourceType}/${resource._uuid}`);

                // Use toJSON to remove all the underscore fields
                const resourceJson = resource.toJSON();

                // delete meta.lastUpdated as this field is converted to date type but requires string type for validation
                delete resourceJson.meta.lastUpdated;

                const validationOperationOutcome = validateResource({
                    resourceBody: resourceJson,
                    resourceName: resourceType,
                    path: resourceType
                });

                if (validationOperationOutcome) {
                    this.writeStream.write(`${resourceType}| ${resource._uuid}| ${JSON.stringify(validationOperationOutcome)}|\n`);
                }
            }

            this.writeStream.close();
            return new Promise((r) => this.writeStream.on('close', r));
        } catch (err) {
            throw new RethrownError({
                message: `Error in validateCollection: ${err.message}`,
                error: err,
                args: {
                    collectionName
                }
            });
        }
    }

    /**
     * Returns query based on the params passed
     */
    getQueryFromParams() {
        let query = {};

        if (this.beforeLastUpdatedDate && this.afterLastUpdatedDate) {
            query = {
                'meta.lastUpdated': {
                    $gt: this.afterLastUpdatedDate,
                    $lt: this.beforeLastUpdatedDate
                }
            };
        } else if (this.beforeLastUpdatedDate) {
            query = {
                'meta.lastUpdated': {
                    $lt: this.beforeLastUpdatedDate
                }
            };
        } else if (this.afterLastUpdatedDate) {
            query = {
                'meta.lastUpdated': {
                    $gt: this.afterLastUpdatedDate
                }
            };
        }

        if (this.startFromId) {
            if (Object.keys(query).length > 0) {
                query = {
                    $and: [
                        query,
                        { [isUuid(this.startFromId) ? '_uuid' : '_sourceId']: this.startFromId }
                    ]
                };
            } else {
                query = { [isUuid(this.startFromId) ? '_uuid' : '_sourceId']: this.startFromId };
            }
        }

        return query;
    }
}

module.exports = { GetIncompatibleResourcesRunner };
