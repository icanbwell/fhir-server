const { assertIsValid } = require('../../../utils/assertType');
const { WriteFailure } = require('../writeFailure');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `accessBeforeBuild` step, once for the batch: fails each item the access checker rejects. For
 * `$merge` the checker checks the stored document and the incoming body before the merge, so a
 * rejected item never reaches `buildDocument`, where the resource merger can delete stored GridFS
 * attachments.
 */
class AccessCheckStep {
    /**
     * @param {{checkAsync: function({items: WriteItem[], context: WriteContext}): Promise<(WriteFailure|null)[]>}} accessChecker
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
     * list is a failure. An error the checker throws fails the whole request.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async runAsync ({ items, context }) {
        const failures = await this.accessChecker.checkAsync({ items, context });
        items.forEach((item, index) => {
            if (failures[index]) {
                item.fail({ failure: failures[index] });
            }
        });
    }
}

module.exports = {
    AccessCheckStep
};
