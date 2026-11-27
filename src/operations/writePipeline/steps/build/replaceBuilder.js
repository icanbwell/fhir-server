const { assertTypeEquals } = require('../../../../utils/assertType');
const { ResourceMerger } = require('../../../common/resourceMerger');
const { GroupMemberMerger } = require('../../../common/groupMemberMerger');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { PostSaveHandlerFactory } = require('../../../../dataLayer/postSaveHandlers/postSaveHandlerFactory');
const { PreconditionFailedError } = require('../../../../utils/httpErrors');
const { normalizeETag } = require('../../../../utils/ifMatchHelper');
const { getExtendedGroupMemberWriteError } = require('../../../../utils/mongoGroupExtendedTag');
const { HttpPreconditions } = require('../../httpPreconditions');
const { hasGroupMembers } = require('../../groupMemberWrites');
const { InsertBuilder } = require('./insertBuilder');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The builder for the `buildDocument` step of a replace (PUT), per item: checks the request's
 * `If-Match` and `If-None-Match` preconditions against the stored document, then replaces the
 * stored document with the body, or builds the body as a new document when nothing is stored.
 */
class ReplaceBuilder {
    /**
     * @param {ResourceMerger} resourceMerger
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {PostSaveHandlerFactory} postSaveHandlerFactory
     * @param {InsertBuilder} insertBuilder
     * @param {GroupMemberMerger} groupMemberMerger
     */
    constructor ({
        resourceMerger,
        databaseAttachmentManager,
        base64DataManager,
        postSaveHandlerFactory,
        insertBuilder,
        groupMemberMerger
    }) {
        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
        /**
         * @type {PostSaveHandlerFactory}
         */
        this.postSaveHandlerFactory = postSaveHandlerFactory;
        assertTypeEquals(postSaveHandlerFactory, PostSaveHandlerFactory);
        /**
         * @type {InsertBuilder}
         */
        this.insertBuilder = insertBuilder;
        assertTypeEquals(insertBuilder, InsertBuilder);
        /**
         * @type {GroupMemberMerger}
         */
        this.groupMemberMerger = groupMemberMerger;
        assertTypeEquals(groupMemberMerger, GroupMemberMerger);
    }

    /**
     * Builds the item's new document and sets `candidate` and `writeMode`; returns a `BUILD`
     * failure carrying the error when a check fails, or null.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async buildAsync ({ item, context }) {
        const preconditions = HttpPreconditions.fromRequestInfo(context.requestInfo);
        if (item.stored && item.stored.meta) {
            return await this.buildFromStoredAsync({ item, context, preconditions });
        }
        if (preconditions.ifMatch) {
            return this.preconditionFailure({
                item,
                message: `Version conflict: Resource does not exist, but If-Match header was provided. If-Match: ${preconditions.ifMatch}`
            });
        }
        return await this.insertBuilder.buildAsync({ item, context });
    }

    /**
     * Checks, in order, that the body sends no members for a Group whose members are kept outside
     * the document, that `If-None-Match: *` was not sent, and that `If-Match` names the stored
     * version, and returns a `BUILD` failure for the first that fails. Otherwise it replaces the
     * stored document with the body through `ResourceMerger.fastMergeResourceAsync` and sets
     * `candidate` to the result (null when nothing changed, unless the forced Group write applies)
     * and `writeMode` to 'update'.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @param {HttpPreconditions} preconditions
     * @returns {Promise<WriteFailure|null>}
     */
    async buildFromStoredAsync ({ item, context, preconditions }) {
        const incoming = item.incoming;
        const hasMemberField = hasGroupMembers(incoming);
        const extendedGroupMemberWriteError = getExtendedGroupMemberWriteError({
            currentResource: item.stored,
            hasMemberField
        });
        if (extendedGroupMemberWriteError) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.BUILD,
                subject: WriteFailure.subjectOf(incoming),
                error: extendedGroupMemberWriteError
            });
        }
        const preconditionMessage = this.storedPreconditionMessage({ stored: item.stored, preconditions });
        if (preconditionMessage) {
            return this.preconditionFailure({ item, message: preconditionMessage });
        }
        const { updatedResource } = await this.resourceMerger.fastMergeResourceAsync({
            requestInfo: context.requestInfo,
            currentResource: item.stored,
            resourceToMerge: incoming,
            smartMerge: false,
            databaseAttachmentManager: this.databaseAttachmentManager,
            base64DataManager: this.base64DataManager
        });
        item.candidate = updatedResource ||
            this.forcedGroupWrite({ incoming, hasMemberField, requestInfo: context.requestInfo });
        item.writeMode = 'update';
        return null;
    }

    /**
     * Returns the 412 message for the first precondition the stored document fails, or null:
     * `If-None-Match: *` against any stored document, an `If-Match` that names neither the stored
     * version nor `*`, or an `If-Match` against a stored document with no `versionId`.
     * @param {Object} stored
     * @param {HttpPreconditions} preconditions
     * @returns {string|null}
     */
    storedPreconditionMessage ({ stored, preconditions }) {
        const { ifMatch, ifMatchVersionIds, ifNoneMatch } = preconditions;
        if (ifNoneMatch === '*') {
            return 'Version conflict: If-None-Match: * was provided but resource already exists.';
        }
        if (!ifMatch) {
            return null;
        }
        if (!stored.meta.versionId) {
            return `Version conflict: Resource does not have a versionId, but If-Match header was provided. If-Match: ${ifMatch}`;
        }
        const currentVersionId = normalizeETag(String(stored.meta.versionId));
        if (!ifMatchVersionIds.includes(currentVersionId) && !ifMatchVersionIds.includes('*')) {
            return `Version conflict: If-Match does not match current resource version. Older version: ${currentVersionId}, If-Match: ${ifMatch}`;
        }
        return null;
    }

    /**
     * Returns the body as the document to write when the merge found no change but the body is a
     * Group with members whose type has post-save handlers, because its members are written outside
     * the document; else null. The merge has already given the body the stored protected fields,
     * including the stored `versionId`. The entries of a member the body lists more than once are
     * merged, so the write does not bring back an entry the merge removed.
     * @param {Object} incoming
     * @param {boolean} hasMemberField
     * @param {FhirRequestInfo} requestInfo
     * @returns {Object|null}
     */
    forcedGroupWrite ({ incoming, hasMemberField, requestInfo }) {
        if (this.postSaveHandlerFactory.getHandlers(incoming.resourceType).length > 0 && hasMemberField) {
            return this.groupMemberMerger.mergeMembers({ resource: incoming, requestInfo });
        }
        return null;
    }

    /**
     * Returns a `BUILD` failure for the item carrying a `PreconditionFailedError` with the message.
     * @param {WriteItem} item
     * @param {string} message
     * @returns {WriteFailure}
     */
    preconditionFailure ({ item, message }) {
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.BUILD,
            subject: WriteFailure.subjectOf(item.incoming),
            error: new PreconditionFailedError(message)
        });
    }
}

module.exports = {
    ReplaceBuilder
};
