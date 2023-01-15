const {SecurityTagSystem} = require('../../utils/securityTagSystem');

class SecurityTagStructure {
    /**
     * constructor
     * @param {string[]|undefined} owner
     * @param {string[]|undefined} access
     * @param {string[]|undefined} vendor
     * @param {string[]|undefined} sourceAssigningAuthority
     */
    constructor({owner, access, vendor, sourceAssigningAuthority}) {
        /**
         * @type {string[]|undefined}
         */
        this.owner = owner;
        /**
         * @type {string[]|undefined}
         */
        this.access = access;
        /**
         * @type {string[]|undefined}
         */
        this.vendor = vendor;
        /**
         * @type {string[]|undefined}
         */
        this.sourceAssigningAuthority = sourceAssigningAuthority;
        if (sourceAssigningAuthority === undefined || sourceAssigningAuthority.length === 0) {
            this.sourceAssigningAuthority = owner;
        }
    }

    /**
     *
     * @param {SecurityTagStructure} other
     * @return {boolean}
     */
    matchesOnSourceAssigningAuthority({other}) {
        return this.sourceAssigningAuthority.some(s => other.sourceAssigningAuthority.includes(s));
    }

    /**
     * Gets SecurityTagStructure from resource
     * @param {Resource} resource
     * @returns {SecurityTagStructure}
     */
    static fromResource({resource}) {
        return new SecurityTagStructure(
            {
                owner: resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.owner)
                    .map(s => s.code),
                access: resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.access)
                    .map(s => s.code),
                vendor: resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.vendor)
                    .map(s => s.code),
                sourceAssigningAuthority: resource.meta.security
                    .filter(s => s.system === SecurityTagSystem.sourceAssigningAuthority)
                    .map(s => s.code),
            }
        );
    }
}

module.exports = {
    SecurityTagStructure
};
