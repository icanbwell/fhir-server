const { assertTypeEquals } = require('../../../../utils/assertType');
const { ScopesValidator } = require('../../../security/scopesValidator');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The access checker for the `accessOnResult` step, once for the batch: checks that the caller may
 * make the access-tag changes between each item's stored document and its built document, removals
 * included. An item whose built document is `null` is a no-op and is skipped. Each forbidden item
 * fails at the `ACCESS` stage.
 */
class AccessTagChangeChecker {
    /**
     * @param {ScopesValidator} scopesValidator
     */
    constructor ({ scopesValidator }) {
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
    }

    /**
     * Returns one entry per item, in item order: null if the item is a no-op or its access-tag
     * change is allowed, else an `ACCESS` failure whose OperationOutcome carries the validator's
     * forbidden issue. An error other than a 403 propagates.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {string} accessRequested the SMART scope letter the check requires
     * @returns {Promise<(WriteFailure|null)[]>}
     */
    async checkAsync ({ items, context, accessRequested }) {
        return items.map((item) => this._checkItem({ item, context, accessRequested }));
    }

    /**
     * Returns null when the item is a no-op or its access-tag change is allowed, else an `ACCESS`
     * failure for it. Throws an error that is not a 403.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {string} accessRequested
     * @returns {WriteFailure|null}
     */
    _checkItem ({ item, context, accessRequested }) {
        if (item.candidate === null) {
            return null;
        }
        try {
            this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                requestInfo: context.requestInfo,
                currentResource: item.stored,
                updatedResource: item.candidate,
                accessRequested
            });
            return null;
        } catch (error) {
            if (error.statusCode !== 403) {
                throw error;
            }
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: WriteFailure.subjectOf(item.incoming),
                operationOutcome: buildOperationOutcomeFromIssues(error.issue)
            });
        }
    }
}

module.exports = {
    AccessTagChangeChecker
};
