const { BadRequestError } = require('../../../../utils/httpErrors');
const { COLLECTION } = require('../../../../constants');
const { WriteItem, WRITE_ITEM_STATUS } = require('../../writeItem');
const { WriteContext } = require('../../writeContext');
const { WriteResponder } = require('../../writeResponder');
const {
    throwIfItemFailed,
    firstExecutedResult,
    notWrittenError
} = require('../singleResource/singleResourceResult');
const { unchangedEntry } = require('../singleResource/singleResourceDocument');
const { getAdminOperation } = require('./adminOperations');

/**
 * The resource types an admin write may be asked to change.
 */
const SUPPORTED_RESOURCE_TYPES = new Set(Object.values(COLLECTION));

/**
 * The reference prefixes an admin id may carry; they are stripped, as the old admin writes do.
 */
const REFERENCE_PREFIX_PATTERN = /^(Person|Patient)\//;

/**
 * The prefix of any resource type, which an id whose definition says `stripsAnyTypePrefix` may
 * carry; it is stripped, as the old `updatePatientReference` does with its `resourceId`.
 */
const ANY_TYPE_PREFIX_PATTERN = /^[A-Za-z]+\//;

/**
 * The longest id an admin write accepts, so a caller can't send an unbounded text into the search.
 */
const MAX_ID_LENGTH = 255;

/**
 * The characters an admin id may not contain, because the search reads them as more than a
 * literal: a comma (it ORs two values), a backslash (the search escape character) and a control
 * character.
 */
const FORBIDDEN_ID_CHARACTERS = /[,\\\p{Cc}]/u;

/**
 * The separator between an id and its source assigning authority (`id|authority`).
 */
const SOURCE_ASSIGNING_AUTHORITY_SEPARATOR = '|';

/**
 * The stages for which an admin write stores the rejected resource in the access log: none.
 */
const ACCESS_LOGGED_STAGES = Object.freeze([]);

/**
 * Returns whether the request left the parameter out: not sent, null or an empty string.
 * @param {*} value
 * @returns {boolean}
 */
function isMissing (value) {
    return value === undefined || value === null || value === '';
}

/**
 * Returns the 400 `invalid` error for an id parameter that can't be used, naming the parameter and
 * the reason but not the value sent.
 * @param {string} name
 * @param {string} reason
 * @returns {BadRequestError}
 */
function invalidIdError (name, reason) {
    return new BadRequestError(new Error(`Invalid ${name}: ${reason}`));
}

/**
 * Returns the message template with each `{name}` replaced by the value of that name.
 * @param {string} template
 * @param {Object<string, string>} values
 * @returns {string}
 */
function renderMessage (template, values) {
    return template.replace(/\{(\w+)\}/g, (placeholder, name) => values[`${name}`]);
}

/**
 * What `readAsync` returns: the write context, the one stub item, no request errors, and that the
 * request did not send a list.
 * @typedef {Object} AdminReadResult
 * @property {WriteContext} context
 * @property {WriteItem[]} items
 * @property {Object[]} requestErrors
 * @property {boolean} wasIncomingAList
 */

/**
 * The manual-link event of an admin write: the Person's `_uuid`, the Patient id (the Patient's
 * `_uuid` for a created Person, else the id as the caller sent it, as the old admin path sends it)
 * and whether the write links or unlinks them.
 * @typedef {Object} AdminLinkEvent
 * @property {string} personId
 * @property {string} patientId
 * @property {boolean} isLinking
 */

/**
 * Holds everything that depends on the admin write operations' request and response format. It
 * reads the operation's name and ids from the request body into one stub item that carries the
 * description of the change, turns a failure into the error the admin operation throws, checks the
 * flush result, and answers with the old response body and, for a Person to Patient link that was
 * created or removed, the manual-link event the caller sends. The operations are described by
 * `ADMIN_OPERATIONS`. Admin writes record no operation metrics.
 */
