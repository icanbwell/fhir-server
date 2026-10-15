const { ObjectId } = require('mongodb');
const { isValidMongoObjectId } = require('../../utils/mongoIdValidator');
const { RethrownError } = require('../../utils/rethrownError');
const { BaseBulkOperationRunner } = require('./baseBulkOperationRunner');
const { ReferenceParser } = require('../../utils/referenceParser');
const { isUuid, generateUUIDv5 } = require('../../utils/uid.util');
const { mongoQueryStringify } = require('../../utils/mongoQueryStringify');

const DOCUMENT_REFERENCE_COLLECTION = 'DocumentReference_4_0_0';
const BINARY_COLLECTION = 'Binary_4_0_0';
const PATIENT_UUID_PREFIX = 'Patient/';
// owners queued but not yet written: a Binary reached twice inside one unflushed bulk batch is checked here, because
// the database does not hold the first stamp yet. Bounded; it must stay larger than batchSize.
const PENDING_OWNERS_MAX = 200000;
const MAX_CONFLICTS_LOGGED = 1000;

/**
 * Resolves the `_uuid` of the Binary a DocumentReference attachment url points at, exactly the way
 * `$everything` does (nonClinicalResourceExtractor): only `Binary/{id}` references count, and a non-uuid id is
 * turned into the uuid with the DocumentReference's own sourceAssigningAuthority.
 * @param {string} url content.attachment.url
 * @param {string|undefined} sourceAssigningAuthority the DocumentReference's _sourceAssigningAuthority
 * @returns {string|null}
 */
function resolveBinaryUuidFromAttachmentUrl ({ url, sourceAssigningAuthority }) {
    if (typeof url !== 'string' || url.length === 0) {
        return null;
    }
    const { id, resourceType } = ReferenceParser.parseReference(url);
    if (resourceType !== 'Binary' || !id) {
        return null;
    }
    return isUuid(id) ? id : generateUUIDv5(`${id}|${sourceAssigningAuthority}`);
}

/**
 * @classdesc Backfills `Binary.securityContext` on existing Binary (design section 17). Scans DocumentReference, and for
 * every Binary a DocumentReference points at that has no securityContext, sets it to the DocumentReference's `subject`
 * when that is a Patient. The stored form of the subject is copied as is, so the new field has exactly the shape the
 * patient filter queries (`securityContext._uuid` / `_sourceId`).
 *
 * Only `$set` of `securityContext` on documents that do not have one: no `replaceOne` (inline base64 `data` is not
 * rewritten), no `meta.lastUpdated` / `meta.versionId` change (the cloud-storage key and `_blobMeta` are built from
 * `meta.lastUpdated`), no history, change events or audit entries (admin runners write straight to Mongo).
 * Idempotent and resumable (`startFromId`).
 *
 * Ambiguity: a Binary that DocumentReferences with different subjects point at keeps the first owner stamped and is
 * counted and logged as a conflict, for review. In a real run every later conflict is detected (the first stamp is
 * in the database). In a dry run only conflicts inside the pending window are, because nothing is written.
 */
class BackfillBinarySecurityContextRunner extends BaseBulkOperationRunner {
    /**
     * @typedef BackfillBinarySecurityContextRunnerParams
     * @property {number} batchSize
     * @property {AdminLogger} adminLogger
     * @property {MongoDatabaseManager} mongoDatabaseManager
     * @property {number|undefined} [limit] DocumentReferences to scan
     * @property {number|undefined} [skip]
     * @property {string|undefined} [startFromId] resume from this DocumentReference _id (inclusive)
     * @property {boolean|undefined} [useTransaction]
     * @property {Date|undefined} [beforeLastUpdatedDate] DocumentReference.meta.lastUpdated
     * @property {Date|undefined} [afterLastUpdatedDate]
     * @property {boolean|undefined} [dryRun] count what would change, write nothing
     * @property {number|undefined} [sleepMs] pause after every batchSize DocumentReferences (throttle)
     * @param {BackfillBinarySecurityContextRunnerParams} options
     */
    constructor ({
        limit,
        skip,
        startFromId,
        useTransaction,
        beforeLastUpdatedDate,
        afterLastUpdatedDate,
        dryRun,
        sleepMs,
        ...args
    }) {
        super(args);

        if (startFromId && !isValidMongoObjectId(startFromId)) {
            throw new Error(`Invalid startFromId: ${startFromId}`);
        }
        this.limit = limit;
        this.skip = skip;
        this.startFromId = startFromId;
        this.useTransaction = useTransaction;
        this.beforeLastUpdatedDate = beforeLastUpdatedDate;
        this.afterLastUpdatedDate = afterLastUpdatedDate;
        this.dryRun = Boolean(dryRun);
        this.sleepMs = sleepMs > 0 ? sleepMs : 0;

        /**
         * binary _uuid -> owner _uuid, for operations queued in this run's recent window
         * @type {Map<string, string>}
         */
        this.pendingOwners = new Map();
        this.conflicts = [];
        this.stats = {
            documentReferencesScanned: 0,
            skippedSubjectNotPatient: 0,
            skippedNoBinaryUrl: 0,
            binaryNotFound: 0,
            alreadyOwnedBySame: 0,
            conflicts: 0,
            queued: 0
        };
        /**
         * @type {import('mongodb').Collection|null}
         */
        this.binaryCollection = null;
    }

