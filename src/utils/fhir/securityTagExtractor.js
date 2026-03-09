const { SECURITY_TAG_SYSTEMS } = require('../../constants/clickHouseConstants');

/**
 * Utility class for extracting security tags from FHIR resource metadata
 *
 * Security tags are stored in resource.meta.security and are used for
 * access control and ownership tracking.
 */
class SecurityTagExtractor {
    /**
     * Extracts access tags from resource metadata
     *
     * Access tags define which scopes/organizations can access this resource.
     *
     * @param {Object} resource - FHIR resource with meta.security
     * @returns {string[]} Array of access codes (may be empty)
     *
     * @example
     * const resource = {
     *   meta: {
     *     security: [
     *       { system: 'https://www.icanbwell.com/access', code: 'client1' },
     *       { system: 'https://www.icanbwell.com/access', code: 'client2' },
     *       { system: 'https://www.icanbwell.com/owner', code: 'owner1' }
     *     ]
     *   }
     * };
     * SecurityTagExtractor.extractAccessTags(resource)
     * // Returns: ['client1', 'client2']
     */
    static extractAccessTags(resource) {
        if (!resource?.meta?.security) {
            return [];
        }

        return resource.meta.security
            .filter(tag => tag.system === SECURITY_TAG_SYSTEMS.ACCESS)
            .map(tag => tag.code)
            .filter(code => code); // Remove undefined/null codes
    }

    /**
     * Extracts owner tags from resource metadata
     *
     * Owner tags define which organizations own/manage this resource.
     *
     * @param {Object} resource - FHIR resource with meta.security
     * @returns {string[]} Array of owner codes (may be empty)
     *
     * @example
     * const resource = {
     *   meta: {
     *     security: [
     *       { system: 'https://www.icanbwell.com/access', code: 'client1' },
     *       { system: 'https://www.icanbwell.com/owner', code: 'owner1' }
     *     ]
     *   }
     * };
     * SecurityTagExtractor.extractOwnerTags(resource)
     * // Returns: ['owner1']
     */
    static extractOwnerTags(resource) {
        if (!resource?.meta?.security) {
            return [];
        }

        return resource.meta.security
            .filter(tag => tag.system === SECURITY_TAG_SYSTEMS.OWNER)
            .map(tag => tag.code)
            .filter(code => code); // Remove undefined/null codes
    }

    /**
     * Extracts source assigning authority from resource metadata
     *
     * @param {Object} resource - FHIR resource with meta.security
     * @returns {string|null} Source assigning authority code or null
     *
     * @example
     * const resource = {
     *   meta: {
     *     security: [
     *       { system: 'https://www.icanbwell.com/sourceAssigningAuthority', code: 'system1' }
     *     ]
     *   }
     * };
     * SecurityTagExtractor.extractSourceAssigningAuthority(resource)
     * // Returns: 'system1'
     */
    static extractSourceAssigningAuthority(resource) {
        if (!resource?.meta?.security) {
            return null;
        }

        const tag = resource.meta.security.find(
            tag => tag.system === SECURITY_TAG_SYSTEMS.SOURCE_ASSIGNING_AUTHORITY
        );

        return tag?.code || null;
    }

    /**
     * Extracts all security tags grouped by system
     *
     * @param {Object} resource - FHIR resource with meta.security
     * @returns {Object} Object with keys: access, owner, sourceAssigningAuthority
     *
     * @example
     * SecurityTagExtractor.extractAllTags(resource)
     * // Returns: { access: ['client1'], owner: ['owner1'], sourceAssigningAuthority: 'system1' }
     */
    static extractAllTags(resource) {
        return {
            access: this.extractAccessTags(resource),
            owner: this.extractOwnerTags(resource),
            sourceAssigningAuthority: this.extractSourceAssigningAuthority(resource)
        };
    }
}

module.exports = { SecurityTagExtractor };
