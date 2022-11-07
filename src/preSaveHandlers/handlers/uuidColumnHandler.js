const {PreSaveHandler} = require('./preSaveHandler');
const {generateUUID, isUuid} = require('../../utils/uid.util');

class UuidColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (!resource._uuid) {
            if (isUuid(resource.id)) {
                resource._uuid = resource.id;
            } else {
                resource._uuid = `${generateUUID()}`;
            }
        }
        return resource;
    }
}

module.exports = {
    UuidColumnHandler
};
