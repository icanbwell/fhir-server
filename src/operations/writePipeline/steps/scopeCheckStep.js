const { assertTypeEquals } = require('../../../utils/assertType');
const { ScopesValidator } = require('../../security/scopesValidator');
const { buildOperationOutcomeFromIssues } = require('../../../utils/operationOutcomeBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `scopeCheck` step, per item: fails an item at the `SCOPE` stage when
 * `ScopesValidator.isScopesValidAsync` forbids the profile's `accessRequested` on its resource
 * type. It runs before the `_uuid` is derived, so a forbidden item's result doesn't gain a derived
 * `uuid` or source assigning authority. When the profile sets `itemErrorsFailItem`, an error the
 * check throws for a type fails each item of that type at the `SCOPE` stage; otherwise it rejects.
 */
class ScopeCheckStep {
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
     * Checks the scopes with the profile's `accessRequested` and `action`, once for each resource
     * type among the items, because the answer depends only on the request and the type, and fails
     * each item of a forbidden type, or of a type whose check threw when the profile sets
     * `itemErrorsFailItem`.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {{accessRequested: string, action: string, itemErrorsFailItem?: boolean}} profile
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context, profile }) {
        /**
         * @type {Map<string, {forbiddenError?: Object, error?: Error}>}
         */
        const checkByResourceType = new Map();
        for (const item of items) {
            const resourceType = item.incoming.resourceType;
            if (!checkByResourceType.has(resourceType)) {
                checkByResourceType.set(
                    resourceType,
                    await this.checkResourceTypeAsync({ resourceType, context, profile })
                );
            }
            const { forbiddenError, error } = checkByResourceType.get(resourceType);
            if (error) {
                item.fail({
                    failure: new WriteFailure({
                        stage: WRITE_FAILURE_STAGE.SCOPE,
                        subject: WriteFailure.subjectOf(item.incoming),
                        error
                    })
                });
            } else if (forbiddenError) {
                item.fail({
                    failure: new WriteFailure({
                        stage: WRITE_FAILURE_STAGE.SCOPE,
                        subject: WriteFailure.subjectOf(item.incoming),
                        operationOutcome: buildOperationOutcomeFromIssues(forbiddenError.issue)
                    })
                });
            }
        }
    }

    /**
     * Returns the scopes check of one resource type: the error that forbids it, if any, or, when
     * the profile sets `itemErrorsFailItem`, the error the check threw. Rethrows that error
     * otherwise.
     * @param {string} resourceType
     * @param {WriteContext} context
     * @param {{accessRequested: string, action: string, itemErrorsFailItem?: boolean}} profile
     * @returns {Promise<{forbiddenError?: Object, error?: Error}>}
     */
    async checkResourceTypeAsync ({ resourceType, context, profile }) {
        try {
            const forbiddenError = await this.scopesValidator.isScopesValidAsync({
                requestInfo: context.requestInfo,
                resourceType,
                accessRequested: profile.accessRequested,
                action: profile.action,
                base_version: context.base_version
            });
            return { forbiddenError };
        } catch (error) {
            if (profile.itemErrorsFailItem !== true) {
                throw error;
            }
            return { error };
        }
    }
}

module.exports = {
    ScopeCheckStep
};
