const { resolveSerialzier } = require('../../middleware/fhir/utils/serializer.util');

/**
 * Gets serializer for the given resource_name and version
 * @param {string} base_version
 * @param {string} resource_name
 * @returns {{ serialize: (obj) => obj}}
 */
module.exports.getResourceSerializer = (base_version, resource_name) => {
    return resolveSerialzier(base_version, `${resource_name}serializer`);
};

module.exports.getResourceSerializerByName = (base_version, serializer_name) => {
    return resolveSerialzier(base_version, serializer_name);
};
