const { assertIsValid, assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { FhirResourceWriteSerializer } = require('../../../fhir/fhirResourceWriteSerializer');
const { runInChunks } = require('../runInChunks');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `buildDocument` step, per item: write-serializes each body, then has the builder build each
 * item's new document, in parallel chunks of `mergeParallelChunkSize`. A failure the builder
 * returns fails only that item, and an error it throws fails only that item at the `BUILD` stage.
 * When the profile sets `itemErrorsFailItem`, an error the write serialization throws also fails
 * only that item at the `BUILD` stage; otherwise it rejects before any item is built.
 */
class BuildDocumentStep {
    /**
     * @param {{buildAsync: function({item: WriteItem, context: WriteContext}): Promise<WriteFailure|null>}} builder
     * @param {ConfigManager} configManager
     */
    constructor ({ builder, configManager }) {
        /**
         * @type {{buildAsync: function}}
         */
        this.builder = builder;
        assertIsValid(builder, 'builder is required');
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Replaces each item's body with its write-serialized form, then builds the items in chunks.
     * When the profile sets `itemErrorsFailItem`, each item is serialized as it is built instead.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {{itemErrorsFailItem?: boolean}} profile
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context, profile }) {
        const serializesEachItem = profile?.itemErrorsFailItem === true;
        if (!serializesEachItem) {
            for (const item of items) {
                item.incoming = FhirResourceWriteSerializer.serialize({ obj: item.incoming });
            }
        }
        await runInChunks({
            items,
            chunkSize: this.configManager.mergeParallelChunkSize,
            func: async (item) => await this.buildOneAsync({ item, context, serializesEachItem })
        });
    }

    /**
     * Builds one item, write-serializing its body first when `serializesEachItem` is set, and
     * fails it with the builder's failure, or at `BUILD` if the serialization or the builder
     * throws.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {boolean} serializesEachItem
     * @returns {Promise<void>}
     */
    async buildOneAsync ({ item, context, serializesEachItem }) {
        let failure;
        try {
            if (serializesEachItem) {
                item.incoming = FhirResourceWriteSerializer.serialize({ obj: item.incoming });
            }
            failure = await this.builder.buildAsync({ item, context });
        } catch (error) {
            failure = new WriteFailure({
                stage: WRITE_FAILURE_STAGE.BUILD,
                subject: WriteFailure.subjectOf(item.incoming),
                error
            });
        }
        if (failure) {
            item.fail({ failure });
        }
    }
}

module.exports = {
    BuildDocumentStep
};
