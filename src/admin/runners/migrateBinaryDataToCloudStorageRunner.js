const { ObjectId } = require('mongodb');
const async = require('async');
const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { CloudStorageClient } = require('../../utils/cloudStorageClient');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { BaseScriptRunner } = require('./baseScriptRunner');
const { computeContentHashAsync } = require('../../utils/contentHash');
const { RethrownError } = require('../../utils/rethrownError');

class MigrateBinaryDataToCloudStorageRunner extends BaseScriptRunner {
    constructor ({
        mongoDatabaseManager,
        adminLogger,
        batchSize,
        concurrency,
        thresholdKB,
        startId,
        count,
        fromDate,
        toDate,
        dryRun,
        base64FieldCloudStorageClient,
        configManager
    }) {
        super({ adminLogger, mongoDatabaseManager });

        this.batchSize = batchSize;
        this.concurrency = concurrency;
        this.thresholdKB = thresholdKB;

        if (startId && !isValidMongoObjectId(startId)) {
            throw new Error(`Invalid startId: ${startId}`);
        }
        this.startId = startId;

        this.count = count;

        if (fromDate && Number.isNaN(new Date(fromDate).getTime())) {
            throw new Error(`Invalid fromDate: ${fromDate}`);
        }
        this.fromDate = fromDate;

        if (toDate && Number.isNaN(new Date(toDate).getTime())) {
            throw new Error(`Invalid toDate: ${toDate}`);
        }
        this.toDate = toDate;

        this.dryRun = dryRun;

        this.base64FieldCloudStorageClient = base64FieldCloudStorageClient;
        if (!this.dryRun) {
            assertTypeEquals(base64FieldCloudStorageClient, CloudStorageClient);
        }

        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);

        this.MAX_VERSION_CONFLICT_RETRIES = 3;

        this.currentBatch = [];
        this.batchCount = 1;
        this.lastProcessedId = null;
        this.lastProcessedUuid = null;

