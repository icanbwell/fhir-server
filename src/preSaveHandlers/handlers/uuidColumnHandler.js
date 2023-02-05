const {PreSaveHandler} = require('./preSaveHandler');
const {isUuid, generateUUIDv5} = require('../../utils/uid.util');
const {IdentifierSystem} = require('../../utils/identifierSystem');
const {getFirstElementOrNull} = require('../../utils/list.util');
const Identifier = require('../../fhir/classes/4_0_0/complex_types/identifier');
const {SecurityTagSystem} = require('../../utils/securityTagSystem');
const {assertIsValid} = require('../../utils/assertType');

class UuidColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (!resource._uuid) {
            // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
            if (resource.identifier && Array.isArray(resource.identifier) && resource.identifier.some(s => s.system === IdentifierSystem.uuid)) {
                resource._uuid = getFirstElementOrNull(
                    resource.meta.security.filter(s => s.system === IdentifierSystem.uuid).map(s => s.value));
            }
        }
        if (!resource._uuid) {
            if (isUuid(resource.id)) {
                resource._uuid = resource.id;
            } else {
                /**
                 * @type {string[]}
                 */
                const sourceAssigningAuthorityCodes = resource.meta.security.filter(
                    s => s.system === SecurityTagSystem.sourceAssigningAuthority).map(s => s.code);
                assertIsValid(sourceAssigningAuthorityCodes.length > 0,
                    `No sourceAssigningAuthority codes found for resource id: ${resource.id}`);
                const idPlusSourceAssigningAuthority = resource.id + '|' + sourceAssigningAuthorityCodes[0];
                resource._uuid = `${generateUUIDv5(idPlusSourceAssigningAuthority)}`;
            }
        }

        if (resource.identifier && Array.isArray(resource.identifier) && !resource.identifier.some(s => s.system === IdentifierSystem.uuid)) {
            resource.identifier.push(
                new Identifier(
                    {
                        'system': IdentifierSystem.uuid,
                        'value': resource._uuid
                    }
                )
            );
        } else if (!resource.identifier && Object.hasOwn(resource, 'identifier')) {
            resource.identifier = [
                new Identifier(
                    {
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
