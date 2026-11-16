const { assertIsValid } = require('../../../utils/assertType');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `findExisting` step: the loader loads the stored documents once for the whole batch of
 * active items. It runs after `validateIncoming`, so an item that fails a body check is not loaded.
 */
class FindExistingStep {
    /**
     * @param {{loadAsync: function({items: WriteItem[], context: WriteContext}): Promise<void>}} existingResourceLoader
     */
    constructor ({ existingResourceLoader }) {
        /**
         * @type {{loadAsync: function}}
         */
        this.existingResourceLoader = existingResourceLoader;
        assertIsValid(existingResourceLoader, 'existingResourceLoader is required');
    }

    /**
     * Passes the active items to the loader in one call, which sets each item's `stored`.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        await this.existingResourceLoader.loadAsync({ items, context });
    }
}

module.exports = {
    FindExistingStep
};
