const { assertTypeEquals } = require('../../../utils/assertType');
const { ResourceValidator } = require('../../common/resourceValidator');
const { validateResource } = require('../../../utils/validator.util');
const { recordValidationFailure, VALIDATION_STAGE, PATH } = require('../../../utils/metrics');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `validateIncoming` step, per item: checks the body alone, failing at `INCOMING_SCHEMA` on a
 * schema error, which it records in `fhir_validation_failure_total` at the `schema` stage, and, for
 * a new resource, at `INCOMING_META` on a meta error. It runs before the access check: for a new
 * resource that check runs preSave, which throws when the owner tag or source assigning authority
 * is missing, and a non-403 error there fails the whole request instead of only this item.
 */
class ValidateIncomingStep {
    /**
     * @param {ResourceValidator} resourceValidator
     */
    constructor ({ resourceValidator }) {
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
    }

    /**
     * Validates each item's schema, with required fields relaxed for a smart merge, records each
     * schema failure in the validation failure metric, and restores the `_uuid` and
     * `_sourceAssigningAuthority` saved by `PrepareBodyStep`. Then it checks the meta of each
     * schema-valid item that has no stored document.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        const { requestInfo, smartMerge } = context;

        const schemaValidItems = [];
        for (const item of items) {
            const resource = item.incoming;
            const validationError = validateResource({
                resourceBody: resource,
                resourceName: resource.resourceType,
                path: requestInfo.path,
                excludeRequiredFieldErrors: smartMerge
            });

            if (item.savedIdentity) {
                resource._uuid = item.savedIdentity.uuid;
                resource._sourceAssigningAuthority = item.savedIdentity.sourceAssigningAuthority;
            }

            if (validationError) {
                recordValidationFailure(
                    validationError,
                    resource.resourceType,
                    VALIDATION_STAGE.SCHEMA,
                    PATH.SAVE
                );
                item.fail({
                    failure: new WriteFailure({
                        stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
                        subject: WriteFailure.subjectOf(resource),
                        operationOutcome: validationError
                    })
                });
            } else {
                schemaValidItems.push(item);
            }
        }

        for (const item of schemaValidItems) {
            if (item.stored) {
                continue;
            }
            const metaOperationOutcome = this.resourceValidator.validateResourceMetaSync(item.incoming);
            if (metaOperationOutcome) {
                item.fail({
                    failure: new WriteFailure({
                        stage: WRITE_FAILURE_STAGE.INCOMING_META,
                        subject: WriteFailure.subjectOf(item.incoming),
                        operationOutcome: metaOperationOutcome
                    })
                });
            }
        }
    }
}

module.exports = {
    ValidateIncomingStep
};
