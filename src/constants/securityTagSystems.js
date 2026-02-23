/**
 * Security tag system URLs used in FHIR meta.security
 *
 * These systems are used throughout the codebase to filter resources
 * by access control and ownership.
 */
const SECURITY_TAG_SYSTEMS = {
    /**
     * Access control system - defines which users/groups can access a resource
     * @type {string}
     */
    ACCESS: 'https://www.icanbwell.com/access',

    /**
     * Ownership system - defines which organization owns a resource
     * @type {string}
     */
    OWNER: 'https://www.icanbwell.com/owner'
};

module.exports = {
    SECURITY_TAG_SYSTEMS
};
