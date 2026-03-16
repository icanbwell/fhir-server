const BaseSerializer = require('./baseSerializer.js');

class ExportStatusEntrySerializer extends BaseSerializer {
    fhirPropertyToSerializerMap = {
        id: null,
        type: null,
        url: null
    };
}

module.exports = new ExportStatusEntrySerializer();
