const { assertTypeEquals } = require('../../../../utils/assertType');
const { R4ArgsParser } = require('../../../query/r4ArgsParser');
const { BadRequestError, NotFoundError } = require('../../../../utils/httpErrors');
const { isUuid, generateUUIDv5 } = require('../../../../utils/uid.util');
const { WriteFailure, WRITE_FAILURE_STAGE } = require('../../writeFailure');
const { WriteItem } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');
const { AccessFilteredFinder } = require('./accessFilteredFinder');

/**
 * The name the lookups of an admin write carry in the database query's extra info.
 */
const ADMIN_OPERATION_NAME = 'admin';

/**
 * The access letters the target is looked up with: `u` for a target the change updates, and `r`
 * for a target the change creates when it is missing. A Person the caller can read but not update
 * is then found, and the target access check refuses it with a 403, instead of it looking missing
 * and a second Person being created. A Person the caller cannot read is still not found.
 */
const TARGET_LOOKUP_ACCESS = Object.freeze({
    updatesTarget: 'u',
    createsMissingTarget: 'r'
});

/**
 * The access letter the link target is looked up with: a link only reads it.
 */
const LINK_TARGET_LOOKUP_ACCESS = 'r';

/**
 * The most documents a lookup reads: two are enough to tell found, not found and more than one.
 */
const LOOKUP_LIMIT = 2;

/**
 * The separator between an id and its source assigning authority (`id|authority`).
 */
const SOURCE_ASSIGNING_AUTHORITY_SEPARATOR = '|';

/**
 * The existing-resource loader for the `findExisting` step of an admin write, once for the batch.
 * It reads each item's `adminChange`, which names its `target` and its `linkTarget` by the id the
 * caller sent (a `_uuid`, a plain `id` or `id|authority`, see `_lookupIdOf`), and finds them
 * through the access-filtered finder, by the search `id` parameter: the target with the `u` access
 * letter, because it is changed, or with the `r` access letter when the change says
 * `createsMissingTarget`, so that a target the caller can read but not change is found and refused
 * by the target access check; and the link target with the `r` access letter, because it is only
 * read. A document the caller cannot access with that letter is not found. On a single match for
 * the target it sets the item's `stored` and copies its identity (`id`, `_uuid` and
 * `_sourceAssigningAuthority`) onto `incoming`, so a later failure names the stored document. The
 * link target is looked up when the change's `linkTargetLookup` is `whenTargetMissing` and no
 * target was found; a single match is added to the item's `linked`. A
 * missing target fails the item at the `LOOKUP` stage, unless the change says
 * `createsMissingTarget`, which leaves `stored` null; a missing link target always fails it. More
 * than one match fails the item too: for a `_uuid` with a plain `Error`, because the data should
 * never hold that, and for a plain `id` (the same id in several tenants the caller can access)
 * with a 400 `invalid` that asks for the `_uuid`, so the write never picks one of them.
 */
class AdminTargetLoader {
    /**
     * @param {AccessFilteredFinder} accessFilteredFinder
     * @param {R4ArgsParser} r4ArgsParser
     */
    constructor ({ accessFilteredFinder, r4ArgsParser }) {
        /**
         * @type {AccessFilteredFinder}
         */
        this.accessFilteredFinder = accessFilteredFinder;
        assertTypeEquals(accessFilteredFinder, AccessFilteredFinder);
        /**
         * @type {R4ArgsParser}
         */
        this.r4ArgsParser = r4ArgsParser;
        assertTypeEquals(r4ArgsParser, R4ArgsParser);
    }

    /**
     * Loads the target and the link target of each item in turn. An error from the search or the
     * database propagates and fails the whole request.
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
     * Loads the target, then the link target when `_looksUpLinkTarget` says so. Stops at the
     * first failure, which fails the item.
     * @param {WriteItem} item
     * @param {WriteContext} context
     * @returns {Promise<void>}
     */
    async _loadItemAsync ({ item, context }) {
        const { target, linkTarget, createsMissingTarget } = item.adminChange;

        const targets = await this._findAsync({
            context,
            reference: target,
            accessRequested: this._targetLookupAccess(item.adminChange)
        });
        if (targets.length > 1) {
            item.fail({ failure: this._lookupFailure({ item, error: this._multipleFoundError(target) }) });
            return;
        }
        if (targets.length === 1) {
            const [stored] = targets;
            item.stored = stored;
            item.incoming.id = stored.id;
            item.incoming._uuid = stored._uuid;
            item.incoming._sourceAssigningAuthority = stored._sourceAssigningAuthority;
        } else if (!createsMissingTarget) {
            item.fail({ failure: this._lookupFailure({ item, error: this._notFoundError(target) }) });
            return;
        }

        if (!this._looksUpLinkTarget(item)) {
            return;
        }
        const linkTargets = await this._findAsync({
            context,
            reference: linkTarget,
            accessRequested: LINK_TARGET_LOOKUP_ACCESS
        });
        if (linkTargets.length > 1) {
            item.fail({ failure: this._lookupFailure({ item, error: this._multipleFoundError(linkTarget) }) });
            return;
        }
        if (linkTargets.length === 0) {
            item.fail({ failure: this._lookupFailure({ item, error: this._notFoundError(linkTarget) }) });
            return;
        }
        item.linked.push({ resourceType: linkTarget.resourceType, resource: linkTargets[0] });
    }

