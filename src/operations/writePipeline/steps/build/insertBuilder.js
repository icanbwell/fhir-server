const moment = require('moment-timezone');
const { WriteFailure } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');

/**
 * The builder for the `buildDocument` step when the body is a new document, per item: stamps the
 * first version on the body and uses it as the document to insert.
 */
class InsertBuilder {
    /**
     * Sets the body's `meta.versionId` to '1' and `meta.lastUpdated` to now, then sets `candidate`
     * to the body and `writeMode` to 'insert'. Returns null: it has no check that can fail.
     * @param {WriteItem} item
     * @returns {Promise<WriteFailure|null>}
     */
    async buildAsync ({ item }) {
        const incoming = item.incoming;
        incoming.meta.versionId = '1';
        incoming.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        item.candidate = incoming;
        item.writeMode = 'insert';
        return null;
    }
}

module.exports = {
    InsertBuilder
};
