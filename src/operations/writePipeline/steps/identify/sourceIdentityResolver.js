const { assertTypeEquals } = require('../../../../utils/assertType');
const { SourceAssigningAuthorityColumnHandler } = require('../../../../preSaveHandlers/handlers/sourceAssigningAuthorityColumnHandler');
const { UuidColumnHandler } = require('../../../../preSaveHandlers/handlers/uuidColumnHandler');
const { isUuid } = require('../../../../utils/uid.util');
const { WriteFailure } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');

/**
 * The identity resolver for the `findExisting` step, per item: sets the body's `_uuid`, from a UUID
 * id, or else from the id and the source assigning authority.
 */
class SourceIdentityResolver {
    /**
     * @param {SourceAssigningAuthorityColumnHandler} sourceAssigningAuthorityColumnHandler
     * @param {UuidColumnHandler} uuidColumnHandler
     */
    constructor ({ sourceAssigningAuthorityColumnHandler, uuidColumnHandler }) {
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
     * Sets `_uuid` to the id when the id is a UUID; otherwise runs the source assigning authority
     * and uuid column handlers, which set `_sourceAssigningAuthority` and `_uuid`. Mutates
     * `item.incoming` and returns null; if a handler throws, only this item fails.
     * @param {WriteItem} item
     * @returns {Promise<WriteFailure|null>}
     */
    async resolveAsync ({ item }) {
        if (isUuid(item.incoming.id)) {
            item.incoming._uuid = item.incoming.id;
            return null;
        }
        item.incoming = await this.sourceAssigningAuthorityColumnHandler.preSaveAsync({ resource: item.incoming });
        item.incoming = await this.uuidColumnHandler.preSaveAsync({ resource: item.incoming });
        return null;
    }
}

module.exports = {
    SourceIdentityResolver
};
