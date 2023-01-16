const {SecurityTagStructure} = require('./securityTagStructure');

class ResourceWithSecurityTagStructure {
    /**
     * constructor
     * @param {Resource} resource
     */
    constructor({resource}) {
        /**
         * @type {Resource}
         */
        this.resource = resource;
        /**
         * @type {string}
         */
        this.resourceType = resource.resourceType;
        /**
         * @type {string}
         */
        this.id = resource.id;
        /**
         * @type {SecurityTagStructure}
         */
        this.securityTagStructure = SecurityTagStructure.fromResource({resource});
    }

    /**
     * Returns whether two resources are same
     * @param {ResourceWithSecurityTagStructure} other
     * @return {boolean}
     */
    isSameResourceByIdAndSecurityTag({other}) {
        return (
            this.resourceType === other.resourceType &&
            this.id === other.id &&
            this.securityTagStructure.matchesOnSourceAssigningAuthority(
                {
                    other: other.securityTagStructure
                }
            )
        );
    }

}

module.exports = {
    ResourceWithSecurityTagStructure
};
