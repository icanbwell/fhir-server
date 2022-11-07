const {PreSaveHandler} = require('./preSaveHandler');
const {generateUUID, isUuid} = require('../../utils/uid.util');
const {IdentifierSystem} = require('../../utils/identifierSystem');
const {getFirstElementOrNull} = require('../../utils/list.util');

class UuidColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (!resource._uuid) {
            // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
            if (resource.identifier && resource.identifier.some(s => s.system === IdentifierSystem.uuid)) {
                resource._uuid = getFirstElementOrNull(
                    resource.meta.security.filter(s => s.system === IdentifierSystem.uuid).map(s => s.value));
            }
        }
        if (!resource._uuid) {
            if (isUuid(resource.id)) {
                resource._uuid = resource.id;
            } else {
                resource._uuid = `${generateUUID()}`;
            }
        }

        if (resource.identifier && !resource.identifier.some(s => s.system === IdentifierSystem.uuid)) {
            resource.identifier.push(
                {
                    'system': IdentifierSystem.uuid,
                    'value': resource._uuid
                }
            );
        }

        return resource;
    }
}

module.exports = {
    UuidColumnHandler
};
