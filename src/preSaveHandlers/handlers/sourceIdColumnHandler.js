const { PreSaveHandler } = require('./preSaveHandler');
const { IdentifierSystem } = require('../../utils/identifierSystem');

/**
 * @classdesc Adds the _sourceId internal column if not present
 */
class SourceIdColumnHandler extends PreSaveHandler {
    /**
     * fixes up any resources before they are saved
     * @typedef {Object} PreSaveAsyncProps
     * @property {import('../../fhir/classes/4_0_0/resources/resource')} resource
     *
     * @param {PreSaveAsyncProps}
     * @returns {Promise<import('../../fhir/classes/4_0_0/resources/resource')>}
     */
    async preSaveAsync({ resource }) {
        if (!resource._sourceId) {
            resource._sourceId = resource.id;
        }

        if (resource.identifier && Array.isArray(resource.identifier)) {
            resource.identifier = resource.identifier.filter((s) => s.system !== IdentifierSystem.sourceId);
        }

        return resource;
    }
}

module.exports = {
    SourceIdColumnHandler
};
