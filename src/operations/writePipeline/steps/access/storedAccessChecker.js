const { assertTypeEquals } = require('../../../../utils/assertType');
const { ScopesValidator } = require('../../../security/scopesValidator');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The access checker for the `accessBeforeBuild` step of PATCH, once for the batch: checks that the
 * caller may update each item's stored document, by the access scopes and the patient scopes, as
 * the old PATCH does. Each forbidden item fails at the `ACCESS` stage.
 */
class StoredAccessChecker {
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
     * Returns one entry per item, in item order: null if the caller may update the item's stored
     * document, else an `ACCESS` failure whose OperationOutcome carries the validator's forbidden
     * issue. An error other than a 403 propagates.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {string} accessRequested the SMART scope letter the check requires
     * @returns {Promise<(WriteFailure|null)[]>}
     */
    async checkAsync ({ items, context, accessRequested }) {
        const failures = [];
        for (const item of items) {
            failures.push(await this._checkItemAsync({ item, context, accessRequested }));
        }
        return failures;
    }

    /**
     * Returns null when the caller may update the item's stored document, else an `ACCESS` failure
     * for it. Throws an error that is not a 403.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {string} accessRequested
     * @returns {Promise<WriteFailure|null>}
     */
    async _checkItemAsync ({ item, context, accessRequested }) {
        try {
            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo: context.requestInfo,
                resource: item.stored,
                base_version: context.base_version,
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
    StoredAccessChecker
};
