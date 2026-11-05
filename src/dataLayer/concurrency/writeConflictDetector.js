const deepEqual = require('fast-deep-equal');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');

/**
 * How an entry's write can lose a concurrency race, by the filter of its operation
 */
const ENTRY_CLASS = Object.freeze({
    CREATE: 'create',
    VERSIONED_UPDATE: 'versionedUpdate',
    IF_MATCH_UPDATE: 'ifMatchUpdate',
    UUID_ONLY_WRITE: 'uuidOnlyWrite'
});

/**
 * @typedef {Object} IndexedEntry
 * @property {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry} entry
 * @property {number} index - position of the entry's operation in the bulk write
 */

/**
 * @typedef {Object} DetectionResult
 * @property {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} losers - creates and
 *   versioned updates whose write did not land
 * @property {Map<string, Object>} latestByUuid - stored documents of the losers
 * @property {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} ifMatchMisses - If-Match
 *   updates whose write did not land
 * @property {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} missingUuidOnly -
 *   {_uuid}-only writes whose document does not exist
 */

/**
 * Classifies the entries of one bulk write as winners or losers of a concurrency race.
 * Creates are read from upsertedIds; updates from one read compared with what each entry sent.
 */
class WriteConflictDetector {
    /**
     * @param {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry} entry
     * @returns {string|null} an ENTRY_CLASS value, or null for a write that can't lose (insertOne)
     */
    classify (entry) {
        const operation = entry.operation;
        if (operation.insertOne) {
            return null;
        }
        if (entry.operationType === 'insertUniqueId' && operation.updateOne?.upsert && operation.updateOne.update?.$setOnInsert) {
            return ENTRY_CLASS.CREATE;
        }
        const versionClause = operation.replaceOne?.filter?.$and?.find(
            (clause) => clause && Object.prototype.hasOwnProperty.call(clause, 'meta.versionId')
        );
        if (versionClause) {
            return typeof versionClause['meta.versionId'] === 'object'
                ? ENTRY_CLASS.IF_MATCH_UPDATE
                : ENTRY_CLASS.VERSIONED_UPDATE;
        }
        return ENTRY_CLASS.UUID_ONLY_WRITE;
    }

    /**
     * @param {IndexedEntry[]} entries
     * @param {import('mongodb').BulkWriteResult} bulkWriteResult - from an ordered write, or one
     *   whose operations are all update-kind, so upsertedIds keys are the entry indices
     * @param {import('../fastDatabaseUpdateManager').FastDatabaseUpdateManager} updateManager
     * @returns {Promise<DetectionResult>}
     */
    async detectAsync ({ entries, bulkWriteResult, updateManager }) {
        const result = { losers: [], latestByUuid: new Map(), ifMatchMisses: [], missingUuidOnly: [] };
        const upsertedIds = bulkWriteResult.upsertedIds || {};

        const lostCreates = [];
        const updates = [];
        for (const { entry, index } of entries) {
            const entryClass = this.classify(entry);
            if (entryClass === ENTRY_CLASS.CREATE) {
                if (!Object.prototype.hasOwnProperty.call(upsertedIds, index)) {
                    lostCreates.push(entry);
                }
            } else if (entryClass) {
                updates.push({ entry, entryClass });
            }
        }
        const updatesFellShort = updates.length > 0 && bulkWriteResult.modifiedCount < updates.length;
        const entriesToRead = [...lostCreates, ...(updatesFellShort ? updates.map((u) => u.entry) : [])];
        if (entriesToRead.length === 0) {
            return result;
        }

        const latest = await updateManager.findLatestByUuidsAsync({
            uuids: [...new Set(entriesToRead.map((e) => e.uuid))]
        });
        const addLoser = (entry) => {
            result.losers.push(entry);
            if (latest.has(entry.uuid)) {
                result.latestByUuid.set(entry.uuid, latest.get(entry.uuid));
            }
        };

        lostCreates.forEach(addLoser);
        if (!updatesFellShort) {
            return result;
        }
        for (const { entry, entryClass } of updates) {
            const stored = latest.get(entry.uuid);
            if (entryClass === ENTRY_CLASS.UUID_ONLY_WRITE) {
                if (!stored) {
                    result.missingUuidOnly.push(entry);
                }
                continue;
            }
            const won = stored && this._isSameDocument(updateManager.toWriteDocument(stored), entry.operation.replaceOne.replacement);
            if (won) {
                continue;
            }
            if (entryClass === ENTRY_CLASS.IF_MATCH_UPDATE) {
                result.ifMatchMisses.push(entry);
            } else {
                addLoser(entry);
            }
        }
        return result;
    }

    /**
     * Compares a stored document with a replacement after both go through the write serializer,
     * so the same empty-value rules apply to each. Both are copied because the serializer deletes
     * properties in place.
     * @param {Object} stored
     * @param {Object} replacement
     * @returns {boolean}
     * @private
     */
    _isSameDocument (stored, replacement) {
        const normalize = (doc) => {
            const copy = deepcopy(doc);
            delete copy._id;
            return FhirResourceWriteSerializer.serialize({ obj: copy });
        };
        return deepEqual(normalize(stored), normalize(replacement));
    }
}

module.exports = {
    WriteConflictDetector,
    ENTRY_CLASS
};
