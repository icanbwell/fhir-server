const { ValidateResultStep } = require('./validateResultStep');
const { WriteItem } = require('../writeItem');
const { WriteContext } = require('../writeContext');

/**
 * The `validateResult` step for an operation that has already validated the body against the stored
 * document in the `validateAgainstStored` step, as PUT does before the build, so that a body that
 * fails never reaches the soft-deletion of the stored GridFS attachments the merge does. It
 * validates an update's built document with the meta check only. A new document is validated in
 * full, as `ValidateResultStep` does. Like `validateAgainstStored`, it can be removed once GridFS
 * attachments are removed, and then `ValidateResultStep` validates an update in full again.
 */
class ValidateUpdateResultStep extends ValidateResultStep {
    /**
     * Returns the meta check's outcome for the merged document, or null when it passes.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<Object|null>}
     */
    async validateUpdateAsync ({ item }) {
        return this.resourceValidator.validateResourceMetaSync(item.candidate);
    }
}

module.exports = {
    ValidateUpdateResultStep
};
