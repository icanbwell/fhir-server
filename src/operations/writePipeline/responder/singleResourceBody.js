const { BadRequestError } = require('../../../utils/httpErrors');
const { removeUnderscoreFieldsRecursive } = require('../../../utils/removeUnderscoreFields');
const { getResourceTypeMismatchOutcome } = require('../../../utils/validator.util');
const { recordValidationFailure, VALIDATION_STAGE, PATH } = require('../../../utils/metrics');
const { WriteItem } = require('../writeItem');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../writeFailure');

/**
 * Reads the body of a single-resource write (POST or PUT) into one `WriteItem`. Throws a
 * `BadRequestError` when there is no body or the body is not an object
 * (`Request body is required.`), and for a list body (`Only single resource can be sent to
 * <operationName>.`). Sets the body's id to the given id, strips every `_` field from it, and
 * removes the client's `meta.lastUpdated` when `meta` is an object, so no check sees it. When its
 * resourceType is not the one in the URL, the item fails at the `STRUCTURE` stage, with the given
 * uuid as its subject's uuid, and the failure is recorded in `fhir_validation_failure_total` at the
 * `schema` stage.
 * @param {*} body
 * @param {string} id
 * @param {string} [uuid]
 * @param {string} resourceType
 * @param {string} path
 * @param {string} operationName
 * @returns {{item: WriteItem}}
 */
const readSingleResourceBody = ({ body, id, uuid, resourceType, path, operationName }) => {
    if (body === null || typeof body !== 'object') {
        throw new BadRequestError(new Error('Request body is required.'));
    }
    if (Array.isArray(body)) {
        throw new BadRequestError(new Error(`Only single resource can be sent to ${operationName}.`));
    }
    body.id = id;
    removeUnderscoreFieldsRecursive(body);
    if (body.meta !== null && typeof body.meta === 'object') {
        delete body.meta.lastUpdated;
    }

    const item = new WriteItem({ index: 0, incoming: body });
    const resourceTypeMismatchOutcome = getResourceTypeMismatchOutcome({
        resourceBody: body,
        resourceName: resourceType,
        path
    });
    if (resourceTypeMismatchOutcome) {
        recordValidationFailure(
            resourceTypeMismatchOutcome,
            resourceType,
            VALIDATION_STAGE.SCHEMA,
            PATH.SAVE
        );
        item.fail({
            failure: new WriteFailure({
                stage: WRITE_FAILURE_STAGE.STRUCTURE,
                subject: { ...WriteFailure.subjectOf(body), uuid },
                operationOutcome: resourceTypeMismatchOutcome
            })
        });
    }
    return { item };
};

module.exports = {
    readSingleResourceBody
};
