const {resolveSchema} = require('../../middleware/fhir/utils/schema.utils');

/**
 * Gets class for Meta
 * @param {string} base_version
 * @returns {function({Object}):Meta} Meta class
 */
module.exports.getMeta = (base_version) => {
    // noinspection JSValidateTypes
    return resolveSchema(base_version, 'Meta');
};
