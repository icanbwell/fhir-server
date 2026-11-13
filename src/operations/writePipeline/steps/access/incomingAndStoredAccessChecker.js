const { assertTypeEquals } = require('../../../../utils/assertType');
const { WriteAllowedByScopesValidator } = require('../../../merge/validators/writeAllowedByScopesValidator');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The access checker for the `accessBeforeBuild` step, once for the batch: runs
 * `WriteAllowedByScopesValidator`, which checks access to the stored document (or to the body for a
 * new resource) and the access-tag changes the body makes. Each forbidden item fails at the
 * `ACCESS` stage.
 */
class IncomingAndStoredAccessChecker {
    /**
     * @param {WriteAllowedByScopesValidator} writeAllowedByScopesValidator
     */
    constructor ({ writeAllowedByScopesValidator }) {
        /**
         * @type {WriteAllowedByScopesValidator}
         */
        this.writeAllowedByScopesValidator = writeAllowedByScopesValidator;
        assertTypeEquals(writeAllowedByScopesValidator, WriteAllowedByScopesValidator);
    }

    /**
     * Returns one entry per item, in item order: null if the item is allowed, else an `ACCESS`
     * failure built from the validator's error. Errors are matched to forbidden items by position,
     * so items that share a `_uuid` each get their own. A non-403 error from the validator
     * propagates.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<(WriteFailure|null)[]>}
     */
    async checkAsync ({ items, context }) {
        const { validatedObjects, preCheckErrors } = await this.writeAllowedByScopesValidator.validate({
            requestInfo: context.requestInfo,
            incomingResources: items.map((item) => item.incoming),
            base_version: context.base_version,
            effectiveSmartMerge: context.smartMerge
        });
        const allowedResources = new Set(validatedObjects);
        const forbiddenItems = items.filter((item) => !allowedResources.has(item.incoming));
        const errorByItem = new Map(forbiddenItems.map((item, position) => [item, preCheckErrors[position]]));
        return items.map((item) => {
            if (allowedResources.has(item.incoming)) {
                return null;
            }
            const entry = errorByItem.get(item);
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: {
                    id: entry.id,
                    uuid: entry._uuid,
                    sourceAssigningAuthority: entry._sourceAssigningAuthority,
                    resourceType: entry.resourceType
                },
                operationOutcome: entry.operationOutcome
            });
        });
    }
}

module.exports = {
    IncomingAndStoredAccessChecker
};
