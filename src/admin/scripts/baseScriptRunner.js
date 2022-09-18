const {connectAsync, disconnectAsync} = require('../../utils/connect');

/**
 * @typedef StartFromIdContainer
 * @property {string | null} startFromId
 * @property {number} skippedIdsForHavingAccessField
 * @property {number} skippedIdsForMissingSecurityTags
 * @property {number} convertedIds
 * @property {number} nModified
 * @property {number} nUpserted
 */

class BaseScriptRunner {
    async init() {
        await connectAsync();
        /**
         * For reporting progress
         * @type {StartFromIdContainer}
         */
        this.startFromIdContainer = {
            startFromId: '',
            skippedIdsForHavingAccessField: 0,
            skippedIdsForMissingSecurityTags: 0,
            skippedIdsForMissingAccessTags: 0,
            convertedIds: 0,
            nModified: 0,
            nUpserted: 0
        };
    }

    async shutdown() {
        await disconnectAsync();
    }
}

module.exports = {
    BaseScriptRunner
};