    /**
     * Returns whether the item's link target is looked up: only when no target was found for
     * `whenTargetMissing`, and never for `never`.
     * @param {WriteItem} item
     * @returns {boolean}
     */
    _looksUpLinkTarget (item) {
        const { linkTargetLookup } = item.adminChange;
        return linkTargetLookup === 'whenTargetMissing' && item.stored === null;
    }

    /**
     * Returns the access letter the change's target is looked up with, from `TARGET_LOOKUP_ACCESS`.
     * @param {{createsMissingTarget: boolean}} adminChange
     * @returns {string}
     */
    _targetLookupAccess ({ createsMissingTarget }) {
        return createsMissingTarget
            ? TARGET_LOOKUP_ACCESS.createsMissingTarget
            : TARGET_LOOKUP_ACCESS.updatesTarget;
    }

    /**
     * Finds the documents of the resource the reference names, with the caller's access filter
     * and the access letter, by the search `id` parameter with the reference's lookup id (see
     * `_lookupIdOf`): the search matches a `_uuid` on `_uuid` and any other id on `id`. It reads at
     * most `LOOKUP_LIMIT` documents.
     * @param {WriteContext} context
     * @param {{resourceType: string, id: string}} reference `id` is the id the caller sent
     * @param {string} accessRequested
     * @returns {Promise<Object[]>}
     */
    async _findAsync ({ context, reference, accessRequested }) {
        const { requestInfo, base_version } = context;
        const { resourceType } = reference;
        const id = this._lookupIdOf(reference);
        return await this.accessFilteredFinder.findAsync({
            requestInfo,
            base_version,
            resourceType,
            parsedArgs: this.r4ArgsParser.parseArgs({ resourceType, args: { base_version, id } }),
            accessRequested,
            currentOperationName: ADMIN_OPERATION_NAME,
            limit: LOOKUP_LIMIT
        });
    }

    /**
     * Returns the value the reference's id is searched for with, as the search API's own
     * reference rewrite reads an `_id` value: the uuid of a `<uuid>|authority`, the `_uuid` the
     * server gives `id|authority` (the uuid v5 of that text) for a plain id with an authority, and
     * otherwise the id itself. The responder has checked that the id holds at most one `|`.
     * @param {{resourceType: string, id: string}} reference
     * @returns {string}
     */
    _lookupIdOf ({ id }) {
        const [sourceId, sourceAssigningAuthority] = id.split(SOURCE_ASSIGNING_AUTHORITY_SEPARATOR);
        if (sourceAssigningAuthority === undefined || isUuid(sourceId)) {
            return sourceId;
        }
        return generateUUIDv5(
            `${sourceId}${SOURCE_ASSIGNING_AUTHORITY_SEPARATOR}${sourceAssigningAuthority}`
        );
    }

    /**
     * Returns the 404 error for a resource that does not exist or that the caller cannot access.
     * @param {{resourceType: string, id: string}} reference
     * @returns {NotFoundError}
     */
    _notFoundError ({ resourceType, id }) {
        return new NotFoundError(`Resource not found: ${resourceType}/${id}`);
    }

    /**
     * Returns the error for a reference that matches more than one document. For a `_uuid` lookup
     * it is a plain `Error`, because the data should never hold that. For a plain id it is a 400
     * `invalid` that asks for the `_uuid` and does not echo the id.
     * @param {{resourceType: string, id: string}} reference
     * @returns {Error}
     */
    _multipleFoundError (reference) {
        const lookupId = this._lookupIdOf(reference);
        if (isUuid(lookupId)) {
            return new Error(
                `Multiple resources found with _uuid ${reference.resourceType}/${lookupId}`
            );
        }
        return new BadRequestError(
            new Error(`The id matches more than one ${reference.resourceType}; pass the _uuid`)
        );
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
    AdminTargetLoader
};