class AdminResponder extends WriteResponder {
    /**
     * Reads the request into a write context and one stub `WriteItem` for the operation in
     * `requestInfo.body.operation`. The item's `incoming` is the target's resource type and its id
     * as sent, and its `adminChange` names the change, the target and the linked resource, and
     * the access letter the linked resource is checked with. An id is a `_uuid`, a plain `id` or
     * `id|authority`, kept as the literal text the caller sent without its prefix: a leading
     * `Person/` or `Patient/`, or any resource type for an id whose definition says
     * `stripsAnyTypePrefix`. The context's `smartMerge` is the operation's. Throws an
     * `UnknownAdminOperationError` for an operation with no definition, and a `BadRequestError`
     * (400 `invalid`) for a missing parameter, a resource type that is not supported and an id
     * that can't be used as a literal (see `_assertLiteralId`).
     * @param {import('../../../../utils/fhirRequestInfo').FhirRequestInfo} requestInfo
     * @param {import('../../../query/parsedArgs').ParsedArgs} parsedArgs
     * @returns {Promise<AdminReadResult>}
     */
    async readAsync ({ requestInfo, parsedArgs }) {
        const body = requestInfo.body;
        const operation = getAdminOperation(body?.operation);
        this._assertNoMissingParameter({ operation, body });
        const target = this._resourceFor({ definition: operation.target, body });
        const linkTarget = this._resourceFor({ definition: operation.linkTarget, body });
        const item = new WriteItem({
            index: 0,
            incoming: { resourceType: target.resourceType, id: target.id }
        });
        item.adminChange = {
            kind: operation.kind,
            target,
            linkTarget,
            linkTargetLookup: operation.linkTargetLookup,
            createsMissingTarget: operation.createsMissingTarget,
            linkTargetAccess: operation.linkTargetAccess
        };
        const context = new WriteContext({
            requestInfo,
            base_version: parsedArgs.base_version,
            parsedArgs,
            smartMerge: operation.smartMerge
        });
        return { context, items: [item], requestErrors: [], wasIncomingAList: false };
    }

    /**
     * Throws a `BadRequestError` that names every parameter of the operation the body leaves out.
     * @param {import('./adminOperations').AdminOperation} operation
     * @param {Object} body
     * @returns {void}
     */
    _assertNoMissingParameter ({ operation, body }) {
        const parameters = [
            operation.target.idParameter,
            operation.target.resourceTypeParameter,
            operation.linkTarget.idParameter,
            operation.linkTarget.resourceTypeParameter
        ].filter(Boolean);
        const missing = parameters.filter((name) => isMissing(body[`${name}`]));
        if (missing.length > 0) {
            throw new BadRequestError(
                new Error(`Missing required parameter(s): ${missing.join(', ')}`)
            );
        }
    }

    /**
     * Returns the resource type and the id the definition names in the body. Throws a
     * `BadRequestError` when the resource type is not supported or the id can't be used.
     * @param {import('./adminOperations').AdminResourceDefinition} definition
     * @param {Object} body
     * @returns {{resourceType: string, id: string}}
     */
    _resourceFor ({ definition, body }) {
        const resourceType = definition.resourceType ?? body[`${definition.resourceTypeParameter}`];
        if (!SUPPORTED_RESOURCE_TYPES.has(resourceType)) {
            throw new BadRequestError(new Error(`ResourceType ${resourceType} not supported`));
        }
        return { resourceType, id: this._idFrom({ definition, body }) };
    }

    /**
     * Returns the body's value for the definition's id parameter without its prefix: a leading
     * `Person/` or `Patient/`, or a leading resource type when the definition says
     * `stripsAnyTypePrefix`. The id is not interpreted here. Throws a `BadRequestError` when the
     * value is not a string or what is left can't be used as a literal id.
     * @param {import('./adminOperations').AdminResourceDefinition} definition
     * @param {Object} body
     * @returns {string}
     */
    _idFrom ({ definition, body }) {
        const name = definition.idParameter;
        const value = body[`${name}`];
        if (typeof value !== 'string') {
            throw invalidIdError(name, 'must be a string');
        }
        const prefixPattern = definition.stripsAnyTypePrefix
            ? ANY_TYPE_PREFIX_PATTERN
            : REFERENCE_PREFIX_PATTERN;
        const id = value.replace(prefixPattern, '');
        this._assertLiteralId({ name, id });
        return id;
    }

    /**
     * Throws a `BadRequestError` that names the parameter, without the value, when the id can't be
     * searched for as a literal: it is empty, longer than `MAX_ID_LENGTH`, holds a comma, a
     * backslash or a control character, or has more than one `|` or nothing on a side of its `|`.
     * @param {string} name
     * @param {string} id
     * @returns {void}
     */
    _assertLiteralId ({ name, id }) {
        if (id.length === 0) {
            throw invalidIdError(name, 'must not be empty');
        }
        if (id.length > MAX_ID_LENGTH) {
            throw invalidIdError(name, `must be at most ${MAX_ID_LENGTH} characters`);
        }
        if (FORBIDDEN_ID_CHARACTERS.test(id)) {
            throw invalidIdError(
                name,
                'must not contain a comma, a backslash or a control character'
            );
        }
        const parts = id.split(SOURCE_ASSIGNING_AUTHORITY_SEPARATOR);
        if (parts.length > 2 || parts.some((part) => part.length === 0)) {
            throw invalidIdError(
                name,
                'must be a _uuid, an id or id|authority with one | and text on both sides'
            );
        }
    }

