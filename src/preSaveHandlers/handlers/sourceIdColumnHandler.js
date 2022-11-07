const {PreSaveHandler} = require('./preSaveHandler');
const {IdentifierSystem} = require('../../utils/identifierSystem');

class SourceIdColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
        if (resource.identifier && resource.identifier.some(s => s.system === IdentifierSystem.sourceId)) {
            resource._sourceId = resource.meta.security.filter(s => s.system === IdentifierSystem.sourceId)[0].value;
        } else if (!resource._sourceId) {
            resource._sourceId = resource.id;
        }
        if (resource.identifier && !resource.identifier.some(s => s.system === IdentifierSystem.sourceId)) {
            resource.identifier.push(
                {
                    'system': IdentifierSystem.sourceId,
                    'value': resource._sourceId
                }
            );
        }
        return resource;
    }
}

module.exports = {
    SourceIdColumnHandler
};
