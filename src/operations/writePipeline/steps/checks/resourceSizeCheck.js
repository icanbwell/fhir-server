const { assertTypeEquals } = require('../../../../utils/assertType');
const { ResourceValidator } = require('../../../common/resourceValidator');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');

/**
 * A precheck for the `findExisting` step, per item: fails an item at the `SIZE` stage when its body
 * is over the size limit, which `ResourceValidator.validateResourceSizeSync` applies to AuditEvent
 * only.
 */
class ResourceSizeCheck {
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
     * The stage this check's failures use, and the one used if it throws: `SIZE`.
     * @returns {string}
     */
    get stage () {
        return WRITE_FAILURE_STAGE.SIZE;
    }

    /**
     * Returns a failure with the too-long OperationOutcome if the body is over the limit, otherwise
     * null.
     * @param {WriteItem} item
     * @returns {Promise<WriteFailure|null>}
     */
    async checkAsync ({ item }) {
        const operationOutcome = this.resourceValidator.validateResourceSizeSync({
            resource: item.incoming,
            resourceType: item.incoming.resourceType
        });
        if (!operationOutcome) {
            return null;
        }
        return new WriteFailure({
            stage: this.stage,
            subject: WriteFailure.subjectOf(item.incoming),
            operationOutcome
        });
    }
}

module.exports = {
    ResourceSizeCheck
};
