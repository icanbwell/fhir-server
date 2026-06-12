/**
 * Base class for a single write-access check.
 * A check decides whether writing one resource is allowed for the current request.
 * Concrete checks are registered into WriteAccessManager and throw a ForbiddenError
 * (or subclass) when they deny a write; returning true means the write is allowed.
 */
class WriteAccessCheck {
    /**
     * Throws when this check denies the write; returns true to allow it.
     * Default: allow (override in a subclass).
     * @param {Object} params
     * @param {import('../../../utils/fhirRequestInfo').FhirRequestInfo} params.requestInfo
     * @param {Object} params.resource post-preSave resource
     * @param {string} [params.base_version]
     * @returns {Promise<boolean>}
     */
    async checkAsync ({ requestInfo, resource, base_version }) {
        return true;
    }
}

module.exports = {
    WriteAccessCheck
};
