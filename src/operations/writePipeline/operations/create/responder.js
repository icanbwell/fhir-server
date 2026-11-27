const deepcopy = require('deepcopy');
const { assertTypeEquals } = require('../../../../utils/assertType');
const { Base64DataManager } = require('../../../../dataLayer/base64DataManager');
const {
    IdentifierEnrichmentProvider
} = require('../../../../enrich/providers/identifierEnrichmentProvider');
const { FhirResourceSerializer } = require('../../../../fhir/fhirResourceSerializer');
const { generateUUID } = require('../../../../utils/uid.util');
const { BLOB_OP } = require('../../../../constants');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');
const { WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteResponder } = require('../../writeResponder');
const { readSingleResourceBody } = require('../singleResource/singleResourceBody');
const {
    throwIfItemFailed,
    firstExecutedResult,
    notWrittenError
} = require('../singleResource/singleResourceResult');

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
     * When its resourceType is not the one in the URL, the item fails at the `STRUCTURE` stage, with
     * the new UUID as its subject's uuid, and the failure is recorded in
     * `fhir_validation_failure_total` at the `schema` stage.
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../../query/parsedArgs').ParsedArgs} parsedArgs
     * @param {string} resourceType
     * @returns {Promise<{context: WriteContext, items: WriteItem[], requestErrors: Object[], wasIncomingAList: boolean}>}
     */
    async readAsync ({ requestInfo, parsedArgs, resourceType }) {
        const id = generateUUID();
        const { item } = readSingleResourceBody({
            body: requestInfo.body,
            id,
            uuid: id,
            resourceType,
            path: requestInfo.path,
            operationName: 'create'
        });
        const context = new WriteContext({
            requestInfo,
            base_version: parsedArgs.base_version,
            parsedArgs,
            smartMerge: false
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
        throwIfItemFailed({
            items,
            accessLoggedStages: ACCESS_LOGGED_STAGES
        });
        return [];
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
        const firstResult = firstExecutedResult(executedResults);
        if (!firstResult.created && !firstResult.updated) {
            throw notWrittenError(firstResult);
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
