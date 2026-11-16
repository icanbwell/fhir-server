const { assertIsValid } = require('../../../utils/assertType');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `identify` step, per item: runs the identity resolver, which sets the body's `_uuid` and,
 * for a non-UUID id, its `_sourceAssigningAuthority`. It reads no stored document. It runs after
 * the scope check, so a forbidden item's result doesn't gain a derived `uuid` or source assigning
 * authority.
 */
class IdentifyStep {
    /**
     * @param {{resolveAsync: function({item: WriteItem, context: WriteContext}): Promise<WriteFailure|null>}} identityResolver
     */
    constructor ({ identityResolver }) {
        /**
         * @type {{resolveAsync: function}}
         */
        this.identityResolver = identityResolver;
        assertIsValid(identityResolver, 'identityResolver is required');
    }

    /**
     * Resolves each item's identity and fails each item the resolver rejects. A resolver that
     * throws fails only that item, at the `IDENTITY` stage.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        for (const item of items) {
            const failure = await this.resolveAsync({ item, context });
            if (failure) {
                item.fail({ failure });
            }
        }
    }

    /**
     * Runs the resolver for one item and returns its failure, or null. A thrown error becomes a
     * failure at `IDENTITY` for this item.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async resolveAsync ({ item, context }) {
        try {
            return await this.identityResolver.resolveAsync({ item, context });
        } catch (error) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.IDENTITY,
                subject: WriteFailure.subjectOf(item.incoming),
                error
            });
        }
    }
}

module.exports = {
    IdentifyStep
};
