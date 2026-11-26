const httpContext = require('express-http-context');
const {
    BadRequestError,
    ForbiddenError,
    NotValidatedError,
    PayloadTooLargeError
} = require('../../../../utils/httpErrors');
const { getCircularReplacer } = require('../../../../utils/getCircularReplacer');
const { ACCESS_LOGS_ENTRY_DATA } = require('../../../../constants');
const { WRITE_ITEM_STATUS } = require('../../writeItem');
const { WRITE_FAILURE_STAGE } = require('../../writeFailure');

/**
 * What the responders of single-resource writes (POST, PUT) share: a failed check is thrown as an
 * HTTP error instead of being reported as a result, and the flush must return a result for the one
 * resource.
 */

/**
 * Returns the error a single-resource write throws for the failure: a `ForbiddenError` with the
 * same message for a scope or access failure, a `PayloadTooLargeError` for a size failure, or the
 * error when the size check threw, the error the step wrapped for an attachments or write failure,
 * and otherwise the failure's own error (such as a 412 or a 400 from the build, or a validation
 * that threw), or a `NotValidatedError` of its OperationOutcome when it has no error.
 * @param {import('../../writeFailure').WriteFailure} failure
 * @returns {Error}
 */
function errorForFailure (failure) {
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
 * created nor updated. The uuid is the subject's, or the one `PrepareBodyStep` saved on the item
 * when the failure was recorded on a body stripped of its `_` fields.
 * @param {import('../../writeItem').WriteItem} item
 * @returns {void}
 */
function storeFailureAccessLog (item) {
    const { failure } = item;
    const { id, sourceAssigningAuthority, resourceType } = failure.subject;
    const uuid = failure.subject.uuid ?? item.savedIdentity?.uuid;
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
 * Does nothing when no item failed. Otherwise throws the error of `errorForFailure` for the first
 * failed item, after storing the rejected resource in the access log when the failure has an
 * OperationOutcome and its stage is one of `accessLoggedStages`.
 * @param {import('../../writeItem').WriteItem[]} items
 * @param {string[]} accessLoggedStages
 * @returns {void}
 */
function throwIfItemFailed ({ items, accessLoggedStages }) {
    const failedItem = items.find((item) => item.status === WRITE_ITEM_STATUS.FAILED);
    if (!failedItem) {
        return;
    }
    const { failure } = failedItem;
    if (failure.operationOutcome && accessLoggedStages.includes(failure.stage)) {
        storeFailureAccessLog(failedItem);
    }
    throw errorForFailure(failure);
}

/**
 * Returns the first flush result. Throws a `BadRequestError` with `No merge result` when the flush
 * returned none.
 * @param {Object[]|undefined} executedResults
 * @returns {Object}
 */
function firstExecutedResult (executedResults) {
    const [firstResult] = executedResults ?? [];
    if (!firstResult) {
        throw new BadRequestError(new Error('No merge result'));
    }
    return firstResult;
}

/**
 * Returns the `BadRequestError` for a flush result that was neither created nor updated, with the
 * result's issue as JSON.
 * @param {Object} executedResult
 * @returns {BadRequestError}
 */
function notWrittenError (executedResult) {
    return new BadRequestError(
        new Error(JSON.stringify(executedResult.issue, getCircularReplacer()))
    );
}

module.exports = {
    throwIfItemFailed,
    firstExecutedResult,
    notWrittenError
};
