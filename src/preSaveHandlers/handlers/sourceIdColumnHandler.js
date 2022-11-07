const {PreSaveHandler} = require('./preSaveHandler');

class SourceIdColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (!resource._sourceId) {
            resource._sourceId = resource.id;
        }
        return resource;
    }
}

module.exports = {
    SourceIdHandler: SourceIdColumnHandler
};