        this.documentsMigrated = 0;
        this.documentsSkippedAlreadyHandled = 0;
        this.documentsSkippedDeleted = 0;
        this.documentsVersionConflictRetries = 0;
        this.documentsOrphanCleanups = 0;
        this.documentsFailed = 0;
        this.documentsSkippedKeyCollision = 0;
        this.documentsSkippedInvalidLastUpdated = 0;
        this.documentsSkippedBelowThreshold = 0;
        this.bytesMoved = 0;
    }

    _buildQuery () {
        const idFilter = {};

        if (this.startId) {
            idFilter.$gt = new ObjectId(this.startId);
        }
        if (this.fromDate) {
            const fromId = ObjectId.createFromTime(Math.floor(new Date(this.fromDate).getTime() / 1000));
            idFilter.$gt = idFilter.$gt && idFilter.$gt > fromId ? idFilter.$gt : fromId;
        }
        if (this.toDate) {
            idFilter.$lt = ObjectId.createFromTime(Math.floor(new Date(this.toDate).getTime() / 1000));
        }

        return {
            data: { $exists: true, $type: 'string' },
            _blobMeta: { $exists: false },
            ...(Object.keys(idFilter).length ? { _id: idFilter } : {})
        };
    }

    _exceedsThreshold (data) {
        if (typeof data !== 'string') {
            return false;
        }
        return Buffer.byteLength(data, 'utf8') > this.thresholdKB * 1024;
    }

    _toEpochMs (value) {
        if (!value) {
            return null;
        }
        const date = value instanceof Date ? value : new Date(value);
        const ms = date.getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    _buildLiveKey (uuid, lastUpdatedMs) {
        return `Binary_4_0_0/${uuid}/${lastUpdatedMs}`;
    }

    async processRecordAsync (doc, collection) {
        let current = doc;
        for (let attempt = 1; attempt <= this.MAX_VERSION_CONFLICT_RETRIES; attempt++) {
            if (current._blobMeta) {
                this.documentsSkippedAlreadyHandled += 1;
                return;
            }

            if (!this._exceedsThreshold(current.data)) {
                this.documentsSkippedBelowThreshold += 1;
                return;
            }

            const rawSize = Math.ceil(Buffer.byteLength(current.data, 'utf8') / 1024);

            if (this.dryRun) {
                this.documentsMigrated += 1;
                this.bytesMoved += rawSize * 1024;
                this.adminLogger.logInfo(
                    `[DRY RUN] resource with _uuid: ${current._uuid} would be migrated (${rawSize} KB)`
                );
                return;
            }

            const lastUpdatedMs = this._toEpochMs(current.meta.lastUpdated);
            if (lastUpdatedMs === null) {
                this.documentsSkippedInvalidLastUpdated += 1;
                this.adminLogger.logError(
                    `Cannot migrate _uuid ${current._uuid}: meta.lastUpdated is missing or unparseable`
                );
                return;
            }

            const hash = await computeContentHashAsync(current.data);
            const liveKey = this._buildLiveKey(current._uuid, lastUpdatedMs);

            let uploadResponse;
            try {
                uploadResponse = await this.base64FieldCloudStorageClient.uploadAsync({
                    filePath: liveKey, data: Buffer.from(current.data, 'utf8'), ifNoneMatch: true
                });
            } catch (err) {
                this.documentsFailed += 1;
                this.adminLogger.logError(`Upload failed for _uuid ${current._uuid}: ${err.message}`);
                return;
            }

            if (uploadResponse === null) {
                this.documentsSkippedKeyCollision += 1;
                this.adminLogger.logError(
                    `Live key collision for _uuid ${current._uuid} at ${liveKey}: an object already exists at this path and was not overwritten. Skipping.`
                );
                return;
            }

            try {
                const result = await collection.updateOne(
                    { _id: { $eq: current._id }, 'meta.versionId': { $eq: current.meta.versionId } },
                    { $set: { _blobMeta: { hash, rawSize, lastUpdated: current.meta.lastUpdated } }, $unset: { data: '' } }
                );

                if (result.matchedCount > 0) {
                    this.documentsMigrated += 1;
                    this.bytesMoved += rawSize * 1024;
                    this.adminLogger.logInfo(
                        `resource with _uuid: ${current._uuid} migrated with data stored at path ${liveKey}`
                    );
                    return;
                }

                await this._deleteOrphanedUploadAsync(liveKey, current._uuid);
                current = await collection.findOne({ _id: doc._id });
                if (!current) {
                    this.documentsSkippedDeleted += 1;
                    return;
                }
                this.documentsVersionConflictRetries += 1;
            } catch (err) {
                await this._deleteOrphanedUploadAsync(liveKey, current._uuid);
                this.documentsFailed += 1;
                this.adminLogger.logError(`Mongo update failed for _uuid ${current._uuid}: ${err.message}`);
                return;
            }
        }
        this.documentsFailed += 1;
        this.adminLogger.logError(`Exhausted retries for _uuid ${doc._uuid} due to concurrent writes`);
    }

    async _deleteOrphanedUploadAsync (liveKey, uuid) {
        try {
            await this.base64FieldCloudStorageClient.deleteAsync(liveKey);
            this.documentsOrphanCleanups += 1;
        } catch (err) {
            this.adminLogger.logError(`Failed to delete orphaned upload at ${liveKey} for _uuid ${uuid}: ${err.message}`);
        }
    }

    async processBatch (collection) {
        this.adminLogger.logInfo(`Processing batch ${this.batchCount}`);
        await async.mapLimit(this.currentBatch, this.concurrency, async (doc) => {
            try {
                await this.processRecordAsync(doc, collection);
            } catch (err) {
                this.documentsFailed += 1;
                this.adminLogger.logError(`Unexpected error for _id ${doc._id}: ${err.message}`);
            }
        });
        this.currentBatch = [];

        const message =
            `Processed batch ${this.batchCount}, migrated: ${this.documentsMigrated}, ` +
            `skipped(handled): ${this.documentsSkippedAlreadyHandled}, skipped(below-threshold): ${this.documentsSkippedBelowThreshold}, ` +
            `skipped(deleted): ${this.documentsSkippedDeleted}, ` +
            `skipped(key-collision): ${this.documentsSkippedKeyCollision}, ` +
            `skipped(invalid-lastUpdated): ${this.documentsSkippedInvalidLastUpdated}, ` +
            `version-conflict-retries: ${this.documentsVersionConflictRetries}, orphan-cleanups: ${this.documentsOrphanCleanups}, ` +
            `failed: ${this.documentsFailed}, bytes moved: ${this.bytesMoved}, ` +
            `last processed _id: ${this.lastProcessedId}, last processed _uuid: ${this.lastProcessedUuid}`;
        this.adminLogger.logInfo(message);
        this.batchCount += 1;
    }

    async processAsync () {
        let client = null;
        let session = null;
        try {
            const clientConfig = await this.mongoDatabaseManager.getClientConfigAsync();
            client = await this.mongoDatabaseManager.createClientAsync(clientConfig);
            session = client.startSession();
            const sessionId = session.serverSession.id;
            this.adminLogger.logInfo('Started Mongo session', { session_id: sessionId });

            const db = client.db(clientConfig.db_name);
            const collection = db.collection('Binary_4_0_0');

            const query = this._buildQuery();

            let cursor = collection
                .find(query, { session })
                .sort({ _id: 1 })
                .maxTimeMS(20 * 60 * 60 * 1000)
                .batchSize(this.batchSize)
                .addCursorFlag('noCursorTimeout', true);

            if (this.count) {
                cursor = cursor.limit(this.count);
            }

            let refreshTimestamp = moment();
            const numberOfSecondsBetweenSessionRefreshes = 10 * 60;

            while (await cursor.hasNext()) {
                if (moment().diff(refreshTimestamp, 'seconds') > numberOfSecondsBetweenSessionRefreshes) {
                    this.adminLogger.logInfo('refreshing session with sessionId', { session_id: sessionId });
                    const adminResult = await db.admin().command({ refreshSessions: [sessionId] });
                    this.adminLogger.logInfo('result from refreshing session', { result: adminResult });
                    refreshTimestamp = moment();
                }

                const doc = await cursor.next();
                if (!doc) {
                    this.adminLogger.logError('error in getting next document from cursor');
                    break;
                }

                this.currentBatch.push(doc);
                this.lastProcessedId = doc._id;
                this.lastProcessedUuid = doc._uuid;

                if (this.currentBatch.length >= this.batchSize) {
                    await this.processBatch(collection);
                }
            }
            if (this.currentBatch.length > 0) {
                await this.processBatch(collection);
            }

            this.adminLogger.logInfo('Finished script');
            this.adminLogger.logInfo(
                `Last processed _id: ${this.lastProcessedId}. Migrated ${this.documentsMigrated} documents, ` +
                `failed ${this.documentsFailed}, bytes moved: ${this.bytesMoved}`
            );
            await this.shutdown();
        } catch (e) {
            this.adminLogger.logError(`ERROR: ${e}`);
            throw new RethrownError({
                message: `Error migrating Binary data to cloud storage: ${e.message}`,
                error: e,
                source: 'MigrateBinaryDataToCloudStorageRunner.processAsync'
            });
        } finally {
            if (session) {
                try {
                    await session.endSession();
                } catch (cleanupErr) {
                    this.adminLogger.logError(`Failed to end Mongo session: ${cleanupErr.message}`);
                }
            }
            if (client) {
                try {
                    await this.mongoDatabaseManager.disconnectClientAsync(client);
                } catch (cleanupErr) {
                    this.adminLogger.logError(`Failed to disconnect Mongo client: ${cleanupErr.message}`);
                }
            }
        }
    }
}

module.exports = { MigrateBinaryDataToCloudStorageRunner };
