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
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        for (const item of items) {
            item.incoming = FhirResourceWriteSerializer.serialize({ obj: item.incoming });
        }
        await runInChunks({
            items,
            chunkSize: this.configManager.mergeParallelChunkSize,
            func: async (item) => await this.buildOneAsync({ item, context })
        });
    }

    /**
     * Builds one item and fails it with the builder's failure, or at `BUILD` if the builder throws.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async buildOneAsync ({ item, context }) {
        let failure;
        try {
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
