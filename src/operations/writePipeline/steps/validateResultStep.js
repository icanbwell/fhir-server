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
 * The `validateResult` step, per item with a built document: validates the built document
 * (`candidate`) and fails the item at `RESULT_VALIDATION`. Checks that compare the body with the
 * stored document belong here, after the access check, so nothing about a stored document reaches a
 * caller who can't access it. `checkPatientReference` (default true) is passed to
 * `validateResourceAsync`; false skips its patient reference check, for an operation that checks
 * what the write links to in its own step.
 */
class ValidateResultStep {
    /**
     * @param {ResourceValidator} resourceValidator
     * @param {ConfigManager} configManager
     * @param {boolean} [checkPatientReference]
     */
    constructor ({ resourceValidator, configManager, checkPatientReference = true }) {
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
        /**
         * @type {boolean}
         */
        this.checkPatientReference = checkPatientReference;
    }

    /**
     * Validates every item that has a candidate, in parallel chunks of `mergeParallelChunkSize`; an
     * item without one is skipped.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {{accessRequested: string}} profile
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context, profile }) {
        await runInChunks({
            items: items.filter((item) => item.candidate !== null),
            chunkSize: this.configManager.mergeParallelChunkSize,
            func: async (item) => await this.validateOneAsync({
                item,
                context,
                accessRequested: profile.accessRequested
            })
        });
    }

    /**
     * Validates one item as an update or an insert and fails it with the outcome, or with the error
     * if validation throws.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {string} accessRequested
     * @returns {Promise<void>}
     */
    async validateOneAsync ({ item, context, accessRequested }) {
        let failure = null;
        try {
            const operationOutcome = item.writeMode === 'update'
                ? await this.validateUpdateAsync({ item, context, accessRequested })
                : await this.validateInsertAsync({ item, context, accessRequested });
            if (operationOutcome) {
                failure = new WriteFailure({
                    stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
                    subject: WriteFailure.subjectOf(item.incoming),
                    operationOutcome
                });
            }
        } catch (error) {
            failure = new WriteFailure({
                stage: WRITE_FAILURE_STAGE.RESULT_VALIDATION,
                subject: WriteFailure.subjectOf(item.incoming),
                error
            });
        }
        if (failure) {
            item.fail({ failure });
        }
    }

    /**
     * Returns the meta check's outcome for the merged document if it fails, else
     * `validateResourceAsync`'s outcome for a normalized copy, checked against the stored document;
     * null when valid.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {string} accessRequested
     * @returns {Promise<Object|null>}
     */
    async validateUpdateAsync ({ item, context, accessRequested }) {
        const { requestInfo, base_version } = context;
        const candidate = item.candidate;
        let operationOutcome = this.resourceValidator.validateResourceMetaSync(candidate);

        const resourceToValidate = deepcopy(candidate);
        FhirResourceWriteNormalizeSerializer.serialize({ obj: resourceToValidate });

        if (!operationOutcome) {
            operationOutcome = await this.resourceValidator.validateResourceAsync({
                accessRequested,
                base_version,
                requestInfo,
                resourceType: candidate.resourceType,
                resourceToValidate,
                path: requestInfo.path,
                resourceObj: candidate,
                currentResource: item.stored,
                checkPatientReference: this.checkPatientReference
            });
        }
        return operationOutcome;
    }

    /**
     * Returns `validateResourceAsync`'s outcome for a normalized copy of the new document, or null
     * when valid.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {string} accessRequested
     * @returns {Promise<Object|null>}
     */
    async validateInsertAsync ({ item, context, accessRequested }) {
        const { requestInfo, base_version } = context;
        const candidate = item.candidate;

        const resourceToValidate = deepcopy(candidate);
        FhirResourceWriteNormalizeSerializer.serialize({ obj: resourceToValidate });

        return await this.resourceValidator.validateResourceAsync({
            accessRequested,
            base_version,
            requestInfo,
            resourceType: candidate.resourceType,
            resourceToValidate,
            path: requestInfo.path,
            resourceObj: candidate,
            checkPatientReference: this.checkPatientReference
        });
    }
}

module.exports = {
    ValidateResultStep
};
