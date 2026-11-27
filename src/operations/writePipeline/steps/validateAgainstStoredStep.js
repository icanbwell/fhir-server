const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../utils/assertType');
const { ConfigManager } = require('../../../utils/configManager');
const { ResourceValidator } = require('../../common/resourceValidator');
const { FhirResourceWriteNormalizeSerializer } = require('../../../fhir/fhirResourceWriteNormalizeSerializer');
const { runInChunks } = require('../runInChunks');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `validateAgainstStored` step, per item with a stored document: validates the body against the
 * stored document with `ResourceValidator.validateResourceAsync` (the Group member limit, the
 * schema, references, the patient reference and Person.link) and fails the item at
 * `STORED_VALIDATION`. It runs after the access check, so nothing about a stored document reaches a
 * caller who can't access it, and before the build.
 *
 * Only PUT runs this step; every other profile turns it off. It exists only because the merge in the
 * build soft-deletes the stored GridFS files that the body drops or changes, and a PUT that fails
 * validation must leave them active, as the old PUT did by validating before it merged. Once GridFS
 * attachments are removed, delete this step, its entry in `WRITE_STEP_NAMES`, its line in
 * `WritePipeline.processAsync`, the `off` entries in the other profiles and `ValidateUpdateResultStep`
 * with the `validateResult: 'update'` variant, and let `ValidateResultStep` validate an update's
 * built document in full again.
 */
class ValidateAgainstStoredStep {
    /**
     * @param {ResourceValidator} resourceValidator
     * @param {ConfigManager} configManager
     */
    constructor ({ resourceValidator, configManager }) {
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Validates every item that has a stored document, in parallel chunks of
     * `mergeParallelChunkSize`; an item with none is skipped, because the build's result validation
     * validates a new document.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {{accessRequested: string}} profile
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context, profile }) {
        await runInChunks({
            items: items.filter((item) => item.stored && item.stored.meta),
            chunkSize: this.configManager.mergeParallelChunkSize,
            func: async (item) => await this.validateOneAsync({
                item,
                context,
                accessRequested: profile.accessRequested
            })
        });
    }

    /**
     * Validates one item's body against its stored document and fails the item with the outcome, or
     * with the error if validation throws.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {string} accessRequested
     * @returns {Promise<void>}
     */
    async validateOneAsync ({ item, context, accessRequested }) {
        const { requestInfo, base_version } = context;
        const incoming = item.incoming;
        let failure = null;
        try {
            const resourceToValidate = deepcopy(incoming);
            FhirResourceWriteNormalizeSerializer.serialize({ obj: resourceToValidate });
            const operationOutcome = await this.resourceValidator.validateResourceAsync({
                accessRequested,
                base_version,
                requestInfo,
                resourceType: incoming.resourceType,
                resourceToValidate,
                path: requestInfo.path,
                resourceObj: incoming,
                currentResource: item.stored
            });
            if (operationOutcome) {
                failure = new WriteFailure({
                    stage: WRITE_FAILURE_STAGE.STORED_VALIDATION,
                    subject: WriteFailure.subjectOf(incoming),
                    operationOutcome
                });
            }
        } catch (error) {
            failure = new WriteFailure({
                stage: WRITE_FAILURE_STAGE.STORED_VALIDATION,
                subject: WriteFailure.subjectOf(incoming),
                error
            });
        }
        if (failure) {
            item.fail({ failure });
        }
    }
}

module.exports = {
    ValidateAgainstStoredStep
};
