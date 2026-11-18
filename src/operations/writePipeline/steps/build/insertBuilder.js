const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { GroupMemberMerger } = require('../../../common/groupMemberMerger');
const { WriteFailure } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The builder for the `buildDocument` step when the body is a new document, per item: stamps the
 * first version on the body, keeps one entry per Group member, and uses it as the document to
 * insert.
 */
class InsertBuilder {
    /**
     * @param {GroupMemberMerger} groupMemberMerger
     */
    constructor ({ groupMemberMerger }) {
        /**
         * @type {GroupMemberMerger}
         */
        this.groupMemberMerger = groupMemberMerger;
        assertTypeEquals(groupMemberMerger, GroupMemberMerger);
    }

    /**
     * Sets the body's `meta.versionId` to '1' and `meta.lastUpdated` to now, merges the entries of
     * a Group member the body lists more than once (the access check before the build has already
     * run preSave on it), then sets `candidate` to the body and `writeMode` to 'insert'. Returns
     * null: it has no check that can fail. Throws a `BadRequestError`, which fails only this item,
     * when the body sends more entries for one member than the limit allows.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async buildAsync ({ item, context }) {
        const incoming = item.incoming;
        incoming.meta.versionId = '1';
        incoming.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        item.candidate = this.groupMemberMerger.mergeMembers({
            resource: incoming,
            requestInfo: context.requestInfo
        });
        item.writeMode = 'insert';
        return null;
    }
}

module.exports = {
    InsertBuilder
};
