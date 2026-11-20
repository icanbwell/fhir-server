const { assertTypeEquals } = require('../../../../utils/assertType');
const { ScopesValidator } = require('../../../security/scopesValidator');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');
const { StoredAccessChecker } = require('./storedAccessChecker');

/**
 * The access letter a linked resource is checked with when the item's change names none: a link
 * only reads it, it never changes it.
 */
const DEFAULT_LINKED_ACCESS_REQUESTED = 'r';

/**
 * The access checker for the `accessBeforeBuild` step of an admin write, once for the batch. It
 * passes the items that have a stored document to the stored access checker, which checks that
 * the caller may change each target, and then checks every resource in each item's `linked`, by
 * the access scopes and the patient scopes, with the change's `linkTargetAccess` letter (`r` when
 * it has none): `r` for a link target and `u` for the new Patient of a patient reference rewrite.
 * An item with no stored document (a Person about to be created) has no target to check here; its
 * linked resources are still checked. The linked resources of an item whose target is forbidden
 * are not checked. Each forbidden item fails at the `ACCESS` stage, a forbidden linked resource
 * failing the item that links it.
 */
class AdminTargetsAccessChecker {
    /**
     * @param {StoredAccessChecker} storedAccessChecker
     * @param {ScopesValidator} scopesValidator
     */
    constructor ({ storedAccessChecker, scopesValidator }) {
        /**
         * @type {StoredAccessChecker}
         */
        this.storedAccessChecker = storedAccessChecker;
        assertTypeEquals(storedAccessChecker, StoredAccessChecker);
        /**
         * @type {ScopesValidator}
         */
        this.scopesValidator = scopesValidator;
        assertTypeEquals(scopesValidator, ScopesValidator);
    }

    /**
     * Returns one entry per item, in item order: null if the caller may change the item's target
     * and has the change's access to each of its linked resources, else an `ACCESS` failure whose
     * OperationOutcome carries the validator's forbidden issue. The target check wins over a
     * linked one. An error other than a 403 propagates.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {string} accessRequested the SMART scope letter the target check requires
     * @returns {Promise<(WriteFailure|null)[]>}
     */
    async checkAsync ({ items, context, accessRequested }) {
        const itemsWithTarget = items.filter((item) => item.stored !== null);
        const targetFailures = await this.storedAccessChecker.checkAsync({
            items: itemsWithTarget,
            context,
            accessRequested
        });
        const targetFailureByItem = new Map(
            itemsWithTarget.map((item, position) => [item, targetFailures[position]])
        );
        const failures = [];
        for (const item of items) {
            failures.push(
                targetFailureByItem.get(item) ?? (await this._checkLinkedAsync({ item, context }))
            );
        }
        return failures;
    }

    /**
     * Returns null when the caller has the change's `linkTargetAccess` (`r` when it has none) to
     * every linked resource of the item, else an `ACCESS` failure for the item, from the first
     * forbidden one. Throws an error that is not a 403.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async _checkLinkedAsync ({ item, context }) {
        const accessRequested =
            item.adminChange?.linkTargetAccess ?? DEFAULT_LINKED_ACCESS_REQUESTED;
        for (const { resource } of item.linked) {
            try {
                await this.scopesValidator.isAccessToResourceAllowedByAccessAndPatientScopes({
                    requestInfo: context.requestInfo,
                    resource,
                    base_version: context.base_version,
                    accessRequested
                });
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
        return null;
    }
}

module.exports = {
    AdminTargetsAccessChecker
};
