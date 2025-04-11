const { ResourceComparer } = require('./resourceComparer');

class ResourceIdentifier {
    /**
     * constructor
     * @param {string} id
     * @param {string} resourceType
     * @param {string} _uuid
     * @param {string} _sourceId
     * @param {string} _sourceAssigningAuthority
     */
    constructor (
        {
            id,
            resourceType,
            _uuid,
            _sourceId,
            _sourceAssigningAuthority
        }
    ) {
        /**
         * @type {string}
         */
        this.id = id;
        /**
         * @type {string}
         */
        this.resourceType = resourceType;
        /**
         * @type {string}
         */
        this._uuid = _uuid;
        /**
         * @type {string}
         */
        this._sourceId = _sourceId;
        /**
         * @type {string}
         */
        this._sourceAssigningAuthority = _sourceAssigningAuthority;
    }

    equals (other) {
        return ResourceComparer.isSameResourceByIdAndSecurityTag(
            {
                first: this,
                second: other
            }
        );
    }
}

module.exports = {
    ResourceIdentifier
};
