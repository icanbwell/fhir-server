const { assertTypeEquals } = require('../../../utils/assertType');
const { ResourceValidator } = require('../../common/resourceValidator');
const { validateResource } = require('../../../utils/validator.util');
const { recordValidationFailure, VALIDATION_STAGE, PATH } = require('../../../utils/metrics');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `validateIncoming` step, per item, on the body that `PrepareBodyStep` stripped of its `_`
 * fields: runs the size check, then the pipe-in-id check, then the schema check, then restores
 * the `_uuid` and `_sourceAssigningAuthority` saved by `PrepareBodyStep`; the first failure wins.
 * A size or pipe-in-id failure is built before the identity is restored, so it carries no `uuid`
 * or source assigning authority. Every operation runs both checks. A schema error fails the item
 * at `INCOMING_SCHEMA` and is recorded in `fhir_validation_failure_total` at the `schema` stage.
 * It runs before `findExisting`, so an item that fails here is not loaded.
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
     * Validates each item and fails each item that a check rejects.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        for (const item of items) {
            const failure = this.validateItem({ item, context });
            if (failure) {
                item.fail({ failure });
            }
        }
    }

    /**
     * Runs the size check, the pipe-in-id check, then the schema check with required fields
     * relaxed for a smart merge, then restores the saved identity, and returns the first failure,
     * or null. An item that fails the size or pipe-in-id check skips the schema check and keeps its
     * stripped body.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {WriteFailure|null}
     */
    validateItem ({ item, context }) {
        const bodyFailure = this.checkSize(item) ?? this.checkPipeInId(item);
        if (bodyFailure) {
            return bodyFailure;
        }
        const resource = item.incoming;
        const validationError = validateResource({
            resourceBody: resource,
            resourceName: resource.resourceType,
            path: context.requestInfo.path,
            excludeRequiredFieldErrors: context.smartMerge
        });
        this.restoreIdentity(item);
        if (!validationError) {
            return null;
        }
        recordValidationFailure(
            validationError,
            resource.resourceType,
            VALIDATION_STAGE.SCHEMA,
            PATH.SAVE
        );
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
            subject: WriteFailure.subjectOf(resource),
            operationOutcome: validationError
        });
    }

    /**
     * Returns a `SIZE` failure with the too-long OperationOutcome when the body is over the size
     * limit, which `ResourceValidator.validateResourceSizeSync` applies to AuditEvent only, or
     * null. A size check that throws becomes a `SIZE` failure carrying the error, for this item
     * only.
     * @param {WriteItem} item
     * @returns {WriteFailure|null}
     */
    checkSize (item) {
        let operationOutcome;
        try {
            operationOutcome = this.resourceValidator.validateResourceSizeSync({
                resource: item.incoming,
                resourceType: item.incoming.resourceType
            });
        } catch (error) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.SIZE,
                subject: WriteFailure.subjectOf(item.incoming),
                error
            });
        }
        if (!operationOutcome) {
            return null;
        }
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.SIZE,
            subject: WriteFailure.subjectOf(item.incoming),
            operationOutcome
        });
    }

    /**
     * Returns an `IDENTITY` failure carrying an error when the id is a string that contains `|`,
     * otherwise null.
     * @param {WriteItem} item
     * @returns {WriteFailure|null}
     */
    checkPipeInId (item) {
        const { id } = item.incoming;
        if (typeof id !== 'string' || !id.includes('|')) {
            return null;
        }
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.IDENTITY,
            subject: WriteFailure.subjectOf(item.incoming),
            error: new Error('Pipe | is not allowed in id field')
        });
    }

    /**
     * Puts the `_uuid` and `_sourceAssigningAuthority` saved by `PrepareBodyStep` back on the body.
     * @param {WriteItem} item
     * @returns {void}
     */
    restoreIdentity (item) {
        if (!item.savedIdentity) {
            return;
        }
        item.incoming._uuid = item.savedIdentity.uuid;
        item.incoming._sourceAssigningAuthority = item.savedIdentity.sourceAssigningAuthority;
    }
}

module.exports = {
    ValidateIncomingStep
};
