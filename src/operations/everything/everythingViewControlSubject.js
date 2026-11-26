const { BadRequestError } = require('../../utils/httpErrors');
const { APPLY_DATA_VIEW_CONTROL_PARAM } = require('../../constants');
const { ViewControlSubject } = require('../../utils/viewControlSubject');

/**
 * Reads the opt-in strictly: a caller that asks for the block must never get an unfiltered record
 * because the value was misspelled. `true`/`1` applies it and `false`/`0` (or no value) does not;
 * anything else, including a repeated key (an array), is a 400.
 * @param {string|boolean|string[]|null|undefined} value
 * @return {boolean}
 * @throws {BadRequestError} for any other value
 */
function parseApplyDataViewControl(value) {
    if (value === undefined || value === null) {
        return false;
    }
    switch (typeof value === 'string' ? value.toLowerCase() : value) {
        case true:
        case 'true':
        case '1':
            return true;
        case false:
        case 'false':
        case '0':
            return false;
        default:
            throw new BadRequestError(new Error(
                `${APPLY_DATA_VIEW_CONTROL_PARAM} must be one of true, 1, false or 0`
            ));
    }
}

/**
 * Chooses whose view-control block a $everything request is filtered by.
 *
 * - A user token: the user, always (the opt-in changes nothing for them).
 * - A service or admin token without the opt-in: nobody, so the full record comes back.
 * - A service token with the opt-in on GET Person/{id}/$everything: the Person in the URL. Only one
 *   Person per request, and only on a Person $everything read (not DELETE).
 *
 * A malformed value is a 400 for every token, so it is never read as "no opt-in".
 * @param {Object} params
 * @param {import('../query/parsedArgs').ParsedArgs} params.parsedArgs
 * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {boolean} params.isPersonEverything true only for a genuine Person/{id}/$everything request
 * @param {string[]} params.personIds the ids from the URL, before any Person-to-Patient remapping
 * @param {string} params.method the HTTP method; the opt-in is accepted on GET only
 * @return {ViewControlSubject|null}
 * @throws {BadRequestError} for a malformed value, the opt-in outside a Person $everything read, or with
 *   more than one Person id
 */
function getEverythingViewControlSubject({ parsedArgs, requestInfo, isPersonEverything, personIds, method }) {
    const optIn = parseApplyDataViewControl(parsedArgs[APPLY_DATA_VIEW_CONTROL_PARAM]);
    if (requestInfo.isUser) {
        return ViewControlSubject.fromToken(requestInfo);
    }
    if (!optIn) {
        return null;
    }
    if (!isPersonEverything || String(method).toUpperCase() !== 'GET') {
        throw new BadRequestError(new Error(
            `${APPLY_DATA_VIEW_CONTROL_PARAM} is only supported on Person $everything reads (GET)`
        ));
    }
    if (personIds.length !== 1) {
        throw new BadRequestError(new Error(
            `${APPLY_DATA_VIEW_CONTROL_PARAM} supports one Person per request`
        ));
    }
    return ViewControlSubject.fromUrlPerson({ personId: personIds[0] });
}

module.exports = { getEverythingViewControlSubject, parseApplyDataViewControl };
