const httpContext = require('express-http-context');
const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../utils/assertType');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const { DatabaseAttachmentManager } = require('../../../dataLayer/databaseAttachmentManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../enrich/providers/identifierEnrichmentProvider');
const {
    GroupExtendedTagEnrichmentProvider
} = require('../../../enrich/providers/groupExtendedTagEnrichmentProvider');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const {
    BadRequestError,
    ForbiddenError,
    NotValidatedError,
    PayloadTooLargeError
} = require('../../../utils/httpErrors');
const { getCircularReplacer } = require('../../../utils/getCircularReplacer');
const { GRIDFS, ACCESS_LOGS_ENTRY_DATA, BLOB_OP } = require('../../../constants');
const { WriteItem, WRITE_ITEM_STATUS } = require('../writeItem');
const { WriteContext } = require('../writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { UrlIdentityResolver } = require('../steps/identify/urlIdentityResolver');
const { WriteResponder } = require('./writeResponder');
const { readSingleResourceBody } = require('./singleResourceBody');

/**
 * The failure stages for which update stores the rejected resource in the access log before it
 * throws, when the failure has an OperationOutcome: the read-time type check, the authority-tag
 * check of the identity, the incoming checks, the size check, the validation against the stored
 * document and the result validation.
 */
const ACCESS_LOGGED_STAGES = Object.freeze([
    WRITE_FAILURE_STAGE.STRUCTURE,
    WRITE_FAILURE_STAGE.IDENTITY,
    WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
    WRITE_FAILURE_STAGE.INCOMING_META,
    WRITE_FAILURE_STAGE.SIZE,
    WRITE_FAILURE_STAGE.STORED_VALIDATION,
    WRITE_FAILURE_STAGE.RESULT_VALIDATION
]);

/**
 * Holds everything that depends on FHIR update's (PUT) request and response format. It reads the
 * body into one item under the URL id, turns a failure into the error update throws, checks the
 * flush result, and answers with the written resource, or with the stored one when nothing
 * changed. Update records no operation metrics.
 */
class UpdateResponder extends WriteResponder {
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
     * Reads the body into an `update` write context and one `WriteItem` with
     * `readSingleResourceBody`. The body's id becomes the URL id (without a `|authority` suffix),
     * whatever id the body had, before the identity step reads it.
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{context: WriteContext, items: WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync ({ requestInfo, parsedArgs, resourceType }) {
        const { item } = readSingleResourceBody({
            body: requestInfo.body,
            id: UrlIdentityResolver.parseUrlId(parsedArgs).id,
            resourceType,
            path: requestInfo.path,
            operationName: 'update'
        });
        const context = new WriteContext({
            requestInfo,
            base_version: parsedArgs.base_version,
            parsedArgs,
            smartMerge: false,
            operationName: 'update'
        });
        return { context, items: [item], requestErrors: [], wasIncomingAList: false };
    }

    /**
     * Returns no results when the item did not fail. Otherwise throws the error update throws for
     * the failure, after storing the rejected resource in the access log for a type, identity,
     * incoming, size or result-validation failure that has an OperationOutcome.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @returns {Object[]}
     */
    failureResults ({ items, requestErrors }) {
        const failedItem = items.find((item) => item.status === WRITE_ITEM_STATUS.FAILED);
        if (!failedItem) {
            return [];
        }
        const { failure } = failedItem;
        if (failure.operationOutcome && ACCESS_LOGGED_STAGES.includes(failure.stage)) {
            this.storeFailureAccessLog(failure);
        }
        throw this.errorFor(failure);
    }

    /**
     * Returns the error update throws for the failure: a `ForbiddenError` with the same message for
     * a scope or access failure, a `PayloadTooLargeError` for a size failure, or the error when the
     * size check threw, the error the step wrapped for an attachments or write failure,
     * and otherwise the failure's own error (an identity, build or result-validation error, such as
     * a 412 from the replace build), or a `NotValidatedError` of its OperationOutcome when it has
     * no error, such as a 400 from the validation against the stored document.
     * @param {WriteFailure} failure
     * @returns {Error}
     */
    errorFor (failure) {
        switch (failure.stage) {
            case WRITE_FAILURE_STAGE.SCOPE:
            case WRITE_FAILURE_STAGE.ACCESS:
                return new ForbiddenError(failure.operationOutcome.issue[0].details.text);
            case WRITE_FAILURE_STAGE.SIZE:
                return (
                    failure.error ?? new PayloadTooLargeError(new Error('Payload size too large.'))
                );
            case WRITE_FAILURE_STAGE.ATTACHMENTS:
            case WRITE_FAILURE_STAGE.WRITE:
                return failure.error.nested ?? failure.error;
            default:
                return failure.error ?? new NotValidatedError(failure.operationOutcome);
        }
    }

    /**
     * Stores the rejected resource, from the failure's subject, as the access log's only operation
     * result: its id, uuid, source assigning authority, resource type and OperationOutcome, neither
     * created nor updated.
     * @param {WriteFailure} failure
     * @returns {void}
     */
    storeFailureAccessLog (failure) {
        const { id, uuid, sourceAssigningAuthority, resourceType } = failure.subject;
        httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
            operationResult: [{
                id,
                uuid,
                sourceAssigningAuthority,
                resourceType,
                operationOutcome: failure.operationOutcome,
                created: false,
                updated: false
            }]
        });
    }

    /**
     * Returns the stored document's entry, neither created nor updated, when the item was
     * unchanged, so nothing was flushed for it. Otherwise returns the flush results when the first
     * one was created or updated, and throws a `BadRequestError` with `No merge result` when the
     * flush returned none. When the first result was neither created nor updated and has no issue,
     * an update (a lost write whose replay found the latest stored document equal to the candidate)
     * returns the candidate's entry, neither created nor updated, and a create throws a
     * `BadRequestError`. Any other first result that was neither created nor updated throws a
     * `BadRequestError` with its issue as JSON.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @param {Object[]} executedResults
     * @returns {Object[]}
     */
    results ({ items, requestErrors, executedResults }) {
        const [item] = items;
        if (item?.status === WRITE_ITEM_STATUS.UNCHANGED) {
            return [this.unchangedEntry(item.stored)];
        }
        const [firstResult] = executedResults ?? [];
        if (!firstResult) {
            throw new BadRequestError(new Error('No merge result'));
        }
        if (!firstResult.created && !firstResult.updated) {
            if (item?.writeMode === 'update' && !firstResult.issue) {
                return [this.unchangedEntry(item.candidate)];
            }
            throw new BadRequestError(
                new Error(JSON.stringify(firstResult.issue, getCircularReplacer()))
            );
        }
        return executedResults;
    }

    /**
     * Returns the entry, neither created nor updated, of a document that was not written: its id,
     * uuid, source assigning authority and resource type.
     * @param {Object} document
     * @returns {Object}
     */
    unchangedEntry (document) {
        return {
            created: false,
            updated: false,
            id: document.id,
            uuid: document._uuid,
            sourceAssigningAuthority: document._sourceAssigningAuthority,
            resourceType: document.resourceType
        };
    }

    /**
     * Returns what `fhirResponseWriter.update` sends: the URL id as requested, whether the resource
     * was created, its version and the resource. The resource is a copy of the candidate (the
     * written document, or the one a replay found already stored), or of the stored document when
     * the item was unchanged, with its GridFS attachments and externalized
     * base64 data put back inline, its identifiers and extended-Group tag enriched, serialized as a
     * FHIR resource.
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @param {Object[]} results
     * @returns {Promise<{id: string, created: boolean, resource_version: string|undefined, resource: Object}>}
     */
    async toResponse ({ context, items, results }) {
        const [item] = items;
        const unchanged = item.status === WRITE_ITEM_STATUS.UNCHANGED;
        let document = deepcopy(unchanged ? item.stored : item.candidate);
        document = await this.databaseAttachmentManager.transformAttachments(document, GRIDFS.RETRIEVE);
        document = await this.base64DataManager.transformAsync(
            document,
            BLOB_OP.RETRIEVE,
            context.requestInfo
        );
        this.identifierEnrichmentProvider.enrichIdentifierList(document);
        [document] = await this.groupExtendedTagEnrichmentProvider.enrichAsync({ resources: [document] });
        return {
            id: context.parsedArgs.id,
            created: unchanged ? false : results[0].created,
            resource_version: document.meta?.versionId,
            resource: FhirResourceSerializer.serialize(document)
        };
    }

    /**
     * Records nothing: update has no operation metrics.
     * @returns {void}
     */
    recordMetrics () {
    }
}

module.exports = {
    UpdateResponder
};
