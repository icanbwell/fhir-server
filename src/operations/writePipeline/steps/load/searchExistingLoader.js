const { assertTypeEquals } = require('../../../../utils/assertType');
const { SearchManager } = require('../../../search/searchManager');
const { DatabaseQueryFactory } = require('../../../../dataLayer/databaseQueryFactory');
const { ConfigManager } = require('../../../../utils/configManager');
const { FhirResourceWriteSerializer } = require('../../../../fhir/fhirResourceWriteSerializer');
const { isTrue } = require('../../../../utils/isTrue');
const { SecurityTagSystem } = require('../../../../utils/securityTagSystem');
const { BadRequestError, NotFoundError } = require('../../../../utils/httpErrors');
const { OPERATIONS: { WRITE } } = require('../../../../constants');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');

/**
 * The existing-resource loader for the `findExisting` step of PATCH, once for the batch: finds each
 * item's stored document through the same access-filtered search the old PATCH uses, so only a
 * document the caller may update can be found. A PATCH has one item whose `incoming` is the stub
 * `{ resourceType, id }` from the URL, where `id` may be the uuid. On a single match it sets the
 * item's `stored` to the write-serialized document and copies its identity (`id`, `_uuid` and
 * `_sourceAssigningAuthority`) onto `incoming`, so a later failure names the stored document.
 * With no match, or more than one, it fails the item at the `LOOKUP` stage with the error.
 */
class SearchExistingLoader {
    /**
     * @param {SearchManager} searchManager
     * @param {DatabaseQueryFactory} databaseQueryFactory
     * @param {ConfigManager} configManager
     */
    constructor ({ searchManager, databaseQueryFactory, configManager }) {
        /**
         * @type {SearchManager}
         */
        this.searchManager = searchManager;
        assertTypeEquals(searchManager, SearchManager);
        /**
         * @type {DatabaseQueryFactory}
         */
        this.databaseQueryFactory = databaseQueryFactory;
        assertTypeEquals(databaseQueryFactory, DatabaseQueryFactory);
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    /**
     * Loads the stored document of each item in turn. An error from the search or the database
     * propagates and fails the whole request.
     * @param {WriteItem[]} items
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async loadAsync ({ items, context }) {
        for (const item of items) {
            await this._loadItemAsync({ item, context });
        }
    }

    /**
     * Searches for the item's stored document with the caller's access filter and the `u` access
     * letter. Sets `stored` and copies the identity (`id`, `_uuid`, `_sourceAssigningAuthority`)
     * onto `incoming` for one match, else fails the item and leaves `incoming` as it was.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async _loadItemAsync ({ item, context }) {
        const { requestInfo, base_version, parsedArgs } = context;
        const { user, scope, isUser, personIdFromJwtToken } = requestInfo;
        const { resourceType } = item.incoming;
        const { id } = parsedArgs;
        const useAccessIndex = this.configManager.useAccessIndex || isTrue(parsedArgs._useAccessIndex);

        const { query } = await this.searchManager.constructQueryAsync({
            user,
            scope,
            isUser,
            resourceType,
            useAccessIndex,
            personIdFromJwtToken,
            parsedArgs,
            operation: WRITE,
            accessRequested: 'u'
        });
        const databaseQueryManager = this.databaseQueryFactory.createQuery({ resourceType, base_version });
        const cursor = await databaseQueryManager.findAsync({
            query,
            extraInfo: { currentOperationName: 'patch' }
        });
        const resources = (await cursor.toArrayAsync()).map(
            (resource) => FhirResourceWriteSerializer.serialize({ obj: resource })
        );

        if (resources.length > 1) {
            item.fail({ failure: this._lookupFailure({ item, error: this._multipleFoundError({ id, resources }) }) });
            return;
        }
        if (resources.length === 0) {
            const error = new NotFoundError(new Error(`Resource not found: ${resourceType}/${id}`));
            item.fail({ failure: this._lookupFailure({ item, error }) });
            return;
        }
        const [stored] = resources;
        item.stored = stored;
        item.incoming.id = stored.id;
        item.incoming._uuid = stored._uuid;
        item.incoming._sourceAssigningAuthority = stored._sourceAssigningAuthority;
    }

    /**
     * Returns the 400 error for an id that matches documents of several sources, listing the
     * `id|sourceAssigningAuthority` options the caller can use to pick one, sorted.
     * @param {string} id
     * @param {Object[]} resources
     * @returns {BadRequestError}
     */
    _multipleFoundError ({ id, resources }) {
        const sourceAssigningAuthorities = resources.flatMap(
            (resource) => resource.meta && resource.meta.security
                ? resource.meta.security
                    .filter((tag) => tag.system === SecurityTagSystem.sourceAssigningAuthority)
                    .map((tag) => tag.code)
                : []
        ).sort();
        return new BadRequestError(new Error(
            `Multiple resources found with id ${id}.  ` +
            'Please either specify the owner/sourceAssigningAuthority tag: ' +
            sourceAssigningAuthorities.map((authority) => `${id}|${authority}`).join(' or ') +
            ' OR use uuid to query.'
        ));
    }

    /**
     * Returns a `LOOKUP` failure that carries the error, for the item's current identity.
     * @param {WriteItem} item
     * @param {Error} error
     * @returns {WriteFailure}
     */
    _lookupFailure ({ item, error }) {
        return new WriteFailure({
            stage: WRITE_FAILURE_STAGE.LOOKUP,
            subject: WriteFailure.subjectOf(item.incoming),
            error
        });
    }
}

module.exports = {
    SearchExistingLoader
};
