const { assertIsValid } = require('../../../utils/assertType');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `findExisting` step: per item, runs the prechecks and then the identity resolver, which
 * derives the `_uuid`; then the loader loads the stored documents once for the whole batch. The
 * prechecks run before the `_uuid` is derived, so they check the body as read and their failures
 * carry no derived `uuid`.
 */
class FindExistingStep {
    /**
     * @param {{stage: string, checkAsync: function({item: WriteItem, context: WriteContext}): Promise<WriteFailure|null>}[]} prechecks
     * @param {{resolveAsync: function({item: WriteItem, context: WriteContext}): Promise<WriteFailure|null>}} identityResolver
     * @param {{loadAsync: function({items: WriteItem[], context: WriteContext}): Promise<void>}} existingResourceLoader
     */
    constructor ({ prechecks, identityResolver, existingResourceLoader }) {
        /**
         * @type {{stage: string, checkAsync: function}[]}
         */
        this.prechecks = prechecks;
        assertIsValid(Array.isArray(prechecks), 'prechecks must be an array');
        /**
         * @type {{resolveAsync: function}}
         */
        this.identityResolver = identityResolver;
        assertIsValid(identityResolver, 'identityResolver is required');
        /**
         * @type {{loadAsync: function}}
         */
        this.existingResourceLoader = existingResourceLoader;
        assertIsValid(existingResourceLoader, 'existingResourceLoader is required');
    }

    /**
     * Fails each item that a precheck or the identity resolver rejects, then passes the rest to the
     * loader in one call.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        const identifiedItems = [];
        for (const item of items) {
            const failure = await this.checkAndIdentifyAsync({ item, context });
            if (failure) {
                item.fail({ failure });
            } else {
                identifiedItems.push(item);
            }
        }
        await this.existingResourceLoader.loadAsync({ items: identifiedItems, context });
    }

    /**
     * Runs the prechecks in order, then the identity resolver, and returns the first failure, or
     * null. The resolver sets the item's `_uuid`.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async checkAndIdentifyAsync ({ item, context }) {
        for (const precheck of this.prechecks) {
            const failure = await this.runStrategyAsync({
                item,
                stage: precheck.stage,
                func: async () => await precheck.checkAsync({ item, context })
            });
            if (failure) {
                return failure;
            }
        }
        return await this.runStrategyAsync({
            item,
            stage: WRITE_FAILURE_STAGE.IDENTITY,
            func: async () => await this.identityResolver.resolveAsync({ item, context })
        });
    }

    /**
     * Runs one precheck or the resolver and returns its result. A thrown error becomes a failure at
     * `stage` for this item only.
     * @param {WriteItem} item
     * @param {string} stage
     * @param {function(): Promise<WriteFailure|null>} func
     * @returns {Promise<WriteFailure|null>}
     */
    async runStrategyAsync ({ item, stage, func }) {
        try {
            return await func();
        } catch (error) {
            return new WriteFailure({ stage, subject: WriteFailure.subjectOf(item.incoming), error });
        }
    }
}

module.exports = {
    FindExistingStep
};
