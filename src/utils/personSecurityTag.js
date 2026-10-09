const { SecurityTagSystem } = require('./securityTagSystem');
const { BadRequestError, ForbiddenError } = require('./httpErrors');

/**
 * Helpers for the clientPersonId security tag that ties a person-owned resource (Binary) to the person
 * who created it. See docs/superpowers/specs/2026-10-08-binary-patient-scoped-write-design.md
 */

/**
 * Returns the codes of every clientPersonId security tag on the resource
 * @param {{meta?: {security?: {system?: string, code?: string}[]}}} resource
 * @returns {string[]}
 */
function getPersonTagCodes (resource) {
    const security = resource && resource.meta && resource.meta.security;
    if (!Array.isArray(security)) {
        return [];
    }
    return security
        .filter(s => s && s.system === SecurityTagSystem.clientPersonId)
        .map(s => s.code);
}

/**
 * Whether the resource carries exactly one clientPersonId tag and it equals personId
 * @param {{meta?: {security?: {system?: string, code?: string}[]}}} resource
 * @param {string|undefined} personId
 * @returns {boolean}
 */
function hasOwnPersonTagOnly (resource, personId) {
    if (!personId || typeof personId !== 'string') {
        return false;
    }
    const codes = getPersonTagCodes(resource);
    return codes.length === 1 && codes[0] === personId;
}

/**
 * Stamps the caller's person id onto the (plain, not yet validated) incoming resource as a
 * clientPersonId security tag. The client never controls this tag:
 * - no tag supplied: appended
 * - one tag equal to the caller's person id: accepted unchanged
 * - one tag for a different person: 403 with a reason (never silently overwritten); the other
 *   person id is not echoed back
 * - more than one clientPersonId tag: 400
 * - no person id for the caller: 403 (defence in depth: authentication already requires the claim
 *   for any token with a patient scope)
 * Mutates and returns the resource.
 * @param {Object} resource plain incoming resource body
 * @param {string|undefined} personId the caller's person id (personIdFromJwtToken)
 * @returns {Object} the same resource
 * @throws {ForbiddenError|BadRequestError}
 */
function stampPersonTag ({ resource, personId }) {
    if (!personId || typeof personId !== 'string') {
        throw new ForbiddenError(
            `A person id in the token is required to create a ${resource.resourceType} with a patient scope`
        );
    }
    const codes = getPersonTagCodes(resource);
    if (codes.length > 1) {
        throw new BadRequestError(new Error(
            `${resource.resourceType} has more than one security tag with system ${SecurityTagSystem.clientPersonId}`
        ));
    }
    if (codes.length === 1) {
        if (codes[0] !== personId) {
            throw new ForbiddenError(
                `The security tag with system ${SecurityTagSystem.clientPersonId} does not match ` +
                'the person id of the authenticated user'
            );
        }
        return resource;
    }
    if (!resource.meta) {
        resource.meta = {};
    }
    if (!Array.isArray(resource.meta.security)) {
        resource.meta.security = [];
    }
    resource.meta.security.push({ system: SecurityTagSystem.clientPersonId, code: personId });
    return resource;
}

module.exports = {
    getPersonTagCodes,
    hasOwnPersonTagOnly,
    stampPersonTag
};
