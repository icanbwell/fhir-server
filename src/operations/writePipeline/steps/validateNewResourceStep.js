const { assertTypeEquals } = require('../../../utils/assertType');
const { ResourceValidator } = require('../../common/resourceValidator');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');

/**
 * The `validateNewResource` step, per item with no stored document: fails the item at
 * `INCOMING_META` when `ResourceValidator.validateResourceMetaSync` rejects its meta, such as a
 * missing owner tag. It runs after `findExisting`, which sets `stored`, and before the access
 * check: for a new resource that check runs preSave, which throws when the owner tag or source
 * assigning authority is missing, and a non-403 error there fails the whole request instead of only
 * this item.
 */
class ValidateNewResourceStep {
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
     * Checks the meta of each item that has no stored document and fails each one it rejects.
     * @param {WriteItem[]} items
     * @returns {Promise<void>}
     */
    async runAsync ({ items }) {
        for (const item of items) {
            if (item.stored) {
                continue;
            }
            const metaOperationOutcome = this.resourceValidator.validateResourceMetaSync(
                item.incoming
            );
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
    ValidateNewResourceStep
};