    /**
     * Returns no results when the item did not fail. Otherwise throws the error the admin
     * operation throws for the failure, and stores nothing in the access log: the lookup's 404 or
     * its not-unique error, the 403 of a forbidden target, linked resource or result, the build's
     * 400, the original error the attachments or write step wrapped, or a `NotValidatedError` for
     * a failed result validation.
     * @param {WriteItem[]} items
     * @returns {Object[]}
     */
    failureResults ({ items }) {
        throwIfItemFailed({ items, accessLoggedStages: ACCESS_LOGGED_STAGES });
        return [];
    }

    /**
     * Returns the stored document's entry, neither created nor updated, when the item was
     * unchanged, so nothing was flushed for it. Otherwise returns the flush results when the first
     * one was created or updated, and throws a `BadRequestError` with `No merge result` when the
     * flush returned none. When the first result was neither created nor updated and has no issue,
     * an update (a lost write whose replay found the stored document already equal to the
     * candidate) returns the candidate's entry, and an insert throws a `BadRequestError`. Any other
     * such result throws a `BadRequestError` with its issue as JSON.
     * @param {WriteItem[]} items
     * @param {Object[]} executedResults
     * @returns {Object[]}
     */
    results ({ items, executedResults }) {
        const [item] = items;
        if (item?.status === WRITE_ITEM_STATUS.UNCHANGED) {
            return [unchangedEntry(item.stored)];
        }
        const firstResult = firstExecutedResult(executedResults);
        if (!firstResult.created && !firstResult.updated) {
            if (item?.writeMode === 'update' && !firstResult.issue) {
                return [unchangedEntry(item.candidate)];
            }
            throw notWrittenError(firstResult);
        }
        return executedResults;
    }

    /**
     * Returns `{ json, linkEvent }`. `json` is the operation's old response body: its `message`
     * (the no-op message when the item was unchanged, the created message when the write created
     * the target, else the success message) and the ids it echoes, as the caller sent them without
     * their prefix. `linkEvent` is `{ personId, patientId, isLinking }` (see `_linkEventFor`) when
     * the operation sends a manual-link event and wrote something, else null. Throws an
     * `UnknownAdminOperationError` when the request names no admin operation.
     * @param {WriteContext} context
     * @param {WriteItem[]} items
     * @param {Object[]} results
     * @returns {{json: Object, linkEvent: AdminLinkEvent|null}}
     */
    toResponse ({ context, items, results }) {
        const [item] = items;
        const operation = getAdminOperation(context.requestInfo.body?.operation);
        const unchanged = item.status === WRITE_ITEM_STATUS.UNCHANGED;
        const created = !unchanged && results[0]?.created === true;
        const values = this._parameterValues({ operation, item });
        const template = unchanged
            ? operation.messages.noOp
            : (created && operation.messages.created) || operation.messages.success;
        const json = { message: renderMessage(template, values) };
        for (const name of operation.responseParameters) {
            json[`${name}`] = values[`${name}`];
        }
        return {
            json,
            linkEvent: unchanged ? null : this._linkEventFor({ operation, item, created })
        };
    }

    /**
     * Returns the value of each request parameter the operation reads, taken from the item's
     * change, so an id is the one the caller sent, without its prefix.
     * @param {import('./adminOperations').AdminOperation} operation
     * @param {WriteItem} item
     * @returns {Object<string, string>}
     */
    _parameterValues ({ operation, item }) {
        const { target, linkTarget } = item.adminChange;
        const values = {
            [operation.target.idParameter]: target.id,
            [operation.linkTarget.idParameter]: linkTarget.id
        };
        if (operation.target.resourceTypeParameter) {
            values[operation.target.resourceTypeParameter] = target.resourceType;
        }
        return values;
    }

    /**
     * Returns the manual-link event of a write the operation sends one for, else null: the
     * Person's `_uuid` (the created Person's when the write created it, else the stored one's),
     * the Patient id `_linkEventPatientId` returns and whether the operation links or unlinks.
     * @param {import('./adminOperations').AdminOperation} operation
     * @param {WriteItem} item
     * @param {boolean} created
     * @returns {AdminLinkEvent|null}
     */
    _linkEventFor ({ operation, item, created }) {
        if (!operation.manualLinkEvent) {
            return null;
        }
        return {
            personId: created ? item.candidate._uuid : item.stored._uuid,
            patientId: this._linkEventPatientId(item),
            isLinking: operation.manualLinkEvent.isLinking
        };
    }

    /**
     * Returns the Patient id of the manual-link event, as the old admin path sends it: the loaded
     * Patient's `_uuid` when the Patient was looked up (a created Person), else the Patient id as
     * the caller sent it, without its prefix (a link added to or removed from a stored Person).
     * @param {WriteItem} item
     * @returns {string}
     */
    _linkEventPatientId (item) {
        const [linked] = item.linked;
        return linked ? linked.resource._uuid : item.adminChange.linkTarget.id;
    }

    /**
     * Records nothing: the admin writes have no operation metrics.
     * @returns {void}
     */
    recordMetrics () {
    }
}

module.exports = {
    AdminResponder
};
