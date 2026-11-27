const { assertTypeEquals } = require('../../../utils/assertType');
const { ResourceValidator } = require('../../common/resourceValidator');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');

/**
 * The `validateNewResource` step, per item with no stored document: fails the item at
 * `INCOMING_META` when `ResourceValidator.validateResourceMetaSync` rejects its meta, such as a
 * missing owner tag. It runs after `findExisting`, which sets `stored`. For an operation that turns
 * `findExisting` off, such as POST, `stored` stays null, so every item gets the meta check. It runs
 * before the access check: for a new resource that check runs preSave, which throws when the owner tag or source
 * assigning authority is missing, and a non-403 error there fails the whole request instead of only
 * this item. When the profile sets `itemErrorsFailItem`, an error the meta check throws for an item
 * fails only that item at `INCOMING_META`; otherwise it rejects.
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
     * Checks the meta of each item that has no stored document and fails each one it rejects, or,
     * when the profile sets `itemErrorsFailItem`, each one whose check throws.
     * @param {WriteItem[]} items
     * @param {{itemErrorsFailItem?: boolean}} [profile]
     * @returns {Promise<void>}
     */
    async runAsync ({ items, profile }) {
        for (const item of items) {
            if (item.stored) {
                continue;
            }
            const failure = this.checkMeta({ item, profile });
            if (failure) {
                item.fail({ failure });
            }
        }
    }

    /**
     * Returns an `INCOMING_META` failure with the meta check's outcome when it rejects the item, or
     * with the error it throws when the profile sets `itemErrorsFailItem`, or null. Rethrows that
     * error otherwise.
     * @param {WriteItem} item
     * @param {{itemErrorsFailItem?: boolean}} [profile]
     * @returns {WriteFailure|null}
     */
    checkMeta ({ item, profile }) {
        let metaOperationOutcome;
        try {
            metaOperationOutcome = this.resourceValidator.validateResourceMetaSync(item.incoming);
        } catch (error) {
            if (profile?.itemErrorsFailItem !== true) {
                throw error;
            }
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.INCOMING_META,
                subject: WriteFailure.subjectOf(item.incoming),
                error
            });
        }
        if (!metaOperationOutcome) {
            return null;
        }
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.INCOMING_META,
            subject: WriteFailure.subjectOf(item.incoming),
            operationOutcome: metaOperationOutcome
        });
    }
}

module.exports = {
    ValidateNewResourceStep
};
