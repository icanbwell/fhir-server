const httpContext = require('express-http-context');
const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../utils/assertType');
const { Base64DataManager } = require('../../../dataLayer/base64DataManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../enrich/providers/identifierEnrichmentProvider');
const { FhirResourceSerializer } = require('../../../fhir/fhirResourceSerializer');
const {
    BadRequestError,
    ForbiddenError,
    NotValidatedError,
    PayloadTooLargeError
} = require('../../../utils/httpErrors');
const { generateUUID } = require('../../../utils/uid.util');
const { getCircularReplacer } = require('../../../utils/getCircularReplacer');
const { ACCESS_LOGS_ENTRY_DATA, BLOB_OP } = require('../../../constants');
const { WriteItem, WRITE_ITEM_STATUS } = require('../writeItem');
const { WriteContext } = require('../writeContext');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');
const { WriteResponder } = require('./writeResponder');
const { readSingleResourceBody } = require('./singleResourceBody');

/**
 * The failure stages for which create stores the rejected resource in the access log before it
 * throws, when the failure has an OperationOutcome: the read-time type check, the incoming checks,
 * the size check and the result validation.
 */
const ACCESS_LOGGED_STAGES = Object.freeze([
    WRITE_FAILURE_STAGE.STRUCTURE,
    WRITE_FAILURE_STAGE.INCOMING_META,
    WRITE_FAILURE_STAGE.INCOMING_SCHEMA,
    WRITE_FAILURE_STAGE.SIZE,
    WRITE_FAILURE_STAGE.RESULT_VALIDATION
]);

/**
 * Holds everything that depends on FHIR create's (POST) request and response format. It reads the
 * body into one item with a new id, turns a failure into the error create throws, checks the flush
 * result, and answers with the written resource. Create records no operation metrics.
 */
class CreateResponder extends WriteResponder {
    /**
     * @param {Base64DataManager} base64DataManager
     * @param {IdentifierEnrichmentProvider} identifierEnrichmentProvider
     */
    constructor ({ base64DataManager, identifierEnrichmentProvider }) {
        super();
        /**
         * @type {Base64DataManager}
         */
        this.base64DataManager = base64DataManager;
        assertTypeEquals(base64DataManager, Base64DataManager);
        /**
         * @type {IdentifierEnrichmentProvider}
         */
        this.identifierEnrichmentProvider = identifierEnrichmentProvider;
        assertTypeEquals(identifierEnrichmentProvider, IdentifierEnrichmentProvider);
    }

    /**
     * Reads the body into a `create` write context and one `WriteItem`. Throws a `BadRequestError`
     * when there is no body or the body is not an object, and for a list body. Replaces the body's
     * id with a new UUID, strips every `_` field from it, and removes the client's
     * `meta.lastUpdated` when `meta` is an object, so no check sees it.
     * When its resourceType is not the one in the URL, the item fails at the `STRUCTURE` stage and
     * the failure is recorded in `fhir_validation_failure_total` at the `schema` stage.
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{context: WriteContext, items: WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync ({ requestInfo, parsedArgs, resourceType }) {
        const { item } = readSingleResourceBody({
            body: requestInfo.body,
            id: generateUUID(),
            resourceType,
            path: requestInfo.path,
            operationName: 'create'
        });
        const context = new WriteContext({
            requestInfo,
            base_version: parsedArgs.base_version,
            parsedArgs,
            smartMerge: false,
            operationName: 'create'
        });
        return { context, items: [item], requestErrors: [], wasIncomingAList: false };
    }

    /**
     * Returns no results when the item did not fail. Otherwise throws the error create throws for
     * the failure, after storing the rejected resource in the access log for a type, incoming,
     * size or result-validation failure that has an OperationOutcome.
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
     * Returns the error create throws for the failure: a `ForbiddenError` with the same message for
     * a scope or access failure, a `NotValidatedError` of the OperationOutcome for a type or
     * incoming failure, a `PayloadTooLargeError` for a size failure, or the error when the size
     * check threw, the error the step wrapped for an attachments or write failure, and the
     * failure's own error for any other failure, such as a result validation that threw, or a
     * `NotValidatedError` of its OperationOutcome when it has no error.
     * @param {WriteFailure} failure
     * @returns {Error}
     */
    errorFor (failure) {
        switch (failure.stage) {
            case WRITE_FAILURE_STAGE.SCOPE:
            case WRITE_FAILURE_STAGE.ACCESS:
                return new ForbiddenError(failure.operationOutcome.issue[0].details.text);
            case WRITE_FAILURE_STAGE.STRUCTURE:
            case WRITE_FAILURE_STAGE.INCOMING_META:
            case WRITE_FAILURE_STAGE.INCOMING_SCHEMA:
                return new NotValidatedError(failure.operationOutcome);
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
     * result: its id (also as the uuid), source assigning authority, resource type and
     * OperationOutcome, neither created nor updated.
     * @param {WriteFailure} failure
     * @returns {void}
     */
    storeFailureAccessLog (failure) {
        const { id, sourceAssigningAuthority, resourceType } = failure.subject;
        httpContext.set(ACCESS_LOGS_ENTRY_DATA, {
            operationResult: [{
                id,
                uuid: id,
                sourceAssigningAuthority,
                resourceType,
                operationOutcome: failure.operationOutcome,
                created: false,
                updated: false
            }]
        });
    }

    /**
     * Returns the flush results when the first one was created or updated. Throws a
     * `BadRequestError` with `No merge result` when the flush returned none, or with the first
     * result's issue as JSON when it was neither created nor updated.
     * @param {WriteItem[]} items
     * @param {Object[]} requestErrors
     * @param {Object[]} executedResults
     * @returns {Object[]}
     */
    results ({ items, requestErrors, executedResults }) {
        const [firstResult] = executedResults ?? [];
        if (!firstResult) {
            throw new BadRequestError(new Error('No merge result'));
        }
        if (!firstResult.created && !firstResult.updated) {
            throw new BadRequestError(
                new Error(JSON.stringify(firstResult.issue, getCircularReplacer()))
            );
        }
        return executedResults;
    }

    /**
     * Returns the written resource: a copy of the item's document with its externalized base64 data
     * put back inline and its identifiers enriched, serialized as a FHIR resource.
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @returns {Promise<Object>}
     */
    async toResponse ({ context, items }) {
        const document = await this.base64DataManager.transformAsync(
            deepcopy(items[0].candidate),
            BLOB_OP.RETRIEVE,
            context.requestInfo
        );
        this.identifierEnrichmentProvider.enrichIdentifierList(document);
        return FhirResourceSerializer.serialize(document);
    }

    /**
     * Records nothing: create has no operation metrics.
     * @returns {void}
     */
    recordMetrics () {
    }
}

module.exports = {
    CreateResponder
};
