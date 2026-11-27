const { assertIsValid } = require('../../../utils/assertType');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `accessBeforeBuild` and `accessOnResult` steps, once for the batch: fails each item the access
 * checker rejects. For `$merge` the `accessBeforeBuild` checker checks the stored document and the
 * incoming body before the merge, so a rejected item never reaches `buildDocument`, where the
 * resource merger can delete stored GridFS attachments. The `accessOnResult` checker checks the
 * built document.
 */
class AccessCheckStep {
    /**
     * @param {{checkAsync: function({items: WriteItem[], context: WriteContext, accessRequested: string}): Promise<(WriteFailure|null)[]>}} accessChecker
     */
    constructor ({ accessChecker }) {
        /**
         * @type {{checkAsync: function}}
         */
        this.accessChecker = accessChecker;
        assertIsValid(accessChecker, 'accessChecker is required');
    }

    /**
     * Calls the checker once with all the items and fails each item whose entry in the returned
     * list is a failure. The checker gets the profile's `accessRequested`, the SMART scope letter
     * the run needs. An error the checker throws fails the whole request, unless the profile sets
     * `itemErrorsFailItem`: then the checker, which only reads, runs again for each item alone, so
     * only the item it throws for fails, at the `ACCESS` stage.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @param {{accessRequested: string, itemErrorsFailItem?: boolean}} profile
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context, profile }) {
        let failures;
        try {
            failures = await this.accessChecker.checkAsync({
                items,
                context,
                accessRequested: profile.accessRequested
            });
        } catch (error) {
            if (profile.itemErrorsFailItem !== true) {
                throw error;
            }
            failures = [];
            for (const item of items) {
                failures.push(await this.checkOneAsync({ item, context, profile }));
            }
        }
        items.forEach((item, index) => {
            if (failures[index]) {
                item.fail({ failure: failures[index] });
            }
        });
    }

    /**
     * Calls the checker with one item and returns its entry, or an `ACCESS` failure with the error
     * the checker throws.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {{accessRequested: string}} profile
     * @returns {Promise<WriteFailure|null>}
     */
    async checkOneAsync ({ item, context, profile }) {
        try {
            const [failure] = await this.accessChecker.checkAsync({
                items: [item],
                context,
                accessRequested: profile.accessRequested
            });
            return failure;
        } catch (error) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.ACCESS,
                subject: WriteFailure.subjectOf(item.incoming),
                error
            });
        }
    }
}

module.exports = {
    AccessCheckStep
};