    /**
     * The owner to stamp from a DocumentReference's stored subject, or null when it is not a Patient
     * @param {Object|undefined} subject stored (internal) form of DocumentReference.subject
     * @returns {{reference: string, _uuid: string, _sourceId: string, _sourceAssigningAuthority: string}|null}
     */
    getOwnerSecurityContext (subject) {
        if (!subject || typeof subject._uuid !== 'string' || !subject._uuid.startsWith(PATIENT_UUID_PREFIX)) {
            return null;
        }
        const owner = { _uuid: subject._uuid };
        for (const field of ['reference', '_sourceId', '_sourceAssigningAuthority']) {
            if (subject[`${field}`] !== undefined) {
                owner[`${field}`] = subject[`${field}`];
            }
        }
        return owner;
    }

    /**
     * Query for the DocumentReference scan
     * @returns {import('mongodb').Filter<import('mongodb').Document>}
     */
    getQuery () {
        const and = [
            { 'content.attachment.url': { $regex: 'Binary/' } },
            { 'subject._uuid': { $regex: `^${PATIENT_UUID_PREFIX}` } }
        ];
        const lastUpdated = {};
        if (this.beforeLastUpdatedDate) {
            lastUpdated.$lt = this.beforeLastUpdatedDate;
        }
        if (this.afterLastUpdatedDate) {
            lastUpdated.$gt = this.afterLastUpdatedDate;
        }
        if (Object.keys(lastUpdated).length > 0) {
            and.push({ 'meta.lastUpdated': lastUpdated });
        }
        if (this.startFromId) {
            and.push({ _id: { $gte: new ObjectId(this.startFromId) } });
        }
        return { $and: and };
    }

    rememberPendingOwner (binaryUuid, ownerUuid) {
        if (this.pendingOwners.size >= PENDING_OWNERS_MAX) {
            this.pendingOwners.delete(this.pendingOwners.keys().next().value);
        }
        this.pendingOwners.set(binaryUuid, ownerUuid);
    }

    recordConflict ({ binaryUuid, keptOwner, otherOwner, documentReferenceUuid }) {
        this.stats.conflicts += 1;
        if (this.conflicts.length < MAX_CONFLICTS_LOGGED) {
            this.conflicts.push({ binaryUuid, keptOwner, otherOwner, documentReferenceUuid });
        }
    }

