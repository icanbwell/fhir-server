const { assertTypeEquals } = require('../../../../utils/assertType');
const { ScopesValidator } = require('../../../security/scopesValidator');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');
const { AccessTagChangeChecker } = require('./accessTagChangeChecker');

/**
 * The access letter a created Person is checked with.
 */
const CREATE_ACCESS_REQUESTED = 'c';

/**
 * The access checker for the `accessOnResult` step of an admin write, once for the batch. For an
 * item with no stored document (a created Person) it checks, with the `c` access letter, that the
 * caller may access the built document, by the access scopes and the patient scopes, and that it
 * may add every access tag the built document carries, as a create does. It passes the other items
 * to the access-tag change checker. An item whose built document is `null` is a no-op and is
 * skipped. Each forbidden item fails at the `ACCESS` stage.
 */
class AdminResultAccessChecker {
    /**
     * @param {ScopesValidator} scopesValidator
     * @param {AccessTagChangeChecker} accessTagChangeChecker
     */
    constructor ({ scopesValidator, accessTagChangeChecker }) {
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
        /**
         * @type {AccessTagChangeChecker}
         */
        this.accessTagChangeChecker = accessTagChangeChecker;
        assertTypeEquals(accessTagChangeChecker, AccessTagChangeChecker);
    }

    /**
     * Returns one entry per item, in item order: null if the item is a no-op or its built document
     * is allowed, else an `ACCESS` failure whose OperationOutcome carries the validator's forbidden
     * issue. An error other than a 403 propagates.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {string} accessRequested the SMART scope letter the check of an updated item requires
     * @returns {Promise<(WriteFailure|null)[]>}
     */
    async checkAsync ({ items, context, accessRequested }) {
        const updatedItems = items.filter(
            (item) => item.candidate !== null && item.stored !== null
        );
        const updateFailures = await this.accessTagChangeChecker.checkAsync({
            items: updatedItems,
            context,
            accessRequested
        });
        const updateFailureByItem = new Map(
            updatedItems.map((item, position) => [item, updateFailures[position]])
        );
        const failures = [];
        for (const item of items) {
            if (item.candidate === null) {
                failures.push(null);
            } else if (item.stored === null) {
                failures.push(await this._checkCreatedAsync({ item, context }));
            } else {
                failures.push(updateFailureByItem.get(item));
            }
        }
        return failures;
    }

    /**
     * Returns null when the caller may create the item's built document with its access tags, else
     * an `ACCESS` failure for it. Throws an error that is not a 403.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async _checkCreatedAsync ({ item, context }) {
        try {
            await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                requestInfo: context.requestInfo,
                resource: item.candidate,
                base_version: context.base_version,
                accessRequested: CREATE_ACCESS_REQUESTED
            });
            this.scopesValidator.isAccessTagChangeAllowedByAccessScopes({
                requestInfo: context.requestInfo,
                currentResource: null,
                updatedResource: item.candidate,
                accessRequested: CREATE_ACCESS_REQUESTED
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
    AdminResultAccessChecker
};
