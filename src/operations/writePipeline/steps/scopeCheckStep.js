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
 * `uuid` or source assigning authority.
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
     * each item of a forbidden type.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {{accessRequested: string, action: string}} profile
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context, profile }) {
        /**
         * @type {Map<string, Object|null>}
         */
        const forbiddenErrorByResourceType = new Map();
        for (const item of items) {
            const resourceType = item.incoming.resourceType;
            if (!forbiddenErrorByResourceType.has(resourceType)) {
                forbiddenErrorByResourceType.set(
                    resourceType,
                    await this.scopesValidator.isScopesValidAsync({
                        requestInfo: context.requestInfo,
                        resourceType,
                        accessRequested: profile.accessRequested,
                        action: profile.action,
                        base_version: context.base_version
                    })
                );
            }
            const forbiddenError = forbiddenErrorByResourceType.get(resourceType);
            if (forbiddenError) {
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
}

module.exports = {
    ScopeCheckStep
};
