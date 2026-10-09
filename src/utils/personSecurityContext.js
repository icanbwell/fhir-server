const { PERSON_PROXY_PREFIX } = require('../constants');
const { ForbiddenError } = require('./httpErrors');
const { ReferenceParser } = require('./referenceParser');

/**
 * Helpers for the `securityContext` that ties a person-owned resource (Binary) to the person who created it.
 *
 * A member's upload is owned by the member's person, expressed as the proxy-patient reference this server
 * already uses for a person: `Patient/person.{person_uuid}` (see PERSON_PROXY_PREFIX). Backends and
 * migrations may instead point `securityContext` at a real Patient (`Patient/{id}`).
 * See docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md
 */

/**
 * The proxy-patient reference for a person, e.g. `Patient/person.4bd2...`
 * @param {string} personId the person's uuid (clientFhirPersonId claim)
 * @returns {string}
 */
function getPersonProxyReference (personId) {
    return `Patient/${PERSON_PROXY_PREFIX}${personId}`;
}

/**
 * The reference string held in the resource's securityContext, if any
 * @param {{securityContext?: {reference?: string, _sourceId?: string}}} resource
 * @returns {string|undefined}
 */
function getSecurityContextReference (resource) {
    const securityContext = resource && resource.securityContext;
    if (!securityContext) {
        return undefined;
    }
    return securityContext.reference || securityContext._sourceId || undefined;
}

/**
 * Whether the resource's securityContext is exactly the person's own proxy-patient reference
 * (a trailing `|sourceAssigningAuthority` on the reference is ignored)
 * @param {{securityContext?: {reference?: string, _sourceId?: string}}} resource
 * @param {string|undefined} personId
 * @returns {boolean}
 */
function hasOwnPersonSecurityContext (resource, personId) {
    if (!personId || typeof personId !== 'string') {
        return false;
    }
    const reference = getSecurityContextReference(resource);
    if (!reference || typeof reference !== 'string') {
        return false;
    }
    const { resourceType, id } = ReferenceParser.parseReference(reference);
    return resourceType === 'Patient' && id === `${PERSON_PROXY_PREFIX}${personId}`;
}

/**
 * Sets the caller's person as the owner of the (plain, not yet validated) incoming resource, by writing
 * `securityContext` from the token's person id. The client never controls it:
 * - nothing supplied: set to `Patient/person.{personId}`
 * - the caller's own reference supplied: accepted unchanged (idempotent)
 * - anything else supplied (another person, a Patient, another resource type): 403 with a reason, never
 *   silently overwritten; the supplied value is not echoed back
 * - no person id for the caller: 403 (defence in depth: authentication already requires the claim for any
 *   token with a patient scope)
 * Mutates and returns the resource.
 * @param {Object} resource plain incoming resource body
 * @param {string|undefined} personId the caller's person id (personIdFromJwtToken)
 * @returns {Object} the same resource
 * @throws {ForbiddenError}
 */
function stampPersonSecurityContext ({ resource, personId }) {
    if (!personId || typeof personId !== 'string') {
        throw new ForbiddenError(
            `A person id in the token is required to create a ${resource.resourceType} with a patient scope`
        );
    }
    if (resource.securityContext !== undefined && resource.securityContext !== null) {
        if (!hasOwnPersonSecurityContext(resource, personId)) {
            throw new ForbiddenError(
                `The securityContext of a ${resource.resourceType} created with a patient scope is set from ` +
                'the token and cannot be supplied by the client'
            );
        }
        return resource;
    }
    resource.securityContext = { reference: getPersonProxyReference(personId) };
    return resource;
}

module.exports = {
    getPersonProxyReference,
    getSecurityContextReference,
    hasOwnPersonSecurityContext,
    stampPersonSecurityContext
};
