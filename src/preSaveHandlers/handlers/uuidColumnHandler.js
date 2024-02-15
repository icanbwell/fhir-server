const { PreSaveHandler } = require('./preSaveHandler');
const { isUuid, generateUUIDv5, generateUUID } = require('../../utils/uid.util');
const { IdentifierSystem } = require('../../utils/identifierSystem');
const Identifier = require('../../fhir/classes/4_0_0/complex_types/identifier');
const { SecurityTagSystem } = require('../../utils/securityTagSystem');
const { assertIsValid, assertTypeEquals } = require('../../utils/assertType');
const { ConfigManager } = require('../../utils/configManager');

/**
 * @classdesc Adds the uuid to the resource if not present
 */
class UuidColumnHandler extends PreSaveHandler {
    /**
     * constructor
     * @param {ConfigManager} configManager
     */
    constructor ({ configManager }) {
        super();
        /**
         * @type {ConfigManager}
         */
        this.configManager = configManager;
        assertTypeEquals(configManager, ConfigManager);
    }

    async preSaveAsync ({ resource }) {
        if (isUuid(resource.id)) {
            resource._uuid = resource.id;
        } else if (!resource.id) {
            resource._uuid = generateUUID();
        } else {
            assertIsValid(resource.meta.security,
                `No meta security tags defined for resource: ${resource.resourceType}/${resource.id}`);
            /**
             * @type {string[]}
             */
            const sourceAssigningAuthorityCodes = resource.meta.security.filter(
                s => s.system === SecurityTagSystem.sourceAssigningAuthority).map(s => s.code);
            const idToGenerateUuid = sourceAssigningAuthorityCodes ?
                resource.id + '|' + sourceAssigningAuthorityCodes[0] :
                resource.id;
            resource._uuid = `${generateUUIDv5(idToGenerateUuid)}`;
        }

        if (resource.identifier &&
            Array.isArray(resource.identifier) &&
            !resource.identifier.some(s => s.system === IdentifierSystem.uuid)
        ) {
            resource.identifier.push(
                new Identifier(
                    {
                        'id': 'uuid',
                        'system': IdentifierSystem.uuid,
                        'value': resource._uuid
                    }
                )
            );
        } else if (resource.identifier && // uuid exists but is wrong
            Array.isArray(resource.identifier) &&
            resource.identifier.some(s => s.system === IdentifierSystem.uuid)) {
            const currentUuidResource = resource.identifier.find(s => s.system === IdentifierSystem.uuid);
            currentUuidResource.id = 'uuid';
            currentUuidResource.value = resource._uuid;
        } else if (!resource.identifier) {
            resource.identifier = [
                new Identifier(
                    {
                        'id': 'uuid',
                        'system': IdentifierSystem.uuid,
                        'value': resource._uuid
                    }
                )
            ];
        }

        return resource;
    }
}

module.exports = {
    UuidColumnHandler
};
