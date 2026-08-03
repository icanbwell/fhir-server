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
const { Base64DataManager } = require('./base64DataManager');
const deepcopy = require('deepcopy');
const { logInfo } = require('../operations/common/logging');

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
         * Used to reconcile this request's own externalized base64 payload change against the
         * generic merge/diff, and to clean up superseded/orphaned live-bucket objects.
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
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
            // Snapshot the live-object refs of the version we're about to supersede so the
            // post-commit cleanup deletes the right objects (path-aware, per configured leaf).
            // Re-captured on each retry re-read so a concurrent writer moving the DB forward doesn't
            // leave us cleaning up a stale version.
            let previousLiveRefs = this.base64DataManager.getLiveObjectRefs(resourceInDatabase);
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
            updatedResource = await this.base64DataManager.resolveWriteForExternalizedDataChange(
                updatedResource, resourceInDatabase, requestInfo, this._forceBase64Write
            );
            if (!updatedResource) {
                return { savedResource: null, patches: null };
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
                    // A concurrent writer moved the DB forward — refresh the snapshot so we clean up
                    // the version the next attempt actually supersedes.
                    previousLiveRefs = this.base64DataManager.getLiveObjectRefs(resourceInDatabase);

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
                        updatedResource = await this.base64DataManager.resolveWriteForExternalizedDataChange(
                            updatedResource, resourceInDatabase, requestInfo, this._forceBase64Write
                        );
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
                    await this.base64DataManager.deleteSupersededLiveObjectsAsync(doc, previousLiveRefs);
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
            // Write failed after we may have uploaded fresh live keys. Delete only the keys THIS
            // request created — never committed, so nothing references them; unchanged leaves still
            // point at a committed prior version and must be left alone.
            await this.base64DataManager.deleteOwnUploadedLiveObjectsAsync(doc, requestInfo);
            throw new RethrownError({
                error: e
            });
        }
    }

    /**
     * Force-write strategy for `resolveWriteForExternalizedDataChange`: a version-bumped copy of the
     * current DB resource, used when the diff saw no field change but this request's externalized
     * data still diverges (the divergent leaf is reconciled onto it afterward). Built from
     * `currentResource` because a null diff means the non-`data` fields already match. Arrow field to
     * keep `this` bound; uses `fastUpdateMeta` + `deepcopy` (the plain-object flavor).
     * @param {Object} currentResource
     * @returns {Object}
     * @private
     */
    _forceBase64Write = (currentResource) => this.resourceMerger.fastUpdateMeta({
        patched_resource_incoming: deepcopy(currentResource),
        currentResource,
        original_source: currentResource?.meta?.source,
        incrementVersion: true
    });
}

module.exports = {
    FastDatabaseUpdateManager
};
