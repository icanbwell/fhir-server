const { BadRequestError } = require('../../utils/httpErrors');
const { isTrue } = require('../../utils/isTrue');
const { ViewControlSubject } = require('../../utils/viewControlSubject');

/**
 * Query parameter a service token sends on Person/{id}/$everything to have that Person's
 * dataConnectionViewControl block applied (a service reading on a user's behalf).
 */
const APPLY_DATA_VIEW_CONTROL_PARAM = '_applyDataViewControl';

/**
 * Chooses whose view-control block a $everything request is filtered by.
 *
 * - A user token: the user, always (the opt-in changes nothing for them).
 * - A service or admin token without the opt-in: nobody, so the full record comes back.
 * - A service token with the opt-in on Person/{id}/$everything: the Person in the URL. Only one
 *   Person per request, and only on Person $everything.
 * @param {Object} params
 * @param {import('../query/parsedArgs').ParsedArgs} params.parsedArgs
 * @param {import('../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
 * @param {boolean} params.isPersonEverything true only for a genuine Person/{id}/$everything request
 * @param {string[]} params.personIds the ids from the URL, before any Person-to-Patient remapping
 * @return {ViewControlSubject|null}
 * @throws {BadRequestError} for the opt-in outside Person $everything, or with more than one Person id
 */
function getEverythingViewControlSubject({ parsedArgs, requestInfo, isPersonEverything, personIds }) {
    if (requestInfo.isUser) {
        return ViewControlSubject.fromToken(requestInfo);
    }
    if (!isTrue(parsedArgs[APPLY_DATA_VIEW_CONTROL_PARAM])) {
        return null;
    }
    if (!isPersonEverything) {
        throw new BadRequestError(new Error(
            `${APPLY_DATA_VIEW_CONTROL_PARAM} is only supported on Person $everything`
        ));
    }
    if (personIds.length !== 1) {
        throw new BadRequestError(new Error(
            `${APPLY_DATA_VIEW_CONTROL_PARAM} supports one Person per request`
        ));
    }
    return ViewControlSubject.fromUrlPerson({ personId: personIds[0] });
}

module.exports = { getEverythingViewControlSubject, APPLY_DATA_VIEW_CONTROL_PARAM };
