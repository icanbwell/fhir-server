const { PreSaveHandler } = require('./preSaveHandler');
const { isUuid, generateUUIDv5, generateUUID } = require('../../utils/uid.util');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const { assertIsValid } = require('../../utils/assertType');
const Resource = require('../../fhir/classes/4_0_0/resources/resource');

/**
 * @classdesc Adds the uuid to the resource if not present
 */
class UuidColumnHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync({ resource }) {
        if (isUuid(resource.id)) {
            resource._uuid = resource.id;
        } else if (!resource.id) {
            resource._uuid = generateUUID();
        } else {
            const sourceAssigningAuthority = resource._sourceAssigningAuthority;
            assertIsValid(
                sourceAssigningAuthority,
                `sourceAssigningAuthority is null for ${resource.resourceType}/${resource.id}`
            );
            resource._uuid = generateUUIDv5(`${resource.id}|${sourceAssigningAuthority}`);
        }

        if (resource.identifier && Array.isArray(resource.identifier)) {
            resource.identifier = resource.identifier.filter((s) => s.system !== IdentifierSystem.uuid);
            if (!(resource instanceof Resource) && resource.identifier.length === 0) {
                delete resource.identifier;
            }
        }

        return resource;
    }
}

module.exports = {
    UuidColumnHandler
};
