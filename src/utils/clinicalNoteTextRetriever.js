const { logWarn } = require('../operations/common/logging');

/**
 * Reassembles chunked clinical-note text from fhir-notes-vector-store's ClinicalNote
 * collection. Used only for read-time enrichment/reverse-lookup, both of which run after a
 * resource's own authorized fetch has already succeeded -- this class never gates access to
 * anything, it only fetches more data about a resource the caller can already see.
 */
class ClinicalNoteTextRetriever {
    /**
     * @param {Object} params
     * @param {import('./mongoDatabaseManager').MongoDatabaseManager} params.mongoDatabaseManager
     * @param {import('./configManager').ConfigManager} params.configManager
     */
    constructor ({ mongoDatabaseManager, configManager }) {
        this.mongoDatabaseManager = mongoDatabaseManager;
        this.configManager = configManager;
    }

    /**
     * @param {Object} params
     * @param {string} params.chunkGroupId `"{resourceId}-{contentIndex}"`
     * @returns {Promise<string|null>}
     */
    async getReassembledTextAsync ({ chunkGroupId }) {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const chunks = await collection
                .find({ 'meta.chunk_group_id': chunkGroupId })
                .sort({ 'meta.chunk_index': 1 })
                .toArray();
            if (chunks.length === 0) {
                return null;
            }
            return chunks.map(c => c.text || '').join('');
        } catch (e) {
            logWarn(`Failed to reassemble clinical note text for chunkGroupId=${chunkGroupId}`, { error: e });
            return null;
        }
    }

    /**
     * @param {Object} params
     * @param {string} params.binaryReference e.g. "Binary/abc123"
     * @returns {Promise<string|null>}
     */
    async getReassembledTextForBinaryAsync ({ binaryReference }) {
        if (!this.configManager.fhirNotesFullTextSearchConfigured) {
            return null;
        }
        const binaryId = binaryReference.split('/')[1];
        try {
            const db = await this.mongoDatabaseManager.getFhirNotesDbAsync();
            const collection = db.collection(this.configManager.fhirNotesMongoCollectionName);
            const urlVariants = [`Binary/${binaryId}`, `#${binaryId}`];
            const matches = await collection.find({
                $or: [
                    { 'debug.resource.content.attachment.url': { $in: urlVariants } },
                    { 'debug.resource.presentedForm.url': { $in: urlVariants } }
                ]
            }).toArray();
            if (matches.length === 0) {
                return null;
            }
            const chunkGroupId = matches[0].meta.chunk_group_id;
            const chunks = matches
                .filter(m => m.meta.chunk_group_id === chunkGroupId)
                .sort((a, b) => a.meta.chunk_index - b.meta.chunk_index);
            return chunks.map(c => c.text || '').join('');
        } catch (e) {
            logWarn(`Failed to reverse-lookup clinical note text for binaryReference=${binaryReference}`, { error: e });
            return null;
        }
    }
}

module.exports = { ClinicalNoteTextRetriever };
