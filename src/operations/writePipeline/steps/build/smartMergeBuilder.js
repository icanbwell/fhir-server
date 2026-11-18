const moment = require('moment-timezone');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { ConfigManager } = require('../../../../utils/configManager');
const { PreSaveManager } = require('../../../../preSaveHandlers/preSave');
const { PreSaveOptions } = require('../../../../preSaveHandlers/preSaveOptions');
const { ResourceMerger } = require('../../../common/resourceMerger');
const { GroupMemberMerger } = require('../../../common/groupMemberMerger');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { BadRequestError } = require('../../../../utils/httpErrors');
const { buildOperationOutcomeFromIssues } = require('../../../../utils/operationOutcomeBuilder');
const { getExtendedGroupMemberWriteError } = require('../../../../utils/mongoGroupExtendedTag');
const { hasGroupMembers } = require('../../groupMemberWrites');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The error message when a body built as a new document has no `meta.source` and source tags are
 * required.
 */
const MISSING_SOURCE_TAG_MESSAGE = 'Unable to merge resource. Missing either metadata or metadata source.';

/**
 * The builder for the `buildDocument` step for `$merge`, per item: merges the body into the stored
 * document (a smart merge unless the request turns it off), or uses the body as a new document when
 * there is no stored document, the stored document has no `meta`, or the resource is an AuditEvent.
 */
class SmartMergeBuilder {
    /**
     * @param {PreSaveManager} preSaveManager
     * @param {ResourceMerger} resourceMerger
     * @param {ConfigManager} configManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {Base64DataManager} base64DataManager
     * @param {GroupMemberMerger} groupMemberMerger
     */
    constructor ({
        preSaveManager,
        resourceMerger,
        configManager,
        databaseAttachmentManager,
        base64DataManager,
        groupMemberMerger
    }) {
        /**
         * @type {PreSaveManager}
         */
        this.preSaveManager = preSaveManager;
        assertTypeEquals(preSaveManager, PreSaveManager);
        /**
         * @type {ResourceMerger}
         */
        this.resourceMerger = resourceMerger;
        assertTypeEquals(resourceMerger, ResourceMerger);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
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
         * @type {GroupMemberMerger}
         */
        this.groupMemberMerger = groupMemberMerger;
        assertTypeEquals(groupMemberMerger, GroupMemberMerger);
    }

    /**
     * Builds the item's new document and sets `candidate` and `writeMode`; returns a failure, or
     * null. It first converts a non-string `meta.lastUpdated` on the body to an ISO string.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async buildAsync ({ item, context }) {
        this.convertLastUpdatedToIsoString(item.incoming);
        if (item.stored && item.stored.meta && item.incoming.resourceType !== 'AuditEvent') {
            return await this.buildFromStoredAsync({ item, context });
        }
        this.buildNew({ item, context });
        return null;
    }

    /**
     * Converts a non-string `meta.lastUpdated` on the resource to an ISO string, in place.
     * @param {Object} resource
     * @returns {void}
     */
    convertLastUpdatedToIsoString (resource) {
        if (resource.meta && resource.meta.lastUpdated && typeof resource.meta.lastUpdated !== 'string') {
            resource.meta.lastUpdated = new Date(resource.meta.lastUpdated).toISOString();
        }
    }

    /**
     * Runs preSave on the stored document, merges the entries of a member the stored Group lists
     * more than once (every stored entry is an older entry, so none counts toward the per-member
     * entry limit), then merges the body into it with `ResourceMerger.fastMergeResourceAsync`.
     * Merging the stored entries first keeps a body that changes nothing else equal to the stored
     * Group, so it writes nothing. Sets `candidate` to the merged document, or null when nothing
     * changed, and sets `writeMode` to 'update'. Returns a `BUILD` failure, without merging, when
     * the body sends members for a Group whose members are kept outside the document.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async buildFromStoredAsync ({ item, context }) {
        const { requestInfo, smartMerge } = context;
        const incoming = item.incoming;
        const preSaveOptions = PreSaveOptions.fromRequestInfo(requestInfo);
        item.stored = await this.preSaveManager.preSaveAsync({
            resource: item.stored, options: preSaveOptions
        });
        item.stored = this.groupMemberMerger.mergeMembers({
            resource: item.stored,
            requestInfo,
            olderEntries: new Set(item.stored.member)
        });

        const extendedGroupMemberWriteError = getExtendedGroupMemberWriteError({
            currentResource: item.stored,
            hasMemberField: hasGroupMembers(incoming)
        });
        if (extendedGroupMemberWriteError) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.BUILD,
                subject: WriteFailure.subjectOf(incoming),
                operationOutcome: buildOperationOutcomeFromIssues(extendedGroupMemberWriteError.issue)
            });
        }

        const { updatedResource } = await this.resourceMerger.fastMergeResourceAsync({
            requestInfo,
            currentResource: item.stored,
            resourceToMerge: incoming,
            smartMerge,
            databaseAttachmentManager: this.databaseAttachmentManager,
            base64DataManager: this.base64DataManager,
            ignoreDateOnlyChange: true
        });
        item.candidate = updatedResource || null;
        item.writeMode = 'update';
        return null;
    }

    /**
     * Uses the body as the new document, sets its `meta.versionId` to '1' and `meta.lastUpdated` to
     * now when it has a `meta`, merges the entries of a Group member it lists more than once, and
     * sets `writeMode` to 'insert'. Throws a `BadRequestError`, which fails only this item, when
     * source tags are required and the body has no `meta.source`, or when the body sends more
     * entries for one member than the limit allows.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {void}
     */
    buildNew ({ item, context }) {
        const incoming = item.incoming;
        if (this.configManager.requireMetaSourceTags && (!incoming.meta || !incoming.meta.source)) {
            throw new BadRequestError(new Error(MISSING_SOURCE_TAG_MESSAGE));
        }
        if (incoming.meta) {
            incoming.meta.versionId = '1';
            incoming.meta.lastUpdated = new Date(moment.utc().format('YYYY-MM-DDTHH:mm:ss.SSSZ'));
        }
        item.candidate = this.groupMemberMerger.mergeMembers({
            resource: incoming,
            requestInfo: context.requestInfo
        });
        item.writeMode = 'insert';
    }
}

module.exports = {
    SmartMergeBuilder
};
