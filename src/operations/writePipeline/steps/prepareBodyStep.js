const { removeUnderscoreFieldsRecursive } = require('../../../utils/removeUnderscoreFields');
const { WriteItem } = require('../writeItem');

/**
 * The `prepareBody` step, per item: saves the body's `_uuid` and `_sourceAssigningAuthority` in
 * `savedIdentity`, then strips every `_` field from the body for validation. `ValidateIncomingStep`
 * restores the two saved fields.
 */
class PrepareBodyStep {
    /**
     * Saves each item's identity fields and strips the `_` fields from its body, in place.
     * @param {WriteItem[]} items
     * @returns {Promise<void>}
     */
    async runAsync ({ items }) {
        for (const item of items) {
            item.savedIdentity = {
                uuid: item.incoming._uuid,
                sourceAssigningAuthority: item.incoming._sourceAssigningAuthority
            };
            removeUnderscoreFieldsRecursive(item.incoming);
        }
    }
}

module.exports = {
    PrepareBodyStep
};
