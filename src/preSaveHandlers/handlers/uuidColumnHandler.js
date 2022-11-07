const {PreSaveHandler} = require('./preSaveHandler');
const {generateUUID} = require('../../utils/uid.util');

class UuidColumnHandler extends PreSaveHandler {
    async preSaveAsync({resource}) {
        if (!resource._uuid) {
            resource._uuid = `${generateUUID()}`;
        }
        return resource;
    }
}

module.exports = {
    UuidColumnHandler
};
