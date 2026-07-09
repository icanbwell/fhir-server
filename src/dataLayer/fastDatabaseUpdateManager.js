/**
 * This class manages inserts and updates to the database
 */
const { assertTypeEquals } = require('../utils/assertType');
const { ConfigManager } = require('../utils/configManager');
const { DatabaseQueryFactory } = require('./databaseQueryFactory');
const { FhirRequestInfo } = require('../utils/fhirRequestInfo');
const { logTraceSystemEventAsync } = require('../operations/common/systemEventLogging');
const { PreSaveManager } = require('../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../preSaveHandlers/preSaveOptions');
const { ReadPreference } = require('mongodb');
const { ResourceLocatorFactory } = require('../operations/common/resourceLocatorFactory');
const { ResourceMerger } = require('../operations/common/resourceMerger');
const { RethrownError } = require('../utils/rethrownError');
const deepcopy = require('deepcopy');
const { logInfo, logError } = require('../operations/common/logging');

class FastDatabaseUpdateManager {
    /**
     * Constructor
     * @param {ResourceLocatorFactory} resourceLocatorFactory
     * @param {ResourceMerger} resourceMerger
     * @param {PreSaveManager} preSaveManager
     * @param {string} resourceType
     * @param {string} base_version
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor({
        resourceLocatorFactory,
        resourceMerger,
        preSaveManager,
        resourceType,
        base_version,
        databaseQueryFactory,
        configManager,
        base64DataManager
    }) {
        assertTypeEquals(resourceLocatorFactory, ResourceLocatorFactory);
        /**
         * @type {string}
         * @private
         */
        this._resourceType = resourceType;
        /**
         * @type {string}
         * @private
         */
        this._base_version = base_version;
        /**
         * @type {ResourceLocator}
         */
        this.resourceLocator = resourceLocatorFactory.createResourceLocator({
            resourceType: this._resourceType,
            base_version: this._base_version
        });

        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);

        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);

        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);

        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        /**
         * Used to re-upload changed base64 payloads to the live key before each retry commit,
         * so concurrent writes to the same resource converge (see Base64DataManager §17).
         * @type {import('./base64DataManager').Base64DataManager|undefined}
         */
        this.base64DataManager = base64DataManager;
    }

    /**
     * Inserts a resource into the database
     * @param {Object} params
     * @param {Object} params.doc
     * @param {FhirRequestInfo} [params.requestInfo]
     * @return {Promise<Object>}
     */
    async insertOneAsync({ doc, requestInfo }) {
        try {
            const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
            doc = await this.preSaveManager.preSaveAsync({ resource: doc, options: preSaveOptions });
            const collection = await this.resourceLocator.getCollectionForResourceAsync(doc);
            if (!doc.meta.versionId || isNaN(parseInt(doc.meta.versionId))) {
                doc.meta.versionId = '1';
            }
            await collection.insertOne(doc);
            return doc;
        } catch (e) {
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Inserts a resource into the database
     * Return value of null means no replacement was necessary since the data in the db is the same
     * @param {string} base_version
     * @param {FhirRequestInfo} requestInfo
     * @param {Object} doc
     * @param {Boolean} [smartMerge]
     * @return {Promise<{savedResource: Object|null, patches: MergePatchEntry[]|null}>}
     */
    async replaceOneAsync({ base_version, requestInfo, doc, smartMerge = true }) {
        assertTypeEquals(requestInfo, FhirRequestInfo);
        const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
        doc = await this.preSaveManager.preSaveAsync({ resource: doc, options: preSaveOptions });

        /**
         * @type {import('mongodb').FindOptions}
         */
        const findQueryOptions = { readPreference: ReadPreference.PRIMARY };

        try {
            /**
             * @type {import('mongodb').Collection<import('mongodb').DefaultSchema>}
             */
            const collection = await this.resourceLocator.getCollectionForResourceAsync(doc);

            const databaseQueryManager = this.databaseQueryFactory.createQuery({
                resourceType: doc.resourceType,
                base_version: '4_0_0'
            });
            /**
             * @type {Object|null}
             */
            let resourceInDatabase = await databaseQueryManager.fastFindOneAsync({
                query: { _uuid: doc._uuid },
                options: findQueryOptions
            });
            await logTraceSystemEventAsync({
                event: 'replaceOneAsync' + `_${doc.resourceType}`,
                message: 'Found existing resource',
                args: {
                    id: doc.id,
                    uuid: doc._uuid,
                    resourceType: doc.resourceType,
                    doc,
                    resourceInDatabase
                }
            });
            if (!resourceInDatabase) {
                return { savedResource: await this.insertOneAsync({ doc, requestInfo }), patches: null };
            }
            /**
             * @type {Object|null}
             */
            let { updatedResource, patches } = await this.resourceMerger.fastMergeResourceAsync({
                base_version,
                requestInfo,
                currentResource: resourceInDatabase,
                resourceToMerge: doc,
                smartMerge
            });
            if (!updatedResource) {
                return { savedResource: null, patches: null }; // nothing to do
            }
            doc = updatedResource;
            /**
             * @type {number}
             */
            let runsLeft = this.configManager.replaceRetries || 10;
            const originalDatabaseVersion = parseInt(doc.meta.versionId);
            while (runsLeft > 0) {
                const updatedDoc = await this.preSaveManager.preSaveAsync({ resource: deepcopy(doc), options: preSaveOptions });
                const previousVersionId = parseInt(updatedDoc.meta.versionId) - 1;
                const filter =
                    previousVersionId > 0
                        ? { $and: [{ _uuid: updatedDoc._uuid }, { 'meta.versionId': `${previousVersionId}` }] }
                        : { _uuid: updatedDoc._uuid };
                // Re-upload any base64 payload this request is changing so the live object holds
                // our bytes at commit time (converges concurrent writes on the shared live key).
                if (this.base64DataManager) {
                    await this.base64DataManager.reuploadChangedToLiveAsync(updatedDoc, requestInfo);
                }
                const updateResult = await collection.replaceOne(filter, updatedDoc);
                logInfo("Retrying resource merge due to concurrent update request", {
                    id: updatedDoc.id,
                    uuid: updatedDoc._uuid,
                    versionId: updatedDoc.meta.versionId,
                    resourceType: updatedDoc.resourceType,
                    sourceAssigningAuthority: updatedDoc._sourceAssigningAuthority,
                    originService: requestInfo.headers['origin-service'] || 'unknown'
                });
                await logTraceSystemEventAsync({
                    event: 'replaceOneAsync: Merging' + `_${updatedDoc.resourceType}`,
                    message: 'Merging existing resource',
                    args: {
                        id: updatedDoc.id,
                        uuid: updatedDoc._uuid,
                        resourceType: updatedDoc.resourceType,
                        updatedDoc,
                        resourceInDatabase,
                        patches,
                        updatedResource,
                        updateResult
                    }
                });
                if (updateResult.matchedCount === 0) {
                    // if not result matched then the versionId has changed in the database
                    // Get the latest version from the database and merge again
                    /**
                     * @type {Object|null}
                     */
                    resourceInDatabase = await databaseQueryManager.fastFindOneAsync({
                        query: { _uuid: doc._uuid },
                        options: findQueryOptions
                    });

                    if (resourceInDatabase === null) {
                        throw new Error(`Unable to read resource ${doc.resourceType}/${doc._uuid} from database`);
                    } else {
                        // merge with our resource
                        ({ updatedResource, patches } = await this.resourceMerger.fastMergeResourceAsync({
                            base_version,
                            requestInfo,
                            currentResource: resourceInDatabase,
                            resourceToMerge: doc
                        }));
                        if (updatedResource) {
                            doc = updatedResource;
                        } else {
                            return { savedResource: null, patches: null };
                        }
                    }
                    runsLeft -= 1;
                    await logTraceSystemEventAsync({
                        event: 'replaceOneAsync',
                        message: 'retry'
                    });
                } else {
                    // save was successful
                    await logTraceSystemEventAsync({
                        event: 'replaceOneAsync: Merged' + `_${doc.resourceType}`,
                        message: 'Successful merged existing resource',
                        args: {
                            id: doc.id,
                            uuid: doc._uuid,
                            resourceType: doc.resourceType,
                            doc,
                            resourceInDatabase,
                            patches,
                            updatedResource,
                            updateResult,
                            runsLeft
                        }
                    });
                    return { savedResource: doc, patches };
                }
            }
            if (runsLeft <= 0) {
                throw new Error(
                    `Unable to save resource ${doc.resourceType}/${doc._uuid} with version ${doc.meta.versionId} ` +
                        `(original=${originalDatabaseVersion}) after 10 tries.`
                );
            }
        } catch (e) {
            // The Mongo write failed (retry exhaustion or hard error) after we may have written
            // this request's payload to the live bucket. Roll it back — the revert is ETag-gated
            // (If-Match on what we wrote), so it only undoes our own write and never clobbers a
            // concurrent winner's committed bytes.
            if (this.base64DataManager) {
                try {
                    await this.base64DataManager.revertLiveAsync(doc, requestInfo);
                } catch (revertErr) {
                    logError('Failed to revert base64 live object after write failure', {
                        args: { source: 'FastDatabaseUpdateManager', error: revertErr }
                    });
                }
            }
            throw new RethrownError({
                error: e
            });
        }
    }
}

module.exports = {
    FastDatabaseUpdateManager
};
