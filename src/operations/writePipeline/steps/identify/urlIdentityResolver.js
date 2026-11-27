const { assertTypeEquals } = require('../../../../utils/assertType');
const { ResourceValidator } = require('../../../common/resourceValidator');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { BadRequestError } = require('../../../../utils/httpErrors');
const { IdParser } = require('../../../../utils/idParser');
const { isUuid } = require('../../../../utils/uid.util');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The identity resolver for the `identify` step of a write addressed by URL id (PUT), per item: sets
 * the body's `_uuid`, from a UUID id, or else from the id and the source assigning authority of its
 * security tags, and checks that an authority given in the URL id (`<id>|<authority>`) matches it.
 * The body's security tags are not changed.
 */
class UrlIdentityResolver {
    /**
     * @param {ResourceValidator} resourceValidator
     * @param {SourceAssigningAuthorityColumnHandler} sourceAssigningAuthorityColumnHandler
     * @param {UuidColumnHandler} uuidColumnHandler
     */
    constructor ({ resourceValidator, sourceAssigningAuthorityColumnHandler, uuidColumnHandler }) {
        /**
         * @type {ResourceValidator}
         */
        this.resourceValidator = resourceValidator;
        assertTypeEquals(resourceValidator, ResourceValidator);
        /**
         * @type {SourceAssigningAuthorityColumnHandler}
         */
        this.sourceAssigningAuthorityColumnHandler = sourceAssigningAuthorityColumnHandler;
        assertTypeEquals(sourceAssigningAuthorityColumnHandler, SourceAssigningAuthorityColumnHandler);
        /**
         * @type {UuidColumnHandler}
         */
        this.uuidColumnHandler = uuidColumnHandler;
        assertTypeEquals(uuidColumnHandler, UuidColumnHandler);
    }

    /**
     * Splits the URL id of the request into the id and the source assigning authority after its
     * first `|`, reading the original `id` (or `_id`) argument before any query rewrite, or else
     * `parsedArgs.id`.
     * @param {Object} parsedArgs
     * @returns {{id: string, sourceAssigningAuthority: string|undefined}}
     */
    static parseUrlId (parsedArgs) {
        const originalIdParsedArg = parsedArgs.getOriginal('id') || parsedArgs.getOriginal('_id');
        return IdParser.parse(originalIdParsedArg?.queryParameterValue?.value ?? parsedArgs.id);
    }

    /**
     * Sets `_uuid` to the id when the id is a UUID. Otherwise it returns an `IDENTITY` failure with
     * the validator's outcome when the body has no owner or source assigning authority tag, derives
     * `_uuid` and `_sourceAssigningAuthority` from a copy of the id and the security tags, returns an
     * `IDENTITY` failure with a `BadRequestError` when the URL authority differs from the derived
     * one, and else sets both on the body. A tag with no code makes the uuid handler throw.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<WriteFailure|null>}
     */
    async resolveAsync ({ item, context }) {
        const incoming = item.incoming;
        if (isUuid(incoming.id)) {
            incoming._uuid = incoming.id;
            return null;
        }
        const missingAuthorityOutcome = this.resourceValidator.validateResourceHasAuthorityTagSync(incoming);
        if (missingAuthorityOutcome) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.IDENTITY,
                subject: WriteFailure.subjectOf(incoming),
                operationOutcome: missingAuthorityOutcome
            });
        }
        const identity = await this.deriveIdentityAsync(incoming);
        const { sourceAssigningAuthority: urlAuthority } = UrlIdentityResolver.parseUrlId(context.parsedArgs);
        if (urlAuthority && urlAuthority !== identity._sourceAssigningAuthority) {
            return new WriteFailure({
                stage: WRITE_FAILURE_STAGE.IDENTITY,
                subject: WriteFailure.subjectOf(incoming),
                error: new BadRequestError(new Error(
                    `The sourceAssigningAuthority in the id (${incoming.id}|${urlAuthority}) does not match ` +
                    `the owner/sourceAssigningAuthority tag of the resource (${identity._sourceAssigningAuthority})`
                ))
            });
        }
        incoming._uuid = identity._uuid;
        incoming._sourceAssigningAuthority = identity._sourceAssigningAuthority;
        return null;
    }

    /**
     * Runs the source assigning authority and uuid column handlers on a minimal copy of the body
     * (its id, resource type and security tags) and returns the copy with `_uuid` and
     * `_sourceAssigningAuthority` set, leaving the body unchanged.
     * @param {Object} incoming
     * @returns {Promise<Object>}
     */
    async deriveIdentityAsync (incoming) {
        const minimalCopy = {
            id: incoming.id,
            resourceType: incoming.resourceType,
            meta: { security: incoming.meta.security.filter(Boolean) }
        };
        return await this.uuidColumnHandler.preSaveAsync({
            resource: await this.sourceAssigningAuthorityColumnHandler.preSaveAsync({ resource: minimalCopy })
        });
    }
}

module.exports = {
    UrlIdentityResolver
};
