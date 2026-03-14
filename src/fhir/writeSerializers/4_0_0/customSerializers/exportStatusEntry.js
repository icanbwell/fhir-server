const BaseSerializer = require('./baseSerializer.js');

class ExportStatusEntrySerializer extends BaseSerializer {
    // Private cache for lazy-loaded property configs
    #configCache = {};

    fhirPropertyToSerializerMap = {
        id: null,
        type: null,
        url: null
    };
}

module.exports = new ExportStatusEntrySerializer();
