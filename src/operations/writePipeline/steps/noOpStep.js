const { WriteItem } = require('../writeItem');

/**
 * The `noOpCheck` step, per item: marks an item unchanged when it has no built document, so nothing
 * is written for it. The builder leaves `candidate` null when the merge finds no change.
 */
class NoOpStep {
    /**
     * Marks each item whose `candidate` is null as unchanged.
     * @param {WriteItem[]} items
     * @returns {Promise<void>}
     */
    async runAsync ({ items }) {
        for (const item of items) {
            if (item.candidate === null) {
                item.markUnchanged();
            }
        }
    }
}

module.exports = {
    NoOpStep
};
