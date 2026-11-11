const { assertIsValid } = require('./assertType');

/**
 * Where the subject Person of a view-control check came from.
 * @enum {string}
 */
const VIEW_CONTROL_SUBJECT_SOURCE = Object.freeze({
    /** the Person in a member's token: every member read path */
    TOKEN: 'token',
    /** the Person in the request URL: Person $everything when a service token opts in */
    URL_PERSON: 'urlPerson'
});

/**
 * The Person whose dataConnectionViewControl Consent and owner a read is checked against.
 * Immutable, with equality by value.
 *
 * Callers decide the subject; the view-control lookup only uses it. A member read uses the Person in
 * the token. Person $everything uses the Person in the URL when a service token opts in, and other
 * paths can choose the URL Person the same way without changing the lookup.
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
     * The member in the token, or null for a token that isn't a member's (service, admin) or has no
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
     * The Person named in the request URL (its id as given: a uuid or a source id).
     * @param {Object} params
     * @param {string} params.personId
     * @return {ViewControlSubject}
     */
    static fromUrlPerson({ personId }) {
        return new ViewControlSubject({ personId, source: VIEW_CONTROL_SUBJECT_SOURCE.URL_PERSON });
    }

    /** @return {boolean} */
    get isUrlPerson() {
        return this.source === VIEW_CONTROL_SUBJECT_SOURCE.URL_PERSON;
    }

    /**
     * @param {ViewControlSubject|null|undefined} other
     * @return {boolean}
     */
    equals(other) {
        return other instanceof ViewControlSubject && other.personId === this.personId && other.source === this.source;
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
