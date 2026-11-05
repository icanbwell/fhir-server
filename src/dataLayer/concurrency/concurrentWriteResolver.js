const { BSON, MongoBulkWriteError } = require('mongodb');
const { assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');
const { Base64DataManager } = require('../base64DataManager');
const { ScopesValidator } = require('../../operations/security/scopesValidator');
const { WriteConflictDetector } = require('./writeConflictDetector');
const { RethrownError } = require('../../utils/rethrownError');
const { buildOperationOutcomeFromIssues, buildOperationOutcomeIssue } = require('../../utils/operationOutcomeBuilder');
const { MONGO_ERROR } = require('../../constants');
const { logInfo } = require('../../operations/common/logging');

/**
 * The driver rejects a whole bulkWrite on the client when one operation reaches this size
 */
const MAX_BSON_OBJECT_SIZE = 16 * 1024 * 1024;
const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * Rewrites the entries that lost a concurrency race: rebases them onto the stored documents,
 * re-runs the update access checks, and writes them in one unordered bulkWrite per round.
 * An entry still conflicting after the last round gets a conflict issue.
 */
class ConcurrentWriteResolver {
    /**
     * @param {ConfigManager} configManager
     * @param {Base64DataManager} base64DataManager
     * @param {ScopesValidator} scopesValidator
     * @param {WriteConflictDetector} writeConflictDetector
     * @param {(ms: number) => Promise<void>} [sleep]
     * @param {() => number} [random]
     */
    constructor ({
        configManager,
        base64DataManager,
        scopesValidator,
        writeConflictDetector,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random = Math.random
    }) {
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
        /**
         * @type {WriteConflictDetector}
         */
        this.writeConflictDetector = writeConflictDetector;
        assertTypeEquals(writeConflictDetector, WriteConflictDetector);
        this.sleep = sleep;
        this.random = random;
    }

    /**
     * Mutates the entries in place: their resource, operation, flags, skipped and issue
     * @param {string} base_version
     * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('mongodb').Collection} collection
     * @param {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} losers
     * @param {Map<string, Object>} latestByUuid - stored documents of the losers
     * @param {import('../fastDatabaseUpdateManager').FastDatabaseUpdateManager} updateManager
     * @param {(resource: Object) => Object} cloneResource
     * @returns {Promise<void>}
     */
    async resolveAsync ({ base_version, requestInfo, collection, losers, latestByUuid, updateManager, cloneResource }) {
        const rounds = this.configManager.concurrencyResolutionRounds;
        const backoffMs = this.configManager.concurrencyResolutionBackoffMs;
        // entries one of whose writes may have committed: their uploads can still be referenced
        const mayHaveCommitted = new Set();
        // stored document each queued entry was rebased on this round
        const rebasedOn = new Map();
        const context = { base_version, requestInfo, updateManager, cloneResource, mayHaveCommitted, rebasedOn };

        let pending = losers;
        let latest = latestByUuid;
        let roundsUsed = 0;
        this._recordLosses(pending, latest, mayHaveCommitted);
        for (let round = 1; round <= rounds && pending.length > 0; round++) {
            roundsUsed = round;
            await this.sleep(this.random() * backoffMs * 2 ** (round - 1));
            const queued = [];
            for (const entry of pending) {
                if (await this._prepareAsync({ ...context, entry, currentResource: latest.get(entry.uuid) })) {
                    queued.push(entry);
                }
            }
            if (queued.length === 0) {
                pending = [];
                break;
            }
            const { bulkWriteResult, failedIndexes } = await this._writeRoundAsync({ ...context, collection, queued });
            ({ losers: pending, latestByUuid: latest } = await this.writeConflictDetector.detectAsync({
                entries: queued.map((entry, index) => ({ entry, index })).filter(({ index }) => !failedIndexes.has(index)),
                bulkWriteResult,
                updateManager
            }));
            this._recordLosses(pending, latest, mayHaveCommitted);
        }
        for (const entry of pending) {
            await this._finishAsync({
                ...context,
                entry,
                storedResource: latest.get(entry.uuid) || null,
                issue: this._conflictIssue(
                    entry,
                    `Resource ${entry.resourceType}/${entry.uuid} was modified concurrently and could not be saved after ${rounds} attempts`
                )
            });
        }
        this._logOutcomes({ requestInfo, losers, roundsUsed });
    }

    /**
     * One structured log line per resolution: counts by outcome, plus the uuids that were not saved
     * @private
     */
    _logOutcomes ({ requestInfo, losers, roundsUsed }) {
        const outcomeOf = (entry) => (entry.issue ? entry.issue.code : entry.skipped ? 'skipped' : 'saved');
        const counts = {};
        for (const entry of losers) {
            const outcome = outcomeOf(entry);
            counts[outcome] = (counts[outcome] || 0) + 1;
        }
        logInfo('Resolved concurrent writes', {
            source: 'ConcurrentWriteResolver',
            requestId: requestInfo.requestId,
            resourceType: losers[0]?.resourceType,
            losers: losers.length,
            roundsUsed,
            outcomes: counts,
            unsavedUuids: losers.filter((entry) => entry.issue).map((entry) => entry.uuid)
        });
    }

    /**
     * Rebases one loser and sets the operation for this round.
     * @returns {Promise<boolean>} true when the entry is queued for this round's write
     * @private
     */
    async _prepareAsync ({ base_version, requestInfo, updateManager, cloneResource, mayHaveCommitted, rebasedOn, entry, currentResource }) {
        if (!currentResource) {
            if (entry.isCreateOperation) {
                entry.operation = {
                    updateOne: {
                        filter: { _uuid: entry.uuid },
                        update: { $setOnInsert: updateManager.toWriteDocument(entry.resource) },
                        upsert: true
                    }
                };
                return true;
            }
            await this._finishAsync({
                requestInfo,
                mayHaveCommitted,
                entry,
                issue: this._conflictIssue(
                    entry, `Resource ${entry.resourceType}/${entry.uuid} was deleted concurrently and could not be saved`
                )
            });
            return false;
        }

        const { updatedResource, patches } = await updateManager.rebaseOnLatestAsync({
            base_version, requestInfo, doc: entry.resource, currentResource, smartMerge: entry.smartMerge
        });
        if (!updatedResource) {
            await this._finishAsync({
                requestInfo, mayHaveCommitted, entry, storedResource: currentResource, skippedResource: currentResource
            });
            return false;
        }

        try {
            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                resource: cloneResource(currentResource), requestInfo, base_version, accessRequested: 'u'
            });
            this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                requestInfo,
                currentResource,
                updatedResource,
                ignoreRemovals: entry.smartMerge,
                accessRequested: 'u'
            });
        } catch (error) {
            if (error.statusCode !== 403) {
                throw error;
            }
            const operationOutcome = buildOperationOutcomeFromIssues(error.issue);
            entry.operationOutcome = operationOutcome;
            await this._finishAsync({
                requestInfo, mayHaveCommitted, entry, storedResource: currentResource, issue: operationOutcome.issue[0]
            });
            return false;
        }

        rebasedOn.set(entry, currentResource);
        entry.resource = updatedResource;
        entry.patches = patches;
        entry.operationType = 'merge';
        entry.isCreateOperation = false;
        entry.isUpdateOperation = true;
        entry.operation = {
            replaceOne: {
                filter: { $and: [{ _uuid: entry.uuid }, { 'meta.versionId': `${currentResource.meta.versionId}` }] },
                replacement: updateManager.toWriteDocument(updatedResource)
            }
        };
        if (BSON.calculateObjectSize(entry.operation) >= MAX_BSON_OBJECT_SIZE) {
            await this._finishAsync({
                requestInfo,
                mayHaveCommitted,
                entry,
                storedResource: currentResource,
                issue: this._exceptionIssue(entry, MONGO_ERROR.RESOURCE_SIZE_EXCEEDS)
            });
            return false;
        }
        return true;
    }

    /**
     * Writes one round. A server write error gives that entry an exception issue; a duplicate
     * key leaves the entry to detection.
     * @returns {Promise<{bulkWriteResult: import('mongodb').BulkWriteResult, failedIndexes: Set<number>}>}
     * @private
     */
    async _writeRoundAsync ({ requestInfo, mayHaveCommitted, rebasedOn, collection, queued }) {
        const failedIndexes = new Set();
        try {
            const bulkWriteResult = await collection.bulkWrite(queued.map((entry) => entry.operation), { ordered: false });
            return { bulkWriteResult, failedIndexes };
        } catch (error) {
            if (!(error instanceof MongoBulkWriteError)) {
                throw new RethrownError({ message: 'ConcurrentWriteResolver: Error bulkWrite', error });
            }
            for (const writeError of [].concat(error.writeErrors || [])) {
                if (writeError.code === DUPLICATE_KEY_ERROR_CODE) {
                    continue;
                }
                failedIndexes.add(writeError.index);
                const entry = queued[writeError.index];
                await this._finishAsync({
                    requestInfo,
                    mayHaveCommitted,
                    entry,
                    storedResource: rebasedOn.get(entry) || null,
                    issue: this._exceptionIssue(entry, writeError.errmsg)
                });
            }
            return { bulkWriteResult: error.result, failedIndexes };
        }
    }

    /**
     * Takes an entry out of resolution without a committed write, and deletes the base64 objects
     * this request uploaded for it when none of its writes can have committed. An object the stored
     * document still references is kept either way.
     * @private
     */
    async _finishAsync ({ requestInfo, mayHaveCommitted, entry, storedResource = null, issue = null, skippedResource = null }) {
        if (!mayHaveCommitted.has(entry)) {
            await this.base64DataManager.deleteOwnUploadedLiveObjectsAsync(
                entry.resource, requestInfo, { keepReferencedBy: storedResource }
            );
        }
        if (skippedResource) {
            entry.skipped = true;
            entry.resource = skippedResource;
        }
        if (issue) {
            entry.issue = issue;
        }
    }

    /**
     * A loser certainly did not commit when it was a create (upsertedIds), or when the stored
     * document is at the version it wrote. A higher stored version can be its own committed write
     * overwritten by a later writer.
     * @private
     */
    _recordLosses (losers, latestByUuid, mayHaveCommitted) {
        for (const entry of losers) {
            const stored = latestByUuid.get(entry.uuid);
            const sameVersion = stored && `${stored.meta?.versionId}` === `${entry.resource.meta?.versionId}`;
            if (!entry.isCreateOperation && !sameVersion) {
                mayHaveCommitted.add(entry);
            }
        }
    }

    /**
     * @private
     */
    _conflictIssue (entry, diagnostics) {
        return buildOperationOutcomeIssue({
            severity: 'error',
            code: 'conflict',
            details: { text: 'Concurrent update conflict' },
            diagnostics,
            expression: [`${entry.resourceType}/${entry.uuid}`]
        });
    }

    /**
     * @private
     */
    _exceptionIssue (entry, diagnostics) {
        return buildOperationOutcomeIssue({
            severity: 'error',
            code: 'exception',
            details: { text: diagnostics },
            diagnostics,
            expression: [`${entry.resourceType}/${entry.uuid}`]
        });
    }
}

module.exports = {
    ConcurrentWriteResolver
};
