const deepEqual = require('fast-deep-equal');
const deepcopy = require('deepcopy');
const { FhirResourceWriteSerializer } = require('../../fhir/fhirResourceWriteSerializer');

/**
 * @typedef {Object} IndexedEntry
 * @property {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry} entry
 * @property {number} index - position of the entry's operation in the bulk write
 */

/**
 * @typedef {Object} DetectionResult
 * @property {import('../bulkInsertUpdateEntry').BulkInsertUpdateEntry[]} losers - creates and
 *   versioned updates whose write did not land, and {_uuid}-only writes whose document is missing
 * @property {Map<string, Object>} latestByUuid - stored documents of the losers
 */

/**
 * Classifies the entries of one bulk write as winners or losers of a concurrency race.
 * Creates are read from upsertedIds; updates from one read compared with what each entry sent.
 */
class WriteConflictDetector {
    /**
     * @param {IndexedEntry[]} entries
     * @param {import('mongodb').BulkWriteResult} bulkWriteResult - from an ordered write, or one
     *   whose operations are all update-kind, so upsertedIds keys are the entry indices
     * @param {import('../fastDatabaseUpdateManager').FastDatabaseUpdateManager} updateManager
     * @returns {Promise<DetectionResult>}
     */
    async detectAsync ({ entries, bulkWriteResult, updateManager }) {
        const result = { losers: [], latestByUuid: new Map() };
        const upsertedIds = bulkWriteResult.upsertedIds || {};

        // the same tests the executor uses to count the creates and updates it expects
        const lostCreates = [];
        const updates = [];
        for (const { entry, index } of entries) {
            if (entry.operationType === 'insertUniqueId') {
                if (!Object.prototype.hasOwnProperty.call(upsertedIds, index)) {
                    lostCreates.push(entry);
                }
            } else if (entry.isUpdateOperation) {
                updates.push(entry);
            }
        }
        const updatesFellShort = updates.length > 0 && bulkWriteResult.modifiedCount < updates.length;
        const entriesToRead = [...lostCreates, ...(updatesFellShort ? updates : [])];
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
        const versionedUpdates = [];
        let uuidOnlyMatched = 0;
        for (const entry of updates) {
            if (this._hasVersionCheck(entry.operation.replaceOne.filter)) {
                versionedUpdates.push(entry);
            } else if (latest.has(entry.uuid)) {
                // filtered on _uuid alone: it can't lose a version race, only lose its document
                uuidOnlyMatched++;
            } else {
                addLoser(entry);
            }
        }
        // matchedCount also counts the lost creates (their upsert found the document) and the
        // {_uuid}-only writes. With nothing left for the versioned updates, none of them landed, even
        // one whose stored document equals its replacement: that is another request's identical write.
        const noVersionedUpdateLanded = typeof bulkWriteResult.matchedCount === 'number' &&
            bulkWriteResult.matchedCount - lostCreates.length - uuidOnlyMatched <= 0;
        for (const entry of versionedUpdates) {
            if (noVersionedUpdateLanded || !this._isOwnWrite(latest.get(entry.uuid), entry.operation.replaceOne.replacement)) {
                addLoser(entry);
            }
        }
        return result;
    }

    /**
     * Whether the replace filter checks meta.versionId. It doesn't for a write filtered on _uuid
     * alone (PUT or PATCH on an existing resource, If-Match: *, a $merge with no previous version)
     * or for a repeat write in the same batch, whose filter is null.
     * @param {Object|null} filter
     * @returns {boolean}
     * @private
     */
    _hasVersionCheck (filter) {
        return !!filter?.$and?.some((clause) => clause && Object.prototype.hasOwnProperty.call(clause, 'meta.versionId'));
    }

    /**
     * A versioned update won when the stored document is at its version with its content
     * @param {Object|undefined} stored
     * @param {Object} replacement
     * @returns {boolean}
     * @private
     */
    _isOwnWrite (stored, replacement) {
        return !!stored &&
            `${stored.meta?.versionId}` === `${replacement.meta?.versionId}` &&
            this._isSameDocument(stored, replacement);
    }

    /**
     * findLatestByUuidsAsync already returns the stored document through the write serializer,
     * which drops _id and empty values. The replacement goes through it too, on a copy because
     * the serializer deletes properties in place and the entry still uses it.
     * @param {Object} stored - as returned by findLatestByUuidsAsync
     * @param {Object} replacement
     * @returns {boolean}
     * @private
     */
    _isSameDocument (stored, replacement) {
        return deepEqual(stored, FhirResourceWriteSerializer.serialize({ obj: deepcopy(replacement) }));
    }
}

module.exports = {
    WriteConflictDetector
};
