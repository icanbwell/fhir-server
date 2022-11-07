const {PreSaveHandler} = require('./preSaveHandler');
const {IdentifierSystem} = require('../../utils/identifierSystem');
const {getFirstElementOrNull} = require('../../utils/list.util');
const Identifier = require('../../fhir/classes/4_0_0/complex_types/identifier');

class SourceIdColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (!resource._sourceId) {
            // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
            if (resource.identifier && resource.identifier.some(s => s.system === IdentifierSystem.sourceId)) {
                resource._sourceId = getFirstElementOrNull(
                    resource.meta.security.filter(s => s.system === IdentifierSystem.sourceId).map(s => s.value));
            }
        }
        if (!resource._sourceId) {
            resource._sourceId = resource.id;
        }

        // if an identifier with system=https://www.icanbwell.com/sourceId does not exist then create it
        if (resource.identifier && !resource.identifier.some(s => s.system === IdentifierSystem.sourceId)) {
            resource.identifier.push(
                new Identifier(
                    {
                        'system': IdentifierSystem.sourceId,
                        'value': resource._sourceId
                    }
                )
            );
        }
        return resource;
    }
}

module.exports = {
    SourceIdColumnHandler
};
