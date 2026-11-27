const { assertTypeEquals } = require('../../../../utils/assertType');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const { DatabaseAttachmentManager } = require('../../../../dataLayer/databaseAttachmentManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../../enrich/providers/identifierEnrichmentProvider');
const {
    GroupExtendedTagEnrichmentProvider
} = require('../../../../enrich/providers/groupExtendedTagEnrichmentProvider');
const { BadRequestError } = require('../../../../utils/httpErrors');
const { fhirContentTypes } = require('../../../../utils/contentTypes');
const {
    validatePatchDoesNotTargetInternalFields
} = require('../../../patch/validators/patchInternalFieldsValidator');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');
const { WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteResponder } = require('../../writeResponder');
const {
    throwIfItemFailed,
    firstExecutedResult,
    notWrittenError
} = require('../singleResource/singleResourceResult');
const {
    unchangedEntry,
    buildResponseDocumentAsync
} = require('../singleResource/singleResourceDocument');

/**
 * The failure stages for which patch stores the rejected resource in the access log before it
 * throws, when the failure has an OperationOutcome: only a failed result validation, as the old
 * patch does.
 */
const ACCESS_LOGGED_STAGES = Object.freeze([WRITE_FAILURE_STAGE.RESULT_VALIDATION]);

/**
 * Holds everything that depends on FHIR patch's (PATCH) request and response format. It checks the
 * JSON Patch body and reads it into one stub item under the URL id, turns a failure into the error
 * patch throws, checks the flush result, and answers with the patched resource, or with the stored
 * one when nothing changed. Patch records no operation metrics.
 */
class PatchResponder extends WriteResponder {
    /**
     * @param {Base64DataManager} base64DataManager
     * @param {DatabaseAttachmentManager} databaseAttachmentManager
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
     * @param {GroupExtendedTagEnrichmentProvider} groupExtendedTagEnrichmentProvider
     */
    constructor ({
        base64DataManager,
        databaseAttachmentManager,
        identifierEnrichmentProvider,
        groupExtendedTagEnrichmentProvider
    }) {
        super();
        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
        /**
         * @type {DatabaseAttachmentManager}
         */
        this.databaseAttachmentManager = databaseAttachmentManager;
        assertTypeEquals(databaseAttachmentManager, DatabaseAttachmentManager);
        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);
        /**
         * @type {GroupExtendedTagEnrichmentProvider}
         */
        this.groupExtendedTagEnrichmentProvider = groupExtendedTagEnrichmentProvider;
        assertTypeEquals(groupExtendedTagEnrichmentProvider, GroupExtendedTagEnrichmentProvider);
    }

    /**
     * Throws a `BadRequestError` when the request's content type is not JSON Patch, then when a
     * patch operation targets an internal `_` field, before anything is built. Otherwise reads the
     * request into a write context with `smartMerge` off and one stub `WriteItem` whose `incoming`
     * is the resource type and the URL id (as given, which may carry a `|authority` suffix or be a
     * uuid) and whose `patch` is the request body.
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{context: WriteContext, items: WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync ({ requestInfo, parsedArgs, resourceType }) {
        const { contentTypeFromHeader, body: patchContent } = requestInfo;
        if (!contentTypeFromHeader || contentTypeFromHeader.type !== fhirContentTypes.jsonPatch) {
            const message = `Content-Type ${contentTypeFromHeader ? contentTypeFromHeader.type : ''} ` +
                'is not supported for patch. ' +
                `Only ${fhirContentTypes.jsonPatch} is supported.`;
            throw new BadRequestError(
                {
                    message,
                    toString: function () {
                        return message;
                    }
                }
            );
        }
        validatePatchDoesNotTargetInternalFields(patchContent);
        const item = new WriteItem({ index: 0, incoming: { resourceType, id: parsedArgs.id } });
        item.patch = patchContent;
        const context = new WriteContext({
            requestInfo,
            base_version: parsedArgs.base_version,
            parsedArgs,
            smartMerge: false
        });
        return { context, items: [item], requestErrors: [], wasIncomingAList: false };
    }

    /**
     * Returns no results when the item did not fail. Otherwise throws the error patch throws for
     * the failure: the lookup's 404 or 400, the 403 of a forbidden update, the build's error, the
     * original error the attachments or write step wrapped (its nested error, as `errorForFailure`
     * throws it), or a `NotValidatedError` for a failed result validation, which is also stored in
     * the access log when it has an OperationOutcome.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @returns {Object[]}
     */
    failureResults ({ items, requestErrors }) {
        throwIfItemFailed({
            items,
            accessLoggedStages: ACCESS_LOGGED_STAGES
        });
        return [];
    }

    /**
     * Returns the stored document's entry, neither created nor updated, when the item was
     * unchanged, so nothing was flushed for it. Otherwise returns the flush results when the first
     * one was created or updated. Throws a `BadRequestError` with `No merge result` when the flush
     * returned none, and a `BadRequestError` with the first result's issue as JSON when it was
     * neither created nor updated, with or without an issue.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @param {Object[]} executedResults
     * @returns {Object[]}
     */
    results ({ items, requestErrors, executedResults }) {
        const [item] = items;
        if (item?.status === WRITE_ITEM_STATUS.UNCHANGED) {
            return [unchangedEntry(item.stored)];
        }
        const firstResult = firstExecutedResult(executedResults);
        if (!firstResult.created && !firstResult.updated) {
            throw notWrittenError(firstResult);
        }
        return executedResults;
    }

    /**
     * Returns what the controller passes to `fhirResponseWriter.update`: the resource's own id, not
     * created, whether it was updated, its version and the resource. The resource is a copy of the
     * patched document, or of the stored document when the item was unchanged, with its GridFS
     * attachments and externalized base64 data put back inline, its identifiers and extended-Group
     * tag enriched, serialized as a FHIR resource.
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @param {Object[]} results
     * @returns {Promise<{id: string, created: boolean, updated: boolean, resource_version: string|undefined, resource: Object}>}
     */
    async toResponse ({ context, items, results }) {
        const [item] = items;
        const unchanged = item.status === WRITE_ITEM_STATUS.UNCHANGED;
        const { resource } = await buildResponseDocumentAsync({
            item,
            requestInfo: context.requestInfo,
            databaseAttachmentManager: this.databaseAttachmentManager,
            base64DataManager: this.base64DataManager,
            identifierEnrichmentProvider: this.identifierEnrichmentProvider,
            groupExtendedTagEnrichmentProvider: this.groupExtendedTagEnrichmentProvider
        });
        return {
            id: resource.id,
            created: false,
            updated: !unchanged,
            resource_version: resource.meta?.versionId,
            resource
        };
    }

    /**
     * Records nothing: patch has no operation metrics.
     * @returns {void}
     */
    recordMetrics () {
    }
}

module.exports = {
    PatchResponder
};
