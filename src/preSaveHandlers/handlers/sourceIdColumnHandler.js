const {PreSaveHandler} = require('./preSaveHandler');

class SourceIdColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        // if an identifier with system=https://www.icanbwell.com/sourceId exists then use that
        if (resource.identifier && resource.identifier.some(s => s.system === 'https://www.icanbwell.com/sourceId')) {
            resource._sourceId = resource.meta.security.filter(s => s.system === 'https://www.icanbwell.com/sourceId')[0].value;
        } else if (!resource._sourceId) {
            resource._sourceId = resource.id;
        }
        if (resource.identifier && !resource.identifier.some(s => s.system === 'https://www.icanbwell.com/sourceId')) {
            resource.identifier.push(
                {
                    'system': 'https://www.icanbwell.com/sourceId',
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
