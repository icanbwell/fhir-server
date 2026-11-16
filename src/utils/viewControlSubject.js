const { assertIsValid } = require('./assertType');

/**
 * Where the subject Person of a view-control check came from.
 * @enum {string}
 */
const VIEW_CONTROL_SUBJECT_SOURCE = Object.freeze({
    /** the Person in a user's token: every user read path */
    TOKEN: 'token'
});

/**
 * The Person whose dataConnectionViewControl Consent and owner a read is checked against.
 * Immutable; identified by toString(), which the request-scoped lookup cache keys on.
 *
 * Callers decide the subject; the view-control lookup only uses it. A user read uses the Person in
 * the token.
 */
class ViewControlSubject {
    /**
     * @param {Object} params
     * @param {string} params.personId
     * @param {string} params.source one of VIEW_CONTROL_SUBJECT_SOURCE
     */
    constructor({ personId, source }) {
        assertIsValid(personId, 'ViewControlSubject: personId is required');
        assertIsValid(
            Object.values(VIEW_CONTROL_SUBJECT_SOURCE).includes(source),
            `ViewControlSubject: unknown source ${source}`
        );
        /** @type {string} */
        this.personId = personId;
        /** @type {string} */
        this.source = source;
        Object.freeze(this);
    }

    /**
     * The user in the token, or null for a token that isn't a user's (service, admin) or has no
     * person id.
     * @param {import('./fhirRequestInfo').FhirRequestInfo|undefined} requestInfo
     * @return {ViewControlSubject|null}
     */
    static fromToken(requestInfo) {
        if (!requestInfo?.isUser || !requestInfo.personIdFromJwtToken) {
            return null;
        }
        return new ViewControlSubject({
            personId: requestInfo.personIdFromJwtToken,
            source: VIEW_CONTROL_SUBJECT_SOURCE.TOKEN
        });
    }

    /**
     * Identifies this subject within a request (for the request-scoped lookup cache).
     * @return {string}
     */
    toString() {
        return `${this.source}:${this.personId}`;
    }
}

module.exports = { ViewControlSubject, VIEW_CONTROL_SUBJECT_SOURCE };
