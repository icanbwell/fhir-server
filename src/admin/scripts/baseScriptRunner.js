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

/**
 * @classdesc base class that implements connecting to the database
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
        try {
            await disconnectAsync();
        } catch (e) {
            console.error(`Error shutting down: ${JSON.stringify(e)}`);
        }
    }
}

module.exports = {
    BaseScriptRunner
};