    /**
     * Bulk operations for one DocumentReference
     * @param {import('mongodb').Document} doc stored DocumentReference
     * @returns {Promise<import('mongodb').AnyBulkWriteOperation[]>}
     */
    async processRecordsAsync ({ doc }) {
        this.stats.documentReferencesScanned += 1;
        if (this.sleepMs > 0 && this.stats.documentReferencesScanned % this.batchSize === 0) {
            await new Promise(resolve => setTimeout(resolve, this.sleepMs));
        }
        const owner = this.getOwnerSecurityContext(doc.subject);
        if (!owner) {
            this.stats.skippedSubjectNotPatient += 1;
            return [];
        }
        const binaryUuids = new Set();
        for (const content of Array.isArray(doc.content) ? doc.content : []) {
            const binaryUuid = resolveBinaryUuidFromAttachmentUrl({
                url: content && content.attachment && content.attachment.url,
                sourceAssigningAuthority: doc._sourceAssigningAuthority
            });
            if (binaryUuid) {
                binaryUuids.add(binaryUuid);
            }
        }
        if (binaryUuids.size === 0) {
            this.stats.skippedNoBinaryUrl += 1;
            return [];
        }

        const operations = [];
        for (const binaryUuid of binaryUuids) {
            const pendingOwner = this.pendingOwners.get(binaryUuid);
            if (pendingOwner !== undefined) {
                if (pendingOwner === owner._uuid) {
                    this.stats.alreadyOwnedBySame += 1;
                } else {
                    this.recordConflict({
                        binaryUuid, keptOwner: pendingOwner, otherOwner: owner._uuid, documentReferenceUuid: doc._uuid
                    });
                }
                continue;
            }
            const existing = await this.binaryCollection.findOne(
                { _uuid: binaryUuid },
                { projection: { _id: 1, 'securityContext._uuid': 1 } }
            );
            if (!existing) {
                this.stats.binaryNotFound += 1;
                continue;
            }
            const existingOwner = existing.securityContext && existing.securityContext._uuid;
            if (existingOwner) {
                if (existingOwner === owner._uuid) {
                    this.stats.alreadyOwnedBySame += 1;
                } else {
                    this.recordConflict({
                        binaryUuid, keptOwner: existingOwner, otherOwner: owner._uuid, documentReferenceUuid: doc._uuid
                    });
                }
                continue;
            }
            this.rememberPendingOwner(binaryUuid, owner._uuid);
            this.stats.queued += 1;
            if (this.dryRun) {
                continue;
            }
            operations.push({
                updateOne: {
                    // never overwrites an owner set meanwhile (member upload, another run)
                    filter: { _uuid: binaryUuid, securityContext: { $exists: false } },
                    update: { $set: { securityContext: owner } }
                }
            });
        }
        return operations;
    }

    /**
     * Runs the backfill
     * @returns {Promise<void>}
     */
    async processAsync () {
        /**
         * @type {{connection: string, db_name: string, options: import('mongodb').MongoClientOptions}}
         */
        const mongoConfig = await this.mongoDatabaseManager.getClientConfigAsync();
        const lookupClient = await this.mongoDatabaseManager.createClientAsync(mongoConfig);
        const startFromIdContainer = this.createStartFromIdContainer();
        const query = this.getQuery();
        try {
            this.binaryCollection = lookupClient.db(mongoConfig.db_name).collection(BINARY_COLLECTION);
            this.adminLogger.logInfo(
                `[processAsync] ${this.dryRun ? 'DRY RUN. ' : ''}Query: ${mongoQueryStringify(query)} ` +
                `on ${DOCUMENT_REFERENCE_COLLECTION}`
            );
            await this.runForQueryBatchesAsync({
                config: mongoConfig,
                sourceCollectionName: DOCUMENT_REFERENCE_COLLECTION,
                destinationCollectionName: BINARY_COLLECTION,
                query,
                projection: {
                    _id: 1,
                    _uuid: 1,
                    _sourceAssigningAuthority: 1,
                    subject: 1,
                    'content.attachment.url': 1
                },
                startFromIdContainer,
                fnCreateBulkOperationAsync: async (doc) => await this.processRecordsAsync({ doc }),
                ordered: false,
                batchSize: this.batchSize,
                skipExistingIds: false,
                limit: this.limit,
                useTransaction: this.useTransaction,
                skip: this.skip,
                useEstimatedCount: true
            });
        } catch (error) {
            this.adminLogger.logError(
                `Got error ${error}. At ${startFromIdContainer.startFromId}`
            );
            throw new RethrownError({
                message: `Error backfilling Binary.securityContext: ${error.message}`,
                error,
                args: { query },
                source: 'BackfillBinarySecurityContextRunner.processAsync'
            });
        } finally {
            this.adminLogger.logInfo(
                `Backfill ${this.dryRun ? '(dry run) ' : ''}summary. Last DocumentReference _id: ` +
                `${startFromIdContainer.startFromId}`,
                { ...this.stats }
            );
            if (this.conflicts.length > 0) {
                this.adminLogger.logInfo(
                    `Binary reached by DocumentReferences with different subjects: ${this.stats.conflicts} ` +
                    `(first ${this.conflicts.length} listed)`,
                    { conflicts: this.conflicts }
                );
            }
            await this.mongoDatabaseManager.disconnectClientAsync(lookupClient);
        }
    }
}

module.exports = {
    BackfillBinarySecurityContextRunner,
    resolveBinaryUuidFromAttachmentUrl
};
